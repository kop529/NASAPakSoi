// End-to-end tests of the TEAM firmware on the PC (build/sunseek_host = the real sketch + mocks + sim_world).
// Each test runs the program with a script of telecommands, #WAIT / #SET / #STATE lines, then checks the output.
// Run inside WSL:  bash SunSeek/host_test/run.sh
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const exe = path.join(__dirname, 'build', 'sunseek_host');
let passes = 0, fails = 0;
const check = (name, cond, info = '') => {
  if (cond) { passes++; console.log(`  ok   ${name} ${info}`); } else { fails++; console.log(`  FAIL ${name} ${info}`); }
};

// run one script; nvs = file that keeps the flash between runs ("reset" = run again with the same file)
function run(lines, nvs) {
  const env = { ...process.env, SUNSEEK_NVS: nvs || '' };
  const r = spawnSync(exe, { input: lines.join('\n') + '\n', encoding: 'utf8', env, maxBuffer: 256 << 20 });
  if (r.status !== 0) throw new Error(`sunseek_host exited ${r.status}: ${r.stderr}`);
  return r.stdout.split('\n').filter((l) => l.length);
}
const tmpNvs = () => path.join(os.tmpdir(), `sunseek_nvs_${process.pid}_${Math.random().toString(36).slice(2)}.txt`);
const find = (out, re) => out.find((l) => re.test(l));
const all = (out, re) => out.filter((l) => re.test(l));
const kv = (line) => { // TM,GROUP?,K,V,... -> {K: V}
  const t = line.split(',').slice(1);
  const o = {};
  const start = t.length % 2 ? 1 : 0;
  for (let i = start; i + 1 < t.length; i += 2) o[t[i]] = t[i + 1];
  return o;
};
const states = (out) => all(out, /^#STATE /).map((l) => Object.fromEntries(l.slice(7).split(' ').map((p) => { const [k, v] = p.split('='); return [k, +v]; })));

console.log('boot + link');
{
  const out = run(['PING', 'STATUS', '#WAIT 200', 'TEAM_INFO', '#WAIT 50']);
  check('boot banner', !!find(out, /^SUNSEEK PLATFORM v2\.1/));
  check('spacecraft id SUNSEEK-NasaPakSoi', !!find(out, /^Spacecraft ID: SUNSEEK-NasaPakSoi$/));
  check('team firmware banner', !!find(out, /^TEAM FIRMWARE: NasaPakSoi-team-/));
  check('PING -> PONG', !!find(out, /^PONG$/));
  check('STATUS -> ACK,STATUS', !!find(out, /^ACK,STATUS$/));
  check('STATUS keeps the organizer lines', !!find(out, /^TM,SAT_ID,SUNSEEK-NasaPakSoi,BLE,DISCONNECTED/) && !!find(out, /^TM,ADCS_MODE,MANUAL,ADCS_REFERENCE,SUN,TARGET,0\.00,KP,2\.000,KD,0\.500,MOMENTUM_BIAS,40,DEADBAND,2\.00,MAX_RW_COMMAND,80,CONTROL_SIGN,1\.0$/));
  check('STATUS adds TM,TEAM_FW', !!find(out, /^TM,TEAM_FW,NasaPakSoi-team-[^,]+,SUN_MODEL,0,UNSAVED,0,LUT_N,0$/));
  check('IMU detected in the simulated GY-89', !!find(out, /^TM,SENSOR_GYRO,READY$/) && !!find(out, /^TM,SENSOR_MAG,READY$/));
  const long = out.filter((l) => !l.startsWith('#') && l.length > 182);
  check('every line fits one BLE notification (<= 182 chars)', long.length === 0, long[0] || '');
}

console.log('team parameters');
{
  const nvs = tmpNvs();
  const out = run([
    'TEAM_GET,sun.alpha', 'TEAM_SET,sun.alpha,31.5', 'TEAM_SET,sun.alpha,95', 'TEAM_SET,nope,1', 'TEAM_SET,sun.alpha,abc',
    'TEAM_SET,adcs.sign,0', 'TEAM_SET,sun.win,25.5', 'TEAM_INFO', 'ADCS_TUNE,3.5,0.8,45', 'TEAM_SAVE', 'TEAM_DEFAULTS', '#WAIT 20',
  ], nvs);
  check('TEAM_GET default', !!find(out, /^TM,TEAM_PARAM,sun\.alpha,30$/));
  check('TEAM_SET ok', !!find(out, /^ACK,TEAM_SET,sun\.alpha,31\.5$/));
  check('TEAM_SET range', !!find(out, /^ERR,TEAM_RANGE,sun\.alpha,1,89$/));
  check('TEAM_SET unknown key', !!find(out, /^ERR,TEAM_UNKNOWN_KEY,nope$/));
  check('TEAM_SET bad number', !!find(out, /^ERR,TEAM_VALUE,sun\.alpha$/));
  check('sign must be -1 or 1', !!find(out, /^ERR,TEAM_RANGE,adcs\.sign,-1\|1$/));
  check('int parameter rejects fractions', !!find(out, /^ERR,TEAM_RANGE,sun\.win,10,200$/));
  check('unsaved counter', !!find(out, /^TM,TEAM_FW,[^,]+,SUN_MODEL,0,UNSAVED,1,/));
  check('TEAM_SAVE', !!find(out, /^ACK,TEAM_SAVE,\d+$/));
  check('TEAM_DEFAULTS needs YES', !!find(out, /^ERR,TEAM_DEFAULTS_NEEDS_YES$/));

  const out2 = run(['TEAM_GET,sun.alpha', 'STATUS', '#WAIT 200'], nvs);  // "reset"
  check('saved value survives a reset', !!find(out2, /^TM,TEAM_PARAM,sun\.alpha,31\.5$/));
  check('ADCS_TUNE + TEAM_SAVE survives a reset', !!find(out2, /^TM,ADCS_MODE,MANUAL,.*KP,3\.500,KD,0\.800,MOMENTUM_BIAS,45,/));

  const out3 = run(['TEAM_DEFAULTS,YES', '#WAIT 10'], nvs);
  check('TEAM_DEFAULTS,YES', !!find(out3, /^ACK,TEAM_DEFAULTS$/));
  const out4 = run(['TEAM_GET,sun.alpha', 'TEAM_GET,adcs.kp', '#WAIT 10'], nvs);
  check('defaults also cleared the flash', !!find(out4, /^TM,TEAM_PARAM,sun\.alpha,30$/) && !!find(out4, /^TM,TEAM_PARAM,adcs\.kp,2$/));
  fs.rmSync(nvs, { force: true });
}

console.log('LUT upload');
{
  const nvs = tmpNvs();
  const v = Array.from({ length: 30 }, (_, i) => +(Math.sin(i / 5) * 0.8).toFixed(3));
  const sum = v.reduce((a, b) => a + b, 0);
  const out = run([
    'TEAM_LUT_DATA,0,1', 'TEAM_LUT_BEGIN,-15,1,30', `TEAM_LUT_DATA,0,${v.slice(0, 20).join(',')}`, 'TEAM_LUT_END',
    `TEAM_LUT_DATA,20,${v.slice(20).join(',')}`, 'TEAM_LUT_END', 'TEAM_SAVE', '#WAIT 10',
  ], nvs);
  check('DATA before BEGIN refused', !!find(out, /^ERR,TEAM_LUT_NOT_STARTED$/));
  check('incomplete LUT refused', !!find(out, /^ERR,TEAM_LUT_INCOMPLETE,10$/));
  check('LUT installed', !!find(out, /^ACK,TEAM_LUT_END,30$/));
  const info = find(out, /^TM,TEAM_LUT,N,30,/);
  check('LUT checksum', !!info && Math.abs(+kv(info).SUM - sum) < 1e-3, info || '');
  const out2 = run(['TEAM_LUT_INFO', '#WAIT 10'], nvs);
  const info2 = find(out2, /^TM,TEAM_LUT,N,30,/);
  check('LUT survives a reset', !!info2 && Math.abs(+kv(info2).SUM - sum) < 1e-3, info2 || '');
  fs.rmSync(nvs, { force: true });
}

// room light in the model's e-domain for the simulated LDRs: G^(1/gamma) = (rf/r10)^(1/gamma) * E/0.1,
// E_room = ambient 0.03 + dark 0.002 -> what the AMB step of the calibration measures on the real board
const AMB = Math.pow(10000 / 15000, 1 / 0.6) * 0.032 / 0.1;
const CAL = ['TEAM_SET,sun.model,1', `TEAM_SET,sun.aL,${AMB.toFixed(5)}`, `TEAM_SET,sun.aR,${AMB.toFixed(5)}`];

console.log('sun sensor (lamp at +20 deg)');
{
  const out = run(['#SET lamp 20', '#WAIT 300', 'TEAM_SUN', 'SUN_RAW', '#WAIT 20', 'TEAM_SET,sun.model,1', '#WAIT 100', 'TEAM_SUN', '#WAIT 20',
    ...CAL.slice(1), '#WAIT 100', 'TEAM_SUN', 'SUN_RAW', '#WAIT 20', '#STATE']);
  const t = all(out, /^TM,TEAM_T,/).map(kv);
  const sun = all(out, /^TM,SUN_L,/).map(kv);
  const st = states(out).pop();
  check('organizer model (90*NDV) is far off', Math.abs(+sun[0].SUN_ANGLE - st.sun) > 3, `SUN_ANGLE ${sun[0].SUN_ANGLE} vs truth ${st.sun.toFixed(2)}`);
  check('team model without room-light step: under 1 deg', Math.abs(+t[1].TH - st.sun) < 1, `TH ${t[1].TH}`);
  check('team model calibrated: within 0.15 deg', Math.abs(+t[2].TH - st.sun) < 0.15, `TH ${t[2].TH} vs ${st.sun.toFixed(2)}`);
  check('sun.model 1 -> SUN_ANGLE is the team angle', Math.abs(+sun[1].SUN_ANGLE - st.sun) < 0.15, `SUN_ANGLE ${sun[1].SUN_ANGLE}`);
  check('light usable, not clipped', t[2].LIT === '1' && t[2].SAT === '0');
  check('SUN_L/SUN_R stay ADC counts', +sun[0].SUN_L > 100 && +sun[0].SUN_L <= 4095);
  const neg = run(['#SET lamp -35', '#WAIT 300', ...CAL, '#WAIT 100', 'TEAM_SUN', '#WAIT 10', '#STATE']);
  const t2 = kv(find(neg, /^TM,TEAM_T,/));
  const st2 = states(neg).pop();
  check('negative side too', Math.abs(+t2.TH - st2.sun) < 0.15, `TH ${t2.TH} vs ${st2.sun.toFixed(2)}`);
}

console.log('flicker + clipping');
{
  const rms = (flicker) => {
    const f = run(['#SET lamp 10', `#SET flicker ${flicker}`, ...CAL, 'TEAM_STREAM,10', '#WAIT 3000', 'TEAM_STREAM,0', '#WAIT 10', '#STATE']);
    const ths = all(f, /^TM,TEAM_T,/).map(kv).map((o) => +o.TH).slice(5);
    const st = states(f).pop();
    return { n: ths.length + 5, e: Math.sqrt(ths.reduce((a, x) => a + (x - st.sun) ** 2, 0) / ths.length) };
  };
  const calm = rms(0), flick = rms(0.3);
  check('TEAM_STREAM,10 gives ~10 lines/s', calm.n >= 27 && calm.n <= 32, `${calm.n} lines in 3 s`);
  check('steady lamp: rms error < 0.15 deg', calm.e < 0.15, `${calm.e.toFixed(3)} deg`);
  check('30 % 100 Hz flicker adds < 0.15 deg (20 ms window)', flick.e - calm.e < 0.15, `${flick.e.toFixed(3)} vs ${calm.e.toFixed(3)} deg`);
  const c = run(['#SET lamp 0', '#SET lampK 40', '#WAIT 300', 'TEAM_SUN', '#WAIT 10']);
  const t = kv(find(c, /^TM,TEAM_T,/));
  check('clipped ADC flagged, light not usable', t.SAT === '1' && t.LIT === '0', JSON.stringify({ MVL: t.MVL, SAT: t.SAT }));
}

console.log('safety rules');
{
  const out = run(['ADCS_MODE,AUTO', '#WAIT 50', 'TEAM_SET,adcs.sign,-1', 'TEAM_SET,sun.model,1', 'TEAM_DEFAULTS,YES', 'TEAM_SET,adcs.kp,1.5', 'STOP', '#WAIT 50']);
  check('AUTO entered', !!find(out, /^ACK,ADCS_MODE,AUTO$/));
  check('sign change refused in AUTO', !!find(out, /^ERR,TEAM_REQUIRES_MANUAL,adcs\.sign$/));
  check('model change refused in AUTO', !!find(out, /^ERR,TEAM_REQUIRES_MANUAL,sun\.model$/));
  check('defaults refused in AUTO', !!find(out, /^ERR,TEAM_REQUIRES_MANUAL,TEAM_DEFAULTS$/));
  check('gain change allowed in AUTO', !!find(out, /^ACK,TEAM_SET,adcs\.kp,1\.5$/));
  check('STOP -> EVT,SAFE', !!find(out, /^ACK,STOP$/) && !!find(out, /^EVT,SAFE$/));
}

// Characterization, not pass/fail yet: how the organizer's PD law (wheel PWM = Kp*e - Kd*rate) behaves on two
// plausible platforms. Which one the real platform is like decides the F4 design (measure it: RW step + GYRO_Z).
console.log('closed loop, organizer law (REACTION, SUN, target 0, lamp at +30 deg) — characterization');
{
  const loop = (drag, rateSign, swap, sign) => {
    const out = run([`#SET drag ${drag}`, `#SET rateSign ${rateSign}`, `#SET swap ${swap}`, '#SET lamp 30', '#WAIT 300', ...CAL, `TEAM_SET,adcs.sign,${sign}`,
      'ADCS_STRATEGY,REACTION', 'ADCS_MODE,AUTO', ...Array.from({ length: 30 }, () => ['#WAIT 1000', '#STATE']).flat(), 'STOP', '#WAIT 100', '#STATE']);
    const s = states(out);
    return { end: s[s.length - 2], afterStop: s[s.length - 1], out };
  };
  // The organizer's estimator predicts angle += GYRO_Z*dt, so it needs d(SUN_ANGLE)/dt = +BODY_RATE.
  // In this world the sun angle falls when the body turns CCW, so the gyro sign must be -1 (or the LDR pins
  // swapped). The last row shows what an inconsistent sign does (W3 "ตรวจทิศ" must catch it).
  const rows = [
    ['low-friction bearing', 0.0, -1, 0, 1], ['bearing drag 0.15/s', 0.15, -1, 0, 1],
    ['LDR pins swapped, adcs.sign -1', 0.15, 1, 1, -1], ['LDR pins swapped, sign WRONG', 0.15, 1, 1, 1],
    ['gyro sign WRONG', 0.15, 1, 0, 1]];
  for (const [name, drag, rs, sw, sg] of rows) {
    const r = loop(drag, rs, sw, sg);
    const lost = name.includes('WRONG');
    console.log(`       ${name.padEnd(32)} error after 30 s ${r.end.sun.toFixed(2).padStart(7)} deg, wheel ${r.end.wheel.toFixed(0).padStart(6)} deg/s, cmd ${r.end.cmd.toFixed(0).padStart(4)} %`);
    if (!lost) check(`consistent signs reach the lamp (${name})`, Math.abs(r.end.sun) < 10);
    if (drag === 0.15 && rs === -1) check('STOP sets the wheel command to 0', r.afterStop.cmd === 0 && !!find(r.out, /^EVT,SAFE$/));
  }
}

console.log('tools/team_setup.txt (what team_setup.ps1 sends after an upload)');
{
  const lines = fs.readFileSync(path.join(__dirname, '..', 'tools', 'team_setup.txt'), 'utf8').split(/\r?\n/).map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean);
  const nvs = tmpNvs();
  const out = run(['PING', 'TEAM_INFO', 'STOP', ...lines, 'TEAM_SAVE', '#WAIT 20'], nvs);
  const acks = all(out, /^ACK,TEAM_SET,/);
  check(`every line accepted (${lines.length})`, acks.length === lines.length && !find(out, /^ERR,/), find(out, /^ERR,/) || '');
  const out2 = run(['TEAM_LIST', '#WAIT 50'], nvs);
  const has = (k, v) => !!find(out2, new RegExp(`^TM,TEAM_PARAM,${k.replace('.', '\\.')},${v}$`));
  const want = lines.map((l) => l.split(',')).map(([, k, v]) => [k, String(+v)]);
  const miss = want.filter(([k, v]) => !has(k, v));
  check('all of them survive a reset', miss.length === 0, miss.map((m) => m.join('=')).join(' '));
  fs.rmSync(nvs, { force: true });
}

console.log('RW_CMD (T02 assist, ported from the workshop firmware)');
{
  const out = run(['RW_CMD,+20,+80,300', 'ADCS_STRATEGY,MOMENTUM', 'RW_BIAS,40', '#WAIT 500', 'RW_CMD,+20,+80,300', '#WAIT 100', '#STATE',
    '#WAIT 400', '#STATE', 'RW_CMD,+70,+80,300', 'RW_CMD,1,2', 'RW_CMD,1,2,6000', 'STOP', '#WAIT 20']);
  const s = states(out);
  check('refused in REACTION', !!find(out, /^ERR,RW_CMD_REQUIRES_MOMENTUM_STRATEGY$/));
  check('ACK,RW_CMD,20,80,300', !!find(out, /^ACK,RW_CMD,20,80,300$/));
  check('assist drives 80 % first', s[0].cmd > 79 && s[0].cmd < 81, `cmd ${s[0].cmd}`);
  check('then bias 60 % + EVT,RW_MANEUVER_COMPLETE,60', s[1].cmd > 59 && s[1].cmd < 61 && !!find(out, /^EVT,RW_MANEUVER_COMPLETE,60$/), `cmd ${s[1].cmd}`);
  check('out of range / syntax / duration refused', !!find(out, /^ERR,RW_CMD_OUT_OF_RANGE$/) && all(out, /^ERR,RW_CMD_SYNTAX$/).length === 2);
}

console.log('wheel slew limit (rw.slew): RW,100 then RW,-100');
{
  const rev = (slew) => {
    const out = run([`TEAM_SET,rw.slew,${slew}`, 'RW,100', '#WAIT 2000', '#STATE', 'RW,-100', '#WAIT 50', '#STATE',
      ...Array.from({ length: 60 }, () => ['#WAIT 20', '#STATE']).flat(), 'STOP', '#WAIT 1', '#STATE']);
    const s = states(out);
    let acc = 0;
    for (let i = 2; i < s.length - 1; i++) acc = Math.max(acc, Math.abs(s[i].rate - s[i - 1].rate) / (s[i].t - s[i - 1].t));
    return { s, acc, out };
  };
  const a = rev(0), b = rev(500);
  check('slew 0 = organizer: -100 at once', a.s[1].cmd === -100);
  check('slew 500 %/s: 50 ms after RW,-100 the pins are near +75 %', Math.abs(b.s[1].cmd - 75) <= 2, `cmd ${b.s[1].cmd}`);
  check('slew 500: reaches -100 within 0.45 s', b.s[23].cmd === -100, `cmd ${b.s[23].cmd}`);
  check('STOP is applied at once even with a slew limit', b.s[b.s.length - 1].cmd === 0);
  check('peak body kick is smaller with the slew limit', b.acc < 0.8 * a.acc, `${b.acc.toFixed(0)} vs ${a.acc.toFixed(0)} deg/s^2`);
  check('RW_CMD telemetry still shows the request', !!find(b.out, /^TM,RW_CMD,-100,/));
}

// F4: organizer law vs + deadzone lift (adcs.dzc) vs + integral (adcs.ki). Lamp at +30 deg, target 0, 30 s, REACTION.
console.log('closed loop F4 (REACTION, drag 0.15/s, lamp +30 deg, 30 s)');
{
  const loop = (stick, extra) => {
    const out = run(['#SET drag 0.15', '#SET rateSign -1', `#SET stick ${stick}`, '#SET lamp 30', '#WAIT 300', ...CAL, ...extra,
      'ADCS_STRATEGY,REACTION', 'ADCS_MODE,AUTO', ...Array.from({ length: 150 }, () => ['#WAIT 200', '#STATE']).flat(), 'STOP', '#WAIT 10']);
    const s = states(out);
    const end = s[s.length - 1];
    const tail = s.slice(-25);  // last 5 s
    const over = Math.max(0, ...s.map((x) => -x.sun));  // went past the target (sun angle < 0)
    const t1 = s.find((x) => Math.abs(x.sun) < 1);
    return { end: end.sun, wob: Math.max(...tail.map((x) => Math.abs(x.sun))), over, t1: t1 ? t1.t : NaN };
  };
  const res = {};
  for (const stick of [0, 20]) {
    for (const [name, extra] of [['organizer PD', []], ['+ dzc', ['TEAM_SET,adcs.dzc,1', 'TEAM_SET,rw.minStart,10', 'TEAM_SET,rw.minStable,5']],
      ['+ ki 0.5', ['TEAM_SET,adcs.ki,0.5']], ['+ ki 0.5 + dzc', ['TEAM_SET,adcs.ki,0.5', 'TEAM_SET,adcs.dzc,1', 'TEAM_SET,rw.minStart,10', 'TEAM_SET,rw.minStable,5']]]) {
      const r = loop(stick, extra);
      res[`${stick}/${name}`] = r;
      console.log(`       stick ${String(stick).padStart(2)}  ${name.padEnd(16)} end ${r.end.toFixed(2).padStart(6)} deg, worst last 5 s ${r.wob.toFixed(2).padStart(5)}, overshoot ${r.over.toFixed(2).padStart(5)}, |e|<1 at ${isNaN(r.t1) ? '  never' : r.t1.toFixed(1).padStart(5) + ' s'}`);
    }
  }
  check('integral term ends inside the 2 deg deadband, organizer PD does not (stick 0)', res['0/+ ki 0.5'].wob <= 2 && res['0/organizer PD'].wob > 3);
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exitCode = fails ? 1 : 0;
