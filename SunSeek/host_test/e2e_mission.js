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
};
