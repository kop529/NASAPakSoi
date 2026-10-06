'use strict';
// ===== ADCS tuning page (SunSeek + our team firmware): parameters, step test, live plot, results table, Ground Station log =====
// Logic (parsing, metrics, the command plan, CSV, GS log) lives in 02c_adcs.js and is unit-tested; this file is the page.
(function () {
  if (typeof document === 'undefined' || !NS.app) return;
  const { $, el } = NS;
  const S = NS.state;
  const A = (NS.adcsUi = {
    params: {}, paramOrder: [], dirty: new Set(), listSeen: null,
    runs: [], nextId: 1, rec: null, live: [], streamHz: 0, lastRow: null, lastAt: 0,
    busy: false, abort: false, phase: '', t0rec: 0, planDur: 0, view: null, gs: null, sel: null,
  });
  const num = (id, d) => { const v = $(id).value; return v === '' || !Number.isFinite(+v) ? d : +v; };
  const ready = () => !!(S.tr && S.connected && S.proto === 'sunseek');
  const why = (r) => NS.app.ssWhy(r);
  const cmd = (c, timeout = 3000) => S.ss.client.send(c, { timeout });

  // ------------------------------------------------------------------ lines from the board
  function addRow(run, row) {
    if (run.T0 === undefined) run.T0 = row.T;
    if (run.lastT !== undefined && row.T < run.lastT - 1000) return; // the board restarted: its clock went back
    run.lastT = row.T;
    run.rows.push({ ...row, t: (row.T - run.T0) / 1000 });
  }
  NS.bus.on('ss:line', (p) => {
    const row = NS.adcs.parseC(p);
    if (row) {
      A.lastRow = row; A.lastAt = Date.now();
      if (A.rec) addRow(A.rec, row);
      else {
        if (A.live.length && row.T < A.live[A.live.length - 1].T - 1000) A.live.length = 0;
        A.live.push({ ...row, t: row.T / 1000 });
        if (A.live.length > 1200) A.live.splice(0, 200);
      }
      return;
    }
    if (p.kind === 'ack') {
      if (p.ack.cmd === 'TEAM_CSTREAM') A.streamHz = +p.ack.args[0] || 0;
      else if (p.ack.cmd === 'TEAM_SET' && p.ack.args.length >= 2 && Number.isFinite(+p.ack.args[1])) { A.params[p.ack.args[0]] = +p.ack.args[1]; refreshParamRow(p.ack.args[0]); }
      return;
    }
    if (p.kind === 'tm' && p.tm.group === 'TEAM_PARAM') {
      for (const k of Object.keys(p.tm.num)) {
        if (!(k in A.params)) A.paramOrder.push(k);
        A.params[k] = p.tm.num[k];
        if (A.listSeen) A.listSeen.add(k);
      }
      return;
    }
    const ev = NS.adcs.parseEvt(p);
    if (ev && A.rec) {
      const t = A.rec.rows.length ? A.rec.rows[A.rec.rows.length - 1].t : 0;
      A.rec.events.push({ ...ev, t });
      if (ev.type === 'auto' && ev.on && !A.rec.auto) A.rec.auto = ev;
    }
  });
  NS.bus.on('stop', () => { if (A.busy) A.abort = true; });
  NS.bus.on('link', (st) => {
    if (st === 'open') { A.streamHz = 0; return; }
    A.streamHz = 0; A.listSeen = null;
    if (A.busy) A.abort = true;
  });

  // ------------------------------------------------------------------ parameters
  async function readParams() {
    A.listSeen = new Set();
    const r = await cmd('TEAM_LIST', 5000);
    if (!r.ok) { A.listSeen = null; throw new Error(`TEAM_LIST: ${why(r)}`); }
    const n = +r.reply.ack.args[0] || 0;
    for (let k = 0; k < 160 && A.listSeen && A.listSeen.size < n; k++) await NS.sleep(25);
    A.listSeen = null;
    A.dirty.clear();
    renderParams();
  }
  function paramRow(key) {
    const info = NS.adcs.paramInfo(key);
    const inp = el('input', { type: 'number', step: 'any', value: A.params[key], 'data-p': key });
    inp.disabled = A.busy;
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
    inp.addEventListener('change', () => setParam(key, inp.value));
    return el('div', { class: 'cfg-row', 'data-p': key },
      el('div', { class: 'key' }, key, el('span', { class: 'tag', text: 'ยังไม่ SAVE' })),
      el('div', { class: 'val' }, inp, el('span', { class: 'u', text: info ? info.unit : '' })),
      el('div', { class: 'def', text: info ? `${info.min}..${info.max}` : '' }),
      el('div', { class: 'desc', text: info ? info.text : '' }));
  }
  function refreshParamRow(key) {
    const row = $(`.cfg-row[data-p="${CSS.escape(key)}"]`);
    if (!row) return;
    const inp = row.querySelector('input');
    if (document.activeElement !== inp) inp.value = A.params[key];
    row.classList.toggle('dirty', A.dirty.has(key));
    $('#adDirty').textContent = A.dirty.size ? `ยังไม่ SAVE ${A.dirty.size}` : '';
    renderPlan();
  }
  function renderParams() {
    const box = $('#adParams');
    if (!A.paramOrder.length) { box.replaceChildren(el('p', { class: 'note', text: 'ยังไม่ได้อ่านค่าจากบอร์ด: กด "อ่านค่าจากบอร์ด" (ต้องต่อบอร์ดที่ใช้เฟิร์มแวร์ทีมแล้ว)' })); return; }
    const known = NS.adcs.PARAMS.map((r) => r[0]).filter((k) => k in A.params);
    const other = A.paramOrder.filter((k) => !NS.adcs.paramInfo(k));
    box.replaceChildren(
      el('div', { class: 'cfg-group' }, el('h2', { text: 'ค่าควบคุม ADCS และล้อ (แก้แล้วเข้าบอร์ดทันที ยังไม่ถาวร)' }), ...known.map(paramRow)),
      other.length ? el('details', { class: 'cfg-group' }, el('summary', { text: `ค่าอื่นที่บอร์ดรายงาน · ${other.length} ค่า (เซนเซอร์แสง, IMU, ...)` }), ...other.map(paramRow)) : null);
    $('#adDirty').textContent = '';
    renderPlan();
  }
  async function setParam(key, text) {
    const v = +text;
    const info = NS.adcs.paramInfo(key);
    const back = () => { refreshParamRow(key); };
    if (text === '' || !Number.isFinite(v)) { NS.toast(`${key}: ต้องเป็นตัวเลข`, 'bad'); back(); return; }
    if (info && (v < info.min || v > info.max)) { NS.toast(`${key}: ต้องอยู่ระหว่าง ${info.min} ถึง ${info.max}`, 'bad'); back(); return; }
    if (!ready()) { NS.toast('ยังไม่ได้เชื่อมต่อ', 'warn'); back(); return; }
    const r = await cmd(`TEAM_SET,${key},${v}`);
    if (!r.ok) { NS.toast(`${key}: ${why(r)}`, 'bad', 7000); back(); return; }
    A.dirty.add(key);
    refreshParamRow(key);
  }
  async function saveParams() {
    if (!ready()) { NS.toast('ยังไม่ได้เชื่อมต่อ', 'warn'); return; }
    const r = await cmd('TEAM_SAVE', 5000);
    if (!r.ok) { NS.toast(`TEAM_SAVE: ${why(r)}`, 'bad', 7000); return; }
    const keys = [...A.dirty];
    A.dirty.clear();
    keys.forEach(refreshParamRow);
    $('#adDirty').textContent = '';
    NS.toast('บันทึกถาวรในบอร์ดแล้ว (TEAM_SAVE)', 'good');
  }
  const snapshotParams = () => Object.fromEntries(Object.entries(A.params).filter(([k]) => NS.adcs.isRunParam(k)));

  // ------------------------------------------------------------------ the step test
  const inputs = () => ({ mode: $('input[name=adMode]:checked').value, A: num('#adA', 0), B: num('#adB', 20), durS: num('#adDur', 20), hz: num('#adHz', 20), tol: num('#adTol', 2), hold: num('#adHold', 3), src: $('#adSrc').value });
  function renderPlan() {
    const i = inputs();
    $('#adBRow').hidden = i.mode !== 'abab';
    const p = NS.adcs.plan({ ...i, retarget: A.params['adcs.retarget'] });
    $('#adPlan').textContent = p.steps.map((s) => (s.cmd ? `> ${s.cmd}${s.soft ? '   (ถ้าบอร์ดไม่รับ ข้ามไป)' : ''}` : s.wait ? `  … รอ ${+s.wait.toFixed(1)} วินาที` : s.mark === 'rec' ? '  --- เริ่มบันทึก TM,TEAM_C ---' : '  --- จบการบันทึก ---')).join('\n');
    const ph = p.dur / 3;
    $('#adPlanNote').textContent = i.mode === 'abab' ? `เวลาแบ่งเป็น 3 ช่วงเท่า ๆ กัน: ช่วงละ ${+ph.toFixed(1)} วินาที (ที่ A ก่อน, ที่ B, แล้วกลับ A)${ph < 8 ? ' · สั้นไปสำหรับตัวควบคุมที่ช้า ถ้าผลขึ้น "ไม่นิ่ง" ให้เพิ่มเวลาทั้งหมดเป็น 36 วินาทีขึ้นไป' : ''}` : `บันทึก ${+p.dur.toFixed(0)} วินาทีหลังเข้า AUTO แล้วส่ง STOP`;
    $('#adPlanWarn').textContent = p.bad.join(' · ');
    $('#adPlanWarn').hidden = !p.bad.length;
    $('#adRun small').textContent = i.mode === 'abab' ? `AUTO · ${+(p.dur).toFixed(0)} s · A→B→A` : `AUTO · ${+(p.dur).toFixed(0)} s`;
  }
  function setBusy(b) {
    A.busy = b;
    $('#adRun').disabled = b;
    $('#adLive').disabled = b;
    $('#adRead').disabled = b;
    $('#adSave').disabled = b;
    for (const e of document.querySelectorAll('#adParams input')) e.disabled = b;
  }
  async function waitFor(sec) {
    const t0 = performance.now();
    while ((performance.now() - t0) / 1000 < sec) {
      if (A.abort) return;
      if (!S.connected) { A.abort = true; throw new Error('การเชื่อมต่อหลุดระหว่างทดสอบ'); }
      if (A.rec && !A.rec.rows.length && performance.now() - A.t0rec > 3500) throw new Error('ไม่ได้รับ TM,TEAM_C เลยใน 3.5 วินาที: เฟิร์มแวร์ยังไม่มี TEAM_CSTREAM หรือสตรีมไม่ออก');
      await NS.sleep(40);
    }
  }
  async function runTest() {
    if (A.busy) return;
    if (!ready()) { NS.toast('ยังไม่ได้เชื่อมต่อ (หน้า "เชื่อมต่อ" เลือก SunSeek)', 'warn'); return; }
    const inp = inputs();
    setBusy(true);
    A.abort = false;
    const run = { id: A.nextId, source: 'board', wall: Date.now(), rows: [], events: [], params: {}, auto: null, mode: inp.mode, note: '' };
    let plan = null;
    let iPost = 0;
    let err = null;
    let armed = false;
    try {
      A.phase = 'อ่านค่าพารามิเตอร์ (TEAM_LIST)…';
      await readParams();
      if (!Number.isFinite(A.params['adcs.kp'])) throw new Error('ไม่เห็น adcs.kp ในค่าของบอร์ด: ต้องใช้เฟิร์มแวร์ทีม (NasaPakSoi-team) ที่มี TEAM_LIST');
      run.params = snapshotParams();
      plan = NS.adcs.plan({ ...inp, retarget: A.params['adcs.retarget'] });
      if (plan.bad.length) throw new Error(plan.bad.join(' · '));
      A.planDur = plan.dur;
      let lastWait = -1;
      plan.steps.forEach((s, i) => { if (s.wait && s.wait > 1) lastWait = i; });
      iPost = lastWait + 1; // what comes after the last wait (STOP, stream off, ...) always runs, also after an error or STOP
      for (let i = 0; i < iPost; i++) {
        if (A.abort) throw new Error('หยุดโดยผู้ใช้ (STOP)');
        const st = plan.steps[i];
        if (st.mark === 'rec') { A.rec = run; A.t0rec = performance.now(); A.phase = 'บันทึก…'; continue; }
        if (st.wait) { await waitFor(st.wait); continue; }
        if (!st.cmd) continue;
        armed = true;
        const r = await cmd(st.cmd, 4000);
        if (!r.ok) {
          const m = `${st.cmd}: ${why(r)}${/^SET_TARGET/.test(st.cmd) && inp.mode === 'abab' ? ' (ต้องตั้ง adcs.retarget = 1 ถึงเปลี่ยนเป้าตอน AUTO ได้)' : ''}`;
          if (st.soft) NS.toast(m + ' · ข้ามไป', 'warn', 5000); else throw new Error(m);
        }
      }
      if (A.abort) throw new Error('หยุดโดยผู้ใช้ (STOP)');
    } catch (e) { err = e; }
    // end of the run, always: STOP, the tail of the stream, stream off, retarget back
    A.phase = 'หยุด…';
    try {
      if (armed && S.connected) await S.ss.client.sendNow('STOP'); // at once, before anything else
      if (plan) {
        for (let i = iPost; i < plan.steps.length; i++) {
          const st = plan.steps[i];
          if (st.mark === 'stop') { A.rec = null; continue; }
          if (st.wait) { await NS.sleep(st.wait * 1000); continue; }
          if (st.cmd === 'STOP') { if (S.connected) await S.ss.client.sendNow('STOP'); continue; }
          if (st.cmd && S.connected) { const r = await cmd(st.cmd, 3000); if (!r.ok) NS.toast(`${st.cmd}: ${why(r)}`, 'warn', 5000); }
        }
      }
    } catch (e) { console.error(e); }
    A.rec = null;
    A.phase = '';
    if (err) run.note = err.message;
    if (A.abort) run.note = run.note || 'หยุดกลางคัน';
    if (run.rows.length >= 5) {
      A.runs.push(run); A.nextId++; A.view = run; A.sel = run.id;
      renderTable();
      const it = items().find((x) => x.run === run);
      if (it && it.m.ok) NS.app.addEvidence('adcs_run', `ทดสอบ ADCS #${it.id}: ${NS.adcs.paramText(run.params)} · เข้า ±${it.m.tol}° ${NS.fmt(it.m.tEnter, 1)} s · นิ่ง ${NS.fmt(it.m.tSettle, 1)} s · overshoot ${NS.fmt(it.m.overshoot, 1)}°${it.m.wrong ? ' · ผิดทิศ' : ''}`, { id: run.id, params: run.params, m: it.m });
    } else if (!err) err = new Error('ได้ข้อมูล TEAM_C น้อยเกินไป');
    if (err) NS.toast(`ทดสอบไม่สมบูรณ์: ${err.message}`, A.abort && /STOP/.test(err.message) ? 'warn' : 'bad', 8000);
    else NS.toast('ทดสอบเสร็จ: ดูผลในตารางด้านล่าง', 'good');
    A.abort = false;
    setBusy(false);
    renderTable();
  }
  async function toggleLive() {
    if (A.busy) return;
    if (!ready()) { NS.toast('ยังไม่ได้เชื่อมต่อ', 'warn'); return; }
    const r = await cmd(A.streamHz > 0 ? 'TEAM_CSTREAM,0' : 'TEAM_CSTREAM,10');
    if (!r.ok) NS.toast(`TEAM_CSTREAM: ${why(r)}`, 'bad', 7000);
  }

  // ------------------------------------------------------------------ results
  const satOf = (run) => { const mx = run.auto && Number.isFinite(run.auto.MAX) ? run.auto.MAX : run.params['adcs.max']; return Number.isFinite(mx) ? mx - 1 : undefined; };
  function items() {
    const tol = num('#adTol', 2);
    const hold = num('#adHold', 3);
    const src = $('#adSrc').value;
    const out = [];
    for (const run of A.runs) {
      if (run.gs) { out.push({ run, id: String(run.id), seg: run.label, m: NS.adcs.gsMetrics(run, { tgt: run.tgt, satLevel: run.satLevel, tol, hold }) }); continue; }
      const segs = NS.adcs.segments(run.rows);
      if (!segs.length) { out.push({ run, id: String(run.id), seg: 'ไม่มีช่วง AUTO', m: { ok: false } }); continue; }
      segs.forEach((sg, i) => out.push({ run, id: segs.length > 1 ? `${run.id}.${i + 1}` : String(run.id), seg: NS.adcs.segLabel(segs, i), first: i === 0, m: NS.adcs.metrics(sg.rows, { tol, hold, src, tgt: sg.tgt, satLevel: satOf(run), events: run.events }) }));
    }
    return out;
  }
  const f1 = (x, d = 1) => (NS.isNum(x) ? x.toFixed(d).replace(/^-/, '−') : '—');
  function renderTable() {
    const its = items();
    const body = $('#adTable tbody');
    body.replaceChildren(...its.map((it) => {
      const m = it.m;
      const tr = el('tr', { class: it.run.id === A.sel ? 'sel' : '' });
      const td = (text, cls = '') => tr.append(el('td', { class: cls, text }));
      td(it.id);
      td(it.run.gs ? it.run.clock : NS.clock(it.run.wall).slice(0, 8));
      td(it.seg);
      if (!m.ok) { td(it.run.note || 'ข้อมูลไม่พอ'); for (let k = 0; k < 8; k++) td(''); tr.append(el('td')); }
      else {
        td(`${f1(m.tgt)}° จาก ${f1(m.a0)}°`, 'num');
        tr.append(el('td', { class: 'num' + (m.tEnter === null ? ' bad' : ''), text: m.tEnter === null ? 'ไม่เข้า' : `${f1(m.tEnter)} s` }));
        tr.append(el('td', { class: 'num' + (m.tSettle === null ? ' bad' : ''), text: m.tSettle === null ? 'ไม่นิ่ง' : `${f1(m.tSettle)} s` }));
        td(m.overshoot === null ? '—' : `${f1(m.overshoot)}° (${f1(m.overshootPct, 0)}%)`, 'num');
        td(`${f1(m.ssMean, 2)} ± ${f1(m.ssSD, 2)}°`, 'num');
        td(m.maxGZ === null ? '—' : f1(m.maxGZ, 0), 'num');
        td(m.tSat === null ? '—' : `${f1(m.tSat)} s`, 'num');
        td(m.kicks === null ? '—' : String(m.kicks), 'num');
        tr.append(el('td', { class: m.wrong ? 'bad' : '', text: m.wrong ? `ผิดทิศ ${f1(m.wrongDev)}°` : '—' }));
        const pc = el('td', { class: 'ad-params' });
        if (it.run.gs) pc.append(el('div', { text: `log GS · ${it.run.note || ''}` }));
        else if (it.first) { pc.append(el('div', { text: NS.adcs.paramText(it.run.params) })); if (it.run.auto) pc.append(el('div', { class: 'muted', title: 'EVT,TEAM_AUTO: ค่าที่ตัวควบคุมมีตอนเข้า AUTO', text: 'AUTO: ' + NS.adcs.autoText(it.run.auto) })); if (it.run.note) pc.append(el('div', { class: 'muted', text: it.run.note })); }
        else pc.append(el('div', { class: 'muted', text: '″' }));
        pc.title = Object.entries(it.run.params || {}).map(([k, v]) => `${k} = ${v}`).join('\n');
        tr.append(pc);
      }
      tr.addEventListener('click', () => { A.view = it.run; A.sel = it.run.id; renderTable(); });
      return tr;
    }));
    $('#adEmpty').hidden = its.length > 0;
    $('#adExport').disabled = !its.length;
    $('#adRaw').disabled = !A.view;
  }
  const csvItems = () => items().map((it) => ({ id: it.id, source: it.run.source, wall: it.run.wall, seg: it.seg, m: it.m, params: it.run.params, auto: it.run.auto, note: it.run.note }));
  function rawCsv(run) {
    const cols = ['t', 'T', 'M', 'TGT', 'ANG', 'EST', 'ERR', 'GZ', 'U', 'I', 'K', 'RW', 'LIT', 'H', 'SR'];
    return [cols.join(','), ...run.rows.map((r) => cols.map((c) => (NS.isNum(r[c]) ? +r[c].toFixed(4) : '')).join(','))].join('\n');
  }

  // ------------------------------------------------------------------ Ground Station log
  function analyzeGs() {
    const out = $('#adGsOut');
    if (!A.gs) return;
    A.runs = A.runs.filter((r) => r.gsFile !== A.gs.name);
    let g;
    try { g = NS.adcs.gsParse(A.gs.text); } catch (e) { out.textContent = e.message; NS.toast(e.message, 'bad'); renderTable(); return; }
    const runs = NS.adcs.gsRuns(g.rows, { gap: num('#adGsGap', 3) });
    const tgt = num('#adGsTgt', 0);
    const mx = num('#adGsMax', NaN);
    for (const r of runs) {
      const rows = r.rows.map((x) => ({ ...x, t: x.t - r.rows[0].t }));
      A.runs.push({ id: A.nextId++, source: 'GS', gs: true, gsFile: A.gs.name, wall: null, clock: r.clock, rows, tgt, satLevel: Number.isFinite(mx) ? mx - 1 : undefined, label: `GS ${r.clock} (${NS.fmt(r.t1 - r.t0, 0)} s)`, params: {}, auto: null, events: [], note: A.gs.name });
    }
    out.textContent = `${A.gs.name}: ${g.n} แถว, ${g.secs} วินาที (${g.from}–${g.to})${g.bad ? `, ข้าม ${g.bad} แถวที่อ่านไม่ได้` : ''} · พบ ${runs.length} รอบที่ rw_cmd ≠ 0${runs.length ? ' (อยู่ในตารางด้านบนแล้ว คลิกแถวเพื่อดูกราฟ)' : ''}`;
    if (runs.length) { A.view = A.runs[A.runs.length - 1]; A.sel = A.view.id; }
    renderTable();
  }

  // ------------------------------------------------------------------ live tiles, charts
  const tiles = {};
  function buildTiles() {
    const defs = [['mode', 'โหมด'], ['tgt', 'เป้า (TGT)'], ['ang', 'มุมเซนเซอร์ (ANG)'], ['est', 'มุมตัวประมาณ (EST)'], ['rw', 'ล้อ (RW)'], ['gz', 'อัตราหมุน (GZ)'], ['st', 'สถานะ']];
    $('#adTiles').replaceChildren(...defs.map(([k, label]) => {
      const v = el('span', { class: 'v', text: '—' });
      const u = el('span', { class: 'u', text: '' });
      tiles[k] = { v, u, label };
      return el('div', { class: 'stat' }, el('div', { class: 'k', text: label }), el('div', {}, v, u));
    }));
  }
  const setTile = (k, v, u = '') => { const t = tiles[k]; const s = String(v).replace(/^-(?=\d)/, '−'); if (t.v.textContent !== s) t.v.textContent = s; if (t.u.textContent !== u) t.u.textContent = u; };
  function updateTiles() {
    const r = A.lastRow;
    const fresh = r && Date.now() - A.lastAt < 1500;
    if (!fresh) { for (const k of Object.keys(tiles)) setTile(k, '—'); setTile('st', A.streamHz > 0 ? 'ไม่มีข้อมูลเข้า' : 'สตรีมปิด'); return; }
    setTile('mode', r.M === 1 ? 'AUTO' : 'MANUAL');
    setTile('tgt', NS.fmt(r.TGT, 1), '°');
    setTile('ang', r.LIT === 0 ? 'ไม่เห็นหลอด' : NS.fmt(r.ANG, 1), r.LIT === 0 ? '' : '°');
    setTile('est', NS.fmt(r.EST, 1), '°');
    setTile('rw', NS.isNum(r.RW) ? r.RW.toFixed(0) : '—', '%');
    setTile('gz', NS.fmt(r.GZ, 1), '°/s');
    setTile('st', r.H === 1 ? 'HOLD' : r.SR === 1 ? 'ค้นหาแสง' : r.M === 1 ? 'ควบคุม' : 'ปกติ');
  }
  const charts = [];
  const lay = (rows, key, x, label, color, extra = {}) => { const data = rows.filter((r) => NS.isNum(r[key])).map((r) => [x(r), r[key]]); return data.length ? { type: 'line', color, label, data, ...extra } : null; }; // a series the source does not have (GS log: no EST, U, I) is left out
  let viewSig = '';
  function updateCharts() {
    let rows = null;
    let x = (r) => r.t;
    let run = null;
    if (A.rec) { rows = A.rec.rows; run = A.rec; } else if (A.view) { rows = A.view.rows; run = A.view; } else if (A.live.length) {
      const last = A.live[A.live.length - 1].t;
      rows = A.live.filter((r) => r.t >= last - 20);
      x = (r) => r.t - last;
    }
    if (!rows || !rows.length) { const sig = 'none'; if (viewSig !== sig) { viewSig = sig; charts.forEach((c) => c.set([])); } return; }
    const tol = num('#adTol', 2);
    const sig = `${run ? run.id : 'live'}|${rows.length}|${rows[rows.length - 1].t}|${tol}`;
    if (sig === viewSig) return;
    viewSig = sig;
    const gs = run && run.gs;
    const withTgt = gs ? rows.map((r) => ({ ...r, TGT: run.tgt })) : rows;
    const tg = withTgt.filter((r) => NS.isNum(r.TGT));
    const band = (d) => ({ type: 'line', color: 'var(--faint)', dash: [3, 4], width: 1, data: tg.map((r) => [x(r), r.TGT + d]) });
    charts[0].set([band(tol), band(-tol), lay(withTgt, 'TGT', x, 'เป้า TGT', 'var(--muted)', { dash: [6, 4] }), lay(rows, 'EST', x, 'EST (ตัวประมาณ)', 'var(--ink)', { width: 1.5 }), lay(rows, 'ANG', x, gs ? 'sun_angle_deg' : 'ANG (เซนเซอร์แสง)', 'var(--ch-l)')].filter(Boolean));
    charts[1].set([lay(rows, 'RW', x, gs ? 'rw_cmd (%)' : 'RW (%)', 'var(--ch-r)'), lay(rows, 'U', x, 'U ตัวควบคุม (%)', 'var(--series-3)', { width: 1.5 }), lay(rows, 'I', x, 'I integral (%)', 'var(--ink)', { width: 1.5, dash: [6, 4] }), lay(rows, 'K', x, 'K เตะ (%)', 'var(--bad)', { width: 1.5 })].filter(Boolean));
    charts[2].set([lay(rows, 'GZ', x, gs ? '|gyro_z| (log ไม่เชื่อเครื่องหมาย)' : 'GZ (°/s)', 'var(--ink)', { width: 1.5 })].filter(Boolean));
  }
  let lastTick = 0;
  function frame() {
    if ($('#tab-adcs').classList.contains('active')) {
      const now = performance.now();
      if (now - lastTick > 120) {
        lastTick = now;
        updateTiles();
        updateCharts();
        $('#adLive').firstChild.nodeValue = A.streamHz > 0 && !A.busy ? 'หยุดดูสด' : 'ดูสด';
        $('#adLive small').textContent = A.streamHz > 0 && !A.busy ? 'TEAM_CSTREAM,0' : 'TEAM_CSTREAM,10';
        const st = $('#adStatus');
        const txt = A.busy ? (A.rec ? `${A.phase} ${NS.fmt((performance.now() - A.t0rec) / 1000, 1)} / ${NS.fmt(A.planDur, 0)} s · ${A.rec.rows.length} บรรทัด · กด STOP ได้ตลอด` : A.phase) : (ready() ? (A.streamHz > 0 ? `สตรีม TEAM_C ${A.streamHz} Hz เปิดอยู่` : 'พร้อม') : 'ยังไม่ได้เชื่อมต่อแบบ SunSeek');
        if (st.textContent !== txt) st.textContent = txt;
      }
      for (const c of charts) if (c.c.offsetParent !== null) c.draw();
    }
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------------ wiring
  function init() {
    buildTiles();
    charts.push(
      new NS.XYChart($('#adChAng'), { xlabel: 'เวลา (s)', ylabel: 'มุม (°)' }),
      new NS.XYChart($('#adChRw'), { xlabel: 'เวลา (s)', ylabel: 'คำสั่งล้อ (%)', yZero: true }),
      new NS.XYChart($('#adChGz'), { xlabel: 'เวลา (s)', ylabel: 'อัตราหมุน (°/s)', yZero: true }),
    );
    renderParams();
    renderTable();
    renderPlan();
    for (const id of ['#adA', '#adB', '#adDur', '#adHz']) $(id).addEventListener('input', renderPlan);
    document.querySelectorAll('input[name=adMode]').forEach((e) => e.addEventListener('change', renderPlan));
    for (const id of ['#adTol', '#adHold', '#adSrc']) $(id).addEventListener('change', () => { viewSig = ''; renderTable(); });
    $('#adRun').addEventListener('click', runTest);
    $('#adLive').addEventListener('click', toggleLive);
    $('#adRead').addEventListener('click', async () => { if (!ready()) { NS.toast('ยังไม่ได้เชื่อมต่อ', 'warn'); return; } try { await readParams(); NS.toast(`อ่านค่าแล้ว ${A.paramOrder.length} ค่า`, 'good'); } catch (e) { NS.toast(e.message, 'bad', 7000); } });
    $('#adSave').addEventListener('click', saveParams);
    $('#adStop').addEventListener('click', () => $('#btnStop').click());
    $('#adExport').addEventListener('click', () => NS.download(`adcs_runs_${NS.fileStamp()}.csv`, NS.adcs.toCSV(csvItems()), 'text/csv'));
    $('#adRaw').addEventListener('click', () => { if (A.view) NS.download(`adcs_run${A.view.id}_raw_${NS.fileStamp()}.csv`, rawCsv(A.view), 'text/csv'); });
    let t = null;
    const clr = $('#adClear');
    clr.addEventListener('click', () => {
      if (t) { clearTimeout(t); t = null; clr.textContent = 'ล้างตาราง'; A.runs = []; A.view = null; A.sel = null; A.gs = null; $('#adGsOut').textContent = ''; viewSig = ''; renderTable(); return; }
      clr.textContent = 'กดอีกครั้งเพื่อยืนยัน'; t = setTimeout(() => { t = null; clr.textContent = 'ล้างตาราง'; }, 4000);
    });
    $('#adGsFile').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try { A.gs = { name: f.name, text: await NS.readFileText(f) }; analyzeGs(); } catch (err) { NS.toast('อ่านไฟล์ไม่ได้: ' + err.message, 'bad'); }
      e.target.value = '';
    });
    for (const id of ['#adGsTgt', '#adGsGap', '#adGsMax']) $(id).addEventListener('change', analyzeGs);
    requestAnimationFrame(frame);
    // after a connection (or a reconnect) the values are read once, so the panel is ready without a click
    NS.bus.on('link', (st) => { if (st === 'open') setTimeout(async () => { if (ready() && !A.busy && S.proto === 'sunseek' && !A.paramOrder.length) { try { await readParams(); } catch (_) { /* not our firmware: the page says so when it is used */ } } }, 2500); });
  }
  init();
})();
