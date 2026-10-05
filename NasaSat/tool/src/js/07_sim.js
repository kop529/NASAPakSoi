'use strict';
// ===== Simulator: a virtual CubeSat (physics) + a virtual firmware that speaks the same protocol =====
// The firmware part mirrors what NasaSat.ino will do, so the tool can be practised end-to-end without a board.

const wrap180 = (a) => { let x = ((a + 180) % 360 + 360) % 360 - 180; if (x === -180) x = 180; return x; };
const gauss = () => { let u = 0; let v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

// GPIO rules of the firmware (cfg.cpp pinWhy) for the usual build: ESP32-S3, "USB CDC On Boot: Enabled", OPI PSRAM
NS.PIN_KEYS = ['sen.pin0', 'sen.pin1', 'act.in1', 'act.in2', 'act.in3', 'act.in4', 'act.spin', 'hw.sda', 'hw.scl', 'hw.btn', 'hw.vbat', 'com.rx', 'com.tx'];
NS.pinWhy = (k, g) => {
  if (!NS.PIN_KEYS.includes(k) || g < 0) return null;
  if (g > 48 || (g >= 22 && g <= 25)) return 'no such GPIO on the ESP32-S3 (22-25 do not exist)';
  if (g >= 26 && g <= 32) return 'GPIO26-32 = SPI flash/PSRAM of the module';
  if (g >= 33 && g <= 37) return 'GPIO33-37 = octal PSRAM in this build (board without PSRAM: Tools > PSRAM > Disabled)';
  if (g === 19 || g === 20) return 'GPIO19/20 = USB D-/D+, the link to the laptop';
  if (['sen.pin0', 'sen.pin1', 'hw.vbat'].includes(k) && !(g >= 1 && g <= 20)) return 'not an ADC pin (an LDR or a battery divider needs an analog input)';
  return null;
};

NS.Sim = class {
  constructor() {
    this.kind = 'sim';
    this.onLine = () => {};
    this.onStatus = () => {};
    // ---- the "real world" (only the simulator knows these) ----
    this.world = { lampOn: true, lampAz: 25, lampK: 1, ambient: 0.03, flicker: 0.08, noiseMv: 4, targetAz: -40, bump: 0 };
    this.truth = {
      alphaL: 31.0, alphaR: 30.6, qL: 1.35, qR: 1.35, fov: 78, gammaL: 0.62, gammaR: 0.57, r10L: 14000, r10R: 17500,
      rf: 10000, vcc: 3300, tau: 0.025, spr: 4076, backlash: 1.4, maxRate: 1000, camOff: 2.2, hfov: 64,
      // the camera module is mounted upside down: the raw picture is turned 180 deg (mirrored and flipped), so
      // practice shows why cam.hmirror / cam.vflip and the direction check exist. Raw direction = -1.
      camDir: -1, camFlipV: true,
    };
    // things on the walls of the room (fixed, irregular), so photos have detail to compare like a real room
    let sd = 4242;
    const r = () => { sd = (sd * 1103515245 + 12345) & 0x7fffffff; return sd / 0x7fffffff; };
    this.decor = Array.from({ length: 16 }, () => ({ az: -180 + 360 * r(), w: 2 + 9 * r(), top: 0.1 + 0.35 * r(), h: 0.12 + 0.3 * r(), hue: Math.round(360 * r()), lit: 25 + Math.round(45 * r()) }));
    this.reset();
  }

  reset() {
    this.cfg = new Map(NS.CFG_DEFS.map((d) => [d.k, d.d]));
    this.nvs = new Map(this.cfg);
    this.lut = null;
    this.nvsLut = null;
    this.t = 0;
    this.m = { L: 0, T: 0, comp: 0, off: 0, v: 0, acc: 0, lastDir: 0, motor: 0, out: 0, energized: false, idleSince: 0, missed: 0, servo: 0 };
    this.g = { L: null, R: null };
    this.win = { sL: 0, sR: 0, n: 0, t0: 0, sat: false };
    this.ema = { L: null, R: null };
    this.meas = null;
    this.measSeq = 0;
    this.stream = true;
    this.nextTel = 0;
    this.proc = null;
    this.aux = null;
    this.m1 = { state: 0, err: NaN };
    this.cam = { locked: false, exp: 300, gain: 0, id: 0, cache: new Map(), blur: 0 };
    this.pinfind = false;
    this.nextPins = 0;
    this.pinNoise = {};
    this.autoAt = null;  // pending automatic start of mission 1 (m1.auto)
    this.nextHk = 1000;
  }

  // ---------------- transport interface ----------------
  async connect() {
    this.running = true;
    this.lastReal = performance.now();
    this.timer = setInterval(() => this.tick(), 20);
    this.onStatus('open', { sim: true });
    this.boot();
    return { sim: true };
  }
  async disconnect() { clearInterval(this.timer); this.running = false; this.onStatus('closed'); }
  write(line) { setTimeout(() => this.handle(String(line).trim()), 2); return Promise.resolve(); }
  async resetPulse() { this.handle('REBOOT'); }
  emit(s) { this.onLine(s); }
  json(o) { this.emit('J ' + JSON.stringify(o)); }

  boot(reason = 'POWERON') {
    this.emit('# NasaSat firmware (SIMULATOR) boot');
    const s = this.get('m1.auto');
    if (s > 0) { this.autoAt = this.t + s * 1000; this.emit(`E AUTO M1_IN ${s}`); } // same as the firmware (ops.cpp)
    this.emit(`E BOOT ${reason}`);
    this.json(this.helloObj());
    this.emit('TH,' + NS.TEL_COLS.join(','));
  }
  helloObj() { return { type: 'hello', fw: 'NasaSat', ver: 'sim-' + NS.VERSION, board: 'SIMULATOR (ESP32-S3 model)', proto: 1, caps: ['stepper', 'servo', 'm1', 'm2', 'sweep', 'pinfind', 'lut', 'hk', 'auto', 'btn', 'cam'] }; }

  // ---------------- running without the laptop (same rules as the firmware's ops.cpp) ----------------
  m1Start(tgt) {
    if (this.proc) this.abort('proc');
    this.m1.err = NaN;
    this.setM1(2, 'start');
    this.start('M1', this.m1Gen(tgt));
  }
  pressButton() { // the BOOT button (hw.btn): start mission 1, or stop it when it runs
    if (this.get('hw.btn') < 0) return false;
    this.autoAt = null;
    if (this.m1.state) {
      this.emit('E BTN M1_STOP');
      if (this.proc && this.proc.name === 'M1') this.abort('proc');
      this.stopMotor();
      this.setM1(0, 'stopped');
    } else {
      this.emit('E BTN M1_START');
      this.m1Start(this.get('m1.tgt'));
    }
    return true;
  }
  housekeeping() {
    const vp = this.get('hw.vbat');
    this.json({
      type: 'hk', t: Math.round(this.t), temp_c: +(39 + 4 * (1 - Math.exp(-this.t / 600000))).toFixed(1), heap: 246000, heap_min: 231000,
      loop_max_ms: 1.4, vbat_mv: vp >= 0 ? Math.round(7400 - this.t / 60000 * 3) : null, m1: NS.M1_STATES[this.m1.state], btn: this.get('hw.btn'),
    });
  }

  get(k) { return this.cfg.get(k); }
  estParams() { return NS.est.fromCfg((k, d) => (this.cfg.has(k) ? this.cfg.get(k) : d), this.lut); }
  spr() { return this.get('act.spr'); }
  angle() { return this.get('act.type') === 2 ? this.m.servo : (this.m.L * 360) / this.spr(); }
  busy() { return this.get('act.type') === 2 ? Math.abs(this.m.servo - this.servoTruth()) > 0.35 : this.m.L !== this.m.T || this.m.comp > 0 || this.m.v > 0; }

  // ---------------- main loop ----------------
  tick() {
    const now = performance.now();
    let ms = Math.min(1100, now - this.lastReal); // catch up even when the browser throttles timers
    this.lastReal = now;
    while (ms >= 2) { this.step(0.002); ms -= 2; }
    this.lastReal -= ms;
  }

  step(dt) {
    this.t += dt * 1000;
    this.motorStep(dt);
    this.sensorStep(dt);
    this.pollProcs();
    if (this.stream && this.get('com.hz') > 0 && this.t >= this.nextTel) {
      this.nextTel = this.t + 1000 / this.get('com.hz');
      this.telemetry();
    }
    if (this.pinfind && this.t >= this.nextPins) { this.nextPins = this.t + 200; this.emitPins(); }
    if (this.autoAt !== null && this.t >= this.autoAt) {
      this.autoAt = null;
      if (this.proc) this.emit(`E AUTO SKIPPED busy_${this.proc.name}`);
      else { this.emit('E AUTO M1_START'); this.m1Start(this.get('m1.tgt')); }
    }
    if (this.stream && this.get('com.hk') > 0 && this.t >= this.nextHk) { this.nextHk = this.t + 1000 * this.get('com.hk'); this.housekeeping(); }
  }

  // ---------------- actuator ----------------
  goto(ang) {
    const lo = this.get('act.min');
    const hi = this.get('act.max');
    if (ang < lo || ang > hi) { this.emit(`E LIMIT ${ang.toFixed(2)}`); ang = NS.clamp(ang, lo, hi); }
    if (this.get('act.type') === 2) { this.m.servo = ang; this.m.energized = true; return; }
    const T = Math.round((ang * this.spr()) / 360);
    if (T === this.m.T && this.m.L === T) return;
    const dir = Math.sign(T - this.m.L);
    if (dir) { // same as the firmware (stepper.cpp): issue the gear-play steps still missing for this direction
      const B = Math.round((this.get('act.bl') * this.spr()) / 360);
      const need = dir > 0 ? -this.m.off : this.m.off + B;
      this.m.comp = B > 0 && need > 0 ? need : 0;
      this.m.lastDir = dir;
    }
    this.m.T = T;
    this.m.energized = true;
  }
  moveRel(d) { this.goto(this.angle() + d); }
  stopMotor() { this.m.T = this.m.L; this.m.comp = 0; this.m.v = 0; }
  servoTruth() { return this.m.out; }

  motorStep(dt) {
    const m = this.m;
    if (this.get('act.type') === 2) { // servo: moves toward target at 300 deg/s, small deadband, slight scale error
      const want = m.servo * 1.015 + 0.4;
      const d = want - m.out;
      if (Math.abs(d) > 0.25) m.out += Math.sign(d) * Math.min(Math.abs(d), 300 * dt);
      return;
    }
    if (this.get('act.type') === 0) return;
    const spr = this.spr();
    const remaining = Math.abs(m.T - m.L) + m.comp;
    if (remaining > 0) {
      const vmax = (this.get('act.vmax') * spr) / 360;
      const acc = (this.get('act.acc') * spr) / 360;
      const brake = (m.v * m.v) / (2 * acc);
      if (remaining <= brake) m.v = Math.max(60, m.v - acc * dt);
      else m.v = Math.min(vmax, m.v + acc * dt);
      m.acc += m.v * dt;
      const dir = m.comp > 0 ? m.lastDir : Math.sign(m.T - m.L);
      while (m.acc >= 1 && (Math.abs(m.T - m.L) > 0 || m.comp > 0)) {
        m.acc -= 1;
        if (m.comp > 0) { m.comp--; m.off += dir; } else m.L += dir;
        const missed = m.v > this.truth.maxRate && Math.random() < 0.3;
        if (missed) m.missed++; else m.motor += dir * this.get('act.dir');
      }
      m.idleSince = this.t;
    } else if (m.v) { m.v = 0; m.acc = 0; m.idleSince = this.t; }
    if (!this.busy() && !this.get('act.hold') && m.energized && this.t - m.idleSince > 100) m.energized = false;
    // truth: motor shaft -> output shaft through gearbox backlash
    const motorDeg = (m.motor * 360) / this.truth.spr;
    const b = this.truth.backlash / 2;
    if (motorDeg - m.out > b) m.out = motorDeg - b;
    else if (motorDeg - m.out < -b) m.out = motorDeg + b;
  }

  bodyTrue() { return this.m.out + this.world.bump; }
  thetaTrue() { return wrap180(this.world.lampAz - this.bodyTrue()); }

  // ---------------- light + LDR + ADC ----------------
  irradiance(sensorAz, q) {
    const inc = wrap180(this.world.lampAz - sensorAz);
    const c = Math.cos(inc * NS.DEG);
    const vign = NS.clamp((this.truth.fov - Math.abs(inc)) / 12, 0, 1);
    const flick = 1 + this.world.flicker * Math.sin(2 * Math.PI * 100 * (this.t / 1000));
    const lamp = this.world.lampOn ? this.world.lampK * Math.pow(Math.max(c, 0), q) * vign * flick : 0;
    return lamp + this.world.ambient + 0.002;
  }
  adc(E, r10, gamma) {
    const R = r10 * Math.pow(E / 0.1, -gamma);
    return R;
  }
  sensorStep(dt) {
    const body = this.bodyTrue();
    const tr = this.truth;
    const EL = this.irradiance(body + tr.alphaL, tr.qL);
    const ER = this.irradiance(body - tr.alphaR, tr.qR);
    const gL = 1 / this.adc(EL, tr.r10L, tr.gammaL);
    const gR = 1 / this.adc(ER, tr.r10R, tr.gammaR);
    const k = 1 - Math.exp(-dt / tr.tau);
    this.g.L = this.g.L === null ? gL : this.g.L + (gL - this.g.L) * k;
    this.g.R = this.g.R === null ? gR : this.g.R + (gR - this.g.R) * k;
    const volt = (g) => { const R = 1 / g; return (tr.vcc * tr.rf) / (tr.rf + R); };
    const noise = () => gauss() * this.world.noiseMv;
    const mvL = Math.round(NS.clamp(volt(this.g.L) + noise(), 0, 3100));
    const mvR = Math.round(NS.clamp(volt(this.g.R) + noise(), 0, 3100));
    this.lastRawMv = [mvL, mvR];
    const w = this.win;
    w.sL += mvL; w.sR += mvR; w.n++;
    if (NS.est.clipped(mvL, this.get('sen.topo')) || NS.est.clipped(mvR, this.get('sen.topo'))) w.sat = true;
    if (this.t - w.t0 >= this.get('sen.win')) {
      let aL = w.sL / w.n;
      let aR = w.sR / w.n;
      const a = this.get('sen.ema');
      if (a < 1 && this.ema.L !== null) { aL = this.ema.L + a * (aL - this.ema.L); aR = this.ema.R + a * (aR - this.ema.R); }
      this.ema.L = aL; this.ema.R = aR;
      const sat = w.sat;
      w.sL = 0; w.sR = 0; w.n = 0; w.t0 = this.t; w.sat = false;
      this.meas = this.makeMeas(aL, aR, sat);
      this.measSeq++;
      for (const slot of ['proc', 'aux']) { const p = this[slot]; if (p && p.wait && p.wait.meas) p.wait.acc.push(this.meas); }
    }
  }
  makeMeas(mvL, mvR, sat) {
    const p = this.estParams();
    const GL = NS.est.toG(mvL, p.vcc, p.topo);
    const GR = NS.est.toG(mvR, p.vcc, p.topo);
    const e = NS.est.estimate(GL, GR, p);
    if (sat) e.valid = false; // same rule as the firmware: clipped data is never "on target"
    return { t: this.t, mvL, mvR, GL, GR, e, sat: !!sat, ang: this.angle(), moving: this.busy() };
  }
  avgMeas(list) {
    const mvL = NS.mean(list.map((m) => m.mvL));
    const mvR = NS.mean(list.map((m) => m.mvR));
    const out = this.makeMeas(mvL, mvR, list.some((m) => m.sat));
    // same as the firmware: noise of one window from window-to-window differences (slow drift ignored)
    let d2 = 0;
    for (let i = 1; i < list.length; i++) d2 += (list[i].e.theta - list[i - 1].e.theta) ** 2;
    out.thSd = list.length > 1 ? Math.sqrt(d2 / (list.length - 1) / 2) : 0;
    out.nWin = list.length;
    return out;
  }

  // ---------------- telemetry ----------------
  telemetry() {
    const m = this.meas;
    if (!m) return;
    const e = m.e;
    const tgt = this.get('m1.tgt');
    let fl = 0;
    if (e.valid) fl |= NS.FLAGS.VALID;
    if (this.busy()) fl |= NS.FLAGS.MOVING;
    if (m.sat) fl |= NS.FLAGS.SAT;
    if (e.edge) fl |= NS.FLAGS.EDGE;
    if (this.proc || this.aux) fl |= NS.FLAGS.PROC;
    if (this.cam.locked) fl |= NS.FLAGS.CAMLOCK;
    const v = [Math.round(this.t), this.m1.state, this.angle().toFixed(3), e.theta.toFixed(3), (e.theta - tgt).toFixed(3), e.D.toFixed(5), e.S.toFixed(4), m.mvL.toFixed(1), m.mvR.toFixed(1), this.m.energized ? 1 : 0, fl];
    this.emit('T,' + v.join(','));
  }

  emitPins() {
    const mv = {};
    const p0 = this.get('sen.pin0');
    const p1 = this.get('sen.pin1');
    for (let gpio = 1; gpio <= 18; gpio++) {
      if (gpio === p0) mv[gpio] = this.lastRawMv ? this.lastRawMv[0] : 0;
      else if (gpio === p1) mv[gpio] = this.lastRawMv ? this.lastRawMv[1] : 0;
      else {
        const base = this.pinNoise[gpio] ?? (this.pinNoise[gpio] = gpio % 5 === 0 ? 3300 : Math.random() * 400);
        this.pinNoise[gpio] = NS.clamp(base + gauss() * 15, 0, 3300);
        mv[gpio] = Math.round(Math.min(3100, this.pinNoise[gpio]));
      }
    }
    this.json({ type: 'pins', t: Math.round(this.t), mv });
  }

  // ---------------- procedure runner (generators) ----------------
  start(name, gen, exclusive = true) {
    const slot = exclusive ? 'proc' : 'aux';
    if (this[slot]) return false;
    this[slot] = { name, gen, wait: null };
    this.emit(`E PROC ${name} START`);
    this.resume(slot, undefined);
    return true;
  }
  abort(slot) {
    const p = this[slot];
    if (!p) return;
    this[slot] = null;
    try { p.gen.return(); } catch (_) { /* ignore */ }
    this.emit(`E PROC ${p.name} ABORT`);
  }
  resume(slot, val) {
    const p = this[slot];
    if (!p) return;
    let r;
    try { r = p.gen.next(val); } catch (e) {
      this[slot] = null;
      this.emit(`E FAULT ${p.name} ${String(e.message || e).replace(/\s+/g, '_')}`);
      return;
    }
    if (this[slot] !== p) return;
    if (r.done) { this[slot] = null; this.emit(`E PROC ${p.name} END`); return; }
    const y = r.value || {};
    if (typeof y.then === 'function') {
      p.wait = { promise: true };
      y.then((v) => { if (this[slot] === p) { p.wait = null; this.resume(slot, v); } },
        (e) => { if (this[slot] === p) { this[slot] = null; this.emit(`E FAULT ${p.name} ${e}`); } });
    } else if (y.wait !== undefined) p.wait = { until: this.t + y.wait };
    else if (y.motion) p.wait = { motion: true };
    else if (y.meas) p.wait = { meas: y.meas, acc: [] };
    else p.wait = { until: this.t };
  }
  pollProcs() {
    for (const slot of ['proc', 'aux']) {
      const p = this[slot];
      if (!p || !p.wait) continue;
      const w = p.wait;
      if (w.until !== undefined && this.t >= w.until) { p.wait = null; this.resume(slot); }
      else if (w.motion && !this.busy()) { p.wait = null; this.resume(slot); }
      else if (w.meas && w.acc.length >= w.meas) { const m = this.avgMeas(w.acc); p.wait = null; this.resume(slot, m); }
    }
  }
  measN(ms) { return { meas: Math.max(1, Math.round(ms / this.get('sen.win'))) }; }

  // ---------------- mission 1 ----------------
  setM1(state, extra = '') {
    this.m1.state = state;
    this.emit(`E M1 ${NS.M1_STATES[state]}${extra ? ' ' + extra : ''}`);
  }
  * m1Gen(tgt, opt = {}) {
    const c = (k) => this.get(k);
    const t0 = this.t;
    let iters = 0;
    let first = true;
    let peak = 0;
    let sunAz = null; // last place the light was seen (actuator angles): SEARCH turns there first
    let noiseVar = -1;
    let measMs = c('ctl.meas');
    let db = c('ctl.db');
    // same as the firmware: average longer / widen the deadband only while the reading is noisy (ctl.adapt)
    const sdMean = () => (noiseVar > 0 ? Math.sqrt(noiseVar / Math.max(1, Math.round(measMs / c('sen.win')))) : 0);
    const adapt = (m) => {
      if (m.nWin >= 2) noiseVar = noiseVar < 0 ? m.thSd ** 2 : 0.8 * noiseVar + 0.2 * m.thSd ** 2;
      db = c('ctl.db');
      if (!c('ctl.adapt')) { measMs = c('ctl.meas'); return; }
      if (sdMean() > db / 3 && measMs < 400) measMs = Math.min(400, measMs * 2);
      db = Math.max(db, 2.5 * sdMean());
    };
    for (;;) {
      if (!(first && opt.skipSearch)) {
        yield { wait: c('ctl.wait') };
        let m = yield this.measN(c('ctl.meas'));
        if (!m.e.valid) { // same as the firmware: turn continuously and stop at the first usable reading
          this.setM1(1, m.sat ? 'adc_saturated' : '');
          let found = false;
          let nSat = 0;
          let dir = sunAz !== null ? (sunAz >= this.angle() ? 1 : -1) : (c('m1.smax') - this.angle() >= this.angle() - c('m1.smin') ? 1 : -1);
          for (let pass = 0; pass < 2 && !found; pass++) {
            this.goto(dir > 0 ? c('m1.smax') : c('m1.smin'));
            while (!found && this.busy()) {
              m = yield this.measN(2 * c('sen.win'));
              const reach = m.ang + m.e.theta - tgt; // same as the firmware: a lamp seen at an unreachable angle does not count
              if (m.sat) nSat++; else if (m.e.valid && reach >= c('act.min') && reach <= c('act.max')) found = true;
            }
            dir = -dir;
          }
          this.stopMotor();
          yield { motion: true };
          if (!found) { this.setM1(4, nSat ? 'adc_saturated' : 'no_light'); yield { wait: 1000 }; continue; }
        }
      }
      first = false;
      this.setM1(2);
      let nOK = 0;
      let nTrim = 0;
      let trimSum = 0;
      let kEff = c('ctl.k');
      let prevErr = null;
      let lastPlain = false;
      measMs = c('ctl.meas');
      for (;;) {
        yield { wait: c('ctl.wait') };
        const m = yield this.measN(measMs);
        if (!m.e.valid) { this.setM1(4, m.sat ? 'adc_saturated' : 'lost'); break; }
        adapt(m);
        const err = m.e.theta - tgt;
        this.m1.err = err;
        sunAz = m.ang + m.e.theta;
        if (opt.step) peak = Math.max(peak, Math.abs(err));
        if (this.m1.state === 3) {
          if (Math.abs(err) > c('ctl.hys')) { this.setM1(2, 'reacquire'); nOK = 0; kEff = c('ctl.k'); prevErr = null; } else {
            // same as the firmware: an offset that stays past the deadband for ctl.trim readings is corrected in HOLD
            if (Math.abs(err) > db && c('ctl.trim') > 0) {
              trimSum += err;
              if (++nTrim >= c('ctl.trim')) {
                const mv = (c('ctl.k') * trimSum) / nTrim;
                this.emit(`E M1TRIM err=${(trimSum / nTrim).toFixed(3)} move=${mv.toFixed(3)}`);
                nTrim = 0; trimSum = 0;
                this.moveRel(mv);
                yield { motion: true };
              }
            } else { nTrim = 0; trimSum = 0; }
            continue;
          }
        }
        if (Math.abs(err) <= db && !m.e.edge) {
          if (++nOK >= c('ctl.nlock')) {
            const tLock = this.t - t0;
            nTrim = 0; trimSum = 0;
            this.setM1(3, `t=${Math.round(tLock)} it=${iters} err=${err.toFixed(3)} sd=${sdMean().toFixed(3)}`);
            if (opt.step) { this.json({ type: 'step_result', deg: opt.step, t_lock_ms: Math.round(tLock), iters, peak_err: +peak.toFixed(3), final_err: +err.toFixed(3) }); opt.step = 0; }
          }
          continue;
        }
        nOK = 0;
        iters++;
        if (prevErr !== null && lastPlain && (err > 0) !== (prevErr > 0)) kEff = Math.max(0.2, kEff * 0.5); // jumped over: halve
        prevErr = err;
        let mv = NS.clamp(kEff * err, -c('ctl.maxstep'), c('ctl.maxstep'));
        if (m.e.edge) mv = Math.sign(err) * Math.min(c('ctl.maxstep'), 30);
        const appr = c('ctl.appr');
        const over = appr && Math.sign(mv) === -appr && Math.abs(err) < 5;
        if (over) mv -= appr * 1.5; // overshoot, then approach from +appr side
        lastPlain = !over;
        this.moveRel(mv);
        yield { motion: true };
      }
      yield { wait: 1000 };
    }
  }

  // returns the last reading plus nullAng = actuator angle where the reading is zero (the sun direction)
  * nullSeek(tol, maxIt = 25) {
    let k = this.get('ctl.k');
    let prev = null;
    let prevAng = 0;
    let lastPlain = false;
    for (let i = 0; i < maxIt; i++) {
      yield { wait: this.get('ctl.wait') };
      const m = yield this.measN(this.get('ctl.meas'));
      if (!m.e.valid) throw new Error(m.sat ? 'adc_saturated' : 'no_light');
      const err = m.e.theta;
      if (Math.abs(err) < tol) return { ...m, nullAng: m.ang + err };
      // same as the firmware: two close readings on both sides of the null -> go to the interpolated zero
      if (prev !== null && (err > 0) !== (prev > 0) && Math.abs(m.ang - prevAng) <= 3 && Math.abs(prev) < 5 && Math.abs(err) < 5) {
        const nullAng = prevAng + ((m.ang - prevAng) * prev) / (prev - err);
        this.goto(nullAng);
        yield { motion: true };
        return { ...m, nullAng };
      }
      // same as the firmware: a plain correction that jumped over the null halves the gain (no endless cycling)
      if (prev !== null && lastPlain && (err > 0) !== (prev > 0)) k = Math.max(0.1, k * 0.5);
      prev = err;
      prevAng = m.ang;
      let mv = m.e.edge ? Math.sign(err) * 30 : NS.clamp(k * err, -30, 30);
      const appr = this.get('ctl.appr');
      const over = appr && Math.sign(mv) === -appr && Math.abs(err) < 5;
      if (over) mv -= appr * 1.5; // same approach side as M1
      lastPlain = !over;
      this.moveRel(mv);
      yield { motion: true };
    }
    throw new Error('null_not_converged');
  }

  * sweepGen(a, b, step, dwell, tag) {
    const dir = Math.sign(b - a) || 1;
    step = Math.abs(step) || 5;
    this.goto(a - dir * 3);
    yield { motion: true };
    let n = 0;
    for (let ang = a; dir > 0 ? ang <= b + 1e-9 : ang >= b - 1e-9; ang += dir * step) {
      this.goto(ang);
      yield { motion: true };
      yield { wait: dwell };
      const m = yield this.measN(Math.max(dwell / 2, 2 * this.get('sen.win')));
      n++;
      this.json({ type: 'sweep_pt', tag, ang: +m.ang.toFixed(3), mv: [+m.mvL.toFixed(1), +m.mvR.toFixed(1)], G: [+m.GL.toFixed(6), +m.GR.toFixed(6)], D: +m.e.D.toFixed(5), S: +m.e.S.toFixed(5), th: +m.e.theta.toFixed(3), sat: m.sat });
    }
    this.json({ type: 'sweep_end', tag, n });
  }

  * backlashGen() {
    const saved = this.get('act.bl');
    this.cfg.set('act.bl', 0);
    try {
      const center = this.angle();
      const pass = function* (self, from, to, st) {
        self.goto(from); yield { motion: true };
        let prev = null;
        for (let a = from; st > 0 ? a <= to : a >= to; a += st) {
          self.goto(a); yield { motion: true }; yield { wait: self.get('ctl.wait') };
          const m = yield self.measN(self.get('ctl.meas'));
          if (!m.e.valid) throw new Error(m.sat ? 'adc_saturated' : 'no_light');
          if (prev && Math.sign(prev.th) !== Math.sign(m.e.theta)) {
            return prev.ang + ((m.ang - prev.ang) * prev.th) / (prev.th - m.e.theta);
          }
          prev = { ang: m.ang, th: m.e.theta };
        }
        return NaN;
      };
      const f = yield* pass(this, center - 5, center + 5, 0.25);
      const b = yield* pass(this, center + 5, center - 5, -0.25);
      if (!Number.isFinite(f) || !Number.isFinite(b)) throw new Error('no_zero_crossing_within_5deg_face_the_lamp_first');
      const bl = f - b;
      this.json({ type: 'backlash', deg: +bl.toFixed(3), fwd: +f.toFixed(3), bwd: +b.toFixed(3) });
      this.goto(center);
      yield { motion: true };
    } finally { this.cfg.set('act.bl', saved); }
  }

  * sprGen() {
    if (this.get('act.max') - this.angle() < 365) throw new Error('need_360deg_free_rotation_raise_act.max');
    yield* this.nullSeek(0.1);
    const L1 = this.m.L;
    this.moveRel(360);
    yield { motion: true };
    yield* this.nullSeek(0.1);
    const L2 = this.m.L;
    this.json({ type: 'spr', steps: L2 - L1, cfg: this.spr() });
  }

  // ---------------- mission 2 (camera) ----------------
  camSize() { return [[320, 240], [640, 480], [800, 600], [1024, 768], [1280, 720], [1600, 1200]][NS.clamp(this.get('cam.res'), 0, 5)]; }
  * lockGen() {
    yield { wait: 900 };
    this.cam.locked = true;
    this.cam.exp = 280 + Math.round(Math.random() * 60);
    this.cfg.set('cam.aec', this.cam.exp);
    this.json({ type: 'cam', locked: true, aec: this.cam.exp, agc: this.cam.gain });
  }
  // point the camera at (sun direction + offset): immune to a lost/shifted actuator zero
  * sunRefGen(offset) {
    // face the sun first: the estimate is most accurate at the null, so the reference is sharpest there
    const m = yield* this.nullSeek(Math.max(0.1, this.get('ctl.db')));
    const sunAz = m.nullAng;
    this.json({ type: 'sun_ref', sun_az: +sunAz.toFixed(3), offset });
    yield* this.snapGen(sunAz + offset, { ref: 'sun', sun_az: +sunAz.toFixed(3), offset });
  }

  reachable(a) {
    const t = this.get('act.type');
    if (t === 0 || a < this.get('act.min') - 1e-3 || a > this.get('act.max') + 1e-3) return false;
    return t !== 2 || Math.abs(a) <= this.get('act.srng') / 2 + 1e-3;
  }
  snapFail(reason, info) { this.json({ type: 'snap_fail', reason, ...info }); throw new Error(reason); }
  * snapGen(goTo, ref = null) {
    if (goTo !== undefined) {
      const aim = goTo - this.get('cam.off');
      const info = { tgt: +goTo.toFixed(3), aim: +aim.toFixed(3), ang: +this.angle().toFixed(3), min: this.get('act.min'), max: this.get('act.max'), tol: this.get('m2.tol'), err_cmd: 0 };
      if (!this.reachable(aim)) this.snapFail('target_out_of_range', info);
      const appr = this.get('ctl.appr'); // same as the firmware: arrive turning the ctl.appr way
      if (appr && (aim - this.angle()) * appr < 0.05 && this.reachable(aim - appr * 2)) { this.goto(aim - appr * 2); yield { motion: true }; }
      this.goto(aim);
      yield { motion: true };
      const errCmd = this.angle() + this.get('cam.off') - goTo;
      if (Math.abs(errCmd) > this.get('m2.tol')) this.snapFail('not_in_tol', { ...info, ang: +this.angle().toFixed(3), err_cmd: +errCmd.toFixed(3) });
    }
    yield { motion: true };
    yield { wait: this.get('m2.settle') };
    yield { wait: 60 * this.get('cam.flush') };
    const [W, H] = this.camSize();
    const cmd = goTo !== undefined ? goTo : null;
    const camAz = this.bodyTrue() + this.truth.camOff;
    const moving = this.busy();
    const bytes = yield this.render(W, H, camAz, moving);
    const id = ++this.cam.id;
    const meta = {
      type: 'img_meta', id, t_ms: Math.round(this.t), w: W, h: H, bytes: bytes.length, q: this.get('cam.q'),
      ang: +this.angle().toFixed(3), cam_az_cmd: +(this.angle() + this.get('cam.off')).toFixed(3), tgt: cmd,
      err_cmd: cmd === null ? null : +(this.angle() + this.get('cam.off') - cmd).toFixed(3),
      tol: this.get('m2.tol'), in_tol: cmd === null ? null : Math.abs(this.angle() + this.get('cam.off') - cmd) <= this.get('m2.tol'),
      m1: NS.M1_STATES[this.m1.state], th: this.meas && this.meas.e.valid ? +this.meas.e.theta.toFixed(3) : null,
      locked: this.cam.locked, aec: this.cam.locked ? this.cam.exp : 'auto', agc: this.cam.gain, moving,
      ...(ref || { ref: cmd === null ? 'none' : 'actuator' }),
      hm: this.get('cam.hmirror'), vf: this.get('cam.vflip'), cam_dir: this.get('cam.dir'), hfov: this.get('cam.hfov'),
      sim_truth_err: cmd === null ? null : +wrap180(camAz - this.world.targetAz).toFixed(3),
    };
    this.json(meta);
    this.sendImage(id, bytes);
  }
  sendImage(id, bytes) {
    const CH = 180;
    const n = Math.ceil(bytes.length / CH);
    const chunks = [];
    for (let i = 0; i < n; i++) chunks.push(NS.bytesToB64(bytes.subarray(i * CH, (i + 1) * CH)));
    this.cam.cache.set(String(id), chunks);
    if (this.cam.cache.size > 5) this.cam.cache.delete(this.cam.cache.keys().next().value);
    this.emit(`IMG B ${id} ${bytes.length} ${n} ${NS.crc32(bytes).toString(16).padStart(8, '0')}`);
    chunks.forEach((c, i) => this.emit(`IMG C ${id} ${i} ${c}`));
    this.emit(`IMG E ${id}`);
  }
  render(W, H, camAz, moving) {
    const hf = this.truth.hfov;
    const f = W / 2 / Math.tan((hf / 2) * NS.DEG);
    const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, H) : Object.assign(document.createElement('canvas'), { width: W, height: H });
    const g = cv.getContext('2d');
    // the picture as the sensor delivers it: the module's own orientation, then cam.hmirror / cam.vflip
    const sx = this.truth.camDir * (this.get('cam.hmirror') ? -1 : 1) < 0 ? -1 : 1;
    const sy = this.truth.camFlipV !== !!this.get('cam.vflip') ? -1 : 1;
    g.setTransform(sx, 0, 0, sy, sx < 0 ? W : 0, sy < 0 ? H : 0);
    const expo = this.cam.locked ? 1 : 0.55 + Math.random() * 1.1;
    g.filter = `brightness(${expo.toFixed(2)})${moving ? ' blur(3px)' : ''}`;
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#0b1633'); sky.addColorStop(1, '#1d2b4a');
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    g.fillStyle = '#3a3a3a'; g.fillRect(0, H * 0.72, W, H * 0.28);
    const xOf = (az) => { const d = wrap180(az - camAz); if (Math.abs(d) > 85) return null; return W / 2 - f * Math.tan(d * NS.DEG); };
    for (const d of this.decor) { // posters and shelves on the walls
      const x1 = xOf(d.az - d.w / 2);
      const x2 = xOf(d.az + d.w / 2);
      if (x1 === null || x2 === null) continue;
      g.fillStyle = `hsl(${d.hue},40%,${d.lit}%)`;
      g.fillRect(Math.min(x1, x2), H * d.top, Math.abs(x1 - x2), H * d.h);
    }
    g.strokeStyle = 'rgba(255,255,255,0.07)'; g.lineWidth = 1;
    for (let az = -180; az < 180; az += 10) { const x = xOf(az); if (x !== null && x > -5 && x < W + 5) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H * 0.72); g.stroke(); } }
    if (this.world.lampOn) {
      const x = xOf(this.world.lampAz);
      if (x !== null) {
        const r = W / 22;
        const rg = g.createRadialGradient(x, H * 0.35, 1, x, H * 0.35, r * 3);
        rg.addColorStop(0, '#ffffff'); rg.addColorStop(0.25, '#fff4b0'); rg.addColorStop(1, 'rgba(255,220,120,0)');
        g.fillStyle = rg; g.beginPath(); g.arc(x, H * 0.35, r * 3, 0, Math.PI * 2); g.fill();
      }
    }
    const tx = xOf(this.world.targetAz);
    if (tx !== null) {
      const s = W / 9;
      g.fillStyle = '#d33c3c'; g.fillRect(tx - s / 2, H * 0.5 - s / 2, s, s);
      g.strokeStyle = '#ffffff'; g.lineWidth = Math.max(2, W / 200);
      g.beginPath(); g.moveTo(tx - s / 2, H * 0.5); g.lineTo(tx + s / 2, H * 0.5); g.moveTo(tx, H * 0.5 - s / 2); g.lineTo(tx, H * 0.5 + s / 2); g.stroke();
      g.fillStyle = '#ffffff'; g.font = `${Math.round(W / 40)}px sans-serif`; g.textAlign = 'center'; g.fillText('TARGET', tx, H * 0.5 + s / 2 + W / 32);
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.filter = 'none';
    g.fillStyle = 'rgba(255,255,255,0.8)'; g.font = `${Math.round(W / 45)}px monospace`; g.textAlign = 'left';
    g.fillText(`NASA-SIM t=${(this.t / 1000).toFixed(2)}s`, 6, H - 8);
    const toBlob = cv.convertToBlob ? cv.convertToBlob({ type: 'image/jpeg', quality: NS.clamp(1 - this.get('cam.q') / 70, 0.2, 0.95) })
      : new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.8));
    return toBlob.then((b) => b.arrayBuffer()).then((ab) => new Uint8Array(ab));
  }

  // ---------------- command handler ----------------
  handle(line) {
    if (!line) return;
    let id = null;
    const mi = line.match(/^@(\d+)\s+(.*)$/);
    if (mi) { id = mi[1]; line = mi[2]; }
    const P = id ? `@${id} ` : '';
    const ok = (t = '') => this.emit(`${P}OK${t ? ' ' + t : ''}`);
    const err = (code, t = '') => this.emit(`${P}ERR ${code}${t ? ' ' + t : ''}`);
    const parts = line.split(/\s+/);
    const cmd = parts[0].toUpperCase();
    const a = parts.slice(1);
    const num = (i, d) => (a[i] !== undefined && a[i] !== '' && isFinite(+a[i]) ? +a[i] : d);
    const motionFree = () => { if (this.proc) { err('BUSY', this.proc.name); return false; } return true; };
    switch (cmd) {
      case 'HELLO': this.json(this.helloObj()); ok(); break;
      case 'HELP':
        this.emit('# HELLO HELP CFG LIST|GET k|SET k v|SAVE [k ..]|LOAD|DEFAULTS STREAM ON|OFF [hz] RAW [ms] AMB [ms] BAL [ms]');
        this.emit('# SWEEP a b step dwell | MOVE d | GOTO a | ZERO | STOP | RELEASE | STEP d | BACKLASH | SPR');
        this.emit('# M1 START [tgt] | M1 STOP | M2 INIT | M2 LOCK | M2 UNLOCK | M2 MANUAL | M2 SNAP | M2 GO [tgt] | M2 GO SUN offset | CAL LUT x0 dx v,v,..| CAL TH0 [ref] | CAL CLR | CAL GET');
        this.emit('# HWID | PINFIND ON|OFF | DIAG | REBOOT | IMG GET id seq,seq');
        this.emit('# no laptop: m1.auto (start M1 N s after power-on), hw.btn (button starts/stops M1), com.tx/com.rx (second port)');
        ok(); break;
      case 'CFG': {
        const sub = (a[0] || '').toUpperCase();
        if (sub === 'LIST') {
          this.json({ type: 'cfg', items: NS.CFG_DEFS.map((d) => ({ ...d, v: this.cfg.get(d.k), sv: this.nvs.get(d.k) })) });
          ok(`${NS.CFG_DEFS.length}`);
        } else err('ARG', 'CFG LIST');
        break;
      }
      case 'GET': {
        if (!this.cfg.has(a[0])) { err('KEY', a[0]); break; }
        ok(`${a[0]}=${this.cfg.get(a[0])}`); break;
      }
      case 'SET': {
        const d = NS.CFG_DEFS.find((x) => x.k === a[0]);
        if (!d) { err('KEY', a[0]); break; }
        let v = Number(a[1]);
        if (!isFinite(v)) { err('VAL', a[1]); break; }
        if (d.t === 'i') v = Math.round(v);
        if (v < d.min || v > d.max) { err('RANGE', `${d.k} ${d.min}..${d.max}`); break; }
        const why = NS.pinWhy(d.k, v);
        if (why) { err('PIN', `${d.k}=${v} ${why}`); break; }
        this.cfg.set(d.k, v);
        if (NS.PIN_KEYS.includes(d.k) && v >= 0) {
          for (const k2 of NS.PIN_KEYS) if (k2 !== d.k && this.cfg.get(k2) === v) this.emit(`E WARN PIN GPIO${v} ${d.k} ${k2}`);
        }
        if (d.k === 'com.hz' && this.stream) this.nextTel = this.t;
        ok(`${d.k}=${v}`); break;
      }
      case 'SAVE':
        if (a.length && a[0] !== '') { // "SAVE k1 k2": only these keys (like the firmware)
          const bad = a.find((k) => !this.cfg.has(k));
          if (bad) { err('KEY', bad); break; }
          for (const k of a) this.nvs.set(k, this.cfg.get(k));
          ok(`saved ${a.length}`); break;
        }
        this.nvs = new Map(this.cfg); this.nvsLut = this.lut ? JSON.parse(JSON.stringify(this.lut)) : null; ok('saved'); break;
      case 'LOAD': this.cfg = new Map(this.nvs); this.lut = this.nvsLut ? JSON.parse(JSON.stringify(this.nvsLut)) : null; ok('loaded'); break;
      case 'DEFAULTS': this.cfg = new Map(NS.CFG_DEFS.map((d) => [d.k, d.d])); this.lut = null; ok('defaults (not saved)'); break;
      case 'STREAM': {
        const on = (a[0] || '').toUpperCase() === 'ON';
        if (on && a[1] !== undefined && !(+a[1] >= 0 && +a[1] <= 100)) { err('RANGE', 'com.hz 0..100'); break; }
        this.stream = on;
        if (on) { if (a[1] !== undefined) this.cfg.set('com.hz', Math.round(+a[1])); this.emit('TH,' + NS.TEL_COLS.join(',')); }
        ok(on ? 'on' : 'off'); break;
      }
      case 'RAW': {
        const ms = num(0, 200);
        const self = this;
        this.start('RAW', (function* () {
          const m = yield self.measN(ms);
          self.json({ type: 'raw', mv: [+m.mvL.toFixed(1), +m.mvR.toFixed(1)], G: [+m.GL.toFixed(6), +m.GR.toFixed(6)], D: +m.e.D.toFixed(5), S: +m.e.S.toFixed(5), th: +m.e.theta.toFixed(3), valid: m.e.valid, sat: m.sat, edge: m.e.edge, ang: +m.ang.toFixed(3), th_sd: +m.thSd.toFixed(4), n: m.nWin });
        }()), false) ? ok() : err('BUSY', 'aux');
        break;
      }
      case 'AMB': {
        const ms = num(0, 500);
        const self = this;
        this.start('AMB', (function* () {
          // wait until the LDRs stop drifting after the lamp went off (two 250 ms averages within 1 %)
          let prev = null;
          let k = 0;
          for (; k < 16; k++) {
            const w = yield self.measN(250);
            if (w.sat) throw new Error('adc_saturated');
            if (prev && Math.abs(w.GL - prev.GL) <= 0.01 * prev.GL && Math.abs(w.GR - prev.GR) <= 0.01 * prev.GR) break;
            prev = w;
          }
          if (k >= 16) self.emit('E WARN AMB still_drifting_after_4s');
          const m = yield self.measN(ms);
          if (m.sat) throw new Error('adc_saturated');
          const p = self.estParams();
          const aL = Math.pow(m.GL, 1 / p.gamma);
          const aR = Math.pow(m.GR, 1 / NS.est.gR(p));
          self.cfg.set('est.aL', +aL.toPrecision(6));
          self.cfg.set('est.aR', +aR.toPrecision(6));
          self.json({ type: 'amb', aL: +aL.toPrecision(6), aR: +aR.toPrecision(6), mv: [+m.mvL.toFixed(1), +m.mvR.toFixed(1)] });
        }()), false) ? ok() : err('BUSY', 'aux');
        break;
      }
      case 'BAL': {
        const ms = num(0, 500);
        const self = this;
        this.start('BAL', (function* () {
          yield { motion: true };
          yield { wait: self.get('ctl.wait') };
          const m = yield self.measN(ms);
          if (m.sat) throw new Error('adc_saturated');
          const p = self.estParams();
          const eL = NS.est.eChannel(m.GL, p.gamma, p.aL, p.qL);
          const eR = NS.est.eChannel(m.GR, NS.est.gR(p), p.aR, p.qR);
          if (eL <= 0 || eR <= 0) throw new Error('too_dark');
          const g = eR / eL;
          self.cfg.set('est.g', +g.toPrecision(6));
          const after = self.avgMeas([m]);
          self.json({ type: 'bal', g: +g.toPrecision(6), S: +after.e.S.toFixed(5), suggest_minS: +(after.e.S * 0.15).toFixed(4) });
        }()), false) ? ok() : err('BUSY', 'aux');
        break;
      }
      case 'SWEEP': {
        if (!motionFree()) break;
        if (a.length < 3) { err('ARG', 'SWEEP a b step [dwell]'); break; }
        this.start('SWEEP', this.sweepGen(num(0, -60), num(1, 60), num(2, 5), num(3, 300), a[4] || 'cal'));
        ok('started'); break;
      }
      case 'MOVE': if (!motionFree()) break; this.moveRel(num(0, 0)); ok(`target=${(this.angle() + 0).toFixed(3)}`); break;
      case 'GOTO': if (!motionFree()) break; this.goto(num(0, 0)); ok(); break;
      case 'ZERO': if (!motionFree()) break; this.m.L = 0; this.m.T = 0; this.m.comp = 0; this.m.servo = 0; ok('zeroed'); break;
      case 'RELEASE': this.m.energized = false; ok(); break;
      case 'STOP':
        if (this.autoAt !== null) { this.autoAt = null; this.emit('E AUTO CANCELLED'); }
        this.abort('proc'); this.abort('aux'); this.stopMotor();
        if (this.m1.state) this.setM1(0, 'stopped');
        ok('stopped'); break;
      case 'M1': {
        const sub = (a[0] || '').toUpperCase();
        if (sub === 'START') {
          if (a[1] !== undefined && !(+a[1] >= -80 && +a[1] <= 80)) { err('RANGE', 'm1.tgt -80..80'); break; }
          if (a[1] !== undefined) this.cfg.set('m1.tgt', num(1, 0));
          this.m1Start(this.get('m1.tgt'));
          ok('started');
        } else if (sub === 'STOP') {
          if (this.proc && this.proc.name === 'M1') this.abort('proc');
          this.stopMotor(); this.setM1(0, 'stopped'); ok();
        } else err('ARG', 'M1 START|STOP');
        break;
      }
      case 'STEP': {
        if (!this.proc || this.proc.name !== 'M1' || this.m1.state !== 3) { err('STATE', 'M1 must be HOLD'); break; }
        const deg = num(0, 10);
        this.abort('proc');
        const self = this;
        this.start('M1', (function* () {
          self.moveRel(deg);
          yield { motion: true };
          yield* self.m1Gen(self.get('m1.tgt'), { skipSearch: true, step: deg });
        }()));
        ok('started'); break;
      }
      case 'BACKLASH': if (!motionFree()) break; this.start('BACKLASH', this.backlashGen()); ok('started'); break;
      case 'SPR': if (!motionFree()) break; this.start('SPR', this.sprGen()); ok('started'); break;
      case 'M2': {
        const sub = (a[0] || '').toUpperCase();
        if (sub === 'INIT') { // the simulated board always has its camera; an ESP32-CAM preset is refused like on a real S3
          if (this.get('cam.model') === 4) err('CAM', 'cam.model 4 not for this chip: PWDN GPIO32 GPIO26-32 = SPI flash/PSRAM of the module');
          else ok('ok sensor PID 0x26 (SIM)');
        }
        else if (sub === 'MANUAL') { this.cam.locked = true; this.cam.exp = this.get('cam.aec'); this.cam.gain = this.get('cam.agc'); this.json({ type: 'cam', locked: true, aec: this.cam.exp, agc: this.cam.gain }); ok(); }
        else if (sub === 'LOCK') { this.start('LOCK', this.lockGen(), false) ? ok('locking') : err('BUSY', 'aux'); }
        else if (sub === 'UNLOCK') { this.cam.locked = false; this.json({ type: 'cam', locked: false }); ok(); }
        else if (sub === 'SNAP') { this.start('SNAP', this.snapGen(), false) ? ok('started') : err('BUSY', this.aux ? this.aux.name : 'aux'); } // aux: works while M1 holds
        else if (sub === 'GO') {
          const sun = (a[1] || '').toUpperCase() === 'SUN';
          if (sun && !(a[2] !== undefined && isFinite(+a[2]))) { err('ARG', 'M2 GO SUN offset_deg'); break; }
          if (!sun && a[1] !== undefined && !(+a[1] >= -360 && +a[1] <= 360)) { err('RANGE', 'm2.tgt -360..360'); break; }
          if (this.proc && this.proc.name === 'M1') { this.abort('proc'); this.stopMotor(); this.setM1(0, 'm2_takeover'); } // mission 2 takes over
          if (!motionFree()) break;
          if (sun) this.start('SNAP', this.sunRefGen(num(2, 0)));
          else { if (a[1] !== undefined) this.cfg.set('m2.tgt', num(1, 0)); this.start('SNAP', this.snapGen(this.get('m2.tgt'))); }
          ok('started');
        }
        else err('ARG', 'M2 INIT|LOCK|UNLOCK|MANUAL|SNAP|GO [tgt]|GO SUN offset');
        break;
      }
      case 'CAL': {
        const sub = (a[0] || '').toUpperCase();
        if (sub === 'LUT') {
          const v = (a[3] || '').split(',').map(Number);
          if (a.length < 4 || v.some((x) => !isFinite(x))) { err('ARG', 'CAL LUT x0 dx v0,v1,...'); break; }
          this.lut = { x0: num(1, 0), dx: num(2, 5), v };
          ok(`lut n=${v.length}`);
        } else if (sub === 'TH0') {
          // outside reference says the lamp is `ref` deg from the satellite axis now: shift est.th0 to agree
          if (a[1] !== undefined && !isFinite(+a[1])) { err('ARG', 'CAL TH0 [ref_deg]'); break; }
          const ref = num(1, 0);
          const self = this;
          this.start('TH0', (function* () {
            yield { motion: true };
            yield { wait: self.get('ctl.wait') };
            const m = yield self.measN(600);
            if (!m.e.valid || m.e.edge) throw new Error(m.e.edge ? 'outside_accurate_range' : m.sat ? 'adc_saturated' : 'no_light');
            const old = self.get('est.th0');
            const nv = old + ref - m.e.theta;
            if (!(nv >= -45 && nv <= 45)) throw new Error('th0_out_of_range');
            self.cfg.set('est.th0', +nv.toFixed(4));
            self.nvs.set('est.th0', +nv.toFixed(4)); // like the firmware: the zero goes to flash right away
            self.json({ type: 'th0', old: +old.toFixed(3), new: +nv.toFixed(3), th_before: +m.e.theta.toFixed(3), ref, saved: true });
          }()), false) ? ok('measuring') : err('BUSY', 'aux');
        } else if (sub === 'CLR') { this.lut = null; ok(); }
        else if (sub === 'GET') { this.json({ type: 'cal', lut: this.lut, est: this.estParams() }); ok(); }
        else err('ARG', 'CAL LUT|TH0|CLR|GET');
        break;
      }
      case 'HWID':
        this.json({
          type: 'hwid', chip: 'ESP32-S3 (SIMULATOR)', cores: 2, cpu_mhz: 240, flash_mb: 8, psram_mb: 8, core: 'sim', fw: 'NasaSat sim ' + NS.VERSION,
          reset: 'POWERON', uptime_ms: Math.round(this.t), i2c: [], camera: 'SIM-OV2640', actuator: ['none', 'stepper ULN2003', 'servo'][this.get('act.type')],
          ldr_pins: [this.get('sen.pin0'), this.get('sen.pin1')], uln_pins: [this.get('act.in1'), this.get('act.in2'), this.get('act.in3'), this.get('act.in4')],
          btn: this.get('hw.btn'), link: 'off (simulator)',
        });
        ok(); break;
      case 'PINFIND': this.pinfind = (a[0] || '').toUpperCase() !== 'OFF'; ok(this.pinfind ? 'on' : 'off'); break;
      case 'DIAG': {
        const m = this.meas;
        const e = m ? m.e : null;
        this.json({
          type: 'diag',
          lines: [
            `uptime=${(this.t / 1000).toFixed(1)}s proc=${this.proc ? this.proc.name : '-'} aux=${this.aux ? this.aux.name : '-'} m1=${NS.M1_STATES[this.m1.state]}`,
            m ? `mv=[${m.mvL.toFixed(0)},${m.mvR.toFixed(0)}] G=[${m.GL.toFixed(4)},${m.GR.toFixed(4)}] D=${e.D.toFixed(4)} S=${e.S.toFixed(4)} th=${e.theta.toFixed(2)} valid=${e.valid} edge=${e.edge} sat=${m.sat}` : 'no measurement',
            `ang=${this.angle().toFixed(2)} energized=${this.m.energized} steps L=${this.m.L} T=${this.m.T} missed(sim)=${this.m.missed}`,
            `est: alpha=${this.get('est.alpha')} gamma=${this.get('est.gamma')} qL=${this.get('est.qL')} qR=${this.get('est.qR')} g=${this.get('est.g')} aL=${this.get('est.aL')} aR=${this.get('est.aR')} th0=${this.get('est.th0')} lut=${this.lut ? this.lut.v.length : 0}`,
            `ctl: k=${this.get('ctl.k')} db=${this.get('ctl.db')} hys=${this.get('ctl.hys')} trim=${this.get('ctl.trim')} adapt=${this.get('ctl.adapt')} wait=${this.get('ctl.wait')} meas=${this.get('ctl.meas')} appr=${this.get('ctl.appr')} act.bl=${this.get('act.bl')} spr=${this.spr()}`,
            `cam: locked=${this.cam.locked} res=${this.get('cam.res')} q=${this.get('cam.q')} off=${this.get('cam.off')} dir=${this.get('cam.dir')} hfov=${this.get('cam.hfov')} hm=${this.get('cam.hmirror')} vf=${this.get('cam.vflip')}`,
            `sys: m1.auto=${this.get('m1.auto')} btn=${this.get('hw.btn')} vbat_pin=${this.get('hw.vbat')} hk=${this.get('com.hk')} link=off (simulator)`,
          ],
        });
        ok(); break;
      }
      case 'REBOOT':
        ok('rebooting');
        setTimeout(() => {
          const nvs = this.nvs; const nvsLut = this.nvsLut;
          const out = this.m.out; const motor = this.m.motor;
          this.reset();
          this.cfg = new Map(nvs); this.nvs = new Map(nvs); this.lut = nvsLut; this.nvsLut = nvsLut;
          this.m.out = out; this.m.motor = motor;
          this.boot('SOFTWARE');
        }, 300);
        break;
      case 'IMG': {
        if ((a[0] || '').toUpperCase() !== 'GET') { err('ARG', 'IMG GET id seqs'); break; }
        const chunks = this.cam.cache.get(a[1]);
        if (!chunks) { err('IMG', 'not_cached'); break; }
        for (const s of (a[2] || '').split(',').map(Number)) if (chunks[s]) this.emit(`IMG C ${a[1]} ${s} ${chunks[s]}`);
        this.emit(`IMG E ${a[1]}`);
        ok(); break;
      }
      default: err('CMD', cmd);
    }
  }

  // ---------------- simulator-only controls ----------------
  truthInfo() {
    const tgt = this.get('m1.tgt');
    return {
      'มุมแสงจริงเทียบตัวดาวเทียม (°)': this.thetaTrue().toFixed(2),
      'error จริงของภารกิจ 1 (°)': wrap180(this.thetaTrue() - tgt).toFixed(2),
      'มุมตัวดาวเทียมจริง (°)': this.bodyTrue().toFixed(2),
      'กล้องชี้จริง (°)': (this.bodyTrue() + this.truth.camOff).toFixed(2),
      'error กล้องจริงเทียบเป้า (°)': wrap180(this.bodyTrue() + this.truth.camOff - this.world.targetAz).toFixed(2),
      'step ต่อรอบจริง / backlash จริง': `${this.truth.spr} / ${this.truth.backlash}°`,
      'step ที่หลุด (ความเร็วเกิน)': this.m.missed,
    };
  }
  randomize() {
    const w = this.world;
    w.lampAz = Math.round(-120 + Math.random() * 240);
    w.lampK = +(0.5 + Math.random() * 1.8).toFixed(2);
    w.ambient = +(0.01 + Math.random() * 0.08).toFixed(3);
    w.targetAz = Math.round(-150 + Math.random() * 300);
  }
};
