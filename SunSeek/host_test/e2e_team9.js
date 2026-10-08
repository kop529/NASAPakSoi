// team-9 (8 Oct): sun/gyro gate (adcs.gate), GS v1.11.x mission names + TM,MISSION_STATE / TM,MISSION_ACTIVITY, COMPLETE safe
// stop (mis.endStop), Operation-tab MISSION_TARGET with NONE|CAPTURE, organizer v3.0.7 Manual Profile (MAN_SEQ_*).
// Part of e2e.js (required at its end).
'use strict';

module.exports = ({ run, check, find, all, states, CAL }) => {
  // the board as saved 7 Oct night (team-8): lock 1, unlock 3, mis.unlock 2
  const BOARD = ['TEAM_SET,rw.minStart,10', 'TEAM_SET,rw.minStable,5', 'TEAM_SET,rw.slew,500', 'TEAM_SET,adcs.kp,4', 'TEAM_SET,adcs.kd,2',
    'TEAM_SET,adcs.ki,1', 'TEAM_SET,adcs.db,0.5', 'TEAM_SET,adcs.kick,20', 'TEAM_SET,adcs.max,60', 'TEAM_SET,adcs.lock,1', 'TEAM_SET,adcs.unlock,3'];
  const RIG = ['#SET drag 0.05', '#SET rateSign -1', '#SET lamp 0', '#SET body 0', '#WAIT 300', ...CAL, ...BOARD];
  const ticks = (s, ms = 100) => Array.from({ length: Math.round(s * 1000 / ms) }, () => [`#WAIT ${ms}`, '#STATE']).flat();
  const timed = (out) => {
    const res = []; let pend = [];
    for (const l of out) {
      if (l.startsWith('#STATE ')) { const t = +l.match(/t=([\d.]+)/)[1]; pend.forEach((p) => res.push({ l: p, t })); pend = []; res.push({ l, t }); }
      else pend.push(l);
    }
    return res;
  };
  // the body's total turn (unwrapped) and the true sun angle at each CAPTURE
  const travel = (out) => {
    const st = states(out); let tot = 0, lo = 0, hi = 0;
    for (let i = 1; i < st.length; i++) { let d = st[i].body - st[i - 1].body; d -= 360 * Math.round(d / 360); tot += d; lo = Math.min(lo, tot); hi = Math.max(hi, tot); }
    return { lo, hi };
  };
  const shots = (out) => {
    const tl = timed(out);
    return tl.filter((x) => x.l === '#PAYLOAD_TX CAPTURE').map((c) => states(tl.filter((x) => x.l.startsWith('#STATE ') && x.t >= c.t).slice(0, 1).map((x) => x.l))[0].sun);
  };

  console.log('team-9: false sun reading past the edge (8 Oct hotel: past ~52 deg the reading folds back, still "lit")');
  {
    // hold target +50 (sim false reading from 52 deg), then a push past the edge like the hotel overshoot (55 deg/s at 0.8 s)
    const go = (extra) => run([...RIG, '#SET aliasAt 52', '#SET aliasK 3', 'TEAM_SET,mis.endStop,0', 'TEAM_SET,mis.hold,30', 'TEAM_SET,mis.targetS,0',
      'TEAM_SET,mis.skipS,0', ...extra, 'TEAM_MIS_GO,50', '#WAIT 6000', '#SET bodyRate -40', ...ticks(20), 'STOP', '#WAIT 20']);
    const sun = (out) => states(out).map((x) => x.sun);
    const off = go(['TEAM_SET,adcs.gate,0']), on = go([]);
    const sOff = sun(off), sOn = sun(on);
    console.log(`       push at +50: gate 0 -> max sun ${Math.max(...sOff).toFixed(1)}, end ${sOff.slice(-1)[0].toFixed(1)} | gate 8 -> max ${Math.max(...sOn).toFixed(1)}, end ${sOn.slice(-1)[0].toFixed(1)}`);
    console.log(`       gate events: ${all(on, /^EVT,TEAM_GATE,/).slice(0, 4).join(' | ')}`);
    check('sim reproduces the hotel: gate 0 + push -> the body is lost past 100 deg', Math.max(...sOff) > 100 && Math.abs(sOff.slice(-1)[0] - 50) > 20);
    check('adcs.gate 8: same push -> back within 3 deg of +50, never past 70, EVT,TEAM_GATE,ON',
      Math.abs(sOn.slice(-1)[0] - 50) <= 3 && Math.max(...sOn) < 70 && !!find(on, /^EVT,TEAM_GATE,ON,/));
    const plain = run([...RIG, 'TEAM_MIS_GO,30,-30,0', ...ticks(35), 'STOP', '#WAIT 20']);
    const sp = shots(plain);
    check('no false reading: the gate never fires (30 / -30 / 0)', !find(plain, /^EVT,TEAM_GATE,/) && sp.length === 3 &&
      Math.abs(sp[0] - 30) <= 2 && Math.abs(sp[1] + 30) <= 2 && Math.abs(sp[2]) <= 2, sp.map((x) => x.toFixed(2)).join(' / '));
    // a wrong estimate with a good sensor (gyro read 40 deg off, e.g. a bump past the gyro range): taken back once it turns
    const bad = run([...RIG, 'TEAM_SET,mis.endStop,0', 'TEAM_MIS_GO,0,30', '#WAIT 1500', '#SET gyroBias 400', '#WAIT 100', '#SET gyroBias 0', ...ticks(20), 'STOP', '#WAIT 20']);
    const sb = shots(bad);
    check('a wrong estimate, sensor fine: RESYNC,...,MOVE when the body turns, target 2 shot within 3 deg of 30',
      !!find(bad, /^EVT,TEAM_GATE,RESYNC,.*,MOVE$/) && sb.length === 2 && Math.abs(sb[1] - 30) <= 3, `${all(bad, /^EVT,TEAM_GATE,/).slice(0, 3).join(' | ')} shots ${sb.map((x) => x.toFixed(1)).join(' / ')}`);
  }

  console.log('team-9: GS v1.11.x Competition names, status telemetry, safe stop at COMPLETE');
  {
    const prep = (T) => ['ADCS_MODE,MANUAL', 'ADCS_REFERENCE,SUN', 'ADCS_STRATEGY,REACTION', 'ADCS_TUNE,4.000,2.000,40', 'MISSION_NAME,MISSION',
      'MISSION_TRANSFER,EACH', 'MISSION_TIME_LIMIT,180', 'MISSION_CLEAR_TARGETS', ...T.map(([a, tol, h], i) => `MISSION_TARGET,${i + 1},${a.toFixed(1)},${tol.toFixed(1)},${h.toFixed(1)}`),
      `SET_TARGET,${T[0][0].toFixed(1)}`, 'MISSION_PREPARE'].map((l) => `#BLEW ${l}`);
    const out = run([...RIG, 'TEAM_SET,mis.on,1', '#BLE 1', ...prep([[20, 3, 2], [-20, 3, 2]]), '#WAIT 300', '#BLEW ADCS_MODE,AUTO', '#BLEW MISSION_START',
      ...ticks(30), 'STOP', '#WAIT 20']);
    check('MISSION_PREPARE -> ACK,MISSION_PREPARE + EVT,MISSION_READY + MISSION,READY; ADCS_MODE,AUTO then MISSION_START -> ACK,MISSION_START',
      !!find(out, /^ACK,MISSION_PREPARE$/) && !!find(out, /^EVT,MISSION_READY$/) && !!find(out, /^MISSION,READY$/) && !!find(out, /^ACK,MISSION_START$/) &&
      !find(out, /^ERR,START_MISSION/));
    const act = all(out, /^TM,MISSION_ACTIVITY,/);
    const hold = act.filter((l) => /^TM,MISSION_ACTIVITY,HOLDING,POINTING,IN_TOLERANCE,HOLD_MS,\d+,HOLD_REQUIRED_MS,2000$/.test(l)).map((l) => +l.split(',')[6]);
    check('TM,MISSION_ACTIVITY (v3.0.7 form): ACQUIRING, HOLDING with HOLD_MS climbing to 2000, CAPTURING', !!act.find((l) => /^TM,MISSION_ACTIVITY,ACQUIRING,/.test(l)) &&
      hold.length >= 4 && hold.some((h) => h >= 1500) && !!act.find((l) => /^TM,MISSION_ACTIVITY,CAPTURING,/.test(l)), `${act.length} lines, hold ${hold.slice(0, 8).join(' ')}`);
    const ms = all(out, /^TM,MISSION_STATE,/);
    check('TM,MISSION_STATE,<state>,TARGET_INDEX,<i>,TARGET_COUNT,2,MISSION_TIME_MS,<ms> while running, COMPLETE at the end',
      ms.some((l) => /^TM,MISSION_STATE,ACQUIRING,TARGET_INDEX,2,TARGET_COUNT,2,MISSION_TIME_MS,[1-9]\d*$/.test(l)) && ms.some((l) => /^TM,MISSION_STATE,COMPLETE,/.test(l)),
      ms.filter((l) => /COMPLETE/.test(l))[0]);
    const tl = timed(out), done = tl.find((x) => x.l === 'MISSION,STATE,COMPLETE');
    const after = states(tl.filter((x) => done && x.t >= done.t + 0.3 && x.l.startsWith('#STATE ')).map((x) => x.l));
    check('COMPLETE -> EVT,TEAM_MIS,SAFE_STOP, EVT,TEAM_AUTO,OFF, wheel 0 for the rest of the run, no periodic status after it',
      !!done && !!find(out, /^EVT,TEAM_MIS,SAFE_STOP$/) && after.length > 10 && after.every((s) => s.cmd === 0) &&
      !tl.find((x) => x.t > done.t + 0.5 && /^TM,MISSION_(STATE|ACTIVITY),/.test(x.l)));
    const keep = run([...RIG, 'TEAM_SET,mis.endStop,0', 'TEAM_MIS_GO,10', ...ticks(14), 'STOP', '#WAIT 20']);
    const ks = states(keep).slice(-3);
    check('mis.endStop 0: stays in AUTO on the last target (team-8 behaviour)', !find(keep, /^EVT,TEAM_MIS,SAFE_STOP$/) &&
      !!find(keep, /^MISSION,STATE,COMPLETE$/) && ks.every((s) => Math.abs(s.sun - 10) <= 3));
    const ab = run([...RIG, 'TEAM_SET,mis.on,1', '#BLE 1', ...prep([[30, 3, 2]]), '#WAIT 300', '#BLEW ADCS_MODE,AUTO', '#BLEW MISSION_START', '#WAIT 1500', '#STATE',
      '#BLEW MISSION_ABORT', '#BLEW ADCS_MODE,MANUAL', '#BLEW RW_STOP', '#WAIT 300', '#STATE']);
    const a = states(ab);
    check('GS v1.11.x ABORT (MISSION_ABORT, ADCS_MODE,MANUAL, RW_STOP) -> ACK,MISSION_ABORT, EVT,MISSION_ABORTED, ABORTED, wheel 0',
      a[0].cmd !== 0 && a[1].cmd === 0 && !!find(ab, /^ACK,MISSION_ABORT$/) && !!find(ab, /^EVT,MISSION_ABORTED$/) && !!find(ab, /^MISSION,STATE,ABORTED$/) &&
      !!find(ab, /^TM,MISSION_STATE,ABORTED,/));
  }

  console.log('team-9: GS v1.11.x Operation tab mission test (MISSION_TARGET,<deg>,<tol>,<hold>,<NONE|CAPTURE>)');
  {
    const out = run([...RIG, 'TEAM_SET,mis.on,1', '#BLE 1', ...['ADCS_MODE,MANUAL', 'ADCS_REFERENCE,SUN', 'ADCS_STRATEGY,REACTION', 'ADCS_TUNE,4.000,2.000,40',
      'MISSION_RESET', 'MISSION_CLEAR', 'MISSION_TARGET,20.0,3.0,1.0,NONE', 'MISSION_TARGET,-20.0,3.0,1.0,CAPTURE', 'ADCS_MODE,MANUAL', 'MISSION_PREPARE'].map((l) => `#BLEW ${l}`),
      '#WAIT 300', '#BLEW ADCS_MODE,AUTO', '#BLEW MISSION_START', ...ticks(25), 'STOP', '#WAIT 20']);
    const sh = shots(out);
    check('NONE target: hold then next (EVT,TEAM_MIS,HOLD_DONE,1), no CAPTURE; CAPTURE target shot within 3 deg of -20; COMPLETE, no ERR',
      !!find(out, /^ACK,MISSION_TARGET,1$/) && !!find(out, /^ACK,MISSION_TARGET,2$/) && !!find(out, /^EVT,TEAM_MIS,HOLD_DONE,1,/) && sh.length === 1 &&
      Math.abs(sh[0] + 20) <= 3 && !!find(out, /^EVT,TEAM_MIS,IMAGE,2,/) && !find(out, /^EVT,TEAM_MIS,IMAGE,1,/) && !!find(out, /^MISSION,STATE,COMPLETE$/) &&
      all(out, /^ERR,/).filter((l) => !/^ERR,(RX_|PAYLOAD)/.test(l)).length === 0, all(out, /^ERR,/).join(' | '));
    const bad = run(['TEAM_SET,mis.on,1', 'MISSION_CLEAR', 'MISSION_TARGET,20,3,1,SHOOT', 'MISSION_TARGET,NONE', '#WAIT 20']);
    check('MISSION_TARGET with an unknown action / no numbers -> ERR,MISSION_TARGET_FORMAT', all(bad, /^ERR,MISSION_TARGET_FORMAT$/).length === 2);
  }

  console.log('team-9: Manual Profile (organizer v3.0.7 MAN_SEQ_*)');
  {
    const seq = ['MAN_SEQ_CLEAR', 'MAN_SEQ_ADD,40,600', 'MAN_SEQ_ADD,-40,600', 'MAN_SEQ_RUN'];
    const out = run([...RIG, ...seq, '#WAIT 300', '#STATE', '#WAIT 600', '#STATE', '#WAIT 600', '#STATE', '#WAIT 20']);
    const s = states(out);
    check('RUN: +40 then -40 then wheel 0, EVT,MAN_SEQ_STEP,2 (organizer: the step now running) + EVT,MAN_SEQ_COMPLETE', s[0].cmd > 0 && s[1].cmd < 0 && s[2].cmd === 0 &&
      !!find(out, /^ACK,MAN_SEQ_ADD,2$/) && !!find(out, /^ACK,MAN_SEQ_RUN$/) && !!find(out, /^EVT,MAN_SEQ_STEP,2$/) && !!find(out, /^EVT,MAN_SEQ_COMPLETE$/),
      s.map((x) => x.cmd.toFixed(0)).join(' '));
    for (const stop of ['STOP', 'RW_STOP', 'MAN_SEQ_STOP', 'ABORT']) {
      const o = run([...RIG, ...seq, '#WAIT 300', '#STATE', stop, '#WAIT 400', '#STATE', '#WAIT 600', '#STATE']);
      const t = states(o);
      check(`${stop} mid-sequence: wheel 0 and the next step never comes`, t[0].cmd > 0 && t[1].cmd === 0 && t[2].cmd === 0, t.map((x) => x.cmd.toFixed(0)).join(' '));
    }
    const au = run([...RIG, 'SET_TARGET,0', ...seq, '#WAIT 300', 'ADCS_MODE,AUTO', '#WAIT 1500', 'MAN_SEQ_ADD,40,600', 'MAN_SEQ_RUN', '#WAIT 20', 'STOP', '#WAIT 20']);
    check('ADCS_MODE,AUTO drops a running sequence; MAN_SEQ_ADD / RUN refused in AUTO', !find(au, /^EVT,MAN_SEQ_STEP,2$/) &&
      !!find(au, /^ERR,MAN_SEQ_REQUIRES_MANUAL_MODE$/) && !!find(au, /^ERR,MAN_SEQ_REQUIRES_MANUAL_REACTION$/));
    const bad = run(['MAN_SEQ_CLEAR', 'MAN_SEQ_ADD,150,500', 'MAN_SEQ_ADD,20,5', 'MAN_SEQ_RUN', '#WAIT 20']);
    check('MAN_SEQ_ADD out of range -> ERR,MAN_SEQ_ADD_INVALID; RUN with no step -> ERR,MAN_SEQ_NOT_READY',
      all(bad, /^ERR,MAN_SEQ_ADD_INVALID$/).length === 2 && !!find(bad, /^ERR,MAN_SEQ_NOT_READY$/));
  }
};
