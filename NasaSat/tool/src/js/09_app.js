'use strict';
// ===== NasaSat Lab: UI glue =====
(function () {
  if (typeof document === 'undefined') return;
  const { $, $$, el } = NS;
  // chart colours are CSS variables resolved at draw time (a theme switch recolours the charts): left LDR blue, right LDR orange
  const C = { c1: 'var(--ch-l)', c2: 'var(--ch-r)', c3: 'var(--series-3)', c4: 'var(--series-3)', ink: 'var(--ink)', mut: 'var(--muted)' };

  const S = (NS.state = {
    tr: null, connected: false, nextId: 1, pending: new Map(), jsonWait: [],
    cols: null, last: null, t0: performance.now(),
    cfgDefs: new Map(), cfgVals: new Map(), cfgSaved: new Map(), lut: null,
    hello: null, hwid: null, diag: null,
    log: [], tel: [], telCols: null, evidence: [], badLines: 0,
    cal: { pts: [], val: [], fit: null, amb: null, bal: null, manualIdx: 0, angSign: 1 }, // angSign -1: SunSeek marks count the other way (NS.fit.calibrate)
    images: [], curImg: null, imgMeta: new Map(), imgWait: [], evWait: [], scan: null, sunAz: null, hk: null,
    m1: { runs: [], cur: null, hold: null },
    pins: null, pinBase: null, paused: false, replay: null, portInfo: null, lastHandshake: 0,
    jobs: new Set(), th0ok: false, telCount: 0, telHz: 0, conErr: 0,
    // proto: 'nasasat' = our firmware (@id CMD -> OK / ERR) · 'sunseek' = the organizer's firmware (CMD,arg -> ACK / ERR / TM / EVT)
    proto: 'nasasat',
    ss: { state: new NS.ss.State(), client: null, hinted: false, tmCount: 0, tmPrev: 0, tmHz: 0, errAt: {}, showT: null, timer: null },
  });

  const now = () => (performance.now() - S.t0) / 1000;
  const cfg = (k, d) => (S.cfgVals.has(k) ? S.cfgVals.get(k) : d);

  // ------------------------------------------------------------------ console / log
  const conOut = $('#conOut');
  const addLog = (dir, text) => {
    const ts = Date.now();
    S.log.push([ts, dir, text]);
    if (S.log.length > 300000) S.log.splice(0, 50000);
    const ss = S.proto === 'sunseek'; // the organizer's lines: ACK ok, ERR error, EVT event, TM muted (and hideable like our T, lines)
    const isT = dir === 'rx' && (ss ? text.startsWith('TM,') : (text.startsWith('T,') || text.startsWith('IMG C') || text.includes('"type":"pins"')));
    let cls = dir === 'tx' ? 'tx' : dir === 'sys' ? 'sys' : '';
    if (dir === 'rx') {
      if (/^(@\d+ )?ERR/.test(text) || text.startsWith('E FAULT')) cls = 'err';
      else if (/^(@\d+ )?OK/.test(text) || (ss && text.startsWith('ACK,'))) cls = 'ok';
      else if (text.startsWith('E ') || (ss && text.startsWith('EVT,'))) cls = 'ev';
      else if (isT) cls = 't';
    }
    if (!isT) { const cl = $('#conLast'); cl.textContent = `${dir === 'tx' ? '>' : dir === 'sys' ? '*' : '<'} ${text.slice(0, 160)}`; cl.style.color = cls === 'err' ? 'var(--bad)' : ''; }
    if (cls === 'err') { const b = $('#conErrN'); b.classList.add('bad'); b.textContent = `error ${++S.conErr}`; }
    if (isT && !$('#conShowT').checked) return;
    if (dir === 'tx' && !$('#conShowTx').checked) return;
    const line = el('div', { class: cls, text: `${NS.clock(ts)} ${dir === 'tx' ? '>' : dir === 'sys' ? '*' : '<'} ${text.length > 400 ? text.slice(0, 400) + ' …' : text}` });
    const atBottom = conOut.scrollHeight - conOut.scrollTop - conOut.clientHeight < 30;
    conOut.append(line);
    while (conOut.childElementCount > 600) conOut.firstChild.remove();
    if (atBottom) conOut.scrollTop = conOut.scrollHeight;
  };
  const sys = (t) => addLog('sys', t);

  // ------------------------------------------------------------------ transport
  // a status-bar number: the unit after it hides while there is no value
  const setNum = (id, s) => { const b = $(id); if (b.textContent === s) return; b.textContent = s; if (b.nextElementSibling) b.nextElementSibling.hidden = s === '—'; };
  // status-bar state: always words; the CSS adds a square indicator coloured by the class (on / info / warn / bad / off / sim)
  const setPill = (id, text, cls = '') => {
    const p = $(id);
    if (p.textContent === text && p.dataset.c === cls) return;
    p.textContent = text; p.dataset.c = cls; p.className = 'pill ' + cls;
  };
  const channel = (kind) => { document.body.dataset.ch = kind || ''; };

  const onStatus = (st, info) => {
    if (st === 'open') {
      S.connected = true;
      if (S.tr.kind === 'serial' && info && info.usbVendorId) S.portInfo = info;
      const sim = S.tr.kind === 'sim';
      setPill('#connPill', sim ? 'ตัวจำลอง — ไม่ใช่บอร์ดจริง' : S.proto === 'sunseek' ? 'บอร์ดจริง · SunSeek' : 'บอร์ดจริง', sim ? 'sim' : 'on'); channel(S.tr.kind); sys('connected ' + JSON.stringify(info || {})); showConnInfo(info);
    } else if (st === 'closed') { S.connected = false; clearLive(); if (!re.on) { setPill('#connPill', 'ยังไม่เชื่อมต่อ', 'off'); channel(''); } sys('closed'); }
    else if (st === 'lost' || st === 'error') {
      if (!S.connected && re.on) return; // the lost port reporting again while we look for it
      S.connected = false; clearLive();
      setPill('#connPill', 'หลุด!', 'bad');
      sys(`${st} ${info || ''}`);
      for (const [, p] of S.pending) { clearTimeout(p.to); p.rej(new Error('disconnected')); }
      S.pending.clear();
      rejectImageWaits('การเชื่อมต่อหลุด');
      if (S.tr && S.tr.kind === 'serial' && $('#autoRe').checked && S.portInfo) startReconnect();
      else NS.toast('บอร์ดหลุดการเชื่อมต่อ (สายหลุด, บอร์ดรีเซ็ต หรือเปิด Arduino Serial Monitor อยู่) กด "เชื่อมต่อ" ใหม่', 'bad', 7000);
    }
    updateNav();
  };

  // ---- auto-reconnect: a board with USB built in vanishes for a moment on every reset (REBOOT, watchdog, brownout)
  // and comes back as a new port. Look for a port with the same VID:PID among the ones this page may use, for 30 s.
  const re = { on: false, timer: null, t0: 0 };
  function startReconnect() {
    if (re.on) return;
    re.on = true;
    re.t0 = Date.now();
    setPill('#connPill', 'กำลังต่อใหม่…', 'warn');
    NS.toast('บอร์ดหลุด: กำลังต่อใหม่อัตโนมัติ (บอร์ดรีเซ็ตจะกลับมาเองในไม่กี่วินาที)', 'warn', 5000);
    tryReconnect();
  }
  function stopReconnect() { re.on = false; clearTimeout(re.timer); }
  async function tryReconnect() {
    if (!re.on) return;
    clearTimeout(re.timer);
    if (Date.now() - re.t0 > 30000) {
      stopReconnect();
      setPill('#connPill', 'หลุด!', 'bad');
      NS.toast('ต่อใหม่อัตโนมัติไม่สำเร็จใน 30 วินาที: ตรวจสาย/ไฟเลี้ยง แล้วกด "เชื่อมต่อ" เอง', 'bad', 9000);
      return;
    }
    const old = S.tr;
    if (old) { old.onStatus = () => {}; old.onLine = () => {}; S.tr = null; try { await old.disconnect(); } catch (_) { /* gone */ } }
    let ports = [];
    try { ports = (await navigator.serial.getPorts()).filter((p) => NS.samePort(p.getInfo(), S.portInfo)); } catch (_) { ports = []; }
    for (const port of ports) {
      const tr = new NS.SerialTransport();
      tr.onLine = onLine;
      tr.onStatus = onStatus;
      try {
        S.tr = tr;
        S.cols = null;
        await tr.connect({ port, baud: $('#selBaud').value, dtr: $('#selDtr').value });
        stopReconnect();
        sys('reconnected');
        NS.toast('ต่อบอร์ดใหม่อัตโนมัติแล้ว', 'good');
        setTimeout(handshake, 600);
        return;
      } catch (_) { S.tr = null; } // not back yet, or open in another tab: try the next one
    }
    if (re.on) re.timer = setTimeout(tryReconnect, 700);
  }
  const showConnInfo = (info) => {
    const o = { ช่องทาง: S.tr.kind === 'sim' ? 'ตัวจำลอง' : 'Web Serial' };
    if (info && info.usbVendorId) { o['USB VID:PID'] = `${info.usbVendorId.toString(16).padStart(4, '0')}:${(info.usbProductId || 0).toString(16).padStart(4, '0')}`; o['ชนิดชิป USB (เดา)'] = usbGuess(info.usbVendorId); }
    NS.kv($('#connInfo'), o);
  };
  const usbGuess = (vid) => ({ 0x303a: 'USB ในตัว ESP32-S3 (Espressif)', 0x10c4: 'CP210x (Silicon Labs)', 0x1a86: 'CH340/CH343 (WCH)', 0x0403: 'FTDI' }[vid] || 'ไม่รู้จัก');

  async function connect() {
    const kind = $('input[name=trKind]:checked').value;
    if (kind === 'serial' && !NS.SerialTransport.supported()) { NS.toast('เบราว์เซอร์นี้ไม่มี Web Serial ให้เปิดด้วย Chrome หรือ Edge', 'bad', 6000); return; }
    stopReconnect();
    if (S.tr) await disconnect();
    if (kind === 'sim' && S.proto !== 'nasasat') setProto('nasasat', false); // the simulator only speaks our protocol
    const tr = kind === 'sim' ? new NS.Sim() : new NS.SerialTransport();
    tr.onLine = onLine;
    tr.onStatus = onStatus;
    S.tr = tr;
    S.cols = null;
    S.ss.state.clear(); S.ss.hinted = false; // a new connection starts without the old board's values
    NS.store.set('baud', $('#selBaud').value);
    NS.store.set('dtr', $('#selDtr').value);
    NS.store.set('kind', kind);
    try {
      await tr.connect({ baud: $('#selBaud').value, dtr: $('#selDtr').value });
    } catch (e) {
      S.tr = null;
      if (!/No port selected|cancel/i.test(e.message)) NS.toast('เชื่อมต่อไม่สำเร็จ: ' + e.message, 'bad', 6000);
      return;
    }
    $('#simCard').hidden = kind !== 'sim';
    setTimeout(handshake, kind === 'sim' ? 60 : 600);
  }
  async function handshake() {
    S.lastHandshake = Date.now();
    if (S.proto === 'sunseek') { await ssHandshake(); return; }
    try {
      await send('HELLO');
      await send('CFG LIST', { timeout: 6000 });
      await send('STREAM ON');
      await send('CAL GET');
    } catch (e) {
      if (S.proto !== 'nasasat') return; // switched to SunSeek meanwhile: these answers will never come
      NS.toast('บอร์ดไม่ตอบคำสั่งมาตรฐาน (' + e.message + ') ถ้าเป็น firmware อื่นยังใช้ Console ด้านล่างได้', 'warn', 7000);
    }
  }
  async function disconnect() {
    stopReconnect();
    if (!S.tr) { setPill('#connPill', 'ยังไม่เชื่อมต่อ', 'off'); channel(''); return; }
    try { await S.tr.disconnect(); } catch (_) { /* ignore */ }
    S.tr = null;
    S.connected = false;
    clearLive();
    setPill('#connPill', 'ยังไม่เชื่อมต่อ', 'off'); channel('');
    updateNav();
  }

  function send(cmd, { timeout = 4000 } = {}) {
    if (!S.tr || !S.connected) { NS.toast('ยังไม่ได้เชื่อมต่อ', 'warn'); return Promise.reject(new Error('not connected')); }
    // our "@id CMD" lines mean nothing to the organizer's firmware: refuse instead of sending them (SunSeek commands go through ssSend)
    if (S.proto === 'sunseek') return Promise.reject(new Error('โหมด SunSeek: คำสั่งนี้ใช้กับเฟิร์มแวร์ NasaSat (ของเรา) เท่านั้น'));
    const id = S.nextId++;
    const line = `@${id} ${cmd}`;
    S.tr.write(line);
    addLog('tx', line);
    return new Promise((res, rej) => {
      const to = setTimeout(() => { S.pending.delete(id); rej(new Error('ไม่มีคำตอบ: ' + cmd)); }, timeout);
      S.pending.set(id, { res, rej, to, cmd });
    });
  }
  const sendQuiet = (cmd, opt) => send(cmd, opt).catch((e) => { NS.toast(e.message, 'bad'); throw e; });
  const waitJson = (type, timeout = 10000, pred = null) => new Promise((res, rej) => {
    const w = { type, pred, res, rej };
    w.to = setTimeout(() => { S.jsonWait = S.jsonWait.filter((x) => x !== w); rej(new Error('หมดเวลารอ ' + type)); }, timeout);
    S.jsonWait.push(w);
  });
  // "E evt arg0 ..." from the board (e.g. the M1 HOLD event)
  const waitEvent = (evt, arg0, timeout = 30000) => new Promise((res, rej) => {
    const w = { evt, arg0, res };
    w.to = setTimeout(() => { S.evWait = S.evWait.filter((x) => x !== w); rej(new Error(`หมดเวลารอ ${evt} ${arg0 || ''}`)); }, timeout);
    S.evWait.push(w);
  });
  // the next photo that arrives whole or broken; a refused shot (snap_fail / FAULT SNAP) or STOP ends the wait at once
  const nextImage = (timeout = 60000) => new Promise((res, rej) => {
    const w = { res, rej };
    w.to = setTimeout(() => { S.imgWait = S.imgWait.filter((x) => x !== w); rej(new Error('หมดเวลารอภาพ')); }, timeout);
    S.imgWait.push(w);
  });
  function rejectImageWaits(why) { for (const w of S.imgWait.splice(0)) { clearTimeout(w.to); w.rej(new Error(why)); } }
  // until the actuator has stopped (telemetry MOVING flag clear 3 times in a row)
  async function waitIdle(timeout = 20000) {
    const t0 = Date.now();
    let calm = 0;
    await NS.sleep(150);
    while (Date.now() - t0 < timeout) {
      if (S.last && !(S.last.fl & NS.FLAGS.MOVING)) { if (++calm >= 3) return; } else calm = 0;
      await NS.sleep(60);
    }
    throw new Error('ตัวขับยังหมุนไม่หยุด');
  }

  // ------------------------------------------------------------------ incoming lines
  S.imgAsm = new NS.ImageAssembler(onImage, (id, missing) => {
    sys(`image ${id}: missing ${missing.length} chunks -> resend`);
    const tr = S.tr;
    for (let i = 0; i < missing.length; i += 40) tr.write(`IMG GET ${id} ${missing.slice(i, i + 40).join(',')}`);
  });

  function onLine(raw) {
    try { handleLine(raw); } catch (e) { console.error(e); sys(`handler error: ${e.message} <- ${String(raw).slice(0, 80)}`); }
  }
  function handleLine(raw) {
    addLog('rx', raw);
    if (S.proto === 'sunseek') { handleSunSeekLine(raw); return; }
    const m = NS.parseLine(raw);
    switch (m.kind) {
      case 'ok': case 'err': {
        const p = m.id !== null ? S.pending.get(m.id) : null;
        if (p) { clearTimeout(p.to); S.pending.delete(m.id); if (m.kind === 'ok') p.res(m.text); else p.rej(new Error(`${p.cmd} → ERR ${m.code} ${m.text}`)); }
        if (p && m.kind === 'ok' && /^SAVE\s+\S/i.test(p.cmd)) { // "SAVE k1 k2": those keys are now in flash
          for (const k of p.cmd.trim().split(/\s+/).slice(1)) if (S.cfgVals.has(k)) { S.cfgSaved.set(k, S.cfgVals.get(k)); refreshCfgRow(k); }
        }
        else if (m.kind === 'err') NS.toast(`ERR ${m.code} ${m.text}`, 'bad');
        if (m.kind === 'ok' && /^[\w.]+=/.test(m.text || '')) { const [k, v] = m.text.split('='); if (S.cfgDefs.has(k)) { S.cfgVals.set(k, +v); refreshCfgRow(k); } }
        break;
      }
      case 'th': S.cols = m.cols; S.telCols = m.cols; break;
      case 't': if (S.cols) onTelemetry(Object.fromEntries(S.cols.map((c, i) => [c, m.vals[i]])), m.vals); break;
      case 'j': onJson(m.json); break;
      case 'e': onEvent(m.evt, m.args); break;
      case 'img': S.imgAsm.handle(m.parts); break;
      case 'bad': S.badLines++; break;
      default: if (!S.ss.hinted && NS.ss.looksLikeSunSeek(raw)) suggestSunSeek(); break;
    }
  }

  function onJson(j) {
    for (const w of [...S.jsonWait]) if (w.type === j.type && (!w.pred || w.pred(j))) { clearTimeout(w.to); S.jsonWait = S.jsonWait.filter((x) => x !== w); w.res(j); }
    switch (j.type) {
      case 'hello': S.hello = j; NS.kv($('#helloInfo'), { firmware: `${j.fw} ${j.ver}`, บอร์ด: j.board, protocol: j.proto, ความสามารถ: (j.caps || []).join(', ') }); updateNav(); break;
      case 'cfg': loadCfg(j.items); updateNav(); break;
      case 'hwid': S.hwid = j; NS.kv($('#hwidOut'), Object.fromEntries(Object.entries(j).filter(([k]) => k !== 'type'))); updateNav(); break;
      case 'diag': S.diag = j; $('#diagOut').textContent = (j.lines || []).join('\n'); break;
      case 'pins': S.pins = j.mv; renderPins(); break;
      case 'sweep_pt': onSweepPoint(j); break;
      case 'snap_fail': {
        const why = { target_out_of_range: `เป้าอยู่นอกช่วงที่หมุนได้ (ต้องหันไป ${j.aim}° แต่ act.min..act.max = ${j.min}..${j.max}°)`, not_in_tol: `หันได้คลาด ${j.err_cmd}° เกิน m2.tol ${j.tol}°` }[j.reason] || j.reason;
        $('#m2Status').textContent = ''; // the banner below says it (no duplicate line)
        showM2Fail(why);
        S.snapFailAt = Date.now(); // the "E FAULT SNAP ..." that follows is the same failure: one tray item, not two
        NS.toast('ภารกิจ 2 ไม่ถ่ายภาพ: ' + why, 'bad', 9000);
        addEvidence('image_refused', why, j);
        rejectImageWaits('ไม่ถ่าย: ' + why);
        break;
      }
      case 'hk': S.hk = j; renderHk(); break;
      case 'th0':
        NS.kv($('#th0Out'), { 'มุมที่อ่านได้ก่อนตั้ง': `${j.th_before}°`, 'มุมจริงที่กรอก': `${j.ref}°`, 'est.th0 เดิม → ใหม่': `${j.old}° → ${j.new}°`, 'บันทึก': j.saved ? 'บอร์ดบันทึกค่าศูนย์ลง flash แล้ว (รีเซ็ตแล้วไม่หาย)' : 'ยังไม่ถาวร: กด SAVE' });
        addEvidence('zero_reference', `ตั้งศูนย์กับของอ้างอิง: อ่านได้ ${j.th_before}° ขณะมุมจริง ${j.ref}° → est.th0 ${j.old} → ${j.new}`, j);
        S.th0ok = true; updateNav();
        refreshCfg();
        break;
      case 'sweep_end':
        $('#swStatus').textContent = `Sweep เสร็จ ${j.n} จุด`;
        if (j.tag === 'cal' && S.cal.pts.length >= 6) { $('#swStatus').textContent += ' · Fit ให้อัตโนมัติแล้ว ดูผลที่ขั้นที่ 5'; setTimeout(runFit, 30); }
        break;
      case 'cal': if (j.lut !== undefined) S.lut = j.lut; break;
      case 'cam': $('#m2Status').textContent = j.locked ? `ล็อกแสงแล้ว (aec ${j.aec}, agc ${j.agc})` : 'แสงกล้องเป็นอัตโนมัติ (ยังไม่ล็อก)'; break;
      case 'sun_ref': $('#m2Status').textContent = `ดวงอาทิตย์อยู่ที่มุม ${j.sun_az}° ของตัวขับ → หันไปที่ ${(j.sun_az + j.offset).toFixed(2)}°`; break;
      case 'img_meta': S.imgMeta.set(String(j.id), j); $('#m2Status').textContent = `กำลังรับภาพ #${j.id} (${(j.bytes / 1024).toFixed(1)} KB)…`; break;
      case 'backlash':
        addEvidence('backlash', `backlash = ${j.deg}° (ไป ${j.fwd}, กลับ ${j.bwd})`, j);
        showMeasured($('#blOut'), `backlash ที่วัดได้ ${j.deg}° (ไป ${j.fwd}, กลับ ${j.bwd})`, 'act.bl', j.deg);
        NS.toast(`วัด backlash ได้ ${j.deg}°: กด "ใช้ค่านี้" ที่ขั้นที่ 1`, 'good', 6000);
        break;
      case 'spr':
        addEvidence('spr', `step ต่อรอบที่วัดได้ = ${j.steps} (ตั้งไว้ ${j.cfg})`, j);
        $('#sprBox').open = true;
        showMeasured($('#sprOut'), `step ต่อรอบที่วัดได้ ${j.steps} (ตั้งไว้ ${j.cfg})`, 'act.spr', j.steps);
        NS.toast(`วัด step ต่อรอบได้ ${j.steps}: กด "ใช้ค่านี้" ที่ขั้นที่ 1`, 'good', 6000);
        break;
      default: break;
    }
  }

  function onEvent(evt, args) {
    for (const w of [...S.evWait]) if (w.evt === evt && (!w.arg0 || w.arg0 === args[0])) { clearTimeout(w.to); S.evWait = S.evWait.filter((x) => x !== w); w.res(args); }
    if (evt === 'PROC') { // "E PROC SWEEP START|END|ABORT": the running-jobs chip in the status bar
      if (args[1] === 'START') S.jobs.add(args[0]); else if (args[1] === 'END' || args[1] === 'ABORT') S.jobs.delete(args[0]);
      renderJobs();
    } else if (evt === 'M1') {
      const st = args[0];
      // every start counts as a run: START button, console, the board's own button or automatic start
      if (st === 'FINE' && args[1] === 'start') { S.m1.cur = { start: now(), wall: Date.now(), tLock: null, iters: null, done: false, tgt: cfg('m1.tgt', 0) }; S.m1.hold = null; renderM1Banner(); }
      if (st === 'HOLD' && S.m1.cur && S.m1.cur.tLock === null) {
        const kv = Object.fromEntries(args.slice(1).map((a) => a.split('=')));
        S.m1.cur.tLock = now() - S.m1.cur.start;
        S.m1.cur.iters = kv.it !== undefined ? +kv.it : null;
        const holdS = Math.max(1, +$('#m1HoldS').value || 3);
        S.m1.hold = { t0: now(), holdS, last: now(), maxGap: 0, samples: [] };
        setTimeout(finishRun, holdS * 1000);
        renderM1Banner();
      }
      if (st === 'LOST' || st === 'SEARCH') {
        if (args[1] === 'adc_saturated') NS.toast('แสงแรงจน ADC ตัน: บอร์ดจะไม่ล็อกเป้าจากค่าที่ตัน ให้ถอยหลอดออก, ใช้กระดาษบางปิดคู่ LDR ให้เท่ากัน หรือเปลี่ยนตัวต้านทาน แล้วคาลิเบรตใหม่', 'bad', 10000);
        else if (st === 'LOST') NS.toast('ภารกิจ 1: หาแสงไม่เจอ (ตรวจว่าเปิดหลอดและอยู่ในช่วงค้นหา)', 'warn');
      }
      if (st === 'IDLE' && args[1] === 'm2_takeover') NS.toast('ภารกิจ 1 หยุดให้ภารกิจ 2 แล้ว', '', 2500);
    } else if (evt === 'FAULT') {
      S.jobs.delete(args[0]); renderJobs(); // a faulted job is over (the board may not send PROC END after it)
      if (!(args[0] === 'SNAP' && Date.now() - (S.snapFailAt || 0) < 3000)) NS.toast('FAULT: ' + args.join(' '), 'bad', 7000);
      if (args[0] === 'SNAP') rejectImageWaits('ถ่ายไม่สำเร็จ: ' + args.slice(1).join(' '));
    } else if (evt === 'WARN' && args[0] === 'PIN') NS.toast(`ขา ${args[1]} ถูกใช้ซ้ำ: ${args[2]} กับ ${args.slice(3).join(' ')} (ตรวจว่าตั้งขาถูกไหม)`, 'warn', 8000);
    else if (evt === 'WARN' && args[0] === 'BTN') NS.toast('ปิดปุ่มบนบอร์ดให้แล้ว เพราะกล้องใช้ขาเดียวกัน (' + args.slice(1).join(' ') + ')', 'warn', 8000);
    else if (evt === 'WARN') NS.toast('คำเตือนจากบอร์ด: ' + args.join(' '), 'warn', 6000);
    else if (evt === 'LIMIT') NS.toast('ชนขีดจำกัดมุม act.min/act.max (' + args.join(' ') + ')', 'warn');
    else if (evt === 'BTN') NS.toast(`กดปุ่มบนบอร์ด: ${args[0] === 'M1_START' ? 'เริ่ม' : 'หยุด'}ภารกิจ 1`, '', 4000);
    else if (evt === 'AUTO') {
      const msg = { M1_IN: `บอร์ดจะเริ่มภารกิจ 1 เองใน ${args[1]} วินาที (m1.auto) กด STOP ถ้าไม่ต้องการ`, M1_START: 'บอร์ดเริ่มภารกิจ 1 เอง (m1.auto)', CANCELLED: 'ยกเลิกการเริ่มภารกิจ 1 อัตโนมัติแล้ว', SKIPPED: `ไม่เริ่มภารกิจ 1 อัตโนมัติ: มีงานอื่นทำอยู่ (${args[1] || ''})` }[args[0]];
      if (msg) NS.toast(msg, args[0] === 'M1_IN' ? 'warn' : '', 7000);
    } else if (evt === 'LINK' && args[0] === 'ON') NS.toast('เปิดช่องสื่อสารที่สองแล้ว: ' + args.slice(1).join(' '), 'good', 5000);
    else if (evt === 'BOOT') {
      NS.toast('บอร์ดรีสตาร์ต: ' + args.join(' '), args[0] === 'BROWNOUT' ? 'bad' : '');
      S.cols = null; S.jobs.clear(); renderJobs();
      // a board with a USB-UART chip keeps the port through a reset: read its (maybe unsaved, now lost) settings again
      if (S.connected && !S.replay) setTimeout(() => { if (S.connected && Date.now() - S.lastHandshake > 2000) handshake(); }, 800);
    }
  }

  function renderHk() {
    const h = S.hk;
    if (!h) return;
    const o = { 'อุณหภูมิชิป': NS.isNum(h.temp_c) ? `${h.temp_c.toFixed(1)} °C` : '—', 'หน่วยความจำว่าง (ต่ำสุด)': `${(h.heap / 1024).toFixed(0)} KB (${(h.heap_min / 1024).toFixed(0)} KB)`, 'loop นานสุด': `${h.loop_max_ms} ms`, 'แบตเตอรี่': NS.isNum(h.vbat_mv) ? `${(h.vbat_mv / 1000).toFixed(2)} V` : 'ไม่ได้ต่อ (hw.vbat)', 'ปุ่มบนบอร์ด': h.btn >= 0 ? `GPIO${h.btn}` : 'ปิด' };
    if (h.link) o['ช่องที่สอง (วิทยุ)'] = `ส่งแล้ว ${h.link.lines} บรรทัด, ทิ้ง ${h.link.drop}, ค้าง ${h.link.queued} B`;
    NS.kv($('#hkInfo'), o);
    $('#hdrHk').textContent = [NS.isNum(h.vbat_mv) ? `แบต ${(h.vbat_mv / 1000).toFixed(2)} V` : '', NS.isNum(h.temp_c) ? `ชิป ${h.temp_c.toFixed(0)}°C` : ''].filter(Boolean).join(' · ');
  }

  // ------------------------------------------------------------------ SunSeek mode (the organizer's firmware)
  // Plain lines "CMD,arg" answered with PONG / ACK,CMD / ERR,CODE / TM,KEY,VALUE / EVT,NAME (02b_sunseek.js). Everything above and
  // below that speaks our "@id CMD" protocol stays as it is; in this mode send() refuses those commands, and the console, the quick
  // buttons and STOP talk SunSeek instead.
  S.ss.client = new NS.ss.Client({
    write: (line) => { if (!S.tr) return Promise.reject(new Error('ยังไม่เชื่อมต่อ')); addLog('tx', line); return S.tr.write(line); },
  }, { state: S.ss.state });
  const SS_ERR_TH = { empty: 'คำสั่งว่าง', 'too long': 'คำสั่งยาวเกิน 240 ตัวอักษร', newline: 'คำสั่งต้องอยู่บรรทัดเดียว' };
  const SS_SENSORS = { SENSOR_ACCEL: 'ตัววัดความเร่ง (accel)', SENSOR_MAG: 'เข็มทิศ (mag)', SENSOR_GYRO: 'ไจโร (gyro)', SENSOR_BARO: 'ความกดอากาศ (baro)', SENSOR_SUN: 'ตัวรับแสงอาทิตย์ (sun)' };

  function handleSunSeekLine(raw) {
    const p = S.ss.client.feed(raw); // parses, keeps the State, completes the command that waits for this line
    if (p.kind === 'tm') S.ss.tmCount++;
    if (p.kind === 'err') {
      const text = ['ERR', p.err.code, ...p.err.args].join(' ');
      const t = Date.now();
      if (t - (S.ss.errAt[text] || 0) > 3000) { S.ss.errAt[text] = t; NS.toast(text, 'bad', 6000); } // an ERR repeated by a stream must not pile up toasts
    }
    scheduleSs();
  }
  async function ssSend(cmd) { // a command typed in the console or a quick button
    if (!S.tr || !S.connected) { NS.toast('ยังไม่ได้เชื่อมต่อ', 'warn'); return { ok: false }; }
    const r = await S.ss.client.send(cmd);
    if (r.timeout) NS.toast(`ไม่มีคำตอบจากบอร์ด: ${cmd}`, 'bad'); // an ERR line already made its own toast
    else if (r.error && !r.aborted) NS.toast(`ส่งไม่ได้: ${SS_ERR_TH[r.error] || r.error}`, 'bad');
    return r;
  }
  // ---- our team firmware on the SunSeek board (calibration page): TEAM_SUN readings and TEAM_* command lists
  const isSs = () => S.proto === 'sunseek';
  const ssWhy = (r) => (r.timeout ? 'บอร์ดไม่ตอบ' : r.reply ? `${r.reply.raw} ${NS.ss.errHelp(r.reply.raw) || (/UNKNOWN_COMMAND/.test(r.reply.raw) ? 'บอร์ดนี้ไม่ใช่เฟิร์มแวร์ทีม (NasaPakSoi-team)' : '')}`.trim() : r.error || 'ส่งไม่ได้');
  async function ssTeamSun() { // one TM,TEAM_T line now: TEAM_SUN answers ACK,TEAM_SUN then the line
    if (!S.tr || !S.connected) throw new Error('ยังไม่ได้เชื่อมต่อ');
    const t0 = S.ss.state.at('TEAM_T.SEQ');
    const r = await S.ss.client.send('TEAM_SUN');
    if (!r.ok) throw new Error(`TEAM_SUN: ${ssWhy(r)}`);
    for (let k = 0; k < 50 && S.ss.state.at('TEAM_T.SEQ') === t0; k++) await NS.sleep(10);
    if (S.ss.state.at('TEAM_T.SEQ') === t0) throw new Error('ไม่ได้รับ TM,TEAM_T หลัง TEAM_SUN');
    const n = (k) => S.ss.state.num('TEAM_T.' + k);
    return { MVL: n('MVL'), MVR: n('MVR'), SAT: n('SAT'), LIT: n('LIT'), TH: n('TH'), ANG: n('ANG') };
  }
  async function ssCapture(n = 8) { // ~0.1 s apart (each reading is already a 20 ms window average)
    const rows = [];
    for (let i = 0; i < n; i++) { rows.push(await ssTeamSun()); await NS.sleep(80); }
    return NS.ss.avgTeamT(rows);
  }
  async function ssStable() { // same rule as stableRaw(): two 1 s readings within 0.3 %
    let prev = null;
    for (let k = 0; k < 8; k++) {
      const a = await ssCapture(10);
      if (a.sat) throw new Error('ADC ตัน: ลดแสงหรือถอยหลอดก่อน แล้ววัดใหม่');
      const G = [NS.est.toG(a.mvL, calVcc(), calTopo()), NS.est.toG(a.mvR, calVcc(), calTopo())];
      if (prev && Math.abs(G[0] / prev[0] - 1) < 0.003 && Math.abs(G[1] / prev[1] - 1) < 0.003) return { GL: (G[0] + prev[0]) / 2, GR: (G[1] + prev[1]) / 2, ang: 0 };
      prev = G;
    }
    throw new Error('ค่ายังไม่นิ่งใน 10 วินาที (LDR ยังเปลี่ยน, ไฟกระพริบ หรือมีคนเดินผ่าน) ลองใหม่');
  }
  async function ssSendAll(lines, progress) { // one by one; stops at the first refusal and says which line
    for (let i = 0; i < lines.length; i++) {
      if (!S.tr || !S.connected) throw new Error('ยังไม่ได้เชื่อมต่อ');
      const r = await S.ss.client.send(lines[i], { timeout: 4000 });
      if (!r.ok) throw new Error(`บรรทัด ${i + 1}/${lines.length} "${lines[i]}": ${ssWhy(r)}`);
      if (progress) progress(i + 1, lines.length);
    }
  }
  async function ssReadParam(key) { // TEAM_GET,key -> number (TM,TEAM_PARAM,key,value)
    const t0 = S.ss.state.at(`TEAM_PARAM.${key}`);
    await ssSendAll([`TEAM_GET,${key}`]);
    for (let k = 0; k < 50 && S.ss.state.at(`TEAM_PARAM.${key}`) === t0; k++) await NS.sleep(10);
    const v = S.ss.state.num(`TEAM_PARAM.${key}`);
    if (!Number.isFinite(v)) throw new Error(`อ่าน ${key} ไม่ได้`);
    return v;
  }

  async function ssHandshake() { // our HELLO / CFG LIST do not exist there; PING and STATUS only read (their lines fill the status card)
    await S.ss.client.send('PING');
    await S.ss.client.send('STATUS');
  }
  function suggestSunSeek() { // NasaSat mode received lines of the organizer's firmware: say so, never switch by itself
    S.ss.hinted = true;
    NS.toast('บอร์ดนี้ดูเหมือนใช้เฟิร์มแวร์ SunSeek (ผู้จัด) ไม่ใช่ NasaSat: ที่หน้า "เชื่อมต่อ" เลือก "SunSeek (ผู้จัด)" ได้เลย ไม่ต้องต่อใหม่', 'warn', 10000);
    sys('lines look like the SunSeek protocol (ACK / TM / EVT ...): choose SunSeek on the connect page');
  }
  function scheduleSs() { // at most 4 repaints a second, and only while the connect page is open
    if (S.ss.timer) return;
    S.ss.timer = setTimeout(() => { S.ss.timer = null; if ($('#tab-connect').classList.contains('active')) renderConn(); }, 250);
  }
  function renderSs() { // the status card: what the board said last (STATUS prints all of it, a stream refreshes parts)
    const s = S.ss.state;
    const has = (k) => s.get(k) !== undefined;
    const val = (k) => (has(k) ? s.get(k) : '—');
    const info = (label, k) => vrow(has(k) ? 'ok' : 'muted', label, val(k), k);
    const hhmmss = (ms) => NS.clock(ms).slice(0, 8);
    const mode = s.get('ADCS_MODE');
    const id = s.get('SAT_ID') || s.spacecraftId;
    const rows = [
      vrow(id ? 'ok' : 'muted', 'รหัสดาวเทียม', id || '—', 'SAT_ID'),
      info('บลูทูธ (BLE)', 'BLE'),
      vrow(mode === 'AUTO' ? 'warn' : mode ? 'ok' : 'muted', 'โหมด ADCS', val('ADCS_MODE'), mode === 'AUTO' ? 'ADCS_MODE · AUTO: ล้อถูกคุมอัตโนมัติ สั่ง RW เองไม่ได้ (STOP = กลับ MANUAL)' : 'ADCS_MODE'),
      info('กลยุทธ์ ADCS', 'ADCS_STRATEGY'),
      info('คำสั่งล้อ', 'RW_CMD'),
      info('bias ของล้อ', 'RW_BIAS'),
      info('สถานะล้อ', 'RW_STATE'),
    ];
    const order = (k) => { const i = Object.keys(SS_SENSORS).indexOf(k); return i < 0 ? 99 : i; };
    const sensors = s.keys('SENSOR_').sort((a, b) => order(a) - order(b) || a.localeCompare(b));
    for (const k of sensors) {
      const v = s.get(k);
      const lvl = v === 'READY' || v === 'DETECTED' ? 'ok' : v === 'NOT_DETECTED' && k !== 'SENSOR_BARO' ? 'bad' : 'warn';
      rows.push(vrow(lvl, SS_SENSORS[k] || k, v, v === 'NOT_DETECTED' ? `${k} · ไม่พบ: เช็กสายเซนเซอร์` : k));
    }
    if (!sensors.length) rows.push(vrow('muted', 'เซนเซอร์ (SENSOR_*)', '—', 'ยังไม่มีข้อมูล: กด "ดูสถานะทั้งหมด"'));
    const a = s.lastAck; const e = s.lastErr;
    rows.push(vrow(a ? 'ok' : 'muted', 'ACK ล่าสุด', a ? [a.cmd, ...a.args].join(',') : '—', a ? hhmmss(a.t) : ''));
    rows.push(vrow(e ? 'bad' : 'muted', 'ERR ล่าสุด', e ? [e.code, ...e.args].join(',') : '—', e ? `${hhmmss(e.t)} ${NS.ss.errHelp(e.raw)}`.trim() : ''));
    $('#ssRows').replaceChildren(...rows);
    $('#ssNote').textContent = s.lastAt ? `ค่าเป็นของตอนที่บอร์ดส่งล่าสุด (${hhmmss(s.lastAt)}) · กด STATUS เพื่ออ่านใหม่` : 'ยังไม่ได้รับข้อมูลจากบอร์ด: กด "ดูสถานะทั้งหมด"';
  }
  // The protocol choice. `remember` keeps it for the next visit (NS.store 'proto'); the simulator and the URL shortcut do not touch it.
  // A connection that is already open switches at once (no new port dialog): the board only has to be read the other way.
  function setProto(p, remember = true) {
    p = p === 'sunseek' ? 'sunseek' : 'nasasat';
    const was = S.proto;
    S.proto = p;
    if (remember) NS.store.set('proto', p);
    for (const r of $$('input[name=proto]')) r.checked = r.value === p;
    applyProtoUI();
    if (was !== p && S.connected && S.tr && !S.replay) setTimeout(handshake, 0);
  }
  // the <small> captions of the calibration buttons: our command / the team SunSeek firmware's
  const SS_CAPTIONS = [
    ['#calSendSetup small', 'SET est.gamma / alpha / sen.topo / vcc', 'TEAM_SET sun.gamma / alpha / topo / vcc'],
    ['#calAmb small', 'AMB 600', 'TEAM_SUN × 12'], ['#swRecord small', 'RAW 400', 'TEAM_SUN × 8'], ['#valRecord small', 'RAW 400', 'TEAM_SUN × 8'],
    ['#grLvl1 small', 'RAW 1000', 'TEAM_SUN'], ['#grLvl2 small', 'RAW 1000', 'TEAM_SUN'],
    ['#pushSend small', 'SET … / CAL LUT / SAVE', 'TEAM_SET … / TEAM_LUT / TEAM_SAVE'], ['#th0Run small', 'CAL TH0', 'TEAM_SET sun.th0'], ['#th0Save small', 'SAVE', 'TEAM_SAVE'],
  ];
  function applyProtoUI() { // everything on the page that depends on the protocol
    const ss = S.proto === 'sunseek';
    const sim = $('input[name=trKind]:checked').value === 'sim';
    document.body.dataset.proto = S.proto;
    for (const e of $$('.ss-only')) e.hidden = !ss;
    for (const e of $$('.ns-only')) e.hidden = ss;
    $('#helloInfo').hidden = ss;
    $('#protoNote').textContent = sim ? 'ตัวจำลองพูดได้เฉพาะโปรโตคอล NasaSat' : ss
      ? 'เฟิร์มแวร์ของผู้จัด: ส่งคำสั่งแบบ CMD,arg (ไม่มี @id) บอร์ดตอบ PONG / ACK / ERR / TM / EVT · ใช้ Console และคำสั่งด่วน · ปุ่ม STOP ส่ง STOP'
      : 'คุยด้วยคำสั่ง @id (ตอบ OK / ERR) ใช้ได้ครบทุกหน้า ทั้งคาลิเบรต ภารกิจ และจูนค่า';
    const ph = ss ? 'พิมพ์คำสั่ง เช่น STATUS หรือ RW,30 แล้วกด Enter (↑/↓ = ประวัติ)' : 'พิมพ์คำสั่ง เช่น SET ctl.k 0.8 แล้วกด Enter (↑/↓ = ประวัติ)';
    if ($('#conInput').placeholder !== ph) $('#conInput').placeholder = ph;
    // TM lines are the data here, so the console shows them (untick "แสดง telemetry" to hide a stream); our own choice comes back afterwards
    if (ss && S.ss.showT === null) { S.ss.showT = $('#conShowT').checked; $('#conShowT').checked = true; }
    else if (!ss && S.ss.showT !== null) { $('#conShowT').checked = S.ss.showT; S.ss.showT = null; }
    for (const [id, nsT, ssT] of SS_CAPTIONS) { const c = $(id); if (c) c.textContent = ss ? ssT : nsT; }
    swSync();
    for (const t of ['hw', 'm1', 'm2', 'live', 'tune']) { // pages that only make sense with our firmware (calibration speaks both)
      const sec = $('#tab-' + t);
      let n = sec.querySelector('.ss-note');
      if (ss && !n) {
        n = el('div', { class: 'ss-note' }, el('span', { class: 'pill warn', text: 'โหมด SunSeek' }), 'หน้านี้ใช้กับเฟิร์มแวร์ NasaSat (ของเรา) · ในโหมด SunSeek ใช้ Console และคำสั่งด่วนที่หน้า "เชื่อมต่อ"');
        sec.querySelector('.pagehead').after(n);
      }
      if (n) n.hidden = !ss;
    }
    const rf = $('#aiRefresh'); // "refresh" reads the board first: DIAG is ours, STATUS is theirs
    const lbl = ss ? 'STATUS + สร้างใหม่' : 'DIAG + สร้างใหม่';
    if (rf.firstChild.nodeValue !== lbl) { rf.firstChild.nodeValue = lbl; rf.querySelector('small').textContent = ss ? 'STATUS' : 'DIAG'; }
    updateNav();
  }
  function syncProtoForKind(sim) { // the simulator cannot speak SunSeek; the saved choice comes back with a real board
    $('input[name=proto][value=sunseek]').disabled = sim;
    if (S.connected) applyProtoUI(); // an open connection keeps its protocol
    else setProto(sim ? 'nasasat' : NS.store.get('proto', 'nasasat'), false);
  }

  // ------------------------------------------------------------------ telemetry + live
  const charts = {};
  function makeCharts() {
    charts.mv = new NS.TimeChart($('#chMv'), { series: [{ key: 'v0', label: 'ซ้าย (ch0)', color: C.c1, dec: 0 }, { key: 'v1', label: 'ขวา (ch1)', color: C.c2, dec: 0 }], minSpan: 20 });
    charts.d = new NS.TimeChart($('#chD'), { series: [{ key: 'D', label: 'D', color: C.c4, dec: 4 }], minSpan: 0.02 });
    charts.deg = new NS.TimeChart($('#chDeg'), { series: [{ key: 'th', label: 'θ แสง', color: C.ink, width: 2 }, { key: 'ang', label: 'มุมตัวขับ', color: C.mut, dash: [6, 4] }], minSpan: 2 });
    charts.m1 = new NS.TimeChart($('#chM1'), { series: [{ key: 'err', label: 'error', color: C.ink, dec: 3 }], minSpan: 2, bands: () => { const t = +$('#m1Tol').value || 1; return [{ lo: -t, hi: t }]; } });
    charts.sweep = new NS.XYChart($('#chSweep'), { xlabel: 'มุมตัวขับ / มุมที่หมุน (°)', ylabel: 'G (conductance สัมพัทธ์)' });
    charts.fitG = new NS.XYChart($('#chFitG'), { xlabel: 'มุม (°)', ylabel: 'G' });
    charts.fitErr = new NS.XYChart($('#chFitErr'), { xlabel: 'มุมแสงจริง (°)', ylabel: 'error (°)', yZero: true });
    charts.val = new NS.XYChart($('#chVal'), { xlabel: 'มุมแสงจริง (°)', ylabel: 'error (°)', yZero: true });
    const win = +$('#selWin').value;
    for (const k of ['mv', 'd', 'deg', 'm1']) charts[k].win = win;
  }

  const minus = (s) => String(s).replace(/^-(?=\d)/, '−'); // a true minus sign on displayed numbers
  const tile = (k, v, u = '', cls = '') => { // a degree sign belongs to the number; other units sit after it
    const deg = u === '°' && v !== '—';
    return el('div', { class: 'stat ' + cls }, el('div', { class: 'k', text: k }), el('div', {}, el('span', { class: 'v', text: minus(v) + (deg ? '°' : '') }), el('span', { class: 'u', text: deg ? '' : u })));
  };
  let tilesAt = 0;
  let dialAt = 0;
  function onTelemetry(o, vals) {
    S.last = o;
    S.telCount++;
    S.tel.push([Date.now(), ...vals]);
    if (S.tel.length > 400000) S.tel.splice(0, 100000);
    const t = now();
    for (const k of ['mv', 'd', 'deg', 'm1']) charts[k].push(t, o);
    const h = S.m1.hold;
    if (S.m1.cur && h && !S.m1.cur.done) {
      const tt0 = now();
      h.maxGap = Math.max(h.maxGap, tt0 - h.last);
      h.last = tt0;
      const smp = { st: o.m1, err: o.err, valid: (o.fl & NS.FLAGS.VALID) !== 0, sat: (o.fl & NS.FLAGS.SAT) !== 0 };
      h.samples.push(smp);
      if (smp.st !== 3 || !smp.valid || smp.sat || !(Math.abs(smp.err) <= (+$('#m1Tol').value || 1))) h.bad = (h.bad || 0) + 1; // the hold bar turns amber
    }
    // where the sun (lamp) is in actuator angles while mission 1 holds: the reference for "GO SUN" from a clicked photo
    if (o.m1 === 3 && (o.fl & NS.FLAGS.VALID) && NS.isNum(o.th)) S.sunAz = o.ang + o.th;
    const chip = NS.rules.m1Chip(o.m1);
    setPill('#m1Pill', chip.text, { muted: 'off', info: 'info', ok: 'on', bad: 'bad' }[chip.level]);
    setNum('#hdrTheta', minus(NS.fmt(o.th, 2)));
    setNum('#hdrErr', o.m1 ? minus(NS.fmt(o.err, 2)) : '—'); // error means nothing while mission 1 is idle
    setNum('#hdrAng', minus(NS.fmt(o.ang, 2)));
    const valid = (o.fl & NS.FLAGS.VALID) !== 0;
    const sat = (o.fl & NS.FLAGS.SAT) !== 0;
    setPill('#hdrValid', sat ? 'ADC ตัน' : valid ? 'เห็นแสง' : 'ไม่เห็นแสง', sat ? 'bad' : valid ? 'on' : o.m1 ? 'warn' : 'off');
    const tt = performance.now();
    if (tt - dialAt > 100) { dialAt = tt; renderDials(o); } // dial: at most 10 Hz
    if (tt - tilesAt > 200) { tilesAt = tt; renderTiles(o); }
  }

  function renderTiles(o) {
    const flags = [];
    if (o.fl & NS.FLAGS.MOVING) flags.push('กำลังหมุน');
    if (o.fl & NS.FLAGS.SAT) flags.push('ADC ตัน!');
    if (o.fl & NS.FLAGS.EDGE) flags.push('ขอบช่วงวัด');
    if (o.fl & NS.FLAGS.PROC) flags.push('มีงานรัน');
    if (o.fl & NS.FLAGS.CAMLOCK) flags.push('กล้องล็อก');
    if ($('#tab-live').classList.contains('active')) { // θ / error / angle are in the status bar and the dial: only what they do not show
      $('#liveTiles').replaceChildren(
        tile('S (แสงรวม)', NS.fmt(o.S, 3)),
        tile('D', NS.fmt(o.D, 4)),
        tile('ซ้าย / ขวา', `${NS.fmt(o.v0, 0)} / ${NS.fmt(o.v1, 0)}`, 'mV', (o.fl & NS.FLAGS.SAT) ? 'bad' : ''),
        tile('สถานะ', flags.join(', ') || 'ปกติ'),
      );
    }
    if ($('#tab-m1').classList.contains('active')) {
      const cur = S.m1.cur && !S.m1.cur.done ? S.m1.cur : null;
      const tol = +$('#m1Tol').value || 1;
      const idle = !o.m1; // idle: nothing to judge, nothing red
      const inTol = !idle && NS.isNum(o.err) && Math.abs(o.err) <= tol;
      $('#m1Tiles').replaceChildren(
        tile('θ มุมแสง', NS.fmt(o.th, 2), '°', 'big'),
        tile('error ตอนนี้', idle ? '—' : NS.fmt(o.err, 3), idle ? '' : '°', inTol ? 'ok' : ''),
        tile('เวลาตั้งแต่เริ่ม', cur ? NS.fmt(now() - cur.start, 1) : '—', cur ? 's' : ''),
        tile('เวลาเข้าเป้า (รอบล่าสุด)', S.m1.cur && S.m1.cur.tLock !== null ? NS.fmt(S.m1.cur.tLock, 2) : '—', S.m1.cur && S.m1.cur.tLock !== null ? 's' : ''),
      );
      renderM1Banner();
    }
  }

  // ------------------------------------------------------------------ small UI parts: nav glyphs, verdict panel, dial, problem tray
  const GL = { ok: '✓', warn: '!', bad: '✕', muted: '○' };
  const vrow = (level, label, value, rule) => el('div', { class: 'vrow' }, el('span', { class: 'g ' + level, text: GL[level] }), el('span', { class: 'vl', text: label }), el('span', { class: 'vv', text: value }), el('span', { class: 'vr', text: rule || '' }));
  function renderVerdict(box, v) { // left bar, title line, one row per criterion: glyph, label, value, rule
    box.className = v ? 'verdict ' + v.level : '';
    box.replaceChildren(...(v ? [el('div', { class: 'vt', text: v.title }), ...v.items.map((i) => vrow(i.level, i.label, i.value, i.rule))] : []));
  }
  function updateNav() { // a status glyph per day-of page, computed from state (cheap)
    const g = { connect: S.connected && (S.proto === 'sunseek' ? S.ss.state.lines > 0 : S.hello) ? 'done' : '', hw: S.hwid ? 'done' : '', cal: S.th0ok ? 'done' : $('#calSteps .done') ? 'part' : '', m1: S.m1.runs.some((r) => r.pass) ? 'done' : '', m2: S.images.some((i) => i.ok) ? 'done' : '' };
    for (const [k, v] of Object.entries(g)) { // the square says it, the title says it in words
      const e = $(`#tabs button[data-tab="${k}"] .ng`);
      if (e.dataset.s === v) continue;
      e.dataset.s = v; e.title = v === 'done' ? 'ทำแล้ว' : v === 'part' ? 'ทำไปบางขั้น' : 'ยังไม่ได้ทำ';
    }
    if ($('#tab-connect').classList.contains('active')) renderConn();
  }
  function renderConn() { // the connect page result list
    const pi = S.portInfo; const hz = S.telHz; const sim = S.tr && S.tr.kind === 'sim'; const c = S.connected;
    if (S.proto === 'sunseek') { // the checks of our firmware (HELLO, settings, telemetry) mean nothing here
      const s = S.ss.state; const live = c && s.lines > 0;
      $('#connList').replaceChildren(
        vrow(c ? 'ok' : 'muted', 'พอร์ต', c ? (pi && pi.usbVendorId ? `USB ${pi.usbVendorId.toString(16)}:${(pi.usbProductId || 0).toString(16)}` : 'Web Serial') : 'ยังไม่เชื่อมต่อ', c ? '' : 'กด "เชื่อมต่อ"'),
        vrow(s.lastPong ? 'ok' : c ? 'warn' : 'muted', 'บอร์ดตอบ PING', s.lastPong ? 'PONG' : live ? 'ยังไม่ตอบ' : '—', s.lastPong || !c ? '' : 'กด "ตรวจการเชื่อมต่อ" ในคำสั่งด่วน'),
        vrow(s.banner ? 'ok' : 'muted', 'เฟิร์มแวร์', s.banner ? s.banner.replace(/\s+—.*$/, '') : '—', s.banner ? '' : 'เห็นตอนบอร์ดเพิ่งบูต'),
        vrow(S.ss.tmHz > 0 ? 'ok' : 'muted', 'สตรีม TM', S.ss.tmHz > 0 ? `${S.ss.tmHz} บรรทัด/วินาที` : '—', S.ss.tmHz > 0 || !c ? '' : 'ยังไม่เปิดสตรีม'),
      );
      renderSs();
      return;
    }
    $('#connList').replaceChildren(
      vrow(c ? 'ok' : 'muted', 'พอร์ต', c ? (sim ? 'ตัวจำลอง' : pi && pi.usbVendorId ? `USB ${pi.usbVendorId.toString(16)}:${(pi.usbProductId || 0).toString(16)}` : 'Web Serial') : 'ยังไม่เชื่อมต่อ', c ? '' : 'กด "เชื่อมต่อ"'),
      vrow(S.hello ? 'ok' : c ? 'warn' : 'muted', 'บอร์ดตอบ HELLO', S.hello ? `${S.hello.fw} ${S.hello.ver}` : '—', S.hello ? `บอร์ด ${S.hello.board}` : c ? 'บอร์ดยังไม่ตอบ: กด HELLO ในคำสั่งด่วน' : ''),
      vrow(S.cfgDefs.size ? 'ok' : c ? 'warn' : 'muted', 'ค่าตั้งจากบอร์ด', S.cfgDefs.size ? `${S.cfgDefs.size} ค่า` : '—', S.cfgDefs.size || !c ? '' : 'ยังไม่ได้ค่า: กด CFG LIST'),
      vrow(hz > 0 ? 'ok' : c ? 'warn' : 'muted', 'telemetry', hz > 0 ? `${hz} Hz` : '—', hz > 0 || !c ? '' : 'ยังไม่มี telemetry: กด STREAM ON'),
    );
  }
  function clearLive() { // a disconnected instrument shows no numbers
    S.ss.client.abort('การเชื่อมต่อปิด'); // SunSeek commands that still wait end now
    S.jobs.clear(); renderJobs();
    for (const id of ['#hdrTheta', '#hdrErr', '#hdrAng']) setNum(id, '—');
    setPill('#hdrValid', '—', 'off');
    setPill('#m1Pill', '—', 'off'); renderDials(null);
  }
  function renderJobs() {
    const j = [...S.jobs].filter((n) => n !== 'M1'); // mission 1 has its own chip
    $('#jobChip').hidden = !j.length;
    $('#jobTxt').textContent = j.join(' + ');
  }
  function renderM1Banner() { // verdict of the last run above the chart; a run in progress is neutral
    const b = $('#m1Banner'); const cur = S.m1.cur; const runs = S.m1.runs; const last = runs[runs.length - 1];
    const live = !!(cur && !cur.done && S.last && S.last.m1 !== 0);
    const sig = live ? `live${runs.length}${cur.tLock === null}` : last ? `run${runs.length}` : '';
    if (b.dataset.sig === sig) return;
    b.dataset.sig = sig; b.hidden = !sig;
    if (live) { b.className = 'verdict'; b.replaceChildren(el('div', { class: 'vt', text: `รอบที่ ${runs.length + 1}: ${cur.tLock === null ? 'กำลังหาแสงและเข้าเป้า…' : 'ล็อกแล้ว กำลังนับเวลาคงเป้า…'}` })); }
    else if (last) { b.className = 'verdict ' + (last.pass ? 'ok' : 'bad'); b.replaceChildren(el('div', { class: 'vt', text: last.pass ? `✓ ผ่าน — รอบที่ ${runs.length}: เข้าเป้า ${NS.fmt(last.tLock, 1)} s, error ${NS.fmt(last.mean, 2)} ± ${NS.fmt(last.sd, 2)}°` : `✕ ไม่ผ่าน — รอบที่ ${runs.length}: ${last.why[0] || '—'}` })); }
  }
  function updateHold() { // progress of the "stay on target" time while the board holds
    const h = S.m1.hold; const on = !!(h && S.m1.cur && !S.m1.cur.done); const box = $('#m1Hold');
    if (box.hidden === on) box.hidden = !on;
    if (!on) return;
    const e = Math.min(h.holdS, now() - h.t0);
    const txt = `คงเป้า ${e.toFixed(1)} / ${h.holdS} s${h.bad ? ` · หลุดเกณฑ์แล้ว ${h.bad} sample` : ''}`;
    if (box.dataset.t === txt) return;
    box.dataset.t = txt;
    $('#m1HoldTxt').textContent = txt;
    $('#m1HoldFill').style.width = (e / h.holdS * 100).toFixed(1) + '%';
    $('#m1HoldFill').className = h.bad ? 'warn' : '';
  }

  // angle dial, the one visual signature: half circle -90..+90 deg, satellite axis vertical, light direction (ink),
  // target (dashed), +-tol wedge (green)
  const dials = [];
  function makeDial(box) {
    const cx = 130; const cy = 124; const R = 100;
    const P = (a, r = R) => [cx + r * Math.sin(a * NS.DEG), cy - r * Math.cos(a * NS.DEG)];
    const f = (n) => n.toFixed(1);
    let t = '';
    for (let a = -90; a <= 90; a += 10) { // minor tick every 10 deg, labelled major tick every 30 deg
      const major = !(a % 30);
      const [x1, y1] = P(a); const [x2, y2] = P(a, R - (major ? 10 : 5));
      t += `<line class="d-tick${major ? ' major' : ''}" x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}"/>`;
      if (major) { const [x3, y3] = P(a, R + 13); t += `<text class="d-lbl" x="${f(x3)}" y="${f(y3)}" text-anchor="middle" dominant-baseline="middle">${a > 0 ? '+' + a : String(a).replace('-', '−')}</text>`; }
    }
    box.innerHTML = `<svg viewBox="0 0 260 150" role="img" aria-label="มุมแสงเทียบแกนดาวเทียม"><path class="d-tol"/><path class="d-arc" d="M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy}"/>${t}<line class="d-axis" x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - R}"/><line class="d-tgt"/><line class="d-th"/><circle class="d-dot" r="6"/><rect class="d-base" x="${cx - 14}" y="${cy + 4}" width="28" height="12" rx="2"/></svg>`;
    const q = (s) => box.querySelector(s);
    const tol = q('.d-tol'); const tgt = q('.d-tgt'); const th = q('.d-th'); const dot = q('.d-dot');
    const set = (e, o) => { for (const k in o) e.setAttribute(k, o[k]); };
    const c = (a) => NS.clamp(a, -90, 90);
    return (thv, tg, tl, valid) => {
      const a0 = P(c(tg - tl)); const a1 = P(c(tg + tl)); const g = P(c(tg));
      tol.setAttribute('d', `M ${cx} ${cy} L ${f(a0[0])} ${f(a0[1])} A ${R} ${R} 0 0 1 ${f(a1[0])} ${f(a1[1])} Z`);
      set(tgt, { x1: cx, y1: cy, x2: f(g[0]), y2: f(g[1]) });
      const has = NS.isNum(thv);
      th.style.display = dot.style.display = has ? '' : 'none';
      if (!has) return;
      const p = P(c(thv));
      set(th, { x1: cx, y1: cy, x2: f(p[0]), y2: f(p[1]) });
      set(dot, { cx: f(p[0]), cy: f(p[1]) });
      dot.classList.toggle('off', !valid);
      th.style.opacity = valid ? 1 : 0.35;
    };
  }
  function renderDials(o) {
    const tgt = +$('#m1Tgt').value || 0; const tol = +$('#m1Tol').value || 1;
    const th = o ? o.th : NaN; const valid = !!o && (o.fl & NS.FLAGS.VALID) !== 0;
    for (const [box, f] of dials) if (box.offsetParent !== null) f(th, tgt, tol, valid);
  }

  // every red toast lands here (NS.toast -> NS.onProblem) and stays until someone says "รับทราบ"
  const problems = [];
  NS.onProblem = (msg) => {
    const m = String(msg); const key = m.replace(/^.*→\s*/, '').replace(/^ERR\s+/, '').trim(); const t = Date.now();
    const dup = problems.find((p) => !p.ack && p.key === key); // the same failure reported by two callers is one problem
    if (dup) { if (t - dup.t > 800) dup.n++; dup.t = t; if (m.length > dup.msg.length) dup.msg = m; }
    else { problems.push({ t, msg: m, key, n: 1, ack: false }); if (problems.length > 60) problems.shift(); }
    renderProblems();
  };
  function renderProblems() {
    const n = problems.filter((p) => !p.ack).length;
    const c = $('#probChip');
    c.textContent = `ปัญหา ${n}`; c.classList.toggle('bad', n > 0);
    if ($('#probTray').hidden) return;
    $('#probList').replaceChildren(...(problems.length ? [...problems].reverse().map((p) => {
      const help = NS.rules.errHelp(p.msg) || NS.ss.errHelp(p.msg); // ours first; the organizer's ERR codes are different words
      return el('div', { class: 'prob' + (p.ack ? ' ack' : '') },
        el('div', { class: 'pt' }, NS.clock(p.t).slice(0, 8), p.n > 1 ? `×${p.n}` : null, el('span', { class: 'spacer' }), p.ack ? el('span', { text: 'รับทราบแล้ว' }) : el('button', { class: 'quiet small', text: 'รับทราบ', onclick: () => { p.ack = true; renderProblems(); } })),
        el('div', { class: 'pm', text: p.msg }),
        help ? el('div', { class: 'ph', text: 'แก้: ' + help }) : null);
    }) : [el('div', { class: 'prob-empty', text: 'ไม่มีปัญหา' })]));
  }

  // a measured value with a one-click "use it" (SET + SAVE of that key)
  function showMeasured(box, text, key, val) {
    const use = async () => { try { await send(`SET ${key} ${val}`); await send(`SAVE ${key}`); NS.toast(`ตั้ง ${key} = ${val} และบันทึกแล้ว`, 'good'); } catch (e) { NS.toast(e.message, 'bad'); } };
    box.replaceChildren(`${text} `, el('button', { class: 'small', text: 'ใช้ค่านี้', onclick: use }), el('span', { class: 'cmd muted', text: ` SET ${key} ${val} + SAVE ${key}` }));
  }
  // danger buttons: the first click arms them, a second click within 4 s does it (no browser confirm dialog)
  function armConfirm(btn, fn) {
    const html = btn.innerHTML; let t = null;
    const reset = () => { clearTimeout(t); t = null; btn.innerHTML = html; };
    btn.addEventListener('click', () => { if (t) { reset(); fn(); return; } btn.textContent = 'กดอีกครั้งเพื่อยืนยัน'; t = setTimeout(reset, 4000); });
  }
  function gotoTune(keys) { // open the tune page and flash these rows
    $('#tabs button[data-tab="tune"]').click();
    const rows = keys.map((k) => $(`.cfg-row[data-k="${k}"]`)).filter(Boolean);
    for (const r of rows) { r.classList.add('flash'); setTimeout(() => r.classList.remove('flash'), 2500); }
    if (rows[0]) rows[0].scrollIntoView({ block: 'center' });
  }
  function showM2Fail(why) { // stays until dismissed (the problem tray has it too)
    const b = $('#m2Fail');
    b.hidden = false;
    b.replaceChildren(el('div', { class: 'vt', text: '✕ ไม่ถ่ายภาพ — ' + why }), el('div', { class: 'row mid' },
      el('button', { class: 'small', text: 'ถ่ายตรงนี้ (SNAP)', onclick: () => sendQuiet('M2 SNAP').catch(() => {}) }),
      el('button', { class: 'small', text: 'เปิดจูนค่า act.min / act.max', onclick: () => gotoTune(['act.min', 'act.max']) }),
      el('button', { class: 'quiet small', text: 'ปิด', onclick: () => { b.hidden = true; } })));
  }

  // ------------------------------------------------------------------ config / tune
  function loadCfg(items) {
    S.cfgDefs = new Map(items.map((d) => [d.k, d]));
    for (const d of items) { S.cfgVals.set(d.k, d.v); S.cfgSaved.set(d.k, d.sv !== undefined ? d.sv : d.v); }
    buildCfgUI();
    syncFormsFromCfg();
    if (!S.scan) scanDefaults();
  }
  // the keys a team touches on contest day come first; every key is shown once (refreshCfgRow finds its row by data-k)
  const COMMON = ['ctl.k', 'ctl.db', 'ctl.hys', 'ctl.trim', 'ctl.adapt', 'ctl.wait', 'ctl.meas', 'act.vmax', 'act.bl', 'act.min', 'act.max', 'm1.tgt', 'm1.tol', 'm2.tol', 'm2.settle', 'cam.res', 'cam.q', 'com.hz'];
  function cfgRow(d) {
    const inp = el('input', { type: 'number', min: d.min, max: d.max, step: d.step, value: S.cfgVals.get(d.k) });
    inp.addEventListener('change', () => setCfg(d.k, inp.value));
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
    const row = el('div', { class: 'cfg-row', 'data-k': d.k, 'data-s': `${d.k} ${d.desc}`.toLowerCase() },
      el('div', { class: 'key' }, d.k, el('span', { class: 'tag', text: 'ยังไม่ SAVE' })),
      el('div', { class: 'val' }, inp, el('span', { class: 'u', text: d.u || '' })),
      el('div', { class: 'def', text: 'เริ่ม ' + d.d }),
      el('div', { class: 'desc', text: d.desc }));
    refreshCfgRow(d.k, row);
    return row;
  }
  function buildCfgUI() {
    const box = $('#cfgGroups');
    box.replaceChildren();
    const common = COMMON.map((k) => S.cfgDefs.get(k)).filter(Boolean);
    if (common.length) box.append(el('div', { class: 'cfg-group', 'data-g': '_common' }, el('h2', { text: 'ค่าที่ใช้บ่อย' }), ...common.map(cfgRow)));
    const groups = new Map();
    for (const d of S.cfgDefs.values()) { if (COMMON.includes(d.k)) continue; if (!groups.has(d.g)) groups.set(d.g, []); groups.get(d.g).push(d); }
    for (const [g, list] of groups) box.append(el('details', { class: 'cfg-group', 'data-g': g }, el('summary', { text: `${NS.CFG_GROUPS[g] || g} · ${list.length} ค่า` }), ...list.map(cfgRow)));
    filterCfg();
  }
  function refreshCfgRow(k, rowEl) {
    const row = rowEl || $(`.cfg-row[data-k="${CSS.escape(k)}"]`);
    if (row) {
      const v = S.cfgVals.get(k);
      const d = S.cfgDefs.get(k);
      const inp = row.querySelector('input');
      if (document.activeElement !== inp) inp.value = v;
      row.classList.toggle('dirty', S.cfgSaved.get(k) !== v);
      row.classList.toggle('changed', d && d.d !== v);
    }
    syncFormsFromCfg(k);
    updateUnsaved();
  }
  function updateUnsaved() { // status bar chip: keys whose value in the board differs from what is saved in flash
    let n = 0;
    for (const [k, v] of S.cfgVals) if (S.cfgSaved.get(k) !== v) n++;
    const b = $('#unsavedChip');
    b.hidden = !n; b.textContent = `ยังไม่ SAVE ${n}`;
  }
  async function setCfg(k, v) {
    try { await send(`SET ${k} ${v}`); } catch (e) { NS.toast(e.message, 'bad'); refreshCfgRow(k); }
  }
  function filterCfg() { // while searching every group opens and groups without a match disappear
    const q = ($('#cfgSearch').value || '').toLowerCase().trim();
    for (const g of $$('#cfgGroups .cfg-group')) {
      let any = false;
      for (const r of $$('.cfg-row', g)) { r.hidden = !!q && !r.dataset.s.includes(q); if (!r.hidden) any = true; }
      if (g.tagName === 'DETAILS') {
        if (q) { if (g.dataset.was === undefined) g.dataset.was = g.open ? '1' : '0'; g.open = any; }
        else if (g.dataset.was !== undefined) { g.open = g.dataset.was === '1'; delete g.dataset.was; }
      }
      g.hidden = !!q && !any;
    }
  }
  function syncFormsFromCfg(only) {
    const map = { 'm1.tgt': '#m1Tgt', 'm1.tol': '#m1Tol', 'est.alpha': '#calAlpha', 'sen.vcc': '#calVcc', 'sen.topo': '#calTopo' };
    for (const [k, sel] of Object.entries(map)) {
      if (only && only !== k) continue;
      if (!S.cfgVals.has(k)) continue;
      const e = $(sel);
      if (document.activeElement !== e) e.value = S.cfgVals.get(k);
    }
    if ((!only || only === 'm2.tgt') && S.cfgVals.has('m2.tgt') && $('#m2Ref').value === 'act' && document.activeElement !== $('#m2Tgt')) { $('#m2Tgt').value = S.cfgVals.get('m2.tgt'); syncM2Cmd(); }
  }
  async function refreshCfg() { try { await send('CFG LIST', { timeout: 6000 }); } catch (e) { NS.toast(e.message, 'bad'); } }

  // ------------------------------------------------------------------ hardware tab
  function renderPins() {
    const box = $('#pinBars');
    const mv = S.pins || {};
    const keys = Object.keys(mv).map(Number).sort((a, b) => a - b);
    const deltas = keys.map((k) => (S.pinBase && S.pinBase[k] !== undefined ? Math.abs(mv[k] - S.pinBase[k]) : 0));
    const hot = [...deltas].sort((a, b) => b - a).slice(0, 2).filter((d) => d > 60);
    box.replaceChildren();
    keys.forEach((k, i) => {
      const isHot = hot.includes(deltas[i]) && deltas[i] > 0; // the pin that moves = the LDR you are covering
      const bar = el('div', { class: 'pinbar' + (isHot ? ' hot' : '') }, el('i', { style: `width:${NS.clamp(mv[k] / 3300, 0, 1) * 100}%` }));
      box.append(el('div', { class: isHot ? 'pinhot' : '', text: 'GPIO' + k }), bar, el('div', { text: mv[k] + ' mV' }),
        el('div', { class: isHot ? 'pinhot' : 'muted', text: S.pinBase ? 'Δ' + (mv[k] - (S.pinBase[k] ?? mv[k])) : '' }));
    });
    const sel = $('#selPinPick');
    if (sel.options.length !== keys.length) sel.replaceChildren(...keys.map((k) => el('option', { value: k, text: 'GPIO' + k })));
  }

  // ------------------------------------------------------------------ calibration
  const calVcc = () => cfg('sen.vcc', +$('#calVcc').value || 3300);
  const calTopo = () => cfg('sen.topo', +$('#calTopo').value || 0);
  const mkPt = (ang, mvL, mvR) => ({ ang: +ang, mvL: +mvL, mvR: +mvR, GL: NS.est.toG(+mvL, calVcc(), calTopo()), GR: NS.est.toG(+mvR, calVcc(), calTopo()) });

  function onSweepPoint(j) {
    const p = mkPt(j.ang, j.mv[0], j.mv[1]);
    if (j.sat) { p.sat = true; NS.toast(`จุด ${j.ang}° ADC ตัน: ไม่ใช้ในการ Fit (ลดแสงหรือเปลี่ยนตัวต้านทาน)`, 'warn', 5000); }
    if (j.tag === 'val') { S.cal.val.push(p); renderVal(); }
    else { S.cal.pts.push(p); renderSweep(); }
    $('#swStatus').textContent = `กำลัง sweep… มุม ${j.ang}°`;
  }
  function renderSweep() {
    const pts = S.cal.pts;
    charts.sweep.set([
      { type: 'pts', label: 'ซ้าย G_L', color: C.c1, data: pts.map((p) => [p.ang, p.GL]) },
      { type: 'pts', label: 'ขวา G_R', color: C.c2, data: pts.map((p) => [p.ang, p.GR]) },
    ]);
    $('#swCount').textContent = `${pts.length} จุด`;
    if (pts.length >= 6) markStep(4);
  }
  function manualAngles() {
    const a = +$('#swFrom').value; const b = +$('#swTo').value; const st = Math.abs(+$('#swStep').value) || 5;
    const out = [];
    for (let x = a; a <= b ? x <= b + 1e-9 : x >= b - 1e-9; x += a <= b ? st : -st) out.push(+x.toFixed(3));
    return out;
  }
  function showNextManual() {
    const list = manualAngles();
    const nx = list[S.cal.manualIdx];
    $('#swNext').textContent = nx === undefined ? 'ครบแล้ว' : nx;
    if (nx !== undefined) $('#swAngle').value = nx;
  }
  function swSync() { // SunSeek has no turntable: always by hand
    const auto = !isSs() && $('input[name=swMode]:checked').value === 'auto';
    $('.sw-auto').hidden = !auto; $('.sw-manual').hidden = auto;
    if (!auto) showNextManual();
  }
  // one averaged reading for a sweep / check point: RAW 400 on our firmware, TEAM_SUN x8 on the team SunSeek firmware
  async function readPoint(ang) {
    if (isSs()) {
      const a = await ssCapture(8);
      const p = mkPt(ang * (S.cal.angSign || 1), a.mvL, a.mvR);
      if (a.sat) { p.sat = true; NS.toast(`จุด ${ang}° ADC ตัน: ไม่ใช้ในการ Fit (ลดแสงหรือถอยหลอด)`, 'warn', 5000); }
      return p;
    }
    const w = waitJson('raw', 8000);
    await send('RAW 400');
    const j = await w;
    return mkPt(ang, j.mv[0], j.mv[1]);
  }
  const markStep = (n) => { const b = $(`#calSteps button[data-step="${n}"]`); if (b) b.classList.add('done'); updateNav(); };

  // ---- gamma ratio from two lamp brightnesses at one pose (audit F04): the LDRs must have stopped drifting
  const ambConductance = () => (S.cal.amb ? { GL: S.cal.amb.GL, GR: S.cal.amb.GR } : null);
  async function stableRaw() {
    let prev = null;
    for (let k = 0; k < 8; k++) {
      const w = waitJson('raw', 8000);
      await send('RAW 1000');
      const j = await w;
      if (j.sat) throw new Error('ADC ตัน: ลดแสงหรือถอยหลอดก่อน แล้ววัดใหม่');
      if (prev && Math.abs(j.G[0] / prev.G[0] - 1) < 0.003 && Math.abs(j.G[1] / prev.G[1] - 1) < 0.003) {
        return { GL: (j.G[0] + prev.G[0]) / 2, GR: (j.G[1] + prev.G[1]) / 2, ang: j.ang };
      }
      prev = j;
    }
    throw new Error('ค่ายังไม่นิ่งใน 16 วินาที (LDR ยังเปลี่ยน, ไฟกระพริบ หรือมีคนเดินผ่าน) ลองใหม่');
  }
  function renderGr(extra) {
    const g = S.cal.gr || {};
    const o = { 'ระดับ 1': g.l1 ? `G ซ้าย ${g.l1.GL.toPrecision(4)} / ขวา ${g.l1.GR.toPrecision(4)} ที่มุมตัวขับ ${g.l1.ang}°` : 'ยังไม่วัด' };
    if (g.l2) o['ระดับ 2'] = `G ซ้าย ${g.l2.GL.toPrecision(4)} / ขวา ${g.l2.GR.toPrecision(4)}`;
    if (extra) Object.assign(o, extra);
    NS.kv($('#grOut'), o);
  }
  async function measureLevel(n) {
    try {
      if (!isSs() && S.last && S.last.m1 && S.last.m1 !== 0) await send('M1 STOP');
      $('#grOut').textContent = `กำลังวัดระดับ ${n} (รอให้ค่านิ่ง)…`;
      const l = isSs() ? await ssStable() : await stableRaw();
      if (n === 1) { S.cal.gr = { l1: l, l2: null, ratio: null }; renderGr({ 'ต่อไป': 'บังหน้าหลอดด้วยกระดาษขาว 1–2 ชั้น (ห้ามขยับดาวเทียม) แล้วกด "วัดระดับ 2"' }); return; }
      if (!S.cal.gr || !S.cal.gr.l1) throw new Error('วัดระดับ 1 ก่อน');
      if (Math.abs(l.ang - S.cal.gr.l1.ang) > 0.05) throw new Error('ตัวขับขยับระหว่างการวัดสองระดับ ต้องวัดที่ท่าเดียวกัน: เริ่มใหม่จากระดับ 1');
      S.cal.gr.l2 = l;
      const r = NS.fit.gammaRatio(S.cal.gr.l1, l, ambConductance(), isSs() ? +$('#calLdr').value : cfg('est.gamma', 0.6));
      S.cal.gr.ratio = r.ratio;
      renderGr({ 'แสงหลอดลดลง': `${r.factor.toFixed(2)} เท่า`, 'γ ขวา / γ ซ้าย': `${r.ratio.toFixed(4)}${S.cal.amb ? '' : ' (ยังไม่ได้วัดแสงรอบข้าง ถ้าห้องเปิดไฟให้ทำขั้นที่ 2 แล้ววัดใหม่)'}`, 'ต่อไป': 'เอากระดาษออก แล้วกด Fit' });
      addEvidence('gamma_ratio', `γ ขวา/ซ้าย = ${r.ratio.toFixed(4)} จากแสงสองระดับ (ลดลง ${r.factor.toFixed(2)} เท่า)`, { ...S.cal.gr, factor: r.factor });
    } catch (e) {
      renderGr({ 'ผล': 'ไม่สำเร็จ: ' + e.message });
      NS.toast(e.message, 'bad', 7000);
    }
  }

  function runFit() {
    const nSat = S.cal.pts.filter((p) => p.sat).length;
    if (nSat) NS.toast(`ตัด ${nSat} จุดที่ ADC ตันออกจากการ Fit`, 'warn', 5000);
    try {
      const amb = $('#fitUseAmb').checked && S.cal.amb ? S.cal.amb : null;
      $('#fitStatus').textContent = 'กำลังคำนวณ…';
      const gr = S.cal.gr;
      const useRatio = !!($('#fitUseRatio').checked && gr && gr.l1 && gr.l2);
      // fitGamma unticked = automatic: each LDR's gamma is fitted when the lamp-off (AMB) reading exists
      const c = NS.fit.calibrate(S.cal.pts, {
        gamma: +$('#calLdr').value, alpha0: Math.abs(+$('#calAlpha').value) || 30, fitQ: $('#fitQ').checked, fitGamma: $('#fitGamma').checked || undefined,
        amb, gr: useRatio ? gr : null, vcc: calVcc(), topo: calTopo(), lutDx: +$('#fitLutDx').value || 1, positiveAlpha: S.proto === 'sunseek',
      });
      if (c.flipped) { // SunSeek: keep the organizer's angle sign (see NS.fit.calibrate); the marks from now on count the same way
        S.cal.pts = c.all;
        S.cal.val = S.cal.val.map((p) => ({ ...p, ang: -p.ang }));
        renderSweep();
        S.cal.angSign = -(S.cal.angSign || 1); // points recorded from now on are flipped the same way: keep typing the marks as they are
        NS.toast('มุมบนขีดนับกลับทิศกับเครื่องหมายมุมของกรรมการ: กลับเครื่องหมายทุกจุดให้แล้ว จุดที่บันทึกต่อจากนี้กรอกตามขีดเหมือนเดิม โปรแกรมกลับให้เอง', 'warn', 12000);
      }
      if (useRatio) gr.ratio = c.gRatio;
      const { r, est, phi, rng, errsNo, errsLut, mNo, mLut } = c;
      const pts = c.pts;
      S.cal.fit = { P: r.P, est, phi, rms: r.rms, mNo, mLut, time: new Date().toISOString(), n: r.n, span: r.span, gRatio: useRatio ? gr.ratio : null, flipped: c.flipped };
      renderVerdict($('#fitVerdict'), NS.rules.fitVerdict({ maeLut: mLut.mae, maxLut: mLut.max, gL: r.P.gL, gR: r.P.gR, ambSource: r.ambSource, nSat, gRatioUsed: useRatio, rangeLo: rng ? rng.lo : NaN, rangeHi: rng ? rng.hi : NaN }));
      NS.kv($('#fitParams'), {
        'α (มุมเอียงจริง)': `${r.P.alpha.toFixed(2)}°${r.P.alpha < 0 ? ' (ติดลบ = ช่องสลับทิศ ไม่เป็นไร โปรแกรมจัดการให้)' : ''}`,
        'γ ซ้าย / ขวา': `${r.P.gL.toFixed(3)} / ${r.P.gR.toFixed(3)}${r.ambSource === 'AMB' ? '' : ' (ไม่ได้วัดแสงรอบข้าง จึงใช้ค่าตั้งต้น)'}`,
        'γ ขวา/ซ้าย จากแสงสองระดับ': useRatio ? `${gr.ratio.toFixed(4)} ใช้แล้ว (q เดียวกันทั้งสองช่อง: มุมไม่เพี้ยนตามความสว่างหลอด)` : 'ไม่ได้ใช้: ถ้าหลอดหรี่/สว่างต่างจากตอนคาลิเบรต มุมอาจเพี้ยน 0.5° ขึ้นไป',
        'qL / qR (รูปทรงแต่ละช่อง)': `${r.P.qL.toFixed(3)} / ${r.P.qR.toFixed(3)}`, 'g (gain ขวา/ซ้าย)': NS.fit.gain(r.P).toFixed(4),
        'แสงรอบข้าง aL / aR': `${r.P.aL.toPrecision(4)} / ${r.P.aR.toPrecision(4)} (${{ AMB: 'วัดจากขั้นที่ 2', sweep: 'จากจุดมืดสุดของ sweep', partial: 'sweep ไม่กว้างพอให้ LDR มืด แนะนำทำขั้นที่ 2' }[r.ambSource]})`,
        'ทิศหลอดเทียบศูนย์ของตัวขับ φ': `${phi.toFixed(2)}°`,
        'ช่วงที่วัดได้แม่น (LDR ทั้งสองเห็นหลอด)': rng ? `${rng.lo.toFixed(0)}° ถึง ${rng.hi.toFixed(0)}° (|D| ≤ ${rng.dmax})` : '-',
        'est.minS ที่แนะนำ': est.minS, 'ความคลาดเคลื่อนของโมเดล (log rms)': r.rms.toFixed(4),
        'จำนวนจุด / ช่วงมุม': `${r.n} จุด (ใช้ fit ${r.nUse} ค่า) / ${r.span.toFixed(0)}°`,
        'MAE โมเดล / + LUT': `${NS.fmt(mNo.mae, 3)}° / ${NS.fmt(mLut.mae, 3)}°`,
        'error สูงสุด โมเดล / + LUT': `${NS.fmt(mNo.max, 3)}° / ${NS.fmt(mLut.max, 3)}°`,
      });
      const rows = NS.fit.compare(pts, est, phi);
      const bestMae = Math.min(...rows.map((x) => x.m.mae));
      $('#fitCompare').replaceChildren(el('table', { class: 'tbl' },
        el('thead', {}, el('tr', {}, el('th', { text: 'วิธี' }), el('th', { text: 'MAE (°)' }), el('th', { text: 'สูงสุด (°)' }))),
        el('tbody', {}, rows.map((x) => el('tr', { class: x.m.mae === bestMae ? 'best' : '' }, el('td', { text: x.name }), el('td', { class: 'num', text: NS.fmt(x.m.mae, 3) }), el('td', { class: 'num', text: NS.fmt(x.m.max, 3) }))))));
      const xs = [];
      const angs = pts.map((p) => p.ang);
      for (let a = Math.min(...angs); a <= Math.max(...angs); a += 0.5) xs.push(a);
      charts.fitG.set([ // model = dashed line in the channel's colour, drawn under the measured dots
        { type: 'line', color: C.c1, dash: [5, 4], width: 1.5, data: xs.map((a) => [a, NS.fit.model(r.P, a).GL]) },
        { type: 'line', color: C.c2, dash: [5, 4], width: 1.5, data: xs.map((a) => [a, NS.fit.model(r.P, a).GR]) },
        { type: 'pts', label: 'วัดได้ ซ้าย', color: C.c1, data: pts.map((p) => [p.ang, p.GL]) },
        { type: 'pts', label: 'วัดได้ ขวา', color: C.c2, data: pts.map((p) => [p.ang, p.GR]) },
      ]);
      charts.fitErr.set([
        { type: 'pts', label: 'โมเดลอย่างเดียว', color: C.c3, data: errsNo.map((e) => [e.truth, e.err]) },
        { type: 'pts', label: 'โมเดล + LUT', color: C.ink, data: errsLut.map((e) => [e.truth, e.err]) },
      ]);
      $('#fitStatus').textContent = `เสร็จ: MAE ${NS.fmt(mLut.mae, 3)}° (โมเดล + LUT)`;
      markStep(5);
      renderPushPreview();
      addEvidence('calibration', `fit ${r.n} จุด ช่วง ${r.span.toFixed(0)}°: MAE ${NS.fmt(mLut.mae, 3)}° สูงสุด ${NS.fmt(mLut.max, 3)}°`, { P: r.P, mNo, mLut });
    } catch (e) {
      $('#fitStatus').textContent = 'Fit ไม่สำเร็จ: ' + e.message;
      renderVerdict($('#fitVerdict'), null);
      NS.toast('Fit ไม่สำเร็จ: ' + e.message, 'bad');
    }
  }

  function renderVal() {
    const f = S.cal.fit;
    if (!f) { $('#valOut').textContent = 'ต้อง Fit (ขั้นที่ 5) ก่อน'; return; }
    const errs = NS.fit.errors(S.cal.val, f.est, f.phi);
    const m = NS.fit.metrics(errs.map((e) => e.err));
    renderVerdict($('#valVerdict'), m.n ? NS.rules.valVerdict({ mae: m.mae, mean: m.mean, n: m.n }) : null);
    NS.kv($('#valOut'), { 'จำนวนจุดตรวจ': m.n, 'MAE': `${NS.fmt(m.mae, 3)}°`, 'RMS': `${NS.fmt(m.rms, 3)}°`, 'สูงสุด': `${NS.fmt(m.max, 3)}°`, 'bias เฉลี่ย': `${NS.fmt(m.mean, 3)}°` });
    charts.val.set([{ type: 'pts', label: 'error จุดตรวจ', color: C.ink, data: errs.map((e) => [e.truth, e.err]) }]);
    f.val = m;
    if (m.n >= 4) markStep(6);
  }

  function pushLines() { // throws (Thai) when the fit cannot go into the team firmware
    const f = S.cal.fit;
    if (!f) return [];
    return isSs() ? NS.ss.teamLines(f.est) : NS.fit.pushLines(f.est);
  }
  function renderPushPreview() {
    let t;
    try { t = pushLines().join('\n') || 'ยังไม่มีผล Fit'; } catch (e) { t = 'ส่งไม่ได้: ' + e.message; }
    $('#pushPreview').textContent = t;
  }

  // ------------------------------------------------------------------ mission 1
  function finishRun() {
    const cur = S.m1.cur;
    if (!cur || cur.done) return;
    cur.done = true;
    const r = NS.m1Judge(S.m1.hold, { tol: +$('#m1Tol').value || 1, hz: cfg('com.hz', 20), now: now() });
    Object.assign(cur, r);
    S.m1.runs.push(cur);
    S.m1.hold = null;
    renderM1Banner(); updateNav();
    const tb = $('#m1Runs tbody');
    tb.append(el('tr', {},
      el('td', { text: S.m1.runs.length }), el('td', { text: NS.clock(cur.wall) }), el('td', { class: 'num', text: NS.fmt(cur.tLock, 2) }),
      el('td', { class: 'num', text: cur.iters ?? '—' }), el('td', { class: 'num', text: NS.fmt(cur.mean, 3) }), el('td', { class: 'num', text: NS.fmt(cur.sd, 3) }),
      el('td', { class: 'num', text: NS.fmt(cur.maxAbs, 3) }), el('td', { class: 'num', text: `${cur.n}/${cur.need}` }),
      el('td', { class: cur.pass ? 'pass' : 'fail', text: cur.pass ? 'ผ่าน' : 'ไม่ผ่าน: ' + cur.why.join(', ') })));
    addEvidence('mission1', `เข้าเป้าใน ${NS.fmt(cur.tLock, 2)} s, error ${NS.fmt(cur.mean, 3)} ± ${NS.fmt(cur.sd, 3)}° สูงสุด ${NS.fmt(cur.maxAbs, 3)}° (${cur.n} sample, คงเป้า ${cur.holdS} s, เกณฑ์ ±${cur.tol}°) → ${cur.pass ? 'ผ่าน' : 'ไม่ผ่าน: ' + cur.why.join(', ')} [error = ค่าประมาณของบอร์ด]`, cur);
  }

  // ------------------------------------------------------------------ mission 2 (images)
  function onImage(img) {
    const meta = S.imgMeta.get(String(img.id)) || { id: img.id };
    const blob = new Blob([img.bytes], { type: 'image/jpeg' });
    const url = URL.createObjectURL(blob);
    const rec = { id: img.id, url, blob, meta, ok: img.ok, ms: img.ms, wall: Date.now() };
    S.images.push(rec);
    const az = NS.isNum(meta.cam_az_cmd) ? ` ${meta.cam_az_cmd.toFixed(0)}°` : '';
    rec.fig = el('figure', { title: NS.clock(rec.wall), onclick: () => showImage(rec) }, el('img', { src: url }), el('figcaption', { text: `#${img.id}${az}${img.ok ? '' : ' CRC!'}` }));
    $('#m2Gallery').prepend(rec.fig);
    showImage(rec);
    if (img.ok) $('#m2Fail').hidden = true; // a good photo after a refused shot ends that banner
    updateNav();
    $('#m2Status').textContent = img.ok ? `ได้ภาพ #${img.id} ครบ (${(img.bytes.length / 1024).toFixed(1)} KB ใน ${img.ms} ms)` : `ภาพ #${img.id} เสีย (CRC ไม่ตรง / ขาด ${img.missing} ชิ้น)`;
    addEvidence('image', `ภาพ #${img.id} ${img.ok ? 'สมบูรณ์' : `เสีย (ขาด ${img.missing} ชิ้น)`} มุมตัวขับ ${meta.ang ?? '-'}° เป้า ${meta.tgt ?? '-'}° err_cmd ${meta.err_cmd ?? '-'}° (คำสั่งเทียบตัวนับ step) อ้างอิง ${meta.ref ?? '-'} ล็อกแสง ${meta.locked ?? '-'}`, { ...meta, crc_ok: img.ok, missing: img.missing });
    autoSave(rec);
    for (const w of S.imgWait.splice(0)) { clearTimeout(w.to); w.res(rec); }
  }
  function showFacts(rec) { // the few numbers that matter; the full metadata sits in the "metadata ทั้งหมด" fold
    const m = rec.meta; const tol = NS.isNum(m.tol) ? m.tol : cfg('m2.tol', 1);
    NS.kv($('#m2Facts'), {
      'ภาพ': `#${rec.id}${rec.ok ? '' : ' (เสีย: CRC ไม่ตรง)'}`,
      'มุมกล้องตอนถ่าย (cam_az_cmd)': NS.isNum(m.cam_az_cmd) ? `${m.cam_az_cmd.toFixed(2)}°` : '—',
      'อ้างอิง': m.ref ?? '—',
      'err_cmd เทียบ tol': NS.isNum(m.err_cmd) ? `${m.err_cmd.toFixed(2)}° (tol ${tol}°) ${Math.abs(m.err_cmd) <= tol ? '✓' : '✕'}` : '—',
      'แสงกล้อง': m.locked === undefined ? '—' : m.locked ? 'ล็อกแล้ว' : 'อัตโนมัติ (ยังไม่ล็อก)',
      'ตัวขับตอนถ่าย': m.moving === undefined ? '—' : m.moving ? 'ยังหมุนอยู่ (ไม่นิ่ง)' : 'นิ่ง',
      'θ ตอนถ่าย': NS.isNum(m.th) ? `${m.th.toFixed(2)}°` : '—',
      'พลิกภาพ (hm / vf)': m.hm === undefined ? '—' : `ซ้าย-ขวา ${m.hm ? 'ใช่' : 'ไม่'} · บน-ล่าง ${m.vf ? 'ใช่' : 'ไม่'}`,
    });
  }
  function showImage(rec) {
    S.curImg = rec;
    $('#m2Img').src = rec.url;
    showFacts(rec);
    for (const f of $$('#m2Gallery figure')) f.classList.toggle('cur', f === rec.fig);
    const m = { ...rec.meta };
    delete m.type;
    m.crc_ok = rec.ok;
    if ('err_cmd' in m) { m['err_cmd (คำสั่ง − ตัวนับ step ไม่ใช่มุมจริงที่วัด)'] = m.err_cmd; delete m.err_cmd; }
    if ('th' in m) { m['th (มุมแสงตอนถ่าย ประมาณจาก LDR)'] = m.th; delete m.th; }
    NS.kv($('#m2Meta'), m);
    $('#m2BoreOut').textContent = '';
    $('#m2Aim').replaceChildren(el('span', { class: 'muted', text: 'คลิกบนภาพที่เป้า เพื่อหาว่าต้องหันไปมุมไหน' }));
    const ov = $('#m2Overlay');
    ov.getContext('2d').clearRect(0, 0, ov.width, ov.height);
  }

  // picture direction for a photo: the latest measured cam.dir (the mounting does not change), flipped by the photo's
  // own hmirror; 0 = not measured yet. Field of view: the latest measured cam.hfov.
  const imgDir = (m) => NS.cam.effDir(cfg('cam.dir', 0) || m.cam_dir || 0, m.hm ?? cfg('cam.hmirror', 0));
  const imgHfov = (m) => cfg('cam.hfov', m.hfov || 62);
  const needDir = 'ยังไม่รู้ทิศของภาพ: กด "ตรวจทิศภาพ" ก่อน (ครั้งเดียวหลังติดกล้อง หรือหลังกลับภาพ)';
  function overlay() { // canvas on top of the photo, same size as shown
    const img = $('#m2Img');
    const ov = $('#m2Overlay');
    ov.width = img.clientWidth; ov.height = img.clientHeight;
    ov.style.left = img.offsetLeft + 'px';
    return { og: ov.getContext('2d'), k: img.clientWidth / img.naturalWidth, ov };
  }

  function boresight() {
    const rec = S.curImg;
    if (!rec) { NS.toast('ยังไม่มีภาพ', 'warn'); return; }
    const m = rec.meta;
    const box = $('#m2BoreOut');
    const s = imgDir(m);
    if (!s) { box.textContent = needDir; return; }
    // the LDR angle is only trustworthy at the null: the photo must be taken while mission 1 holds on the lamp
    if (!NS.isNum(m.th) || m.m1 !== 'HOLD' || Math.abs(m.th) > 2) {
      box.textContent = `ภาพนี้ใช้วัดไม่ได้: ต้องถ่ายตอนภารกิจ 1 ล็อกหลอด (HOLD) และ |θ| ≤ 2° (ภาพนี้ m1 = ${m.m1 ?? '-'}, θ = ${NS.isNum(m.th) ? m.th.toFixed(2) : '-'}°) กดปุ่ม "ล็อกหลอดแล้ววัด boresight"`;
      return;
    }
    const img = $('#m2Img');
    const W = img.naturalWidth; const H = img.naturalHeight;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, W, H).data;
    const lum = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) lum[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    const sorted = Float32Array.from(lum).sort();
    const thr = Math.max(200, sorted[Math.floor(sorted.length * 0.997)]);
    let sx = 0; let sy = 0; let n = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (lum[y * W + x] >= thr) { sx += x; sy += y; n++; }
    if (n < 5) { box.textContent = 'หาจุดสว่างไม่เจอ (ต้องมีหลอดอยู่ในภาพ)'; return; }
    const cx = sx / n; const cy = sy / n;
    const r = NS.cam.boresight(cx, W, m.th, imgHfov(m), s);
    const { og, k, ov } = overlay();
    og.strokeStyle = '#00e0ff'; og.lineWidth = 2;
    og.beginPath(); og.arc(cx * k, cy * k, 12, 0, Math.PI * 2); og.stroke();
    og.strokeStyle = 'rgba(255,255,255,.6)'; og.beginPath(); og.moveTo(ov.width / 2, 0); og.lineTo(ov.width / 2, ov.height); og.stroke();
    // cam.off is measured against the sensor's zero: before CAL TH0 that zero can be degrees away from the real axis
    const noZero = !cfg('est.th0', 0) && !(S.lut && S.lut.v);
    box.replaceChildren(`หลอดอยู่ห่างกลางภาพ ${r.delta.toFixed(2)}° (θ ตอนถ่าย ${m.th.toFixed(2)}°) → cam.off ที่แนะนำ = ${r.off.toFixed(2)}° `,
      noZero ? el('b', { text: '(บอร์ดยังไม่ได้คาลิเบรต/ตั้งศูนย์ CAL TH0: ค่านี้เทียบกับศูนย์ที่ยังผิดอยู่ ทำขั้นคาลิเบรต 1–8 ก่อนแล้ววัดใหม่) ' }) : '',
      el('button', { class: 'small', text: 'ใช้ค่านี้ + SAVE', onclick: async () => { try { await send(`SET cam.off ${r.off.toFixed(2)}`); await send('SAVE cam.off'); NS.toast('ตั้ง cam.off และบันทึกแล้ว', 'good'); addEvidence('boresight', `cam.off = ${r.off.toFixed(2)}° (หลอดห่างกลางภาพ ${r.delta.toFixed(2)}°, θ ${m.th.toFixed(2)}°)`, { ...r, th: m.th, id: rec.id }); } catch (e) { NS.toast(e.message, 'bad'); } } }));
  }
  async function boresightAuto() {
    const box = $('#m2BoreOut');
    try {
      if (!cfg('cam.dir', 0)) throw new Error(needDir);
      if (!(S.last && S.last.m1 === 3)) {
        box.textContent = 'เริ่มภารกิจ 1 ให้หันเข้าหาหลอดก่อน แล้วรอล็อก…';
        const w = waitEvent('M1', 'HOLD', 45000);
        await send('M1 START');
        await w;
      }
      box.textContent = 'ล็อกแล้ว กำลังถ่าย…';
      const wi = nextImage();
      await send('M2 SNAP');
      const rec = await wi;
      showImage(rec);
      if (!$('#m2Img').complete) await new Promise((res) => { $('#m2Img').onload = res; });
      boresight();
    } catch (e) { box.textContent = 'วัด boresight ไม่สำเร็จ: ' + e.message; }
  }

  // click on the photo -> the actuator angle of that spot -> point the camera there (actuator or sun reference)
  function aimAt(x, y) {
    const rec = S.curImg;
    if (!rec) return;
    const m = rec.meta;
    const box = $('#m2Aim');
    const s = imgDir(m);
    if (!s) { box.textContent = needDir; return; }
    if (!NS.isNum(m.cam_az_cmd)) { box.textContent = 'ภาพนี้ไม่มีมุมตอนถ่าย (metadata หาย)'; return; }
    const img = $('#m2Img');
    const W = img.naturalWidth;
    const az = NS.cam.pixelToAz(x, W, m.cam_az_cmd, imgHfov(m), s);
    // the sun direction in the same actuator frame: from this photo (GO SUN / taken while M1 saw the lamp), else the latest HOLD
    const sun = NS.isNum(m.sun_az) ? { az: m.sun_az, from: 'ภาพนี้ (GO SUN)' } : NS.isNum(m.th) ? { az: m.ang + m.th, from: 'θ ตอนถ่ายภาพนี้' } : NS.isNum(S.sunAz) ? { az: S.sunAz, from: 'ตอนภารกิจ 1 ล็อกล่าสุด' } : null;
    const { og, k } = overlay();
    og.strokeStyle = '#ff3d71'; og.lineWidth = 2;
    og.beginPath(); og.moveTo(x * k - 14, y * k); og.lineTo(x * k + 14, y * k); og.moveTo(x * k, y * k - 14); og.lineTo(x * k, y * k + 14); og.stroke();
    const go = el('button', { class: 'small', text: `หันไปถ่ายตรงนี้ (M2 GO ${az.toFixed(2)})`, onclick: () => sendQuiet(`M2 GO ${az.toFixed(2)}`).catch(() => {}) });
    const kids = [`จุดนี้อยู่ที่มุม ${az.toFixed(2)}° (ห่างกลางภาพ ${(az - m.cam_az_cmd).toFixed(2)}°) `, go];
    if (sun) {
      const off = az - sun.az;
      kids.push(' ', el('button', { class: 'small', text: `เทียบดวงอาทิตย์ (M2 GO SUN ${off.toFixed(2)})`, title: `ทิศดวงอาทิตย์จาก${sun.from} = ${sun.az.toFixed(2)}°`, onclick: () => sendQuiet(`M2 GO SUN ${off.toFixed(2)}`).catch(() => {}) }));
    }
    box.replaceChildren(...kids);
    addEvidence('aim_click', `คลิกบนภาพ #${rec.id}: มุม ${az.toFixed(2)}°${sun ? ` = ดวงอาทิตย์ ${sun.az.toFixed(2)}° ${az - sun.az >= 0 ? '+' : ''}${(az - sun.az).toFixed(2)}°` : ''}`, { id: rec.id, x, y, az, sun });
  }

  // picture direction + field of view: photo, turn +8 deg the same way, photo, compare (NS.cam.dirFromProfiles)
  async function checkDirection() {
    const out = $('#m2DirOut');
    const D = 8;
    try {
      if (S.last && S.last.m1) await send('M1 STOP');
      const a0 = S.last && NS.isNum(S.last.ang) ? S.last.ang : 0;
      out.textContent = 'ถ่ายภาพที่ 1…';
      await send(`GOTO ${(a0 - 3).toFixed(2)}`); await waitIdle();
      await send(`GOTO ${a0.toFixed(2)}`); await waitIdle(); // both turns the same way: the gear play cannot eat the 8 deg
      let w = nextImage(); await send('M2 SNAP'); const A = await w;
      out.textContent = `หมุน +${D}° แล้วถ่ายภาพที่ 2…`;
      await send(`MOVE ${D}`);
      w = nextImage(); await send('M2 SNAP'); const B = await w;
      await send(`GOTO ${a0.toFixed(2)}`);
      if (!A.ok || !B.ok) throw new Error('ภาพเสียระหว่างส่ง ลองใหม่');
      const turned = B.meta.ang - A.meta.ang;
      if (!(Math.abs(turned - D) < 1.5)) throw new Error(`ตัวขับหมุนได้ ${NS.fmt(turned, 2)}° ไม่ใช่ ${D}° (ชนขีดจำกัด act.min/act.max?)`);
      const [iA, iB] = await Promise.all([NS.cam.load(A.url), NS.cam.load(B.url)]);
      const r = NS.cam.dirFromProfiles(NS.cam.profile(iA), NS.cam.profile(iB), turned);
      const hm = A.meta.hm ?? cfg('cam.hmirror', 0);
      const camDir = r.s * (hm ? -1 : 1);
      const said = `${r.s > 0 ? 'ของที่มุมมากกว่าอยู่ซ้ายของภาพ' : 'ของที่มุมมากกว่าอยู่ขวาของภาพ'}, มุมรับภาพ ${r.hfov.toFixed(1)}° (ความมั่นใจ ${r.score.toFixed(2)} เทียบทิศกลับ ${r.other.toFixed(2)})`;
      if (!r.ok) { out.textContent = `ไม่แน่ใจ: ${said} ภาพมีรายละเอียดน้อยเกินไป (ผนังเรียบ/มืด) หันไปทางที่มีของหลายอย่างหรือมีหลอดในภาพ แล้วลองใหม่`; return; }
      await send(`SET cam.dir ${camDir}`);
      await send(`SET cam.hfov ${r.hfov.toFixed(1)}`);
      await send('SAVE cam.dir cam.hfov');
      out.textContent = `เสร็จ: ${said} → ตั้ง cam.dir ${camDir} และ cam.hfov ${r.hfov.toFixed(1)} แล้วบันทึกลงบอร์ด`;
      addEvidence('camera_direction', `ทิศภาพ: ${said} → cam.dir ${camDir}`, { ...r, camDir, hm, turned });
    } catch (e) { out.textContent = 'ตรวจทิศภาพไม่สำเร็จ: ' + e.message; }
  }

  // photos all around (actuator reference), then click the target in any of them
  function scanDefaults() { // the whole travel, ~70 % of the field of view per step so the photos overlap
    $('#scanFrom').value = cfg('act.min', -170);
    $('#scanTo').value = cfg('act.max', 170);
    $('#scanStep').value = Math.round(cfg('cam.hfov', 62) * 0.7);
  }
  async function scanAround() {
    const from = +$('#scanFrom').value; const to = +$('#scanTo').value;
    const step = Math.max(5, +$('#scanStep').value || 40);
    const list = [];
    for (let a = Math.min(from, to); a <= Math.max(from, to) + 1e-9; a += step) list.push(+a.toFixed(2));
    if (list.length && list[list.length - 1] < Math.max(from, to) - 0.5) list.push(Math.max(from, to)); // the far end too
    if (!list.length) return;
    const resPrev = cfg('cam.res', 1);
    const small = $('#scanSmall').checked && resPrev !== 0;
    S.scan = { stop: false };
    let done = 0;
    try {
      if (S.last && S.last.m1) await send('M1 STOP');
      if (small) await send('SET cam.res 0');
      for (const a of list) {
        if (!S.scan || S.scan.stop) break;
        $('#m2Status').textContent = `สแกน ${done + 1}/${list.length}: หันไปที่ ${a}°…`;
        const w = nextImage(90000);
        await send(`M2 GO ${a}`);
        try { await w; done++; } catch (e) { if (S.scan && S.scan.stop) break; NS.toast(`มุม ${a}°: ${e.message}`, 'warn', 4000); }
      }
      $('#m2Status').textContent = `สแกนเสร็จ ${done}/${list.length} ภาพ: คลิกภาพในแกลเลอรี แล้วคลิกที่เป้า`;
    } catch (e) { NS.toast('สแกนไม่ครบ: ' + e.message, 'bad'); }
    finally {
      if (small) await send(`SET cam.res ${resPrev}`).catch(() => {});
      S.scan = null;
    }
  }

  // ---- photos straight into a folder (Chrome/Edge): nothing is lost if nobody pressed "save"
  let saveDir = null;
  async function pickSaveDir() {
    if (!window.showDirectoryPicker) { NS.toast('เบราว์เซอร์นี้เลือกโฟลเดอร์ไม่ได้ ใช้ปุ่ม "บันทึกภาพ" ทีละภาพ', 'warn', 6000); return; }
    try {
      saveDir = await window.showDirectoryPicker({ mode: 'readwrite' });
      $('#m2DirName').textContent = 'บันทึกอัตโนมัติลง: ' + saveDir.name;
    } catch (_) { /* cancelled */ }
  }
  async function autoSave(rec) {
    if (!saveDir) return;
    const base = `img${rec.id}_${NS.fileStamp()}`;
    try {
      for (const [name, data] of [[base + '.jpg', rec.blob], [base + '.json', JSON.stringify({ ...rec.meta, crc_ok: rec.ok, saved: new Date().toISOString() }, null, 1)]]) {
        const fh = await saveDir.getFileHandle(name, { create: true });
        const wr = await fh.createWritable();
        await wr.write(data);
        await wr.close();
      }
      rec.file = base;
    } catch (e) {
      saveDir = null;
      $('#m2DirName').textContent = 'ยังไม่ได้เลือกโฟลเดอร์';
      NS.toast('บันทึกภาพลงโฟลเดอร์ไม่สำเร็จ (' + e.message + ') เลือกโฟลเดอร์ใหม่', 'bad', 7000);
    }
  }

  // ------------------------------------------------------------------ evidence + AI
  function addEvidence(type, text, data) {
    const rec = { t: new Date().toISOString(), type, text, data };
    S.evidence.push(rec);
    $('#evTable tbody').prepend(el('tr', {}, el('td', { text: NS.clock() }), el('td', { text: type }), el('td', { text })));
  }
  function statLine(key, rows, idx) {
    const v = rows.map((r) => r[idx]).filter(NS.isNum);
    if (!v.length) return null;
    return `${key}: ${NS.mean(v).toFixed(3)} ± ${NS.std(v).toFixed(3)} [${Math.min(...v).toFixed(3)} … ${Math.max(...v).toFixed(3)}]`;
  }
  function buildSsPack() { // the same idea for the organizer's firmware: what the board said last, what we sent, what it refused
    const s = S.ss.state; const L = [];
    const sym = $('#aiSymptom').value.trim();
    if (sym) L.push('## อาการที่ทีมเห็น (ทีมเขียนเอง)', sym, '');
    L.push('# SunSeek context (สร้างอัตโนมัติจาก NasaSat Lab)');
    L.push(`- เวลา: ${new Date().toLocaleString('th-TH')} · tool ${NS.VERSION} · โหมด: SunSeek (เฟิร์มแวร์ของผู้จัด) · ช่องทาง: ${S.tr ? S.tr.kind : 'ไม่ได้เชื่อมต่อ'}`);
    L.push('- protocol: ส่ง "CMD,arg" (ไม่มี @id) บอร์ดตอบ PONG / "ACK,CMD,..." / "ERR,CODE" (ERR ไม่บอกว่าปฏิเสธคำสั่งไหน) / "TM,KEY,VALUE,..." / "EVT,NAME" / "PAYLOAD,..."');
    if (s.banner) L.push(`- ${s.banner}`);
    if (s.spacecraftId) L.push(`- Spacecraft ID: ${s.spacecraftId}`);
    L.push('## ค่าล่าสุดของ TM ทุกตัว (KEY=VALUE)');
    const o = s.toObject();
    L.push(Object.keys(o).length ? Object.entries(o).map(([k, v]) => `${k}=${v}`).join(' ') : '(ยังไม่มี: กด STATUS)');
    if (s.lastAck) L.push(`ACK ล่าสุด: ${s.lastAck.raw}`);
    if (s.lastErr) L.push(`ERR ล่าสุด: ${s.lastErr.raw}`);
    if (s.events.length) { L.push('## EVT ล่าสุด'); for (const ev of s.events.slice(-10)) L.push(`${NS.clock(ev.t)} ${ev.raw}`); }
    const errs = S.log.filter((r) => r[1] === 'rx' && (r[2].startsWith('ERR,') || r[2].startsWith('EVT,'))).slice(-15);
    if (errs.length) { L.push('## ERR / EVT ที่บอร์ดส่งมาล่าสุด'); for (const r of errs) L.push(`${NS.clock(r[0])} ${r[2]}`); }
    const sent = S.log.filter((r) => r[1] === 'tx').slice(-20);
    if (sent.length) { L.push('## คำสั่งที่ส่งล่าสุด (20)'); for (const r of sent) L.push(`${NS.clock(r[0])} ${r[2]}`); }
    L.push('## คำถามถึง AI');
    L.push('(พิมพ์ปัญหาหรือสิ่งที่อยากให้ช่วยต่อตรงนี้)');
    return L.join('\n');
  }
  function buildAiPack() {
    if (S.proto === 'sunseek') return buildSsPack();
    const L = [];
    const sym = $('#aiSymptom').value.trim();
    if (sym) L.push('## อาการที่ทีมเห็น (ทีมเขียนเอง)', sym, '');
    L.push('# NasaSat context (สร้างอัตโนมัติจาก NasaSat Lab)');
    L.push(`- เวลา: ${new Date().toLocaleString('th-TH')} · tool ${NS.VERSION} · ช่องทาง: ${S.tr ? S.tr.kind : 'ไม่ได้เชื่อมต่อ'}`);
    L.push('- ระบบ: ESP32-S3 + LDR 2 ตัววางเป็นตัว V (เอียง ±α) + stepper 28BYJ-48/ULN2003; คำนวณมุม θ = atan(D / tan α) หลังแปลง mV → conductance → ^(1/γ) − ambient → ^(1/qL หรือ 1/qR) แล้วแก้ด้วย LUT');
    L.push('- protocol: "@id CMD args" ตอบ "@id OK/ERR", telemetry TH/T, JSON "J {...}", event "E ..."');
    if (S.hello) L.push(`- firmware: ${S.hello.fw} ${S.hello.ver} บอร์ด ${S.hello.board}`);
    if (S.hwid) L.push(`- HWID: ${JSON.stringify(S.hwid)}`);
    const changed = [...S.cfgDefs.values()].filter((d) => S.cfgVals.get(d.k) !== d.d).map((d) => `${d.k}=${S.cfgVals.get(d.k)}`);
    L.push('## ค่าที่ต่างจากค่าเริ่มต้น');
    L.push(changed.length ? changed.join(' ') : '(ไม่มี)');
    const unsaved = [...S.cfgDefs.keys()].filter((k) => S.cfgSaved.get(k) !== S.cfgVals.get(k));
    if (unsaved.length) L.push(`(ยังไม่ SAVE: ${unsaved.join(', ')})`);
    if (S.cal.fit) {
      const f = S.cal.fit;
      L.push('## ผลคาลิเบรต');
      L.push(`alpha=${f.P.alpha.toFixed(2)} gammaL=${f.P.gamma.toFixed(3)} gammaR=${(f.P.gammaR ?? f.P.gamma).toFixed(3)} qL=${f.P.qL.toFixed(3)} qR=${f.P.qR.toFixed(3)} g=${NS.fit.gain(f.P).toFixed(4)} aL=${f.P.aL.toPrecision(4)} aR=${f.P.aR.toPrecision(4)} phi=${f.phi.toFixed(2)}`);
      L.push(f.gRatio ? `gammaR/gammaL จากแสงสองระดับ = ${f.gRatio.toFixed(4)} (q ร่วม)` : 'ไม่ได้วัด gamma สองระดับแสง (มุมอาจเพี้ยนเมื่อหลอดสว่างเปลี่ยน)');
      L.push(`จุด=${f.n} ช่วง=${f.span.toFixed(0)}° MAE(model)=${NS.fmt(f.mNo.mae, 3)} MAE(+LUT)=${NS.fmt(f.mLut.mae, 3)} max=${NS.fmt(f.mLut.max, 3)}${f.val ? ` validate MAE=${NS.fmt(f.val.mae, 3)} max=${NS.fmt(f.val.max, 3)}` : ''}`);
    }
    if (S.diag) { L.push('## DIAG ล่าสุด'); L.push(...S.diag.lines); }
    if (S.hk) L.push(`## สุขภาพระบบ (J hk ล่าสุด)`, JSON.stringify(S.hk));
    L.push(`กล้อง: cam.dir=${cfg('cam.dir', 0)} (${cfg('cam.dir', 0) ? 'ตรวจทิศภาพแล้ว' : 'ยังไม่ได้ตรวจทิศภาพ'}) cam.hfov=${cfg('cam.hfov', 62)} cam.off=${cfg('cam.off', 0)} hmirror=${cfg('cam.hmirror', 0)} vflip=${cfg('cam.vflip', 0)} ภาพที่ได้ ${S.images.length}`);
    if (S.telCols && S.tel.length) {
      const cutoff = Date.now() - 10000;
      const rows = S.tel.filter((r) => r[0] >= cutoff);
      L.push(`## telemetry 10 วินาทีล่าสุด (${rows.length} แถว) ค่าเฉลี่ย ± SD [ต่ำสุด … สูงสุด]`);
      for (const k of ['th', 'err', 'ang', 'D', 'S', 'v0', 'v1']) {
        const i = S.telCols.indexOf(k);
        if (i >= 0) { const s = statLine(k, rows, i + 1); if (s) L.push(s); }
      }
      const fi = S.telCols.indexOf('fl');
      if (fi >= 0 && rows.length) {
        const fl = rows.map((r) => r[fi + 1]);
        const cnt = (b) => fl.filter((f) => f & b).length;
        L.push(`flags: เห็นแสง ${cnt(NS.FLAGS.VALID)}/${fl.length}, หมุน ${cnt(NS.FLAGS.MOVING)}, ADC ตัน ${cnt(NS.FLAGS.SAT)}, ขอบช่วง ${cnt(NS.FLAGS.EDGE)}`);
      }
    }
    const errs = S.log.filter((r) => r[1] === 'rx' && (/^(@\d+ )?ERR/.test(r[2]) || r[2].startsWith('E '))).slice(-15);
    if (errs.length) { L.push('## error/event ล่าสุด'); for (const r of errs) L.push(`${NS.clock(r[0])} ${r[2]}`); }
    if (S.m1.runs.length) { L.push('## ผลภารกิจ 1'); for (const r of S.m1.runs.slice(-5)) L.push(`t_lock=${NS.fmt(r.tLock, 2)}s iters=${r.iters} err=${NS.fmt(r.mean, 3)}±${NS.fmt(r.sd, 3)} ${r.pass ? 'ผ่าน' : 'ไม่ผ่าน'}`); }
    const sent = S.log.filter((r) => r[1] === 'tx').slice(-20);
    if (sent.length) { L.push('## คำสั่งที่ส่งล่าสุด (20)'); for (const r of sent) L.push(`${NS.clock(r[0])} ${r[2]}`); }
    L.push('## คำถามถึง AI');
    L.push('(พิมพ์ปัญหาหรือสิ่งที่อยากให้ช่วยต่อตรงนี้)');
    return L.join('\n');
  }

  // ------------------------------------------------------------------ replay
  async function replay(text, speed) {
    const rows = text.split(/\r?\n/).map((l) => { const m = l.match(/^(\S+)\s+(RX|TX|SYS)\s(.*)$/); return m ? { t: Date.parse(m[1]), dir: m[2], line: m[3] } : null; }).filter(Boolean);
    const rx = rows.filter((r) => r.dir === 'RX');
    if (!rx.length) { NS.toast('ไฟล์นี้ไม่มีข้อมูลที่เล่นได้', 'warn'); return; }
    const token = {};
    S.replay = token;
    sys(`replay ${rx.length} lines ×${speed}`);
    const t0 = rx[0].t;
    const w0 = performance.now();
    for (let i = 0; i < rx.length; i++) {
      if (S.replay !== token) break;
      const due = (rx[i].t - t0) / speed;
      const wait = due - (performance.now() - w0);
      if (wait > 4) await NS.sleep(wait);
      onLine(rx[i].line);
      if (i % 50 === 0) $('#rpStatus').textContent = `${i}/${rx.length}`;
    }
    $('#rpStatus').textContent = S.replay === token ? 'เล่นจบแล้ว' : 'หยุดแล้ว';
    S.replay = null;
  }

  // ---- mission 2 target box: what the number means depends on the reference, and the GO button shows what it will send
  const m2memo = { sun: -65, act: null };
  function syncM2Cmd() { $('#m2GoCmd').textContent = ($('#m2Ref').value === 'sun' ? 'M2 GO SUN ' : 'M2 GO ') + (+$('#m2Tgt').value || 0); }
  function setM2Ref(ref) {
    m2memo[$('#m2Ref').value] = +$('#m2Tgt').value;
    $('#m2Ref').value = ref;
    for (const b of $$('#m2RefSeg button')) b.classList.toggle('on', b.dataset.ref === ref);
    $('#m2TgtLbl').textContent = ref === 'sun' ? 'offset จากดวงอาทิตย์ (°)' : 'มุมฐานหมุน (°)';
    $('#m2Tgt').value = ref === 'act' ? cfg('m2.tgt', m2memo.act ?? -40) : m2memo.sun; // actuator reference starts from the saved m2.tgt
    syncM2Cmd();
  }

  // ------------------------------------------------------------------ wiring
  function wire() {
    $('#verLabel').textContent = 'tool v' + NS.VERSION;
    $('#serialSupport').textContent = NS.SerialTransport.supported() ? '' : 'เบราว์เซอร์นี้ไม่มี Web Serial ใช้ได้แค่ตัวจำลอง (ใช้ Chrome หรือ Edge บนคอมจึงจะต่อบอร์ดจริงได้)';
    $('#selBaud').value = NS.store.get('baud', '115200');
    $('#selDtr').value = NS.store.get('dtr', 'none');
    const kind = NS.store.get('kind', 'serial');
    const r = $(`input[name=trKind][value=${kind}]`);
    if (r) r.checked = true;
    const syncKind = () => { const sim = $('input[name=trKind]:checked').value === 'sim'; for (const e of $$('.serial-only')) e.hidden = sim; syncProtoForKind(sim); };
    $$('input[name=trKind]').forEach((e) => e.addEventListener('change', syncKind));
    // protocol: NasaSat (ours) or SunSeek (the organizer's); remembered, applies at once
    $$('input[name=proto]').forEach((e) => e.addEventListener('change', () => {
      if (e.value === 'sunseek' && S.connected && S.tr && S.tr.kind === 'sim') { NS.toast('ตัวจำลองพูดได้เฉพาะโปรโตคอล NasaSat', 'warn'); setProto('nasasat', false); return; }
      setProto(e.value);
    }));
    $$('[data-ss]').forEach((b) => b.addEventListener('click', () => { ssSend(b.dataset.ss); }));
    syncKind();

    // tabs
    $$('#tabs button[data-tab]').forEach((b) => b.addEventListener('click', () => {
      $$('#tabs button[data-tab]').forEach((x) => x.classList.toggle('active', x === b));
      $$('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + b.dataset.tab));
      NS.store.set('tab', b.dataset.tab);
      Object.values(charts).forEach((c) => { c.dirty = true; });
      if (b.dataset.tab === 'cal') renderPushPreview();
      $('main').scrollTop = 0;
      updateNav(); renderDials(S.last);
    }));
    const lastTab = NS.store.get('tab', 'connect');
    const tb = $(`#tabs button[data-tab="${lastTab}"]`);
    if (tb) tb.click();

    $('#btnConnect').addEventListener('click', connect);
    $('#btnDisconnect').addEventListener('click', disconnect);
    $('#btnResetUart').addEventListener('click', async () => { if (S.tr && S.tr.resetPulse) { await S.tr.resetPulse(); sys('reset pulse'); } });
    armConfirm($('#btnReboot'), () => sendQuiet('REBOOT').catch(() => {}));
    $$('[data-cmd]').forEach((b) => b.addEventListener('click', () => sendQuiet(b.dataset.cmd).catch(() => {})));
    if (NS.SerialTransport.supported()) {
      navigator.serial.addEventListener('disconnect', (e) => { if (S.tr && S.tr.port === e.target) { S.tr.keep = false; onStatus('lost', 'usb unplugged'); } });
      navigator.serial.addEventListener('connect', () => { if (re.on) tryReconnect(); }); // the board is back: try now
    }
    $('#autoRe').checked = NS.store.get('autoRe', true);
    $('#autoRe').addEventListener('change', () => { NS.store.set('autoRe', $('#autoRe').checked); if (!$('#autoRe').checked) stopReconnect(); });

    // STOP everywhere: Esc always, Space unless the cursor is in a box where you type text.
    // A focused button must not swallow Space: the browser would press that button again (e.g. M1 START).
    const stop = () => {
      if (S.scan) S.scan.stop = true;
      rejectImageWaits('หยุดแล้ว (STOP)');
      if (S.tr && S.connected) {
        if (S.proto === 'sunseek') { // the organizer's safe stop (MANUAL + wheel stop): straight out, never behind a command that waits for its reply
          S.ss.client.sendNow('STOP').then((r) => { if (!r.ok) NS.toast('ส่ง STOP ไม่สำเร็จ: ' + r.error, 'bad', 6000); });
          NS.toast('ส่ง STOP แล้ว', 'warn', 1500);
        } else { const id = S.nextId++; S.tr.write(`@${id} STOP`); addLog('tx', `@${id} STOP`); NS.toast('ส่ง STOP แล้ว', 'warn', 1500); }
      }
    };
    $('#btnStop').addEventListener('click', stop);
    const typing = (t) => {
      if (!t || !t.tagName) return false;
      if (t.isContentEditable || t.tagName === 'TEXTAREA') return true;
      return t.tagName === 'INPUT' && ['text', 'search', 'email', 'password', 'tel', 'url'].includes((t.type || 'text').toLowerCase());
    };
    const isSpace = (e) => e.key === ' ' || e.code === 'Space';
    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape') { if (!e.repeat) stop(); return; }
      if (!isSpace(e) || typing(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) stop();
    }, true);
    window.addEventListener('keyup', (e) => { if (isSpace(e) && !typing(e.target)) { e.preventDefault(); e.stopPropagation(); } }, true);

    // status bar: theme, "ยังไม่ SAVE", problem tray, copy for AI
    const applyTheme = (t) => { document.documentElement.dataset.theme = t; $('#themeBtn').textContent = 'ธีม: ' + (t === 'dark' ? 'มืด' : 'สว่าง'); Object.values(charts).forEach((c) => { c.dirty = true; }); };
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
    $('#themeBtn').addEventListener('click', () => { const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; NS.store.set('theme', t); applyTheme(t); });
    if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => { if (!NS.store.get('theme', null)) applyTheme(e.matches ? 'dark' : 'light'); });
    $('#unsavedChip').addEventListener('click', async () => { try { await send('SAVE'); await refreshCfg(); NS.toast('บันทึกถาวรในบอร์ดแล้ว', 'good'); } catch (e) { NS.toast(e.message, 'bad'); } });
    $('#probChip').addEventListener('click', () => { $('#probTray').hidden = !$('#probTray').hidden; renderProblems(); });
    $('#probClose').addEventListener('click', () => { $('#probTray').hidden = true; });
    $('#probAckAll').addEventListener('click', () => { for (const p of problems) p.ack = true; renderProblems(); });

    // simulator panel
    const simBind =(id, key, isNum = true) => {
      const inp = $('#' + id);
      const out = $('#' + id + 'V');
      inp.addEventListener('input', () => {
        const v = inp.type === 'checkbox' ? inp.checked : +inp.value;
        if (out) out.textContent = v;
        if (S.tr && S.tr.kind === 'sim') { if (key === 'backlash') S.tr.truth.backlash = v; else S.tr.world[key] = v; }
      });
      return () => { if (!(S.tr && S.tr.kind === 'sim')) return; const v = key === 'backlash' ? S.tr.truth.backlash : S.tr.world[key]; if (inp.type === 'checkbox') inp.checked = v; else inp.value = v; if (out) out.textContent = isNum ? v : ''; };
    };
    const simSync = [simBind('simLamp', 'lampOn', false), simBind('simLampAz', 'lampAz'), simBind('simLampK', 'lampK'), simBind('simAmb', 'ambient'), simBind('simFlicker', 'flicker'), simBind('simNoise', 'noiseMv'), simBind('simBacklash', 'backlash'), simBind('simTargetAz', 'targetAz')];
    const syncSimUI = () => simSync.forEach((f) => f());
    $('#btnSimRandom').addEventListener('click', () => { if (S.tr && S.tr.kind === 'sim') { S.tr.randomize(); syncSimUI(); NS.toast('สุ่มตำแหน่งหลอด ความสว่าง แสงห้อง และเป้าหมายใหม่แล้ว'); } });
    $('#btnSimBump').addEventListener('click', () => { if (S.tr && S.tr.kind === 'sim') S.tr.world.bump += 15; });
    $('#btnSimButton').addEventListener('click', () => { if (S.tr && S.tr.kind === 'sim' && !S.tr.pressButton()) NS.toast('ปุ่มถูกปิดอยู่ (hw.btn = -1)', 'warn'); });
    setInterval(() => { if (S.tr && S.tr.kind === 'sim' && !$('#simCard').hidden) NS.kv($('#simTruth'), S.tr.truthInfo()); }, 300);
    $('#btnConnect').addEventListener('click', () => setTimeout(syncSimUI, 200));

    // live
    $('#selWin').addEventListener('change', () => { for (const k of ['mv', 'd', 'deg', 'm1']) { charts[k].win = +$('#selWin').value; charts[k].dirty = true; } });
    $('#btnPause').addEventListener('click', () => { S.paused = !S.paused; for (const k of ['mv', 'd', 'deg', 'm1']) charts[k].paused = S.paused; $('#btnPause').textContent = S.paused ? 'เล่นกราฟต่อ' : 'หยุดกราฟชั่วคราว'; });
    $('#btnClearCharts').addEventListener('click', () => { for (const k of ['mv', 'd', 'deg', 'm1']) charts[k].clear(); });
    $$('[data-move]').forEach((b) => b.addEventListener('click', () => sendQuiet('MOVE ' + b.dataset.move).catch(() => {})));
    $('#btnGoto').addEventListener('click', () => sendQuiet('GOTO ' + (+$('#inGoto').value || 0)).catch(() => {}));

    // hardware
    $('#btnHwid').addEventListener('click', () => sendQuiet('HWID').catch(() => {}));
    $('#btnDiag').addEventListener('click', () => sendQuiet('DIAG').catch(() => {}));
    $('#btnPinStart').addEventListener('click', () => sendQuiet('PINFIND ON').catch(() => {}));
    $('#btnPinStop').addEventListener('click', () => sendQuiet('PINFIND OFF').catch(() => {}));
    $('#btnPinBase').addEventListener('click', () => { S.pinBase = S.pins ? { ...S.pins } : null; renderPins(); });
    $('#btnSetPin0').addEventListener('click', () => setCfg('sen.pin0', $('#selPinPick').value));
    $('#btnSetPin1').addEventListener('click', () => setCfg('sen.pin1', $('#selPinPick').value));

    // calibration steps
    $$('#calSteps button').forEach((b) => b.addEventListener('click', () => {
      $$('#calSteps button').forEach((x) => x.classList.toggle('active', x === b));
      $$('.calstep').forEach((s) => s.classList.toggle('active', s.dataset.step === b.dataset.step));
      Object.values(charts).forEach((c) => { c.dirty = true; });
      if (b.dataset.step === '7') renderPushPreview();
    }));
    $$('.calstep .next').forEach((b) => b.addEventListener('click', () => { // a step hidden in this mode (Balance in SunSeek) is skipped
      let n = +b.dataset.next;
      while ($(`#calSteps button[data-step="${n}"]`) && $(`#calSteps button[data-step="${n}"]`).hidden) n++;
      $(`#calSteps button[data-step="${n}"]`).click(); $('main').scrollTop = 0;
    }));
    $('#calSendSetup').addEventListener('click', async () => {
      try {
        if (isSs()) {
          await ssSendAll([`TEAM_SET,sun.gamma,${+$('#calLdr').value}`, `TEAM_SET,sun.alpha,${Math.abs(+$('#calAlpha').value) || 30}`, `TEAM_SET,sun.topo,${+$('#calTopo').value}`, `TEAM_SET,sun.vcc,${+$('#calVcc').value}`]);
          markStep(1);
          NS.toast('ส่งค่าตั้งแล้ว (ยังใช้สูตรกรรมการจนกว่าจะส่งผลคาลิเบรตในขั้นที่ 7)', 'good');
          return;
        }
        await send(`SET est.gamma ${+$('#calLdr').value}`);
        await send(`SET est.alpha ${+$('#calAlpha').value}`);
        await send(`SET sen.topo ${+$('#calTopo').value}`);
        await send(`SET sen.vcc ${+$('#calVcc').value}`);
        markStep(1);
        NS.toast('ส่งค่าตั้งแล้ว', 'good');
      } catch (e) { NS.toast(e.message, 'bad'); }
    });
    $('#calAmb').addEventListener('click', async () => {
      try {
        if (isSs()) { // lamp off: the room light as conductance (what AMB computes on our firmware)
          const a = await ssCapture(12);
          if (a.sat) throw new Error('ADC ตัน: ห้องสว่างเกินหรือยังไม่ได้ปิดหลอด');
          const g = +$('#calLdr').value;
          const GL = NS.est.toG(a.mvL, calVcc(), calTopo()); const GR = NS.est.toG(a.mvR, calVcc(), calTopo());
          S.cal.amb = { GL, GR, gamma: g, aL: +Math.pow(GL, 1 / g).toPrecision(6), aR: +Math.pow(GR, 1 / g).toPrecision(6) };
          NS.kv($('#calAmbOut'), { 'mV ซ้าย / ขวา': `${a.mvL.toFixed(1)} / ${a.mvR.toFixed(1)} (สั่น ±${a.sdL.toFixed(1)} / ±${a.sdR.toFixed(1)})`, 'aL / aR': `${S.cal.amb.aL} / ${S.cal.amb.aR}` });
          markStep(2);
          return;
        }
        const w = waitJson('amb', 8000);
        await send('AMB 600');
        const j = await w;
        S.cal.amb = { aL: j.aL, aR: j.aR, gamma: cfg('est.gamma', 0.6), GL: NS.est.toG(j.mv[0], calVcc(), calTopo()), GR: NS.est.toG(j.mv[1], calVcc(), calTopo()) };
        NS.kv($('#calAmbOut'), { 'mV ซ้าย / ขวา': `${j.mv[0]} / ${j.mv[1]}`, 'aL / aR': `${j.aL} / ${j.aR}` });
        markStep(2);
      } catch (e) { NS.toast(e.message, 'bad'); }
    });
    $('#calBal').addEventListener('click', async () => {
      try {
        const w = waitJson('bal', 8000);
        await send('BAL 600');
        const j = await w;
        S.cal.bal = j;
        const box = $('#calBalOut');
        NS.kv(box, { 'g (gain ขวา/ซ้าย)': j.g, 'S ตอนหันตรง': j.S, 'est.minS ที่แนะนำ': j.suggest_minS });
        box.append(el('div', {}), el('div', {}, el('button', { class: 'small', text: 'ใช้ est.minS นี้', onclick: () => setCfg('est.minS', j.suggest_minS) })));
        markStep(3);
      } catch (e) { NS.toast(e.message, 'bad'); }
    });
    $$('input[name=swMode]').forEach((e) => e.addEventListener('change', swSync));
    swSync();
    for (const id of ['#swFrom', '#swTo', '#swStep']) $(id).addEventListener('change', showNextManual);
    const swCmd = () => { $('#swCmd').textContent = `SWEEP ${+$('#swFrom').value} ${+$('#swTo').value} ${+$('#swStep').value} ${+$('#swDwell').value} cal`; };
    for (const id of ['#swFrom', '#swTo', '#swStep', '#swDwell']) $(id).addEventListener('input', swCmd);
    swCmd();
    $('#swStart').addEventListener('click', async () => {
      const a = +$('#swFrom').value; const b = +$('#swTo').value; const st = +$('#swStep').value; const dw = +$('#swDwell').value;
      try {
        if (S.last && S.last.m1 && S.last.m1 !== 0) await send('M1 STOP');
        await send(`SWEEP ${a} ${b} ${st} ${dw} cal`);
        $('#swStatus').textContent = S.cal.pts.length ? `เริ่ม sweep… (มีข้อมูลเก่า ${S.cal.pts.length} จุดอยู่แล้ว: ล้างก่อนถ้าเริ่มชุดใหม่)` : 'เริ่ม sweep…';
      } catch (e) { NS.toast(e.message, 'bad'); }
    });
    $('#swRecord').addEventListener('click', async () => {
      try {
        S.cal.pts.push(await readPoint(+$('#swAngle').value));
        S.cal.manualIdx++;
        renderSweep();
        showNextManual();
      } catch (e) { NS.toast(e.message, 'bad'); }
    });
    $('#swUndo').addEventListener('click', () => { S.cal.pts.pop(); S.cal.manualIdx = Math.max(0, S.cal.manualIdx - 1); renderSweep(); showNextManual(); });
    armConfirm($('#swClear'), () => { S.cal.pts = []; S.cal.manualIdx = 0; S.cal.angSign = 1; renderSweep(); showNextManual(); });
    $('#swExport').addEventListener('click', () => NS.download(`sweep_${NS.fileStamp()}.csv`, NS.fit.toCSV(S.cal.pts), 'text/csv'));
    $('#swImport').addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      S.cal.pts = NS.fit.fromCSV(await NS.readFileText(f), calVcc(), calTopo());
      renderSweep(); e.target.value = '';
      NS.toast(`โหลด ${S.cal.pts.length} จุด`, 'good');
    });
    $('#grLvl1').addEventListener('click', () => measureLevel(1));
    $('#grLvl2').addEventListener('click', () => measureLevel(2));
    $('#fitRun').addEventListener('click', () => setTimeout(runFit, 10));
    $('#valAuto').addEventListener('click', async () => {
      const a = +$('#swFrom').value; const b = +$('#swTo').value; const st = +$('#swStep').value; const dw = +$('#swDwell').value;
      // the other direction than step 4: an LDR that lags or gear play left over shows up as a bias here (audit F16)
      try { S.cal.val = []; await send(`SWEEP ${b - st / 2} ${a + st / 2} ${st} ${dw} val`); } catch (e) { NS.toast(e.message, 'bad'); }
    });
    $('#valRecord').addEventListener('click', async () => {
      try {
        S.cal.val.push(await readPoint(+$('#valAngle').value));
        renderVal();
      } catch (e) { NS.toast(e.message, 'bad'); }
    });
    $('#valClear').addEventListener('click', () => { S.cal.val = []; renderVal(); });
    $('#pushSend').addEventListener('click', async () => {
      try {
        const lines = pushLines();
        if (!lines.length) { NS.toast('ยังไม่มีผล Fit', 'warn'); return; }
        if (isSs()) {
          await ssSendAll(lines, (i, n) => { $('#pushOut').textContent = `กำลังส่ง ${i}/${n}…`; });
          await S.ss.client.send('TEAM_INFO');
          $('#pushOut').textContent = `ส่ง ${lines.length} คำสั่งสำเร็จ: บอร์ดใช้โมเดลทีม (sun.model 1) และบันทึกถาวรแล้ว (${NS.clock()}) · ต่อไปทำขั้นที่ 8`;
          markStep(7);
          addEvidence('calibration_push', 'ส่งผลคาลิเบรตเข้าเฟิร์มแวร์ทีม SunSeek และ TEAM_SAVE', { lines });
          return;
        }
        for (const l of lines) await send(l, { timeout: 6000 });
        $('#pushOut').textContent = `ส่ง ${lines.length} คำสั่งสำเร็จ และบันทึกถาวรแล้ว (${NS.clock()})`;
        markStep(7);
        addEvidence('calibration_push', 'ส่งผลคาลิเบรตเข้าบอร์ดและ SAVE', { lines });
        refreshCfg();
      } catch (e) { $('#pushOut').textContent = 'ส่งไม่สำเร็จ: ' + e.message; NS.toast(e.message, 'bad'); }
    });
    $('#pushExport').addEventListener('click', () => NS.download(`calibration_${NS.fileStamp()}.json`, JSON.stringify({ tool: NS.VERSION, fit: S.cal.fit, pts: S.cal.pts, val: S.cal.val, amb: S.cal.amb, gr: S.cal.gr || null }, null, 1), 'application/json'));
    $('#pushImport').addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const j = JSON.parse(await NS.readFileText(f));
        S.cal.fit = j.fit || null; S.cal.pts = j.pts || []; S.cal.val = j.val || []; S.cal.amb = j.amb || null; S.cal.gr = j.gr || null;
        renderSweep(); renderPushPreview();
        NS.toast('โหลดผลคาลิเบรตแล้ว กด Fit ใหม่ได้ถ้าต้องการกราฟ', 'good');
      } catch (err) { NS.toast('ไฟล์ไม่ถูกต้อง: ' + err.message, 'bad'); }
      e.target.value = '';
    });

    $('#th0Run').addEventListener('click', async () => {
      try {
        if (isSs()) { // the team angle read now (TH, with the current th0 and LUT) becomes the reference angle
          const ref = +$('#th0Ref').value || 0;
          const cur = await ssReadParam('sun.th0');
          const a = await ssCapture(12);
          if (!Number.isFinite(a.th)) throw new Error('อ่านมุมไม่ได้ (TH)');
          if (a.sat) throw new Error('ADC ตัน: ลดแสงหรือถอยหลอดก่อน');
          const nv = NS.ss.th0For(cur, a.th, ref);
          await ssSendAll([`TEAM_SET,sun.th0,${nv}`]);
          NS.kv($('#th0Out'), { 'มุมที่อ่านได้ก่อนตั้ง': `${a.th.toFixed(3)}°`, 'th0 เดิม → ใหม่': `${cur} → ${nv}`, 'ต่อไป': 'กด "บันทึกถาวร" (TEAM_SAVE)' });
          S.th0ok = true;
          markStep(8);
          return;
        }
        if (S.last && S.last.m1 && S.last.m1 !== 0) await send('M1 STOP');
        const w = waitJson('th0', 10000);
        await send(`CAL TH0 ${+$('#th0Ref').value || 0}`);
        await w;
        markStep(8);
      } catch (e) { NS.toast(e.message, 'bad'); }
    });
    $('#th0Save').addEventListener('click', async () => { try { if (isSs()) { await ssSendAll(['TEAM_SAVE']); NS.toast('บันทึกถาวรแล้ว (TEAM_SAVE)', 'good'); return; } await send('SAVE'); await refreshCfg(); NS.toast('บันทึกถาวรแล้ว', 'good'); } catch (e) { NS.toast(e.message, 'bad'); } });

    // tune
    $('#cfgReload').addEventListener('click', refreshCfg);
    $('#cfgSave').addEventListener('click', async () => { try { await send('SAVE'); await refreshCfg(); NS.toast('บันทึกถาวรในบอร์ดแล้ว', 'good'); } catch (e) { NS.toast(e.message, 'bad'); } });
    $('#cfgLoad').addEventListener('click', async () => { try { await send('LOAD'); await refreshCfg(); } catch (e) { NS.toast(e.message, 'bad'); } });
    $('#cfgDefConfirm').addEventListener('input', () => { $('#cfgDefaults').disabled = $('#cfgDefConfirm').value.trim() !== 'DEFAULTS'; }); // typing the word enables the button (no browser confirm)
    $('#cfgDefaults').addEventListener('click', async () => {
      try { await send('DEFAULTS'); await refreshCfg(); NS.toast('คืนค่าเริ่มต้นแล้ว (ยังไม่ถาวรจนกว่าจะ SAVE)', 'good'); } catch (e) { NS.toast(e.message, 'bad'); }
      $('#cfgDefConfirm').value = ''; $('#cfgDefaults').disabled = true;
    });
    $('#cfgSearch').addEventListener('input', filterCfg);
    $('#cfgExport').addEventListener('click', () => NS.download(`profile_${NS.fileStamp()}.json`, JSON.stringify({ tool: NS.VERSION, cfg: Object.fromEntries(S.cfgVals), lut: S.lut }, null, 1), 'application/json'));
    $('#cfgImport').addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const j = JSON.parse(await NS.readFileText(f));
        let n = 0;
        for (const [k, v] of Object.entries(j.cfg || {})) if (S.cfgDefs.has(k) && S.cfgVals.get(k) !== v) { await send(`SET ${k} ${v}`); n++; }
        if (j.lut && j.lut.v) await send(`CAL LUT ${j.lut.x0} ${j.lut.dx} ${j.lut.v.join(',')}`);
        NS.toast(`ตั้งค่า ${n} ตัวจากโปรไฟล์แล้ว (ยังไม่ SAVE)`, 'good');
      } catch (err) { NS.toast('นำเข้าไม่สำเร็จ: ' + err.message, 'bad'); }
      e.target.value = '';
    });
    $('#stepRun').addEventListener('click', async () => {
      try {
        const w = waitJson('step_result', 60000);
        await send('STEP ' + (+$('#stepDeg').value || 10));
        $('#stepOut').textContent = 'กำลังทดสอบ…';
        const j = await w;
        NS.kv($('#stepOut'), { 'ดันเบี้ยว': `${j.deg}°`, 'เวลากลับเข้าเป้า': `${(j.t_lock_ms / 1000).toFixed(2)} s`, 'จำนวนรอบปรับ': j.iters, 'error สูงสุดระหว่างทาง': `${j.peak_err}°`, 'error สุดท้าย': `${j.final_err}°` });
        addEvidence('step', `STEP ${j.deg}°: กลับเข้าเป้าใน ${(j.t_lock_ms / 1000).toFixed(2)} s (${j.iters} รอบ) error สุดท้าย ${j.final_err}°`, j);
      } catch (e) { NS.toast(e.message, 'bad'); $('#stepOut').textContent = ''; }
    });

    // mission 1
    $('#m1Tgt').addEventListener('change', () => setCfg('m1.tgt', +$('#m1Tgt').value));
    $('#m1Tol').addEventListener('change', () => { setCfg('m1.tol', +$('#m1Tol').value); charts.m1.dirty = true; });
    for (const id of ['#m1Tgt', '#m1Tol']) $(id).addEventListener('input', () => { renderDials(S.last); charts.m1.dirty = true; });
    $('#m1Start').addEventListener('click', async () => {
      try { await send(`M1 START ${+$('#m1Tgt').value}`); } catch (e) { NS.toast(e.message, 'bad'); } // the "E M1 FINE start" event opens the run
    });
    $('#m1Stop').addEventListener('click', () => sendQuiet('M1 STOP').catch(() => {}));

    // mission 2
    $('#m2Lock').addEventListener('click', () => sendQuiet('M2 LOCK').catch(() => {}));
    $('#m2Unlock').addEventListener('click', () => sendQuiet('M2 UNLOCK').catch(() => {}));
    $('#m2Init').addEventListener('click', () => sendQuiet('M2 INIT').catch(() => {}));
    $('#m2Manual').addEventListener('click', () => sendQuiet('M2 MANUAL').catch(() => {}));
    // reference selector: two buttons drive the (hidden) #m2Ref select; the target box changes meaning with it
    $$('#m2RefSeg button').forEach((b) => b.addEventListener('click', () => setM2Ref(b.dataset.ref)));
    $('#m2Tgt').addEventListener('input', syncM2Cmd);
    syncM2Cmd();
    $('#m2Snap').addEventListener('click', () => sendQuiet('M2 SNAP').catch(() => {}));
    $('#m2Go').addEventListener('click', () => {
      const tgt = +$('#m2Tgt').value;
      sendQuiet($('#m2Ref').value === 'sun' ? `M2 GO SUN ${tgt}` : `M2 GO ${tgt}`).catch(() => {});
    });
    $('#m2Tgt').addEventListener('change', () => { if ($('#m2Ref').value === 'act') setCfg('m2.tgt', +$('#m2Tgt').value); });
    $('#m2Save').addEventListener('click', () => {
      const r = S.curImg; if (!r) return;
      const base = `img${r.id}_${NS.fileStamp()}`;
      NS.download(base + '.jpg', r.blob);
      NS.download(base + '.json', JSON.stringify({ ...r.meta, crc_ok: r.ok, saved: new Date().toISOString() }, null, 1), 'application/json');
    });
    $('#m2Bore').addEventListener('click', boresight);
    $('#m2BoreAuto').addEventListener('click', boresightAuto);
    $('#m2Dir').addEventListener('click', checkDirection);
    $('#m2Scan').addEventListener('click', scanAround);
    $('#m2PickDir').addEventListener('click', pickSaveDir);
    $('#m2Img').addEventListener('click', (e) => {
      const img = e.currentTarget;
      if (!img.naturalWidth) return;
      aimAt((e.offsetX / img.clientWidth) * img.naturalWidth, (e.offsetY / img.clientHeight) * img.naturalHeight);
    });
    // picture flips belong to how the camera is mounted: set and keep them in the board at once
    const flip = async (k) => {
      try { await send(`SET ${k} ${cfg(k, 0) ? 0 : 1}`); await send(`SAVE ${k}`); NS.toast(`${k} = ${cfg(k, 0)} (มีผลกับภาพถัดไป)`, 'good'); } catch (e) { NS.toast(e.message, 'bad'); }
    };
    $('#m2FlipH').addEventListener('click', () => flip('cam.hmirror'));
    $('#m2FlipV').addEventListener('click', () => flip('cam.vflip'));
    $('#scanReset').addEventListener('click', scanDefaults);
    scanDefaults();

    // evidence + AI
    const refreshAi = () => { $('#aiText').value = buildAiPack(); };
    const copyAi = async () => { refreshAi(); const ok = await NS.copyText($('#aiText').value); NS.toast(ok ? 'คัดลอกแล้ว วางในแชท AI ได้เลย' : 'คัดลอกไม่ได้ ให้เลือกข้อความเอง', ok ? 'good' : 'warn'); };
    $('#aiCopy').addEventListener('click', copyAi);
    $('#aiTop').addEventListener('click', copyAi);
    $('#aiRefresh').addEventListener('click', async () => { if (S.proto === 'sunseek') { if (S.connected) await ssSend('STATUS'); refreshAi(); return; } try { const w = waitJson('diag', 5000); await send('DIAG'); await w; } catch (_) { /* ignore */ } refreshAi(); });
    $('#dlLog').addEventListener('click', () => NS.download(`session_${NS.fileStamp()}.txt`, S.log.map(([t, d, x]) => `${new Date(t).toISOString()} ${d.toUpperCase()} ${x}`).join('\n')));
    $('#dlTel').addEventListener('click', () => {
      if (!S.telCols) { NS.toast('ยังไม่มี telemetry', 'warn'); return; }
      NS.download(`telemetry_${NS.fileStamp()}.csv`, ['wall_ms,' + S.telCols.join(','), ...S.tel.map((r) => r.join(','))].join('\n'), 'text/csv');
    });
    $('#dlEv').addEventListener('click', () => NS.download(`evidence_${NS.fileStamp()}.json`, JSON.stringify({ tool: NS.VERSION, hello: S.hello, hwid: S.hwid, cfg: Object.fromEntries(S.cfgVals), calibration: S.cal.fit, m1: S.m1.runs, images: S.images.map((i) => ({ ...i.meta, crc_ok: i.ok })), evidence: S.evidence }, null, 1), 'application/json'));
    let rpText = null;
    $('#rpFile').addEventListener('change', async (e) => { const f = e.target.files[0]; if (f) { rpText = await NS.readFileText(f); $('#rpStatus').textContent = f.name; } });
    $('#rpPlay').addEventListener('click', () => { if (!rpText) { NS.toast('เลือกไฟล์ก่อน', 'warn'); return; } S.cols = null; replay(rpText, +$('#rpSpeed').value); });
    $('#rpStop').addEventListener('click', () => { S.replay = null; });

    // console
    const hist = NS.store.get('hist', []);
    let hi = hist.length;
    const conSend = () => {
      const v = $('#conInput').value.trim();
      if (!v) return;
      hist.push(v); if (hist.length > 100) hist.shift(); NS.store.set('hist', hist); hi = hist.length;
      $('#conInput').value = '';
      if (!S.tr || !S.connected) { NS.toast('ยังไม่ได้เชื่อมต่อ', 'warn'); return; }
      if (S.proto === 'sunseek') { ssSend(v); return; } // raw command, no "@id"
      if (v.startsWith('@')) { S.tr.write(v); addLog('tx', v); } else send(v, { timeout: 15000 }).catch((e) => NS.toast(e.message, 'bad'));
    };
    $('#conSend').addEventListener('click', conSend);
    $('#conInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') conSend();
      else if (e.key === 'ArrowUp') { hi = Math.max(0, hi - 1); $('#conInput').value = hist[hi] || ''; e.preventDefault(); }
      else if (e.key === 'ArrowDown') { hi = Math.min(hist.length, hi + 1); $('#conInput').value = hist[hi] || ''; e.preventDefault(); }
    });
    $('#conClear').addEventListener('click', () => { conOut.replaceChildren(); S.conErr = 0; $('#conErrN').classList.remove('bad'); $('#conErrN').textContent = 'error 0'; $('#conLast').textContent = ''; });
    // collapsed (default): one bar with the last line, the error count and the command box; expanded: ~40 % of the height
    const conOpen = (open) => { $('#dock').classList.toggle('min', !open); $('#conToggle').textContent = open ? 'Console ▾' : 'Console ▴'; $('#conToggle').setAttribute('aria-expanded', String(open)); if (open) conOut.scrollTop = conOut.scrollHeight; };
    $('#conToggle').addEventListener('click', () => conOpen($('#dock').classList.contains('min')));
    $('#conErrOnly').addEventListener('change', (e) => conOut.classList.toggle('errs', e.target.checked));
    $('#conErrN').addEventListener('click', () => { $('#conErrOnly').checked = true; conOut.classList.add('errs'); conOpen(true); });
  }

  // ------------------------------------------------------------------ boot
  makeCharts();
  for (const id of ['#dialM1', '#dialLive']) dials.push([$(id), makeDial($(id))]);
  wire();
  renderDials(null);
  setInterval(() => { // once a second: stuck image assemblies, telemetry rate, nav glyphs
    S.imgAsm.poll(); // ends images whose last line never arrived
    S.telHz = S.telCount - (S.telPrev || 0); S.telPrev = S.telCount;
    S.ss.tmHz = S.ss.tmCount - S.ss.tmPrev; S.ss.tmPrev = S.ss.tmCount;
    updateNav();
  }, 1000);
  showNextManual();
  const frame = () => {
    for (const c of Object.values(charts)) if (c.c.offsetParent !== null) c.draw();
    updateHold();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  // URL shortcuts for practice and screenshots, e.g. NasaSatLab.html#sim&tab=m1&theme=dark&cmd=M1 START
  // (sim: connect to the simulator; cmd: commands sent after the handshake, separated by ";")
  (async () => {
    const hp = new URLSearchParams(location.hash.slice(1));
    if (hp.has('theme') && document.documentElement.dataset.theme !== hp.get('theme')) $('#themeBtn').click();
    if (hp.has('proto') && !hp.has('sim')) setProto(hp.get('proto'), false); // &proto=sunseek (for practice and screenshots; not remembered)
    if (hp.has('tab')) { const b = $(`#tabs button[data-tab="${CSS.escape(hp.get('tab'))}"]`); if (b) b.click(); }
    if (hp.has('step')) { const b = $(`#calSteps button[data-step="${CSS.escape(hp.get('step'))}"]`); if (b) b.click(); }
    if (!hp.has('sim')) return;
    $('input[name=trKind][value=sim]').click();
    await connect();
    await NS.sleep(1500);
    for (const c of (hp.get('cmd') || '').split(';').map((x) => x.trim()).filter(Boolean)) {
      if (/^wait \d+$/i.test(c)) await NS.sleep(+c.slice(5)); else await sendQuiet(c).catch(() => {});
    }
  })();
  window.addEventListener('beforeunload', (e) => { if (S.connected && S.tr && S.tr.kind === 'serial') { e.preventDefault(); e.returnValue = ''; } });
})();
