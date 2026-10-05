'use strict';
// ===== SunSeek protocol: the organizer's firmware (SunSeek Platform v2.1). Pure logic, no DOM, unit-tested =====
// Source of truth: System_CommandRouter.h, System_Telemetry.h, System_TTC.h in the organizer folder.
// One message per "\n", plain comma lists.
//   host -> board : CMD[,arg...]            case-sensitive, the board trims spaces around commas, max 240 characters
//   board -> host : PONG                    the reply to PING
//                   ACK,<CMD>[,args]        accepted; CMD is the first comma-token of the command that was sent
//                   ERR,<CODE>[,args]       refused; it does NOT say which command it refuses
//                   TM,KEY,VALUE,...        telemetry. An even number of tokens after "TM" = KEY,VALUE pairs;
//                                           an odd number = the first token is a GROUP name, then pairs
//                   TM,HELP,<text>          help text, not data
//                   EVT,<NAME>[,args]       event
//                   PAYLOAD,<line>          a line of the camera board forwarded as it is
//                   anything else           boot banner, "BLE client connected", "Payload UART: ..."
// Commands that get no ACK: PING (PONG), HELP and the *_RAW / *_STATUS readers (TM lines only).
NS.ss = NS.ss || {};

NS.ss.MAX_LINE = 240; // TTC_MAX_RX_LINE: a longer command is dropped by the board with ERR,RX_LINE_TOO_LONG
NS.ss.NO_ACK = new Set(['HELP', 'GYRO_RAW', 'MAG_RAW', 'SUN_RAW', 'TM_STREAM_STATUS', 'MISSION_STATUS']); // reply = TM lines only

const SS_NUM = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

// same trimming as the board's ttcNormalizeCommand: no spaces at the ends or around commas
NS.ss.norm = (cmd) => String(cmd == null ? '' : cmd).trim().split(',').map((s) => s.trim()).join(',');

// One line -> { kind, raw, ... }. kind: pong | ack | err | tm | help | evt | payload | text. Never throws.
//   ack {cmd, args} · err {code, args} · evt {name, args} · tm {group|null, kv:{KEY:'text'}, num:{KEY:number}}
//   help (text) · payload {sub, args, text}
NS.ss.parse = function (raw) {
  let line = '';
  try { line = String(raw == null ? '' : raw).replace(/^﻿/, '').trim(); } catch (_) { line = ''; }
  const out = { kind: 'text', raw: line };
  try {
    if (line === 'PONG') { out.kind = 'pong'; return out; }
    const c = line.indexOf(',');
    if (c <= 0) return out;
    const head = line.slice(0, c).trim();
    const rest = line.slice(c + 1);
    const tok = rest.split(',').map((s) => s.trim());
    if (head === 'ACK') {
      if (tok[0]) { out.kind = 'ack'; out.ack = { cmd: tok[0], args: tok.slice(1) }; }
    } else if (head === 'ERR') {
      if (tok[0]) { out.kind = 'err'; out.err = { code: tok[0], args: tok.slice(1) }; }
    } else if (head === 'EVT') {
      if (tok[0]) { out.kind = 'evt'; out.evt = { name: tok[0], args: tok.slice(1) }; }
    } else if (head === 'PAYLOAD') {
      out.kind = 'payload'; out.payload = { sub: tok[0], args: tok.slice(1), text: rest.trim() };
    } else if (head === 'TM') {
      if (tok[0] === 'HELP') { out.kind = 'help'; out.help = rest.replace(/^\s*HELP\s*,?\s*/, ''); return out; }
      if (tok.every((s) => s === '')) return out; // "TM," carries nothing
      const odd = tok.length % 2 === 1;
      const kv = Object.create(null);
      const num = Object.create(null);
      for (let i = odd ? 1 : 0; i + 1 < tok.length; i += 2) {
        if (!tok[i]) continue;
        kv[tok[i]] = tok[i + 1];
        if (SS_NUM.test(tok[i + 1])) num[tok[i]] = +tok[i + 1];
      }
      out.kind = 'tm'; out.tm = { group: odd ? tok[0] || null : null, kv, num };
    }
  } catch (_) { return { kind: 'text', raw: line }; }
  return out;
};

// Does this line come from the organizer firmware? (used to suggest the protocol switch)
NS.ss.looksLikeSunSeek = (line) => {
  const s = String(line == null ? '' : line).trim();
  return s === 'PONG' || /^(?:ACK|ERR|TM|EVT|PAYLOAD),/.test(s) || /^SUNSEEK PLATFORM\b/.test(s) || /^Spacecraft ID: SUNSEEK-/.test(s);
};

// Latest value of every TM key (with the time it arrived), last ACK / ERR, recent events. apply() never throws.
NS.ss.State = class {
  constructor(o = {}) {
    this.maxEvents = o.maxEvents ?? 50;
    this.maxHelp = o.maxHelp ?? 100;
    this.maxKeys = o.maxKeys ?? 1000; // a corrupt stream must not grow this without limit
    this.clear();
  }
  clear() {
    this.vals = Object.create(null); // 'KEY' or 'GROUP.KEY' -> { v: 'text', n: number|null, t: ms }
    this.nKeys = 0;
    this.lastAck = null; // { cmd, args, t, raw }
    this.lastErr = null; // { code, args, t, raw }
    this.events = []; // newest last: { name, args, t, raw }
    this.help = []; // the TM,HELP texts
    this.lastPong = 0;
    this.lastPayload = null; // { sub, args, text, t }
    this.banner = ''; // "SUNSEEK PLATFORM v2.1 ..." (boot)
    this.spacecraftId = ''; // from "Spacecraft ID: ..." (boot)
    this.lines = 0; // lines applied since clear()
    this.lastAt = 0;
  }
  apply(p, t = Date.now()) {
    try {
      if (!p || typeof p !== 'object') return this;
      this.lines++;
      this.lastAt = t;
      switch (p.kind) {
        case 'tm': {
          const g = p.tm.group;
          for (const k of Object.keys(p.tm.kv)) {
            const key = g ? `${g}.${k}` : k;
            if (!(key in this.vals)) { if (this.nKeys >= this.maxKeys) continue; this.nKeys++; }
            this.vals[key] = { v: p.tm.kv[k], n: k in p.tm.num ? p.tm.num[k] : null, t };
          }
          break;
        }
        case 'ack': this.lastAck = { cmd: p.ack.cmd, args: p.ack.args, t, raw: p.raw }; break;
        case 'err': this.lastErr = { code: p.err.code, args: p.err.args, t, raw: p.raw }; break;
        case 'evt':
          this.events.push({ name: p.evt.name, args: p.evt.args, t, raw: p.raw });
          while (this.events.length > this.maxEvents) this.events.shift();
          break;
        case 'help':
          this.help.push(p.help);
          while (this.help.length > this.maxHelp) this.help.shift();
          break;
        case 'pong': this.lastPong = t; break;
        case 'payload': this.lastPayload = { sub: p.payload.sub, args: p.payload.args, text: p.payload.text, t }; break;
        default: {
          const raw = String(p.raw || '');
          if (/^SUNSEEK PLATFORM\b/.test(raw)) this.banner = raw;
          const m = raw.match(/^Spacecraft ID:\s*(\S.*)$/);
          if (m) this.spacecraftId = m[1];
        }
      }
    } catch (_) { /* a bad line never breaks the stream */ }
    return this;
  }
  keys(prefix = '') { return Object.keys(this.vals).filter((k) => k.startsWith(prefix)); }
  get(key) { const e = this.vals[key]; return e ? e.v : undefined; } // text of the last value
  num(key) { const e = this.vals[key]; return e && e.n !== null ? e.n : NaN; } // number, NaN when not numeric / unknown
  at(key) { const e = this.vals[key]; return e ? e.t : 0; } // when it arrived (ms), 0 = never
  age(key, now = Date.now()) { const e = this.vals[key]; return e ? now - e.t : Infinity; }
  toObject() { const o = {}; for (const k of Object.keys(this.vals)) o[k] = this.vals[k].v; return o; }
};

// Sends commands to the board one at a time and tells whether each one was accepted.
//   transport : any object with write(line) (returns nothing or a Promise)
//   feed(line): the owner calls this for EVERY line that arrives (it parses, updates the State, completes the command)
//   send(cmd) : Promise of { ok, reply, timeout? } that never rejects. One command is in flight, the others wait (FIFO).
//     ok       : PING -> PONG · any other command -> ACK whose cmd = the first comma-token of the command ·
//                the *_RAW / HELP readers (no ACK) -> the first TM / TM,HELP line
//     not ok   : any ERR line while the command is in flight (the board's ERR does not name the command, so an ERR
//                caused by something else, e.g. ERR,SENSOR_SNAPSHOT_READ_FAILED from a stream, fails it too) ·
//                { timeout: true } when nothing completes it in `timeout` ms · { error } when it cannot be written
//     Limits: a TM line that is part of a running stream also completes a no-ACK reader; a late ACK of a command that
//     timed out can complete the next command with the same name.
NS.ss.Client = class {
  constructor(transport, o = {}) {
    this.tr = transport;
    this.timeout = o.timeout > 0 ? o.timeout : 1500;
    this.state = o.state || new NS.ss.State();
    this.now = o.now || Date.now;
    this.queue = [];
    this.cur = null;
  }
  get waiting() { return this.queue.length + (this.cur ? 1 : 0); }

  feed(raw) {
    const p = NS.ss.parse(raw);
    this.state.apply(p, this.now());
    const j = this.cur;
    if (j) {
      if (p.kind === 'err') this._done(j, { ok: false, reply: p });
      else if (j.mode === 'ping' ? p.kind === 'pong' : j.mode === 'noack' ? p.kind === 'tm' || p.kind === 'help' : p.kind === 'ack' && p.ack.cmd === j.name) this._done(j, { ok: true, reply: p });
    }
    return p;
  }

  send(cmd, o = {}) {
    const text = String(cmd == null ? '' : cmd).trim();
    const bad = this._bad(text);
    if (bad) return Promise.resolve({ ok: false, error: bad, reply: null, cmd: text });
    const norm = NS.ss.norm(text);
    const mode = norm === 'PING' ? 'ping' : NS.ss.NO_ACK.has(norm) ? 'noack' : 'ack';
    return new Promise((resolve) => {
      this.queue.push({ cmd: text, name: norm.split(',')[0], mode, timeout: o.timeout > 0 ? o.timeout : this.timeout, resolve });
      this._pump();
    });
  }

  // Straight to the board, ahead of everything that waits (for STOP). Nothing is waited for: ACK,STOP shows up as a line.
  sendNow(cmd) {
    const text = String(cmd == null ? '' : cmd).trim();
    const bad = this._bad(text);
    if (bad) return Promise.resolve({ ok: false, error: bad });
    try { return Promise.resolve(this.tr.write(text)).then(() => ({ ok: true }), (e) => ({ ok: false, error: this._msg(e) })); } catch (e) { return Promise.resolve({ ok: false, error: this._msg(e) }); }
  }

  // the link is gone: everything that waits ends now, not ok
  abort(why = 'aborted') {
    const jobs = this.cur ? [this.cur, ...this.queue] : [...this.queue];
    if (this.cur) clearTimeout(this.cur.timer);
    this.cur = null;
    this.queue = [];
    for (const j of jobs) j.resolve({ ok: false, aborted: true, error: why, reply: null, cmd: j.cmd });
  }

  _bad(text) {
    if (!text) return 'empty';
    if (/[\r\n]/.test(text)) return 'newline';
    if (text.length > NS.ss.MAX_LINE) return 'too long';
    return '';
  }
  _msg(e) { return e && e.message ? e.message : String(e); }
  _pump() {
    if (this.cur) return;
    const job = this.queue.shift();
    if (!job) return;
    this.cur = job;
    job.t0 = this.now();
    job.timer = setTimeout(() => this._done(job, { ok: false, timeout: true, reply: null }), job.timeout);
    try {
      const r = this.tr.write(job.cmd);
      if (r && typeof r.then === 'function') r.then(null, (e) => this._done(job, { ok: false, error: this._msg(e), reply: null }));
    } catch (e) { this._done(job, { ok: false, error: this._msg(e), reply: null }); }
  }
  _done(job, res) {
    if (this.cur !== job) return; // already finished (reply and timeout can race)
    clearTimeout(job.timer);
    this.cur = null;
    job.resolve({ cmd: job.cmd, ms: this.now() - job.t0, ...res });
    if (this.queue.length) queueMicrotask(() => this._pump());
  }
};

// ===== our team firmware on the SunSeek board (NasaPakSoi-team, TEAM_* commands) =====
// Its sun model is the same estimator as 04_estimator.js (parity-tested in SunSeek/host_test), parameters sun.*.
NS.ss.LUT_MAX = 256; // TEAM_LUT_MAX

// web estimator params (NS.fit.calibrate().est) -> the exact command list that loads them, switches the board to the team
// model (sun.model 1) and saves. Throws (Thai) when a value is outside what the firmware accepts.
NS.ss.teamLines = (e) => {
  if (!e) throw new Error('ยังไม่มีผล Fit');
  if (!(e.alpha >= 1 && e.alpha <= 89)) throw new Error(`α ${(+e.alpha).toFixed(2)}° อยู่นอกช่วงที่เฟิร์มแวร์ทีมรับ (1..89°): Fit ใหม่ในโหมด SunSeek`);
  const p6 = (v) => (+v).toPrecision(6);
  const L = [
    `TEAM_SET,sun.vcc,${e.vcc ?? 3300}`, `TEAM_SET,sun.topo,${e.topo ?? 0}`,
    `TEAM_SET,sun.gamma,${e.gamma.toFixed(4)}`, `TEAM_SET,sun.gammaR,${(e.gammaR || 0).toFixed(4)}`,
    `TEAM_SET,sun.qL,${e.qL.toFixed(4)}`, `TEAM_SET,sun.qR,${e.qR.toFixed(4)}`, `TEAM_SET,sun.alpha,${e.alpha.toFixed(3)}`,
    `TEAM_SET,sun.g,${p6(e.g)}`, `TEAM_SET,sun.aL,${p6(e.aL)}`, `TEAM_SET,sun.aR,${p6(e.aR)}`,
    `TEAM_SET,sun.minS,${p6(e.minS)}`, `TEAM_SET,sun.dmax,${e.dmax ?? 0.95}`, `TEAM_SET,sun.th0,${+(e.th0 || 0).toFixed(3)}`,
  ];
  const v = e.lut && e.lut.v ? e.lut.v : [];
  if (v.length) {
    if (v.length > NS.ss.LUT_MAX) throw new Error(`LUT ${v.length} ค่า เกิน ${NS.ss.LUT_MAX}: เพิ่มความละเอียดตาราง (°) แล้ว Fit ใหม่`);
    if (v.some((x) => !(Math.abs(x) <= 90))) throw new Error('ค่าใน LUT เกิน ±90°: ข้อมูล Sweep ผิดปกติ');
    L.push(`TEAM_LUT_BEGIN,${e.lut.x0},${e.lut.dx},${v.length}`);
    for (let i = 0; i < v.length;) { // as many values per line as fit well under the 240-character limit
      let line = `TEAM_LUT_DATA,${i}`;
      let j = i;
      while (j < v.length && line.length + 1 + String(v[j]).length <= 200) line += ',' + v[j++];
      L.push(line);
      i = j;
    }
    L.push('TEAM_LUT_END', 'TEAM_SET,sun.lut,1');
  } else L.push('TEAM_LUT_CLEAR', 'TEAM_SET,sun.lut,0');
  L.push('TEAM_SET,sun.model,1', 'TEAM_SAVE');
  return L;
};

// average of TM,TEAM_T readings ({MVL, MVR, SAT, TH, ANG, ...} numbers) -> {n, mvL, mvR, sdL, sdR, sat, th, ang} or null
NS.ss.avgTeamT = (rows) => {
  const ok = (rows || []).filter((r) => r && Number.isFinite(r.MVL) && Number.isFinite(r.MVR));
  if (!ok.length) return null;
  const mean = (k) => { const a = ok.map((r) => r[k]).filter(Number.isFinite); return a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN; };
  const sd = (k, mu) => Math.sqrt(ok.reduce((s, r) => s + (r[k] - mu) ** 2, 0) / ok.length);
  const mvL = mean('MVL');
  const mvR = mean('MVR');
  return { n: ok.length, mvL, mvR, sdL: sd('MVL', mvL), sdR: sd('MVR', mvR), sat: ok.some((r) => r.SAT === 1), th: mean('TH'), ang: mean('ANG') };
};

// new sun.th0 so that the angle read now (with the current th0) becomes `ref`; the firmware accepts -90..90
NS.ss.th0For = (curTh0, readDeg, ref) => {
  const v = curTh0 + (ref - readDeg);
  if (!Number.isFinite(v) || Math.abs(v) > 90) throw new Error(`th0 ใหม่ ${NS.isNum(v) ? v.toFixed(2) : v}° เกิน ±90°: ตรวจว่าหันเข้าหาหลอดและใช้โมเดลทีมอยู่`);
  return +v.toFixed(3);
};

// ---- W3 sign checks on TM,TEAM_T rows ({T ms, ANG = SUN_ANGLE the ADCS uses, GZ = BODY_RATE after imu.rsign, LIT, SAT})
// The organizer's estimator predicts angle += BODY_RATE*dt and its control law brakes with -Kd*BODY_RATE, so both need
// d(SUN_ANGLE)/dt = +BODY_RATE (imu.rsign), and a + wheel command must make SUN_ANGLE grow (adcs.sign).
const ssUsable = (r) => r && Number.isFinite(r.T) && Number.isFinite(r.ANG) && r.LIT !== 0 && r.SAT !== 1;

// turned by hand (wheel off): regression of BODY_RATE on d(SUN_ANGLE)/dt.
// verdict: ok (keep imu.rsign) | flip (multiply imu.rsign by -1) | move (not turned enough) | nogyro | unclear
NS.ss.gyroSign = (rows) => {
  const r = (rows || []).filter(ssUsable);
  const d = [], g = [];
  for (let i = 1; i + 1 < r.length; i++) {
    const dt = (r[i + 1].T - r[i - 1].T) / 1000;
    if (!(dt > 0 && dt < 0.5) || !Number.isFinite(r[i].GZ)) continue;
    d.push((r[i + 1].ANG - r[i - 1].ANG) / dt);
    g.push(r[i].GZ);
  }
  const n = d.length;
  const maxRate = n ? Math.max(...d.map(Math.abs)) : 0;
  const sdd = Math.sqrt(d.reduce((s, x) => s + x * x, 0));
  const sgg = Math.sqrt(g.reduce((s, x) => s + x * x, 0));
  const sdg = d.reduce((s, x, i) => s + x * g[i], 0);
  const out = { n, maxRate, slope: sdd ? sdg / (sdd * sdd) : NaN, corr: sdd && sgg ? sdg / (sdd * sgg) : NaN };
  // 1 deg/s: before calibration the organizer's 90*NDV squeezes the angle ~6x (a 15 deg/s turn reads ~2.5 deg/s); only the sign matters
  if (n < 10 || maxRate < 1) return { ...out, verdict: 'move' };
  if (!(sgg / Math.sqrt(n) > 0.5)) return { ...out, verdict: 'nogyro' }; // rms body rate under 0.5 deg/s while the sun angle moved
  out.verdict = out.corr > 0.7 && out.slope > 0.3 ? 'ok' : out.corr < -0.7 && out.slope < -0.3 ? 'flip' : 'unclear';
  return out;
};

// a short + wheel kick at tKick (ms, board clock): how SUN_ANGLE moved. verdict: sign (+1 keep / -1) for adcs.sign as
// it must be, or 'unclear' (moved less than 0.3 deg: kick harder, or the platform sticks)
NS.ss.kickSign = (rows, tKick, cmdSign = 1) => {
  const r = (rows || []).filter(ssUsable);
  const mean = (a) => (a.length ? a.reduce((s, x) => s + x.ANG, 0) / a.length : NaN);
  const before = mean(r.filter((x) => x.T >= tKick - 400 && x.T <= tKick));
  const after = mean(r.filter((x) => x.T >= tKick + 500 && x.T <= tKick + 900));
  const delta = after - before;
  const gz = r.filter((x) => x.T >= tKick && x.T <= tKick + 600 && Number.isFinite(x.GZ)).map((x) => x.GZ);
  const rate = gz.length ? gz.reduce((s, x) => s + x, 0) / gz.length : NaN;
  if (!Number.isFinite(delta)) return { delta, rate, verdict: 'nodata' };
  if (Math.abs(delta) < 0.3) return { delta, rate, verdict: 'unclear' }; // the organizer model shows ~1/6 of the real turn
  return { delta, rate, verdict: Math.sign(delta) * cmdSign };
};

// Short Thai fix for an ERR code of the organizer firmware (single codes, so "ERR ADCS_PREPARE GYRO_NOT_READY" works too).
// Takes a text that contains the code (an ERR line, a toast); '' when it knows nothing.
NS.ss.errHelp = (() => {
  const READ = 'อ่านเซนเซอร์ไม่สำเร็จ: เช็กสาย IMU / ตัวรับแสง แล้วกด STATUS ดู SENSOR_*';
  const T = {
    UNKNOWN_COMMAND: 'ไม่รู้จักคำสั่ง (ต้องพิมพ์ตัวพิมพ์ใหญ่ตรงตามชื่อ): พิมพ์ HELP ดูรายการ',
    RX_LINE_TOO_LONG: 'คำสั่งยาวเกิน 240 ตัวอักษร: พิมพ์ให้สั้นลง',
    PAYLOAD_RX_LINE_TOO_LONG: 'บรรทัดจากกล้อง (payload) ยาวเกินไป: เช็กสาย UART ของ ESP32-CAM',
    RW_REQUIRES_REACTION_STRATEGY: 'สั่ง RW ได้เฉพาะกลยุทธ์ REACTION: ส่ง ADCS_STRATEGY,REACTION ก่อน (ต้องอยู่โหมด MANUAL)',
    RW_BIAS_REQUIRES_MOMENTUM_STRATEGY: 'สั่ง RW_BIAS ได้เฉพาะกลยุทธ์ MOMENTUM: ส่ง ADCS_STRATEGY,MOMENTUM ก่อน (ต้องอยู่โหมด MANUAL)',
    RW_INVALID_OR_RANGE: 'RW ต้องเป็นตัวเลข −100 ถึง 100',
    RW_BIAS_INVALID_OR_RANGE: 'RW_BIAS ต้องเป็นตัวเลข 0 ถึง 100',
    MANUAL_RW_COMMAND_REQUIRES_MANUAL_MODE: 'ตอนนี้โหมด AUTO ล้อถูก ADCS คุมอยู่: ส่ง STOP หรือ ADCS_MODE,MANUAL ก่อนสั่งล้อเอง',
    RW_CMD_REQUIRES_MANUAL_MODE: 'ตอนนี้โหมด AUTO ล้อถูก ADCS คุมอยู่: ส่ง STOP หรือ ADCS_MODE,MANUAL ก่อนสั่งล้อเอง',
    STRATEGY_CHANGE_REQUIRES_MANUAL: 'เปลี่ยนกลยุทธ์ได้เฉพาะโหมด MANUAL: ส่ง ADCS_MODE,MANUAL (หรือ STOP) ก่อน',
    REFERENCE_CHANGE_REQUIRES_MANUAL: 'เปลี่ยนตัวอ้างอิง (SUN / MAG) ได้เฉพาะโหมด MANUAL',
    TARGET_INVALID_VALUE: 'SET_TARGET ต้องตามด้วยตัวเลข (องศา) เช่น SET_TARGET,0',
    TARGET_OUT_OF_RANGE_OR_AUTO: 'ตั้งเป้าไม่ได้: อยู่โหมด AUTO หรือเป้านอกช่วง (SUN −90..90, MAG 0..360)',
    ADCS_SENSOR_NOT_READY: 'เข้าโหมด AUTO ไม่ได้ เพราะอ่านเซนเซอร์ไม่ได้: กด STATUS ดู SENSOR_*',
    ADCS_TUNE_SYNTAX: 'ADCS_TUNE ต้องมี 3 ค่า: ADCS_TUNE,<Kp>,<Kd>,<Bias>',
    ADCS_TUNE_OUT_OF_RANGE: 'ค่า Kp / Kd / Bias อยู่นอกช่วงที่ firmware ยอมรับ (Bias ต้อง 0..100)',
    GYRO_NOT_READY: 'ไจโรยังไม่พร้อม (SENSOR_GYRO ต้องเป็น READY): เช็กสาย IMU แล้วรีเซ็ตบอร์ด',
    TM_RATE_RANGE_1_TO_20: 'TM_RATE ต้องอยู่ระหว่าง 1 ถึง 20',
    MISSION_CLEAR_NOT_IDLE: 'ล้างเป้าไม่ได้: ภารกิจต้องเป็น IDLE (ส่ง MISSION_RESET ก่อน)',
    MISSION_TARGET_FORMAT: 'MISSION_TARGET ต้องมี 3 ค่า: MISSION_TARGET,<มุม>,<เกณฑ์ ±>,<เวลาคงเป้า s>',
    MISSION_TARGET_INVALID: 'เพิ่มเป้าไม่ได้: ภารกิจต้องเป็น IDLE, เป้าไม่เกิน 10 ตัว, เกณฑ์ 0..30°, เวลาคงเป้า 0..60 s',
    MISSION_MAX_MIN_INVALID: 'MISSION_MAX_MIN ต้องเป็น 1..15, 20 หรือ 30 นาที และภารกิจต้องเป็น IDLE หรือ READY',
    MISSION_PREPARE: 'เตรียมภารกิจไม่ได้: ต้องมีเป้าอย่างน้อย 1 ตัว (MISSION_TARGET) และภารกิจเป็น IDLE',
    MISSION_START_NOT_READY: 'เริ่มภารกิจไม่ได้: ต้อง MISSION_PREPARE ให้เป็น READY ก่อน',
    MISSION_NOT_AVAILABLE_T04: 'คำสั่งภารกิจแบบเก่าใช้ไม่ได้: ใช้ MISSION_CLEAR, MISSION_TARGET, MISSION_PREPARE, MISSION_START',
    ESTIMATOR_MA_WINDOW_RANGE_1_TO_500: 'ESTIMATOR_MA_WINDOW ต้องเป็นเลข 1 ถึง 500',
    ESTIMATOR_FILTER_RANGE_0_TO_1: 'ESTIMATOR_FILTER ต้องเป็นเลข 0 ถึง 1',
    ESTIMATOR_GYRO_WEIGHT_RANGE_0_TO_1: 'ESTIMATOR_GYRO_WEIGHT ต้องเป็นเลข 0 ถึง 1',
    // our team firmware (TEAM_*); the organizer's firmware answers TEAM_* with UNKNOWN_COMMAND
    TEAM_UNKNOWN_KEY: 'ไม่รู้จักชื่อค่านี้: พิมพ์ TEAM_LIST ดูชื่อทั้งหมด',
    TEAM_RANGE: 'ค่าอยู่นอกช่วงที่เฟิร์มแวร์ทีมรับ (ตัวเลขหลังชื่อคือช่วง ต่ำสุด,สูงสุด)',
    TEAM_VALUE: 'ค่าต้องเป็นตัวเลข',
    TEAM_SET_SYNTAX: 'รูปแบบคือ TEAM_SET,<ชื่อ>,<ค่า>',
    TEAM_REQUIRES_MANUAL: 'เปลี่ยนค่านี้ได้เฉพาะโหมด MANUAL: กด STOP ก่อน',
    TEAM_SAVE_FLASH: 'บันทึกลง flash ไม่สำเร็จ: ลอง TEAM_SAVE อีกครั้ง',
    TEAM_DEFAULTS_NEEDS_YES: 'ต้องพิมพ์ TEAM_DEFAULTS,YES (ล้างค่าที่จูนทั้งหมด)',
    TEAM_LUT_NOT_STARTED: 'ต้องส่ง TEAM_LUT_BEGIN ก่อน TEAM_LUT_DATA',
    TEAM_LUT_INCOMPLETE: 'LUT ส่งมาไม่ครบ: ส่งชุดคำสั่งคาลิเบรตใหม่ทั้งชุด',
    TEAM_LUT_BEGIN_SYNTAX: 'TEAM_LUT_BEGIN,<x0>,<dx>,<n> (n ไม่เกิน 256)',
    TEAM_LUT_DATA_SYNTAX: 'TEAM_LUT_DATA,<เริ่มที่>,<ค่า>,...',
    TEAM_LUT_DATA_VALUE: 'ค่าใน LUT ผิด (ต้องไม่เกิน ±90 และไม่เกินจำนวนที่ประกาศ)',
    TEAM_STREAM_RANGE_0_TO_20: 'TEAM_STREAM ต้องเป็น 0 ถึง 20',
    TEAM_UNKNOWN_COMMAND: 'ไม่รู้จักคำสั่ง TEAM_ นี้',
    RW_CMD_REQUIRES_MOMENTUM_STRATEGY: 'RW_CMD ใช้ได้เฉพาะกลยุทธ์ MOMENTUM: ส่ง ADCS_STRATEGY,MOMENTUM แล้ว RW_BIAS ก่อน',
    RW_CMD_SYNTAX: 'รูปแบบ RW_CMD,<delta>,<assist>,<ms> เช่น RW_CMD,+20,+80,300 (ms ไม่เกิน 5000)',
    RW_CMD_OUT_OF_RANGE: 'RW_CMD: bias + delta ต้องอยู่ 0..100 และ assist −100..100',
    SENSOR_SNAPSHOT_READ_FAILED: READ,
    SENSOR_RAW_READ_FAILED: READ,
    GYRO_READ_FAILED: READ,
    ACC_READ_FAILED: READ,
    MAG_READ_FAILED: READ,
    SUN_READ_FAILED: READ,
  };
  return (text) => {
    for (const w of String(text == null ? '' : text).split(/[^A-Za-z0-9_]+/)) if (Object.prototype.hasOwnProperty.call(T, w)) return T[w];
    return '';
  };
})();
