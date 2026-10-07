// team-6: mission 2 (imaging) for the GS Competition tab (Team_Mission.h). The GS lines below are the exact ones the
// GS v1.10.4 sends / reads (decoded 7 Oct). The sim camera answers CAPTURE (#SET camMs / camFail / camDead).
// Part of e2e.js (required at its end).
'use strict';

module.exports = ({ run, check, find, all, states, CAL }) => {
  const BOARD = ['TEAM_SET,rw.minStart,10', 'TEAM_SET,rw.minStable,5', 'TEAM_SET,rw.slew,500', 'TEAM_SET,adcs.kp,4', 'TEAM_SET,adcs.kd,2',
    'TEAM_SET,adcs.ki,1', 'TEAM_SET,adcs.db,0.5', 'TEAM_SET,adcs.kick,20', 'TEAM_SET,adcs.max,60', 'TEAM_SET,adcs.lock,1.5', 'TEAM_SET,adcs.unlock,3'];
  const RIG = ['#SET drag 0.05', '#SET rateSign -1', '#SET lamp 0', '#SET body 0', '#WAIT 300', ...CAL, ...BOARD];
  const gsPrepare = (targets, transfer = 'EACH') => ['ADCS_MODE,MANUAL', 'ADCS_REFERENCE,SUN', 'ADCS_STRATEGY,REACTION', 'ADCS_TUNE,4.000,2.000,40',
    'MISSION_NAME,NASA_TEST', `MISSION_TRANSFER,${transfer}`, 'MISSION_TIME_LIMIT,300', 'MISSION_CLEAR_TARGETS',
    ...targets.map(([a, tol, hold], i) => `MISSION_TARGET,${i + 1},${a.toFixed(1)},${tol.toFixed(1)},${hold.toFixed(1)}`),
    `SET_TARGET,${targets[0][0].toFixed(1)}`, 'PREPARE'].map((l) => `#BLEW ${l}`);
  const ticks = (s, ms = 100) => Array.from({ length: Math.round(s * 1000 / ms) }, () => [`#WAIT ${ms}`, '#STATE']).flat();
  // time of every output line = the next #STATE after it (lines come out during the #WAIT before it)
  const timed = (out) => {
    const res = []; let pend = [];
    for (const l of out) {
      if (l.startsWith('#STATE ')) { const t = +l.match(/t=([\d.]+)/)[1]; pend.forEach((p) => res.push({ l: p, t })); pend = []; res.push({ l, t }); }
      else pend.push(l);
    }
    return res;
  };
  const errs = (out) => all(out, /^ERR,/).filter((l) => !/^ERR,(RX_|PAYLOAD)/.test(l));

  console.log('team-6: mission commands stay with the organizer when mis.on 0 (default)');
  {
    const out = run(['PREPARE', 'START_MISSION', 'ABORT', '#WAIT 20']);
    check('mis.on 0: PREPARE / START_MISSION / ABORT -> ERR,MISSION_NOT_AVAILABLE_T04 as in v3.0', all(out, /^ERR,MISSION_NOT_AVAILABLE_T04$/).length === 3);
  }

  console.log('team-6: GS Competition PREPARE -> START, 3 targets (EACH)');
  {
    const T = [[20, 3, 2], [-30, 3, 2], [0, 3, 1]];
    const out = run([...RIG, 'TEAM_SET,mis.on,1', '#BLE 1', ...gsPrepare(T), '#WAIT 300', '#BLEW START_MISSION', ...ticks(45), 'STOP', '#WAIT 20']);
    const tl = timed(out);
    const st = all(out, /^MISSION,STATE,/);
    check('PREPARE burst: every MISSION_* ACKed, MISSION,READY, no ERR', !!find(out, /^ACK,MISSION_TARGET,3$/) && !!find(out, /^MISSION,READY$/) &&
      !!find(out, /^ACK,PREPARE$/) && errs(out).length === 0, errs(out).join(' | '));
    check('MISSION,STATE lines carry only the state name the GS knows', st.every((l) => /^MISSION,STATE,(IDLE|READY|ACQUIRING|STABILIZING|CAPTURING|COMPLETE|ABORTED|FAILED)$/.test(l)), st.join(' '));
    const caps = tl.filter((x) => x.l === '#PAYLOAD_TX CAPTURE');
    const sAt = (t) => states(tl.filter((x) => x.l.startsWith('#STATE ') && x.t >= t).slice(0, 1).map((x) => x.l))[0];
    const at = caps.map((c, i) => ({ t: c.t, sun: sAt(c.t).sun, want: T[i] ? T[i][0] : NaN }));
    console.log(`       captures: ${at.map((a) => `${a.t.toFixed(1)}s sun ${a.sun.toFixed(2)} (target ${a.want})`).join(' | ')}`);
    check('one CAPTURE per target, each while the body is within tolerance of that target', caps.length === 3 && at.every((a) => Math.abs(a.sun - a.want) <= 3.2));
    const ce = all(out, /^EVT,TEAM_MIS,CAPTURE,/).map((l) => +l.split(',')[6]);
    check('team-7: CAPTURE waits until |error| <= mis.capErr 1.5 (team-6 shot at 2.9 deg, the tolerance edge)', ce.length === 3 && ce.every((e) => Math.abs(e) <= 1.5), ce.join(' '));
    const res = tl.filter((x) => /^MISSION,RESULT,IMAGE,/.test(x.l));
    check('MISSION,RESULT,IMAGE,<i>,<name> for targets 1..3 in order', res.map((x) => x.l).join(' ') ===
      'MISSION,RESULT,IMAGE,1,/IMG_0001.JPG MISSION,RESULT,IMAGE,2,/IMG_0002.JPG MISSION,RESULT,IMAGE,3,/IMG_0003.JPG', res.map((x) => x.l).join(' '));
    const gaps = res.slice(1).map((x, i) => x.t - res[i].t);
    check('result lines at least 2.4 s apart (the GS fetch reads the name 300 ms later)', gaps.every((g) => g >= 2.4), gaps.map((g) => g.toFixed(1)).join(' '));
    const done = tl.find((x) => x.l === 'MISSION,STATE,COMPLETE'), start = tl.find((x) => x.l === 'MISSION,TIMER,START');
    const stop = find(out, /^MISSION,TIMER,STOP,\d+$/);
    console.log(`       complete at ${done ? (done.t - start.t).toFixed(1) : '-'} s after START, ${stop}`);
    check('MISSION,TIMER,START ... MISSION,TIMER,STOP,<ms> + COMPLETE', !!start && !!done && !!stop);
    check('the hold is counted: no CAPTURE earlier than hold s after STABILIZING', (() => {
      const stab = tl.filter((x) => x.l === 'MISSION,STATE,STABILIZING');
      return caps.every((c, i) => { const s = stab.filter((x) => x.t <= c.t).pop(); return s && c.t - s.t >= T[i][2] - 0.25; });
    })());
  }

  console.log('team-7: never close enough -> CAPTURE anyway mis.waitMs after the hold');
  {
    const out = run([...RIG, 'TEAM_SET,mis.capErr,0.01', 'TEAM_SET,mis.waitMs,3000', 'TEAM_MIS_GO,15', ...ticks(15), 'STOP', '#WAIT 20']);
    const tl = timed(out);
    const stab = tl.find((x) => x.l === 'MISSION,STATE,STABILIZING'), cap = tl.find((x) => x.l === '#PAYLOAD_TX CAPTURE');
    check('capErr 0.01: CAPTURE comes >= hold 2 s + wait 3 s after STABILIZING, and the mission completes', !!stab && !!cap && cap.t - stab.t >= 4.75 &&
      !!find(out, /^MISSION,STATE,COMPLETE$/), stab && cap ? (cap.t - stab.t).toFixed(1) + ' s' : '');
  }

  console.log('team-7: adcs.keepTune, boot reason, cam.off with the mission');
  {
    const out = run(['TEAM_SET,adcs.kp,4', 'ADCS_TUNE,1.000,0.500,40', 'TEAM_GET,adcs.kp', '#WAIT 10',
      'TEAM_SET,adcs.kp,4', 'TEAM_SET,adcs.kd,2', 'TEAM_SET,adcs.keepTune,1', 'ADCS_TUNE,1.000,0.500,40', 'TEAM_GET,adcs.kp', 'TEAM_GET,adcs.kd', '#WAIT 10']);
    const kp = all(out, /^TM,TEAM_PARAM,adcs.kp,/).map((l) => +l.split(',')[3]);
    check('keepTune 0: ADCS_TUNE from the GS replaces kp (organizer); keepTune 1: kp/kd stay 4/2, ACK carries ours + EVT IGNORED',
      kp[0] === 1 && kp[1] === 4 && !!find(out, /^TM,TEAM_PARAM,adcs.kd,2/) && !!find(out, /^ACK,ADCS_TUNE,4.000,2.000,/) &&
      !!find(out, /^EVT,TEAM_KEEP_TUNE,IGNORED,1.000,0.500,40$/), kp.join(' '));
    check('boot prints EVT,TEAM_BOOT,REASON (HOST in the sim)', !!find(out, /^EVT,TEAM_BOOT,REASON,HOST$/));
    const cam = run([...RIG, 'TEAM_SET,cam.off,10', 'TEAM_MIS_GO,0', ...ticks(10), 'STOP', '#WAIT 20']);
    const tl = timed(cam);
    const c = tl.find((x) => x.l === '#PAYLOAD_TX CAPTURE');
    const s0 = c && states(tl.filter((x) => x.l.startsWith('#STATE ') && x.t >= c.t).slice(0, 1).map((x) => x.l))[0];
    check('cam.off 10: the mission target 0 is shot with the sun sensor at ~10 deg (target + cam.off)', !!s0 && Math.abs(s0.sun - 10) <= 1.6 &&
      !!find(cam, /^MISSION,STATE,COMPLETE$/), s0 ? 'sun ' + s0.sun.toFixed(2) : '');
  }

  console.log('team-7: a target past the sun sensor (85 deg) with the board setting adcs.ghold 0');
  {
    const far = (extra) => run([...RIG, ...extra, 'TEAM_MIS_GO,85', ...ticks(25), 'STOP', '#WAIT 20']);
    const on = far([]);
    const tl = timed(on);
    const cap = tl.find((x) => x.l === '#PAYLOAD_TX CAPTURE');
    const c = cap && states(tl.filter((x) => x.l.startsWith('#STATE ') && x.t >= cap.t).slice(0, 1).map((x) => x.l))[0];
    const end = states(on).slice(-1)[0];
    check('mis.ghold 1 (default): captured within 3 deg of 85 and still there 25 s after START', !!c && Math.abs(c.sun - 85) <= 3 &&
      !!find(on, /^MISSION,STATE,COMPLETE$/) && Math.abs(end.sun - 85) <= 3, c ? `at capture ${c.sun.toFixed(2)}, end ${end.sun.toFixed(2)}` : 'no capture');
    check('PREPARE flags it: EVT,TEAM_MIS,FAR_TARGET,1,85.0 and MISSION,PREP ... far 1 gyro',
      !!find(on, /^EVT,TEAM_MIS,FAR_TARGET,1,85.0$/) && !!find(on, /^MISSION,PREP,1 targets SUN EACH cam (OK SD OK|NO STATUS|NO REPLY) far 1 gyro$/), find(on, /^MISSION,PREP,/));
    const off = far(['TEAM_SET,mis.ghold,0']);
    check('mis.ghold 0 + adcs.ghold 0: MISSION,PREP warns NO GYRO HOLD', !!find(off, /^MISSION,PREP,.* far 1 NO GYRO HOLD$/),
      `(sim body at the end ${states(off).slice(-1)[0].sun.toFixed(1)} deg)`);
  }

  console.log('team-7 plan B: a target never stalls the mission (rescue shot, skip, GS time limit share)');
  {
    const tlOf = (out) => timed(out);
    const r = run([...RIG, 'TEAM_SET,mis.hold,30', 'TEAM_SET,mis.targetS,5', 'TEAM_SET,mis.skipS,20', 'TEAM_MIS_GO,10', ...ticks(12), 'STOP', '#WAIT 20']);
    const tl = tlOf(r);
    const st = tl.find((x) => x.l === 'MISSION,TIMER,START'), cap = tl.find((x) => x.l === '#PAYLOAD_TX CAPTURE');
    check('hold 30 s can never finish in time -> EVT,TEAM_MIS,RESCUE at 5 s, CAPTURE inside the tolerance, image, COMPLETE',
      !!find(r, /^EVT,TEAM_MIS,RESCUE,1,/) && !!cap && cap.t - st.t >= 4.9 && cap.t - st.t < 8 && !!find(r, /^EVT,TEAM_MIS,IMAGE,1,/) &&
      !!find(r, /^MISSION,STATE,COMPLETE$/) && Math.abs(+find(r, /^EVT,TEAM_MIS,CAPTURE,/).split(',')[6]) <= 3, cap ? `capture ${(cap.t - st.t).toFixed(1)} s` : 'no capture');
    const k = run([...RIG, '#SET stick 1000000', 'TEAM_SET,mis.targetS,3', 'TEAM_SET,mis.skipS,6', 'TEAM_MIS_GO,30,0', ...ticks(14), 'STOP', '#WAIT 20']);
    check('body cannot move: target 1 rescued at 3 s (never inside), SKIP at 6 s, target 2 photographed, COMPLETE',
      !!find(k, /^EVT,TEAM_MIS,RESCUE,1,/) && !!find(k, /^EVT,TEAM_MIS,SKIP,1,/) && !find(k, /^EVT,TEAM_MIS,IMAGE,1,/) &&
      !!find(k, /^EVT,TEAM_MIS,IMAGE,2,/) && !!find(k, /^MISSION,STATE,COMPLETE$/), all(k, /^EVT,TEAM_MIS,(RESCUE|SKIP|IMAGE)/).join(' | '));
    const g = run(['TEAM_SET,mis.on,1', 'ADCS_REFERENCE,SUN', 'MISSION_CLEAR_TARGETS', 'MISSION_TIME_LIMIT,30', 'MISSION_TARGET,1,0,3,2', 'MISSION_TARGET,2,10,3,2',
      'MISSION_TARGET,3,-10,3,2', 'PREPARE', 'START_MISSION', '#WAIT 50', 'STOP', '#WAIT 20']);
    check('GS time limit 30 s, 3 targets -> each target gets 10 s (SKIP_S 10, RESCUE_S 7)', !!find(g, /^EVT,TEAM_MIS,TARGET,1,3,.*,RESCUE_S,7,SKIP_S,10$/), find(g, /^EVT,TEAM_MIS,TARGET,1,/));
  }

  console.log('team-6: camera trouble and the way out');
  {
    const out = run([...RIG, '#SET camFail 2', 'TEAM_SET,mis.capMs,1500', 'TEAM_MIS_GO,15', ...ticks(15), 'TEAM_MIS_STATUS', '#WAIT 20', 'STOP', '#WAIT 20']);
    check('ERR,CAPTURE_FAILED twice -> CAPTURE again, 3rd try gives the image (TEAM_MIS_GO without mis.on)',
      all(out, /^#PAYLOAD_TX CAPTURE$/).length === 3 && !!find(out, /^MISSION,RESULT,IMAGE,1,\/IMG_0001\.JPG$/) && !!find(out, /^MISSION,STATE,COMPLETE$/) &&
      !!find(out, /^TM,MISSION_STATE,COMPLETE,.*MISSION_TIME_MS,[1-9]\d*,.*IMG1,\/IMG_0001\.JPG$/), find(out, /^TM,MISSION_STATE/));
    const dead = run([...RIG, '#SET camDead 1', 'TEAM_SET,mis.capMs,1500', 'TEAM_MIS_GO,10,-10', ...ticks(25), 'TEAM_MIS_STATUS', '#WAIT 20', 'STOP', '#WAIT 20']);
    check('camera silent: 3 tries per target, CAPTURE_FAILED, still moves on and completes', all(dead, /^EVT,TEAM_MIS,CAPTURE_FAILED,[12]$/).length === 2 &&
      all(dead, /^#PAYLOAD_TX CAPTURE$/).length === 6 && !!find(dead, /^MISSION,STATE,COMPLETE$/) && !find(dead, /^MISSION,RESULT,IMAGE/), find(dead, /^TM,MISSION_STATE/));
  }

  console.log('team-6: STOP / ABORT / a new PREPARE always win');
  {
    const stop = run([...RIG, 'TEAM_SET,mis.on,1', '#BLE 1', ...gsPrepare([[30, 3, 2], [-30, 3, 2]]), '#WAIT 300', '#BLEW START_MISSION', '#WAIT 1500', '#STATE',
      '#BLEW STOP', '#WAIT 300', '#STATE']);
    const s = states(stop);
    check('STOP mid-turn -> MISSION,STATE,ABORTED + TIMER,STOP, wheel 0', s[0].cmd !== 0 && s[1].cmd === 0 && !!find(stop, /^MISSION,STATE,ABORTED$/) && !!find(stop, /^MISSION,TIMER,STOP,\d+$/));
    const ab = run([...RIG, 'TEAM_SET,mis.on,1', '#BLE 1', ...gsPrepare([[30, 3, 2]]), '#WAIT 300', '#BLEW START_MISSION', '#WAIT 1500', '#STATE',
      '#BLEW ABORT', '#WAIT 300', '#STATE']);
    const a = states(ab);
    check('GS ABORT -> ACK,ABORT, ABORTED, wheel 0', a[0].cmd !== 0 && a[1].cmd === 0 && !!find(ab, /^ACK,ABORT$/) && !!find(ab, /^MISSION,STATE,ABORTED$/));
    const re = run([...RIG, 'TEAM_SET,mis.on,1', '#BLE 1', ...gsPrepare([[30, 3, 2]]), '#WAIT 300', '#BLEW START_MISSION', '#WAIT 1500',
      ...gsPrepare([[-20, 3, 2]]), '#WAIT 300']);
    check('a new GS PREPARE burst during a mission: old one ABORTED, new one READY, no MISSION_BUSY', !!find(re, /^MISSION,STATE,ABORTED$/) &&
      all(re, /^MISSION,READY$/).length === 2 && !find(re, /^ERR,MISSION_BUSY/), errs(re).join(' | '));
  }

  console.log('team-6: AFTER = all images once the mission is complete; bad input');
  {
    const out = run([...RIG, 'TEAM_SET,mis.on,1', '#BLE 1', ...gsPrepare([[10, 3, 1], [-10, 3, 1]], 'AFTER'), '#WAIT 300', '#BLEW START_MISSION', ...ticks(30), 'STOP', '#WAIT 20']);
    const tl = timed(out);
    const done = tl.find((x) => x.l === 'MISSION,STATE,COMPLETE');
    const res = tl.filter((x) => /^MISSION,RESULT,IMAGE,/.test(x.l));
    check('AFTER: both result lines come after COMPLETE, 2.4 s apart', !!done && res.length === 2 && res.every((x) => x.t >= done.t) && res[1].t - res[0].t >= 2.4,
      res.map((x) => `${x.l}@${x.t.toFixed(1)}`).join(' '));
    const bad = run(['TEAM_SET,mis.on,1', 'ADCS_REFERENCE,SUN', 'MISSION_CLEAR_TARGETS', 'MISSION_TARGET,1,120.0,3.0,2.0', 'PREPARE', 'MISSION_TARGET,3,0,3,2',
      'MISSION_TARGET,1,0,0,2', 'START_MISSION', '#WAIT 20']);
    check('SUN target 120 -> ERR,PREPARE,TARGET_1_OUT_OF_RANGE_SUN; index gap / tol 0 rejected; START without READY refused',
      !!find(bad, /^ERR,PREPARE,TARGET_1_OUT_OF_RANGE_SUN$/) && all(bad, /^ERR,MISSION_TARGET_INVALID$/).length === 2 && !!find(bad, /^ERR,START_MISSION,NOT_READY$/));
  }

  console.log('team-8: audit 7 Oct night fixes (N5 STOP/ABORT, N4 hold 0, N7 nan, N1 camera/SD at PREPARE)');
  {
    const leg = run([...RIG, 'MISSION_CLEAR', 'MISSION_TARGET,20,3,2', 'MISSION_PREPARE', 'MISSION_START', '#WAIT 500', '#STATE', 'STOP', '#WAIT 300', '#STATE',
      '#WAIT 1000', '#STATE']);
    const l = states(leg);
    check('N5: mis.on 0, organizer MISSION_START then STOP -> wheel stays 0 (the organizer manager used to put AUTO back)',
      l[0].cmd !== 0 && l[1].cmd === 0 && l[2].cmd === 0 && !!find(leg, /^ACK,STOP$/), l.map((s) => s.cmd).join(' '));
    const ab = run([...RIG, '#SET camDead 1', 'TEAM_MIS_GO,20', '#WAIT 1000', '#STATE', 'ABORT', '#WAIT 300', '#STATE']);
    const a = states(ab);
    check('N5: mis.on 0, ABORT during TEAM_MIS_GO -> ACK,ABORT, ABORTED, wheel 0 (it used to answer ERR,MISSION_NOT_AVAILABLE_T04)',
      a[0].cmd !== 0 && a[1].cmd === 0 && !!find(ab, /^ACK,ABORT$/) && !!find(ab, /^MISSION,STATE,ABORTED$/) && !find(ab, /^ERR,MISSION_NOT_AVAILABLE/), a.map((s) => s.cmd).join(' '));

    const T = [[0, 3, 0], [20, 3, 0], [-20, 3, 0]];
    const h0 = run([...RIG, 'TEAM_SET,mis.on,1', '#SET camMs 300', '#BLE 1', ...gsPrepare(T), '#WAIT 300', '#BLEW START_MISSION', ...ticks(30), 'STOP', '#WAIT 20']);
    const tl = timed(h0);
    const caps = tl.filter((x) => x.l === '#PAYLOAD_TX CAPTURE');
    const sAt = (t) => states(tl.filter((x) => x.l.startsWith('#STATE ') && x.t >= t).slice(0, 1).map((x) => x.l))[0];
    const at = caps.map((c, i) => ({ sun: sAt(c.t).sun, want: T[i] ? T[i][0] : NaN }));
    console.log(`       hold 0 captures: ${at.map((x) => `sun ${x.sun.toFixed(2)} (target ${x.want})`).join(' | ')}`);
    check('N4: hold 0 -> each CAPTURE on its own target (it shot target 2 at 0 deg with the old error)',
      caps.length === 3 && at.every((x) => Math.abs(x.sun - x.want) <= 3.2) && !!find(h0, /^MISSION,STATE,COMPLETE$/));

    const nan = run(['ADCS_TUNE,nan,2,40', 'ADCS_TUNE,4,inf,40', 'SET_TARGET,nan', 'TEAM_MIS_GO,nan', '#WAIT 20']);
    check('N7: nan / inf numbers are refused (ADCS_TUNE, SET_TARGET, TEAM_MIS_GO)', !find(nan, /^ACK,(ADCS_TUNE|SET_TARGET|TEAM_MIS_GO)/) &&
      all(nan, /^ERR,/).length >= 4, all(nan, /^(ACK|ERR),/).join(' | '));

    const ST = (sd) => `#PAYLOAD STATUS,READY,CAMERA,OK,STORAGE,${sd},WIFI,READY,IP,192.168.4.1,STREAM,OFF,IMAGE_COUNT,0,LAST_IMAGE,`;
    const cam = run([...RIG, 'TEAM_SET,mis.on,1', '#BLE 1', ST('ERR'), ...gsPrepare([[10, 3, 1]]), '#WAIT 300', '#BLEW START_MISSION', '#WAIT 300',
      ST('OK'), ...gsPrepare([[10, 3, 1]]), '#WAIT 300', ST('ERR'), 'TEAM_SET,mis.camReq,0', ...gsPrepare([[10, 3, 1]]), '#WAIT 300']);
    const prep = all(cam, /^MISSION,PREP,/);
    check('N1: camera STORAGE,ERR -> ERR,PREPARE,CAMERA_OK_STORAGE_ERR, no READY, START refused',
      !!find(cam, /^ERR,PREPARE,CAMERA_OK_STORAGE_ERR$/) && prep[0] === 'MISSION,PREP,FAILED CAMERA_OK_STORAGE_ERR' && !!find(cam, /^ERR,START_MISSION,NOT_READY$/), prep.join(' | '));
    check('N1: STORAGE,OK -> READY "cam OK SD OK"; mis.camReq 0 -> READY even with SD ERR ("cam OK SD ERR")',
      all(cam, /^MISSION,READY$/).length === 2 && prep[1] === 'MISSION,PREP,1 targets SUN EACH cam OK SD OK' && prep[2] === 'MISSION,PREP,1 targets SUN EACH cam OK SD ERR', prep.join(' | '));
  }

  console.log('team-8: N2 camera stream off at START, N3 mission HOLD lets go at mis.unlock');
  {
    const on = run([...RIG, 'TEAM_MIS_GO,10', '#WAIT 500', 'STOP', '#WAIT 20']);
    const off = run([...RIG, 'TEAM_SET,mis.camStop,0', 'TEAM_MIS_GO,10', '#WAIT 500', 'STOP', '#WAIT 20']);
    check('N2: START sends STREAM_STOP to the camera (mis.camStop 1); none with mis.camStop 0',
      all(on, /^#PAYLOAD_TX STREAM_STOP$/).length === 1 && all(off, /^#PAYLOAD_TX STREAM_STOP$/).length === 0);
    // sticky rig, a push while holding target 10 (hold 15 s so the shot comes late): where does the body end up? (7 Oct bedroom:
    // target 20 crept to 23 and stayed there inside HOLD)
    const push = (u) => {
      const out = run([...RIG, '#SET stick 10', `TEAM_SET,mis.unlock,${u}`, 'TEAM_SET,mis.hold,15', 'TEAM_SET,mis.capErr,0', 'TEAM_MIS_GO,10', '#WAIT 7000', '#SET bodyRate 5', ...ticks(6), 'STOP', '#WAIT 20']);
      const s = states(out);
      return Math.abs(s[s.length - 1].sun - 10);
    };
    const p2 = push(2), p0 = push(0);
    console.log(`       sticky rig, push in HOLD, error 6 s later: mis.unlock 2 -> ${p2.toFixed(2)} deg, mis.unlock 0 (adcs.unlock 3) -> ${p0.toFixed(2)} deg`);
    check('N3: mis.unlock 2 pulls back under 1.5 deg; adcs.unlock 3 stays stuck over 2 deg inside HOLD', p2 < 1.5 && p0 > 2, `${p2.toFixed(2)} vs ${p0.toFixed(2)}`);
  }

  console.log('team-8: N6 retry through the gate, broken IMAGE_READY; N8 results / reset / index');
  {
    const re = run([...RIG, '#SET camFail 1', 'TEAM_SET,mis.capMs,1500', 'TEAM_MIS_GO,15', ...ticks(20), 'STOP', '#WAIT 20']);
    const tl = timed(re);
    const fail = tl.find((x) => x.l === 'PAYLOAD,ERR,CAPTURE_FAILED'), caps = tl.filter((x) => x.l === '#PAYLOAD_TX CAPTURE');
    const ce = all(re, /^EVT,TEAM_MIS,CAPTURE,/).map((l) => +l.split(',')[6]);
    console.log(`       retry: failed at ${fail ? fail.t.toFixed(1) : '-'} s, captures at ${caps.map((x) => x.t.toFixed(1)).join(' ')} s, ERR ${ce.join(' ')}`);
    check('N6: after ERR,CAPTURE_FAILED the retry passes the capture gate again (|ERR| <= 1.5) and gets the image',
      !!fail && caps.length === 2 && ce.every((e) => Math.abs(e) <= 1.5) && !!find(re, /^MISSION,RESULT,IMAGE,1,/));
    const bad = run([...RIG, '#SET camDead 1', 'TEAM_SET,mis.capMs,3000', 'TEAM_MIS_GO,5', ...ticks(8), '#PAYLOAD IMAGE_READY,,0', ...ticks(1), 'TEAM_MIS_STATUS', '#WAIT 20', 'STOP', '#WAIT 20']);
    check('N6: IMAGE_READY with no .JPG name / size -> ERR,PAYLOAD_IMAGE_READY_INVALID, not taken as the image',
      !!find(bad, /^ERR,PAYLOAD_IMAGE_READY_INVALID$/) && !find(bad, /^EVT,TEAM_MIS,IMAGE,/) && !!find(bad, /^TM,MISSION_STATE,.*IMG1,-$/), find(bad, /^TM,MISSION_STATE/));

    const q = run([...RIG, 'TEAM_SET,mis.on,1', 'TEAM_SET,mis.gap,10000', '#BLE 1', ...gsPrepare([[10, 3, 1], [-10, 3, 1]], 'AFTER'), '#WAIT 300', '#BLEW START_MISSION',
      ...ticks(13), '#BLEW MISSION_CLEAR_TARGETS', ...ticks(25), 'STOP', '#WAIT 20']);
    const qt = timed(q), done = qt.find((x) => x.l === 'MISSION,STATE,COMPLETE'), res = qt.filter((x) => /^MISSION,RESULT,IMAGE,/.test(x.l));
    console.log(`       AFTER, gap 10 s, clear at 13 s: COMPLETE at ${done ? done.t.toFixed(1) : '-'} s, results ${res.map((x) => x.l + '@' + x.t.toFixed(1)).join(' ')}`);
    check('N8: MISSION_CLEAR_TARGETS drops the results still queued (1 sent before, none after)', !!done && done.t < 12 && res.length === 1);
    const rs = run([...RIG, 'TEAM_SET,mis.on,1', '#BLE 1', ...gsPrepare([[30, 3, 2]]), '#WAIT 300', '#BLEW START_MISSION', '#WAIT 1500', '#BLEW MISSION_RESET', '#WAIT 300', '#STATE',
      '#BLEW MISSION_TARGET,1.5,0,3,2', '#WAIT 20']);
    check('N8: MISSION_RESET mid-run -> MISSION,TIMER,STOP once, wheel 0; MISSION_TARGET index 1.5 -> ERR', all(rs, /^MISSION,TIMER,STOP,\d+$/).length === 1 &&
      states(rs).pop().cmd === 0 && !!find(rs, /^ERR,MISSION_TARGET_INVALID$/));
  }
};
