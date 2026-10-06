'use strict';
// ===== ADCS tuning: TEAM_C stream, step-response metrics, step-test plan, Ground Station log analyzer. Pure logic, no DOM, unit-tested =====
// Board side (our team firmware, NasaPakSoi):
//   TEAM_CSTREAM,<hz>   0..20, 0 = off, over USB and BLE (STOP does not stop it)
//   TM,TEAM_C,T,<ms>,M,<0|1>,TGT,<deg>,ANG,<deg>,EST,<deg>,ERR,<deg>,GZ,<dps>,U,<pct>,I,<pct>,K,<pct>,RW,<pct>,LIT,<0|1>,H,<0|1>,SR,<0|1>[,more]
//   EVT,TEAM_AUTO,ON,TGT,..,EST,..,ANG,..,LIT,..[,KP,..,KD,..,KI,..,SIGN,..,RSIGN,..,MAX,..]   at AUTO entry
//   EVT,TEAM_KICK,<k>,ERR,<e> · EVT,TEAM_HOLD,ON|OFF,ERR,<e> · EVT,TEAM_SUN_SEARCH,START,DIR,<+-1> | FOUND,ANGLE,<a>
// Every line is read as key,value pairs and unknown keys are ignored (the firmware may append more at the end).
NS.adcs = NS.adcs || {};

const AD_NUM = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const adIs = (x) => typeof x === 'number' && Number.isFinite(x);
const adKnown = new Set(['T', 'M', 'TGT', 'ANG', 'EST', 'ERR', 'GZ', 'U', 'I', 'K', 'RW', 'LIT', 'H', 'SR']);

// parsed TM line (NS.ss.parse) -> { T, M, TGT, ANG, EST, ERR, GZ, U, I, K, RW, LIT, H, SR, extra } or null (not TEAM_C / unusable)
NS.adcs.parseC = (p) => {
  if (!p || p.kind !== 'tm' || !p.tm || p.tm.group !== 'TEAM_C') return null;
  const n = p.tm.num;
  if (!(adIs(n.T) && n.T >= 0) || !(adIs(n.ANG) || adIs(n.EST))) return null;
  const row = {};
  const extra = {};
  for (const k of Object.keys(n)) { if (adKnown.has(k)) row[k] = n[k]; else extra[k] = n[k]; }
  row.extra = extra;
  return row;
};

const adKv = (arr, from) => { // [k, v, k, v ...] from an index -> { k: number | text }
  const o = {};
  for (let i = from; i + 1 < arr.length; i += 2) if (arr[i]) o[arr[i]] = AD_NUM.test(arr[i + 1]) ? +arr[i + 1] : arr[i + 1];
  return o;
};
// parsed EVT line -> { type: 'auto' | 'kick' | 'hold' | 'search', ... } or null
NS.adcs.parseEvt = (p) => {
  if (!p || p.kind !== 'evt' || !p.evt) return null;
  const a = p.evt.args || [];
  switch (p.evt.name) {
    case 'TEAM_AUTO': return { type: 'auto', on: a[0] !== 'OFF', ...adKv(a, 1) };
    case 'TEAM_KICK': return { type: 'kick', k: AD_NUM.test(a[0] || '') ? +a[0] : NaN, ...adKv(a, 1) };
    case 'TEAM_HOLD': return { type: 'hold', on: a[0] === 'ON', ...adKv(a, 1) };
    case 'TEAM_SUN_SEARCH': return { type: 'search', what: a[0] || '', ...adKv(a, 1) };
    default: return null;
  }
};

// ---------------------------------------------------------------- step-response metrics
// rows: [{ t (s), TGT, ANG, EST, LIT, GZ, RW, K, ... }] of ONE stretch with a constant target
// o: { tol 2, hold 3, lastS 3, tgt, src 'ang' | 'est', median, satLevel, events [{t, type}], wrongWin 0.7, wrongDeg 1 }
// The angle that counts: src 'ang' = the sun-sensor angle ANG while the lamp is seen (LIT != 0), the estimator EST when it is not;
// src 'est' = always EST (what the controller used). Logs without EST use ANG.
NS.adcs.angleOf = (r, src = 'ang') => {
  if (src === 'est') return adIs(r.EST) ? r.EST : r.ANG;
  if (r.LIT === 0 && adIs(r.EST)) return r.EST;
  return adIs(r.ANG) ? r.ANG : r.EST;
};
const adMed3 = (a) => a.map((v, i) => (i === 0 || i === a.length - 1 ? v : [a[i - 1], v, a[i + 1]].sort((p, q) => p - q)[1]));

NS.adcs.metrics = (rowsIn, o = {}) => {
  const tol = o.tol > 0 ? o.tol : 2;
  const hold = o.hold > 0 ? o.hold : 3;
  const lastS = o.lastS > 0 ? o.lastS : 3;
  const wrongWin = o.wrongWin > 0 ? o.wrongWin : 0.7;
  const wrongDeg = o.wrongDeg >= 0 ? o.wrongDeg : 1;
  const src = o.src === 'est' ? 'est' : 'ang';
  const rows = (rowsIn || []).filter((r) => r && adIs(r.t) && adIs(NS.adcs.angleOf(r, src)));
  if (rows.length < 2) return { ok: false, n: rows.length };
  const t0 = rows[0].t;
  const tau = rows.map((r) => r.t - t0);
  const dur = tau[tau.length - 1];
  let ang = rows.map((r) => NS.adcs.angleOf(r, src));
  if (o.median) ang = adMed3(ang);
  let tgt = o.tgt;
  if (!adIs(tgt)) { const g = rows.map((r) => r.TGT).filter(adIs); tgt = g.length ? NS.median(g) : 0; }
  const err = ang.map((a) => tgt - a);
  const step = tgt - ang[0];
  const dir = Math.abs(step) > tol ? Math.sign(step) : 0; // a start inside the band has no direction of travel
  const m = { ok: true, n: rows.length, dur, tgt, a0: ang[0], step, tol, hold };

  m.tEnter = null; // first time inside the band
  for (let i = 0; i < err.length; i++) if (Math.abs(err[i]) <= tol) { m.tEnter = tau[i]; break; }

  m.tSettle = null; // start of the first stretch that stays inside the band for `hold` s (a gap of data over 1 s ends a stretch)
  let runStart = null;
  for (let i = 0; i < err.length; i++) {
    if (Math.abs(err[i]) <= tol) {
      if (runStart === null || (i > 0 && tau[i] - tau[i - 1] > 1)) runStart = tau[i];
      if (tau[i] - runStart >= hold) { m.tSettle = runStart; break; }
    } else runStart = null;
  }

  m.overshoot = null; // how far past the target in the direction of travel, AFTER the angle first reached the band
  m.overshootPct = null; // (what happens before that is the approach: a spin through other angles is not an overshoot)
  if (dir !== 0) {
    let from = err.findIndex((e) => Math.abs(e) <= tol);
    if (from < 0) from = ang.findIndex((a) => dir * (a - tgt) >= 0); // jumped over the band between two samples
    let ov = 0;
    for (let i = from < 0 ? ang.length : from; i < ang.length; i++) ov = Math.max(ov, dir * (ang[i] - tgt));
    m.overshoot = ov;
    m.overshootPct = (ov / Math.abs(step)) * 100;
  }

  const lastIdx = [];
  for (let i = 0; i < tau.length; i++) if (tau[i] >= dur - lastS) lastIdx.push(i);
  const le = lastIdx.map((i) => err[i]);
  m.ssN = le.length;
  m.ssMean = le.length ? NS.mean(le) : NaN;
  m.ssSD = le.length > 1 ? NS.std(le) : NaN;

  const gz = rows.map((r) => r.GZ).filter(adIs);
  m.maxGZ = gz.length ? Math.max(...gz.map(Math.abs)) : null;

  m.tSat = null; // time with the wheel command at its limit
  if (adIs(o.satLevel) && o.satLevel > 0 && rows.some((r) => adIs(r.RW))) {
    let s = 0;
    for (let i = 0; i < rows.length; i++) {
      const dt = Math.min(i + 1 < rows.length ? tau[i + 1] - tau[i] : (i > 0 ? tau[i] - tau[i - 1] : 0), 0.25);
      if (adIs(rows[i].RW) && Math.abs(rows[i].RW) >= o.satLevel) s += dt;
    }
    m.tSat = s;
  }

  m.kicks = null; // stiction kicks: the EVT,TEAM_KICK events of this stretch, else the rising edges of the K term
  const ev = (o.events || []).filter((e) => e && e.type === 'kick' && e.t >= rows[0].t - 1e-9 && e.t <= rows[rows.length - 1].t + 0.25).length;
  let edges = 0;
  let hasK = false;
  let was = false;
  for (const r of rows) if (adIs(r.K)) { hasK = true; const on = Math.abs(r.K) > 0.5; if (on && !was) edges++; was = on; }
  if (ev > 0) m.kicks = ev; else if (hasK) m.kicks = edges; else if (o.events) m.kicks = 0;

  // wrong way: in the first wrongWin s the angle moves AWAY from the target by more than wrongDeg
  let grow = 0;
  for (let i = 0; i < err.length && tau[i] <= wrongWin; i++) grow = Math.max(grow, Math.abs(err[i]) - Math.abs(err[0]));
  m.wrongDev = grow;
  m.wrong = grow > wrongDeg;
  return m;
};

// rows of a TEAM_C recording -> stretches of constant target while ADCS is in AUTO: [{ tgt, rows }]
NS.adcs.segments = (rows, o = {}) => {
  const auto = (rows || []).filter((r) => r && r.M !== 0);
  const out = [];
  let cur = null;
  for (const r of auto) {
    const tg = adIs(r.TGT) ? r.TGT : (adIs(o.tgt) ? o.tgt : 0);
    if (!cur || Math.abs(tg - cur.tgt) > 1e-6) { cur = { tgt: tg, rows: [] }; out.push(cur); }
    cur.rows.push(r);
  }
  return out.filter((s) => s.rows.length >= (o.minRows || 5));
};
// label of stretch i: "A" for the first, then "A→B" ... with the targets as numbers
NS.adcs.segLabel = (segs, i) => (i === 0 ? `→ ${+segs[0].tgt.toFixed(1)}°` : `${+segs[i - 1].tgt.toFixed(1)}° → ${+segs[i].tgt.toFixed(1)}°`);

// ---------------------------------------------------------------- the step test as a list of steps
// o: { mode 'single' | 'abab', A, B, durS, hz, retarget (current adcs.retarget on the board), keepStream }
// step: { cmd } sent and waited for (ACK) · { cmd, soft: true } an ERR is only a warning · { wait: s } · { mark: 'rec' | 'stop' } start / end of the recording
NS.adcs.plan = (o) => {
  const num = (x, d) => (adIs(+x) && x !== '' && x !== null ? +x : d);
  const A = num(o.A, 0);
  const B = num(o.B, 20);
  const dur = Math.max(5, Math.min(120, num(o.durS, 20)));
  const hz = Math.max(1, Math.min(20, Math.round(num(o.hz, 20))));
  const abab = o.mode === 'abab';
  const bad = [];
  for (const [n, v] of abab ? [['A', A], ['B', B]] : [['A', A]]) if (!(Math.abs(v) <= 80)) bad.push(`เป้า ${n} = ${v}° อยู่นอก ±80° (ช่วงที่เซนเซอร์แสงอ่านได้)`);
  if (abab && Math.abs(A - B) < 1) bad.push('A กับ B ต้องต่างกันอย่างน้อย 1°');
  const fmt = (x) => +x.toFixed(3);
  const steps = [{ cmd: 'STOP' }, { cmd: 'ADCS_STRATEGY,REACTION', soft: true }];
  if (abab && o.retarget !== 1) steps.push({ cmd: 'TEAM_SET,adcs.retarget,1' });
  steps.push({ cmd: `TEAM_CSTREAM,${hz}` }, { cmd: 'ADCS_REFERENCE,SUN' }, { cmd: `SET_TARGET,${fmt(A)}` }, { mark: 'rec' }, { cmd: 'ADCS_MODE,AUTO' });
  if (abab) {
    const t = dur / 3;
    steps.push({ wait: t }, { cmd: `SET_TARGET,${fmt(B)}` }, { wait: t }, { cmd: `SET_TARGET,${fmt(A)}` }, { wait: t });
  } else steps.push({ wait: dur });
  steps.push({ cmd: 'STOP' }, { wait: 0.4 }, { mark: 'stop' });
  if (!o.keepStream) steps.push({ cmd: 'TEAM_CSTREAM,0', soft: true });
  if (abab && o.retarget !== 1) steps.push({ cmd: 'TEAM_SET,adcs.retarget,0', soft: true }); // back to what it was (RAM only, but the next test should not inherit it)
  return { steps, bad, dur, hz, A, B, abab };
};

// ---------------------------------------------------------------- parameters
// the keys the page shows first, with what they do (from Team_Params.h); the board may list more: those go under "other"
NS.adcs.PARAMS = [
  ['adcs.kp', 'Kp: แรงสั่งล้อต่อ error ยิ่งมากยิ่งไว แต่เสี่ยงแกว่ง', '', 0, 20],
  ['adcs.kd', 'Kd: เบรกตามอัตราหมุน (gyro) ลดการแกว่ง/overshoot', '', 0, 20],
  ['adcs.ki', 'Ki: integral ชดเชยแรงเสียดทานที่ทำให้หยุดก่อนถึงเป้า (0 = ปิด)', '%/(°·s)', 0, 10],
  ['adcs.db', 'Deadband: error ต่ำกว่านี้ไม่สั่งล้อ', '°', 0, 30],
  ['adcs.max', 'คำสั่งล้อสูงสุดที่ ADCS ใช้', '%', 0, 100],
  ['adcs.kick', 'แรงเตะแก้ฝืด: เมื่อยังไม่ขยับ เพิ่มคำสั่งล้อทีเดียวเท่านี้ (0 = ปิด)', '%', 0, 60],
  ['adcs.kickMs', 'รอนานเท่าไรที่ยังไม่ขยับก่อนเตะ', 'ms', 100, 10000],
  ['adcs.krate', 'ถือว่า "ยังไม่ขยับ" เมื่อ gyro ต่ำกว่านี้', '°/s', 0, 30],
  ['adcs.lock', 'เข้าโหมด HOLD เมื่อ error อยู่ในเกณฑ์นี้ (0 = ปิด HOLD)', '°', 0, 10],
  ['adcs.unlock', 'ออกจาก HOLD เมื่อ error เกินเกณฑ์นี้', '°', 0, 30],
  ['adcs.lockMs', 'ต้องอยู่ในเกณฑ์ lock นานเท่าไรจึงเข้า HOLD', 'ms', 0, 10000],
  ['adcs.hgain', 'ตัวคูณ Kp/Kd/Ki ตอน HOLD', '', 0.05, 1],
  ['adcs.srate', 'ความเร็วหมุนหาแสงเมื่อไม่เห็นหลอด (0 = ไม่หา)', '°/s', 0, 60],
  ['adcs.sk', 'gain ของลูปความเร็วตอนหาแสง', '', 0, 20],
  ['adcs.ghold', 'ไม่เห็นหลอด: 1 = ใช้ gyro ต่อมุมไปก่อน', '0/1', 0, 1],
  ['adcs.retarget', 'อนุญาตให้ SET_TARGET ตอน AUTO (ใช้ในการทดสอบ A→B→A)', '0/1', 0, 1],
  ['rw.slew', 'จำกัดความชันของคำสั่งล้อ (0 = กระโดดทันที)', '%/s', 0, 5000],
  ['rw.minStart', 'คำสั่งล้อต่ำสุดที่ล้อเริ่มหมุน', '%', 0, 100],
  ['rw.minStable', 'คำสั่งล้อต่ำสุดที่ล้อหมุนต่อได้', '%', 0, 100],
];
NS.adcs.paramInfo = (key) => { const r = NS.adcs.PARAMS.find((x) => x[0] === key); return r ? { key, text: r[1], unit: r[2], min: r[3], max: r[4] } : null; };
// the parameters worth recording with every run (everything ADCS and the wheel use)
NS.adcs.isRunParam = (key) => /^(adcs|rw)\./.test(key) || key === 'imu.rsign' || key === 'imu.gbz';
// "kp 2 · kd 0.5 · ki 0.02 …" for the table
NS.adcs.paramText = (p, keys = ['adcs.kp', 'adcs.kd', 'adcs.ki', 'adcs.db', 'adcs.max', 'adcs.kick', 'adcs.lock']) => keys.filter((k) => p && adIs(p[k])).map((k) => `${k.replace(/^adcs\./, '')} ${+(+p[k]).toPrecision(4)}`).join(' · ');
// "KP 2 · KD 0.5 ..." of the EVT,TEAM_AUTO line (what the controller really had at AUTO entry)
NS.adcs.autoText = (a) => {
  if (!a) return '';
  const f = (k) => (adIs(a[k]) ? `${k} ${+a[k].toPrecision(4)}` : '');
  return [f('EST'), f('ANG'), a.LIT === 0 ? 'ไม่เห็นหลอด' : '', f('KP'), f('KD'), f('KI'), f('SIGN'), f('RSIGN'), f('MAX')].filter(Boolean).join(' · ');
};

// ---------------------------------------------------------------- results table -> CSV
// items: [{ id, label, source, wall (ms), seg (label), m (metrics), params {key: value}, auto, note }]
NS.adcs.CSV_HEAD = ['run', 'source', 'time', 'step', 'target_deg', 'from_deg', 'tol_deg', 'hold_s', 'enter_s', 'settle_s', 'overshoot_deg', 'overshoot_pct', 'steady_mean_deg', 'steady_sd_deg', 'max_abs_gz_dps', 'wheel_saturated_s', 'kicks', 'wrong_way', 'rows', 'duration_s'];
NS.adcs.toCSV = (items) => {
  const keys = [...new Set(items.flatMap((it) => Object.keys(it.params || {})))].sort();
  const akeys = ['TGT', 'EST', 'ANG', 'LIT', 'KP', 'KD', 'KI', 'SIGN', 'RSIGN', 'MAX'];
  const q = (v) => { const s = v === null || v === undefined ? '' : adIs(v) ? String(+v.toFixed(4)) : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = [...NS.adcs.CSV_HEAD, ...keys.map((k) => 'p.' + k), ...akeys.map((k) => 'auto.' + k), 'note'];
  const lines = [head.join(',')];
  for (const it of items) {
    const m = it.m || {};
    const t = it.wall ? new Date(it.wall).toISOString() : '';
    const base = [it.id, it.source, t, it.seg, m.tgt, m.a0, m.tol, m.hold, m.tEnter, m.tSettle, m.overshoot, m.overshootPct, m.ssMean, m.ssSD, m.maxGZ, m.tSat, m.kicks, m.wrong === undefined ? '' : m.wrong ? 1 : 0, m.n, m.dur];
    lines.push([...base, ...keys.map((k) => (it.params || {})[k]), ...akeys.map((k) => (it.auto || {})[k]), it.note || ''].map(q).join(','));
  }
  return lines.join('\n');
};

// ---------------------------------------------------------------- Ground Station log (START LOG csv)
// timestamp,sun_l,sun_r,sun_ndv,sun_angle_deg,mag_x_uT,mag_y_uT,mag_z_uT,mag_heading_deg,gyro_x_dps,gyro_y_dps,gyro_z_dps,rw_cmd
// The timestamp has 1 s resolution and ~25 rows arrive per second: the rows of one second are spread evenly over it.
// gyro_z of logs written before the firmware fix mixes two sources with opposite signs: only |gyro_z| is used.
NS.adcs.gsParse = (text) => {
  const lines = String(text == null ? '' : text).replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim().length);
  if (!lines.length) throw new Error('ไฟล์ว่าง');
  const head = lines[0].split(',').map((s) => s.trim());
  const col = (n) => head.indexOf(n);
  const ci = { ts: col('timestamp'), ang: col('sun_angle_deg'), rw: col('rw_cmd'), gz: col('gyro_z_dps'), l: col('sun_l'), r: col('sun_r') };
  if (ci.ts < 0 || ci.ang < 0 || ci.rw < 0) throw new Error('ไม่ใช่ไฟล์ log ของ Ground Station: ต้องมีคอลัมน์ timestamp, sun_angle_deg, rw_cmd');
  const groups = [];
  let bad = 0;
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',');
    const m = /^(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d):(\d\d)/.exec((c[ci.ts] || '').trim());
    const ang = c[ci.ang] === undefined || c[ci.ang].trim() === '' ? NaN : +c[ci.ang];
    const rw = c[ci.rw] === undefined || c[ci.rw].trim() === '' ? NaN : +c[ci.rw];
    if (!m || !adIs(ang) || !adIs(rw)) { bad++; continue; }
    const sec = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000;
    const row = { ANG: ang, RW: rw, GZ: ci.gz >= 0 && adIs(+c[ci.gz]) && c[ci.gz].trim() !== '' ? Math.abs(+c[ci.gz]) : undefined, clock: `${m[4]}:${m[5]}:${m[6]}`, day: `${m[1]}-${m[2]}-${m[3]}` };
    if (ci.l >= 0) row.L = +c[ci.l];
    if (ci.r >= 0) row.R = +c[ci.r];
    const g = groups[groups.length - 1];
    if (g && g.sec === sec) g.rows.push(row); else groups.push({ sec, rows: [row] });
  }
  const rows = [];
  for (const g of groups) g.rows.forEach((r, i) => { r.t = g.sec + i / g.rows.length; rows.push(r); });
  const base = rows.length ? rows[0].t : 0;
  for (const r of rows) r.t -= base; // seconds from the first row
  return { rows, n: rows.length, bad, secs: groups.length, from: rows.length ? rows[0].clock : '', to: rows.length ? rows[rows.length - 1].clock : '', day: rows.length ? rows[0].day : '' };
};

// stretches where rw_cmd != 0 (zero gaps up to o.gap s stay inside the stretch) -> [{ i0, i1, rows, clock, t0, t1, nz }]
NS.adcs.gsRuns = (rows, o = {}) => {
  const gap = o.gap >= 0 ? o.gap : 3;
  const minDur = o.minDur >= 0 ? o.minDur : 2;
  const minNz = o.minNz >= 0 ? o.minNz : 10;
  const runs = [];
  let cur = null;
  rows.forEach((r, i) => {
    if (!(adIs(r.RW) && r.RW !== 0)) return;
    if (cur && r.t - cur.lastNz <= gap) { cur.i1 = i; cur.lastNz = r.t; cur.nz++; } else { if (cur) runs.push(cur); cur = { i0: i, i1: i, lastNz: r.t, nz: 1 }; }
  });
  if (cur) runs.push(cur);
  return runs
    .map((r) => ({ i0: r.i0, i1: r.i1, nz: r.nz, rows: rows.slice(r.i0, r.i1 + 1), clock: rows[r.i0].clock, t0: rows[r.i0].t, t1: rows[r.i1].t }))
    .filter((r) => r.t1 - r.t0 >= minDur && r.nz >= minNz);
};

// the metrics of a GS run: target tgt (default 0), no LIT / EST / TGT in the log
NS.adcs.gsMetrics = (run, o = {}) => {
  const tgt = adIs(o.tgt) ? o.tgt : 0;
  const rows = run.rows.map((r) => ({ ...r, t: r.t - run.rows[0].t }));
  let satLevel = o.satLevel;
  if (!(satLevel > 0)) { const mx = Math.max(...run.rows.map((r) => Math.abs(r.RW)).filter(adIs)); satLevel = mx - 1; } // adcs.max unknown: the largest command seen
  return NS.adcs.metrics(rows, { median: true, ...o, tgt, satLevel });
};
