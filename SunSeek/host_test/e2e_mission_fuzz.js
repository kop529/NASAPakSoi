// team-7 mission fuzz: random missions on random rigs, with camera trouble, gyro bias and STOP / ABORT / a new PREPARE in the
// middle, through the GS Competition lines (#BLEW, mis.on 1) or TEAM_MIS_GO. Invariants that must hold in every run:
// no unexpected ERR, only GS state names, it ends (COMPLETE, or ABORTED + wheel 0 after STOP / ABORT), every photo taken
// within tol + 1 deg of the target (true angle), the body stays at the last target after COMPLETE, no wild spin, result
// lines in order and spaced, TIMER,STOP once per started mission. Photo / stay accuracy is checked for |target| <= 40 deg, where
// the simulated sun sensor is accurate; beyond, the sim sensor over-reads (50 -> 56) and sticks at 60, the angle is carried by
// the gyro (mis.trust 45) and drifts with the gyro bias (still on the wheel limit on sticky rigs) -> reported, not checked.
// On the board: TEAM_GYRO_ZERO right before the mission; set mis.trust to the range the calibration shows accurate.
// MFUZZ_N runs (default 24), MFUZZ_SEED first seed (default 1). Part of e2e.js (required at its end).
'use strict';

module.exports = ({ run, check, all, states, CAL }) => {
  const N = +(process.env.MFUZZ_N || 24), SEED = +(process.env.MFUZZ_SEED || 1);
  const BOARD = ['TEAM_SET,rw.minStart,10', 'TEAM_SET,rw.minStable,5', 'TEAM_SET,rw.slew,500', 'TEAM_SET,adcs.kp,4', 'TEAM_SET,adcs.kd,2',
    'TEAM_SET,adcs.ki,1', 'TEAM_SET,adcs.db,0.5', 'TEAM_SET,adcs.kick,20', 'TEAM_SET,adcs.max,60', 'TEAM_SET,adcs.lock,1.5', 'TEAM_SET,adcs.unlock,3',
    // MFUZZ_SET="k=v;k=v": extra TEAM_SET values after the board ones (e.g. adcs.lock=1, the value saved on the board 7 Oct night)
    ...(process.env.MFUZZ_SET || '').split(';').filter(Boolean).map((kv) => 'TEAM_SET,' + kv.replace('=', ','))];
  const RIGS = [['#SET drag 0.05'], ['#SET drag 0.15'], ['#SET drag 0.05', '#SET stick 10'], ['#SET drag 0.05', '#SET stick 5', '#SET ratio 0.02', '#SET wheelTau 2.5']];
  const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const STATE_NAMES = /^MISSION,STATE,(IDLE|READY|ACQUIRING|STABILIZING|CAPTURING|COMPLETE|ABORTED|FAILED)$/;

  const gsBurst = (T, transfer) => ['ADCS_MODE,MANUAL', 'ADCS_REFERENCE,SUN', 'ADCS_STRATEGY,REACTION', 'ADCS_TUNE,4.000,2.000,40',
    'MISSION_NAME,FUZZ', `MISSION_TRANSFER,${transfer}`, 'MISSION_TIME_LIMIT,300', 'MISSION_CLEAR_TARGETS',
    ...T.map((t, i) => `MISSION_TARGET,${i + 1},${t.deg.toFixed(1)},${t.tol.toFixed(1)},${t.hold.toFixed(1)}`),
    `SET_TARGET,${T[0].deg.toFixed(1)}`, 'PREPARE'].map((l) => `#BLEW ${l}`);

  const scenario = (seed) => {
    const r = rng(seed);
    const pick = (a) => a[Math.floor(r() * a.length)];
    const gs = r() < 0.5;
    const n = 1 + Math.floor(r() * 4);
    const tol = pick([2, 3, 3, 5]), hold = pick([0.5, 1, 2, 3]);
    const T = Array.from({ length: n }, () => ({ deg: Math.round((-85 + r() * 170) * 10) / 10, tol: gs ? pick([2, 3, 3, 5]) : tol, hold: gs ? pick([0.5, 1, 2, 3]) : hold }));
    const transfer = gs && r() < 0.3 ? 'AFTER' : 'EACH';
    const cam = { ms: Math.round(300 + r() * 2500), fail: r() < 0.3 ? 1 + Math.floor(r() * 3) : 0, dead: r() < 0.08 ? 1 : 0 };
    const bias = r() < 0.5 ? Math.round((r() - 0.5) * 30) / 100 : 0;  // deg/s, the rig showed ~0.1
    const u = r();
    const cut = u < 0.12 ? 'STOP' : u < 0.2 && gs ? 'ABORT' : u < 0.26 && gs ? 'PREPARE' : '';
    const cutAt = 1 + Math.floor(r() * 12);  // s after START
    const rig = pick(RIGS), body = Math.round(-40 + r() * 80);
    const secs = Math.min(320, 10 + n * 70);  // plan B: a target takes <= skipS 45 + the camera tries
    const ticks = (s) => Array.from({ length: s * 10 }, () => ['#WAIT 100', '#STATE']).flat();
    const lines = [...rig, '#SET rateSign -1', '#SET lamp 0', `#SET body ${body}`, `#SET gyroBias ${bias}`,
      `#SET camMs ${cam.ms}`, `#SET camFail ${cam.fail}`, `#SET camDead ${cam.dead}`, '#WAIT 300', ...CAL, ...BOARD,
      'TEAM_SET,mis.capMs,4000', '#STATE'];
    if (gs) lines.push('TEAM_SET,mis.on,1', '#BLE 1', ...gsBurst(T, transfer), '#WAIT 300', '#BLEW START_MISSION');
    else lines.push(`TEAM_SET,mis.tol,${tol}`, `TEAM_SET,mis.hold,${hold}`, `TEAM_MIS_GO,${T.map((t) => t.deg).join(',')}`);
    if (cut) {
      lines.push(...ticks(cutAt));
      if (cut === 'STOP') lines.push(gs ? '#BLEW STOP' : 'STOP');
      else if (cut === 'ABORT') lines.push('#BLEW ABORT');
      else lines.push(...gsBurst([{ deg: 0, tol: 3, hold: 1 }], 'EACH'));
      lines.push(...ticks(3));
    } else lines.push(...ticks(secs));
    lines.push('STOP', '#WAIT 20');
    return { seed, gs, T, transfer, cam, bias, cut, rig: RIGS.indexOf(rig), body, lines };
  };

  // time of every output line = the next #STATE after it
  const timed = (out) => {
    const res = []; let pend = [];
    for (const l of out) {
      if (l.startsWith('#STATE ')) { const t = +l.match(/t=([\d.]+)/)[1]; pend.forEach((p) => res.push({ l: p, t })); pend = []; res.push({ l, t }); }
      else pend.push(l);
    }
    return res;
  };

  const bad = {};  // invariant -> failing seeds
  const fail = (k, s, why) => { (bad[k] = bad[k] || []).push(`${s.seed}${why ? ` (${why})` : ''}`); };
  let worst = 0, photos = 0, completes = 0;
  const farErr = [];
  console.log(`team-7 mission fuzz: ${N} random missions (seeds ${SEED}..${SEED + N - 1})`);
  for (let k = 0; k < N; k++) {
    const s = scenario(SEED + k);
    const out = run(s.lines);
    const tl = timed(out);
    const st = tl.filter((x) => x.l.startsWith('#STATE ')).map((x) => ({ t: x.t, ...states([x.l])[0] }));
    const sAt = (t) => st.find((x) => x.t >= t) || st[st.length - 1];
    const lastTick = st[st.length - 1];

    const errs = all(out, /^ERR,/).filter((l) => !/^ERR,(RX_|PAYLOAD)/.test(l));
    if (errs.length) fail('no unexpected ERR', s, errs[0]);
    const names = all(out, /^MISSION,STATE,/).filter((l) => !STATE_NAMES.test(l));
    if (names.length) fail('only GS state names', s, names[0]);

    const done = tl.find((x) => x.l === 'MISSION,STATE,COMPLETE'), aborted = tl.find((x) => x.l === 'MISSION,STATE,ABORTED');
    if (!s.cut && !done) fail('ends COMPLETE when nothing interrupts it', s, `last state ${(all(out, /^MISSION,STATE,/).pop() || '-')}`);
    if (done) {  // plan B: every target ends with an image, CAPTURE_FAILED or SKIP
      const ended = new Set(all(out, /^EVT,TEAM_MIS,(IMAGE|CAPTURE_FAILED|SKIP),/).map((l) => +l.split(',')[3]));
      if (s.T.some((_, i) => !ended.has(i + 1))) fail('every target ends: image, CAPTURE_FAILED or SKIP', s, [...ended].join(' '));
    }
    if (done) completes++;
    if (s.cut && !done) {
      if (!aborted) fail(`${s.cut} mid-mission -> ABORTED`, s);
      const after = st.filter((x) => aborted && x.t >= aborted.t + 0.1);
      if (s.cut !== 'PREPARE' && after.length && after[0].cmd !== 0) fail('wheel 0 after STOP / ABORT', s, `cmd ${after[0].cmd}`);
      if (s.cut === 'PREPARE' && all(out, /^MISSION,READY$/).length !== 2) fail('a new PREPARE mid-mission -> READY again', s);
    }

    // every photo: true angle within tol + 1 of the target at the shutter
    const caps = tl.filter((x) => /^EVT,TEAM_MIS,CAPTURE,/.test(x.l));
    for (const c of caps) {
      const i = +c.l.split(',')[3] - 1, t = s.T[i];
      const e = Math.abs(sAt(c.t).sun - t.deg);
      if (Math.abs(t.deg) > 40) { farErr.push(e); continue; }
      worst = Math.max(worst, e);
      if (e > t.tol + 1) fail('photo within tol + 1 deg (true angle)', s, `target ${i + 1} ${t.deg}: off ${e.toFixed(2)}`);
    }
    photos += all(out, /^EVT,TEAM_MIS,IMAGE,/).length;

    // after COMPLETE the body stays at the last target (still AUTO) until the end of the run
    // (only when the last target was photographed: a skipped one may still be on the way)
    if (done && Math.abs(s.T[s.T.length - 1].deg) <= 40 && !!out.find((l) => l.startsWith(`EVT,TEAM_MIS,IMAGE,${s.T.length},`))) {
      const last = s.T[s.T.length - 1];
      // until it leaves AUTO (a STOP / ABORT injected after COMPLETE stops the wheel: the body then drifts, as it should)
      const off = tl.find((x) => x.t >= done.t && /^EVT,TEAM_AUTO,OFF/.test(x.l));  // team-9 mis.endStop 1: right at COMPLETE
      const over = st.filter((x) => x.t >= done.t + 1 && (!off || x.t < off.t)).map((x) => Math.abs(x.sun - last.deg));
      const m = over.length ? Math.max(...over) : 0;
      if (m > last.tol + 2) fail('stays at the last target after COMPLETE', s, `off up to ${m.toFixed(1)} deg`);
    }
    const spin = st.find((x) => Math.abs(x.rate) > 200);
    if (spin) fail('no wild spin (|rate| <= 200 deg/s)', s, `${spin.rate.toFixed(0)} at ${spin.t.toFixed(1)} s`);

    // result lines: indices increasing, a name per image, spaced (the GS reads the name back 300 ms later)
    const res = tl.filter((x) => /^MISSION,RESULT,IMAGE,/.test(x.l));
    const idx = res.map((x) => +x.l.split(',')[3]);
    if (idx.some((v, j) => j && v <= idx[j - 1])) fail('result lines in target order', s, idx.join(' '));
    if (res.some((x, j) => j && x.t - res[j - 1].t < 2.4)) fail('result lines >= 2.4 s apart', s);
    if (done && !s.cut && res.length !== all(out, /^EVT,TEAM_MIS,IMAGE,/).length) fail('one result line per image', s, `${res.length} vs ${all(out, /^EVT,TEAM_MIS,IMAGE,/).length}`);
    if (s.transfer === 'AFTER' && done && res.some((x) => x.t < done.t)) fail('AFTER: results only after COMPLETE', s);

    // team-9 (mis.endStop 1, organizer v3.0.6+ / T07 C7): COMPLETE leaves the wheel stopped until a new mission starts
    if (done) {
      const again = tl.find((x) => x.t > done.t && x.l === 'MISSION,TIMER,START');
      const aft = st.filter((x) => x.t >= done.t + 0.2 && (!again || x.t < again.t));
      if (aft.some((x) => x.cmd !== 0) || !out.includes('EVT,TEAM_MIS,SAFE_STOP')) fail('COMPLETE -> safe stop (MANUAL, wheel 0)', s, `cmd ${aft.map((x) => x.cmd).filter((c) => c).slice(0, 3).join(' ')}`);
    }
    const starts = all(out, /^MISSION,TIMER,START$/).length, stops = all(out, /^MISSION,TIMER,STOP,[1-9]\d*$/).length;
    if (starts !== stops) fail('TIMER,STOP once per started mission', s, `${starts} START / ${stops} STOP`);
    if (lastTick && process.env.MFUZZ_VERBOSE)
      console.log(`       seed ${s.seed} ${s.gs ? 'GS' : 'GO'} T ${s.T.map((t) => t.deg).join('/')} cam ${s.cam.ms}/${s.cam.fail}/${s.cam.dead} bias ${s.bias} rig ${s.rig} cut ${s.cut || '-'} -> ${done ? 'COMPLETE' : aborted ? 'ABORTED' : '?'} caps ${caps.length}`);
  }
  const fs2 = farErr.slice().sort((a, b) => a - b), q = (p) => (fs2.length ? fs2[Math.min(fs2.length - 1, Math.floor(p * fs2.length))].toFixed(1) : '-');
  console.log(`       ${completes} complete, ${photos} photos; |target| <= 40: worst photo error ${worst.toFixed(2)} deg; |target| > 40 (gyro, not checked): ${fs2.length} shots, error median ${q(0.5)} / 90% ${q(0.9)} / max ${q(1)} deg`);
  const keys = ['no unexpected ERR', 'only GS state names', 'ends COMPLETE when nothing interrupts it', 'STOP mid-mission -> ABORTED', 'ABORT mid-mission -> ABORTED',
    'PREPARE mid-mission -> ABORTED', 'wheel 0 after STOP / ABORT', 'a new PREPARE mid-mission -> READY again', 'photo within tol + 1 deg (true angle)',
    'stays at the last target after COMPLETE', 'COMPLETE -> safe stop (MANUAL, wheel 0)', 'every target ends: image, CAPTURE_FAILED or SKIP', 'no wild spin (|rate| <= 200 deg/s)', 'result lines in target order', 'result lines >= 2.4 s apart',
    'one result line per image', 'AFTER: results only after COMPLETE', 'TIMER,STOP once per started mission'];
  for (const k of keys) check(`mission fuzz: ${k}`, !bad[k], bad[k] ? `seeds ${bad[k].slice(0, 4).join(', ')}${bad[k].length > 4 ? ` +${bad[k].length - 4}` : ''}` : '');
};
