#pragma once
// TEAM NasaPakSoi team-6: mission 2 (imaging) for the GS v1.10.4 Competition tab.
// Organizer v3.0 answers PREPARE / START_MISSION / ABORT with ERR,MISSION_NOT_AVAILABLE_T04, and its Module_Mission parses
// MISSION_TARGET as 3 fields (the GS sends 4), never captures and never moves on to the next target while in AUTO.
// GS protocol (decoded from the GS 7 Oct): PREPARE burst = ADCS_MODE,MANUAL / ADCS_REFERENCE / ADCS_STRATEGY / ADCS_TUNE /
// MISSION_NAME,<n> / MISSION_TRANSFER,EACH|AFTER / MISSION_TIME_LIMIT,<s> / MISSION_CLEAR_TARGETS /
// MISSION_TARGET,<i>,<deg>,<tol>,<hold s> per row / SET_TARGET,<first> / PREPARE.  START = START_MISSION, ABORT = ABORT.
// The GS reads MISSION,READY (START enabled), MISSION,PREP,<detail>, MISSION,STATE,<READY|ACQUIRING|STABILIZING|CAPTURING|
// COMPLETE|FAILED|ABORTED> (nothing after the state), MISSION,TIMER,START, MISSION,TIMER,STOP,<ms> and
// MISSION,RESULT,IMAGE,<i>,<name> (300 ms later it GETs http://<payload ip>/image?name=<name>; a second line before that
// overwrites the name -> result lines are spaced mis.gap ms).
// Per target: AUTO to the angle -> |error| <= tol for hold s without a break -> CAPTURE -> IMAGE_READY -> next target.
// mis.on 0 = organizer behaviour for the GS command names. TEAM_MIS_GO,<deg>[,<deg>...] works either way.
// STOP / ABORT / anything that leaves AUTO ends the mission (ABORTED) and stops the wheel.
#include <Arduino.h>
#include <math.h>
#include "System_TTC.h"
#include "Team_Params.h"
#include "Module_ADCS.h"
#include "Module_ReactionWheel.h"
#include "Module_Payload.h"
#include "Module_ManualSequence.h"  // team-9: ABORT / START also end a running MAN_SEQ

enum TeamMisState : uint8_t { TMS_IDLE, TMS_READY, TMS_ACQ, TMS_STAB, TMS_CAP, TMS_DONE, TMS_ABORTED, TMS_FAILED };
#define TEAM_MIS_MAX 10
#define TEAM_MIS_TRIES 3
#define TEAM_MIS_SUN_FOV 55.0f  // deg: beyond this the lamp is at the edge of / outside the sun sensor view
struct TeamMisTarget { float deg, tol, hold; String img; bool cap; };  // team-9 cap: action CAPTURE (else NONE)
static TeamMisTarget _tmT[TEAM_MIS_MAX];
static uint8_t _tmN = 0, _tmI = 0, _tmTry = 0;
static TeamMisState _tmS = TMS_IDLE, _tmSaid = TMS_IDLE;
static bool _tmEach = true, _tmLimitSaid = false, _tmStarted = false;
static String _tmName = "MISSION";
static unsigned long _tmEndAt = 0, _tmLimitMs = 0, _tmT0 = 0, _tmHold0 = 0, _tmCap0 = 0, _tmSaidMs = 0, _tmResMs = 0;
static uint32_t _tmImg0 = 0, _tmErr0 = 0;
static unsigned long _tmTgt0 = 0, _tmRescueMs = 0, _tmSkipMs = 0;  // team-7 plan B: target start, rescue / skip after (0 = off)
static bool _tmRescue = false;
static uint8_t _tmQ[TEAM_MIS_MAX];  // targets whose MISSION,RESULT,IMAGE line is still to send
static uint8_t _tmQn = 0, _tmQi = 0;
static unsigned long _tmStatMs = 0;  // team-9: last TM,MISSION_STATE / TM,MISSION_ACTIVITY

inline const char* teamMisText(TeamMisState s) {
  switch (s) {
    case TMS_READY: return "READY";
    case TMS_ACQ: return "ACQUIRING";
    case TMS_STAB: return "STABILIZING";
    case TMS_CAP: return "CAPTURING";
    case TMS_DONE: return "COMPLETE";
    case TMS_ABORTED: return "ABORTED";
    case TMS_FAILED: return "FAILED";
    default: return "IDLE";
  }
}
// team-9: the state names of organizer v3.0.7 telemetry (TM,MISSION_STATE / TM,MISSION_ACTIVITY; GS v1.11.x CURRENT ACTIVITY)
inline const char* teamMisTmText(TeamMisState s) { return s == TMS_STAB ? "HOLDING" : teamMisText(s); }
inline void _tmStatus(bool full = true);
inline bool teamMisActive() { return _tmS == TMS_ACQ || _tmS == TMS_STAB || _tmS == TMS_CAP; }
inline unsigned long _tmElapsed() { return _tmStarted ? millis() - _tmT0 : (_tmEndAt ? _tmEndAt - _tmT0 : 0); }
inline void _tmFlush() {
  sendTelemetry(String("MISSION,STATE,") + teamMisText(_tmS));
  _tmSaid = _tmS;
  _tmSaidMs = millis();
  _tmStatus(false);  // team-9: the v3.0.7 status lines at every state change (terminal states freeze the GS timer)
}
inline bool _tmAngleOk(float d) { return adcsGet().ref == ADCS_MAG ? (d >= 0 && d < 360) : (d >= -90 && d <= 90); }
inline void _tmTargetEvt() {
  char b[128];
  snprintf(b, sizeof(b), "EVT,TEAM_MIS,TARGET,%u,%u,DEG,%.1f,TOL,%.1f,HOLD,%.1f,RESCUE_S,%.0f,SKIP_S,%.0f", _tmI + 1, _tmN, _tmT[_tmI].deg,
           _tmT[_tmI].tol, _tmT[_tmI].hold, _tmRescueMs / 1000.0f, _tmSkipMs / 1000.0f);
  sendTelemetry(b);
}
inline void _tmEnd(TeamMisState s) {
  _tmS = s;
  if (_tmStarted) { _tmEndAt = millis(); sendTelemetry("MISSION,TIMER,STOP," + String(_tmEndAt - _tmT0)); }
  _tmStarted = false;
  _tmFlush();
}
// The GS PREPARE burst starts with ADCS_MODE,MANUAL and runs before teamMissionUpdate(): end a mission that left AUTO first
inline void _tmCheckAuto() {
  if (teamMisActive() && adcsGet().mode != ADCS_AUTO) {
    rwStop();
    sendTelemetry("EVT,TEAM_MIS,LEFT_AUTO," + String(_tmI + 1));
    _tmEnd(TMS_ABORTED);
  }
}
// Config change after PREPARE / at the end: back to IDLE (the GS sends PREPARE again)
inline bool _tmConfigOk(const char* what) {
  _tmCheckAuto();
  if (teamMisActive()) { sendTelemetry(String("ERR,MISSION_BUSY,") + what); return false; }
  if (_tmS != TMS_IDLE) { _tmS = TMS_IDLE; _tmFlush(); }
  return true;
}
inline int _tmParseList(const String& p, float* v, int maxN) {
  int n = 0, s = 0;
  while (n < maxN) {
    const int c = p.indexOf(',', s);
    if (!ttcParseNumber(c < 0 ? p.substring(s) : p.substring(s, c), v[n])) return -1;
    n++;
    if (c < 0) return n;
    s = c + 1;
  }
  return -1;
}

inline bool _tmPrepare() {
  String why = "";
  if (teamMisActive()) why = "BUSY";
  else if (_tmN == 0) why = "NO_TARGETS";
  else {
    for (uint8_t i = 0; i < _tmN && !why.length(); i++)
      if (!_tmAngleOk(_tmT[i].deg)) why = "TARGET_" + String(i + 1) + "_OUT_OF_RANGE_" + adcsRefText();
  }
  if (!why.length() && rwGetMode() == RW_MODE_MOMENTUM && !rwMomentumProfileReady()) why = "MOMENTUM_PROFILE_NOT_READY";
  // team-8 (audit N1): the camera's last STATUS (it answers the STATUS sent below, so PREPARE again after a camera fix)
  const String cam = payloadCamState(), sd = payloadStoreState();
  if (!why.length() && TP.misCamReq && cam.length() && (cam != "OK" || sd != "OK")) why = "CAMERA_" + cam + "_STORAGE_" + (sd.length() ? sd : String("?"));
  payloadSendCommand("STATUS");  // the GS takes the payload IP for the image download from the status line
  if (why.length()) {
    sendTelemetry("ERR,PREPARE," + why);
    sendTelemetry("MISSION,PREP,FAILED " + why);
    if (!teamMisActive()) { _tmS = TMS_IDLE; _tmFlush(); }
    return false;
  }
  // team-7: targets past the sun sensor (6 Oct calibration: -60..+50 deg) are reached on the gyro alone
  uint8_t far = 0;
  if (adcsGet().ref == ADCS_SUN)
    for (uint8_t i = 0; i < _tmN; i++)
      if (fabsf(_tmT[i].deg + TP.camOff) > TEAM_MIS_SUN_FOV) { far++; sendTelemetry("EVT,TEAM_MIS,FAR_TARGET," + String(i + 1) + "," + String(_tmT[i].deg, 1)); }
  const bool gyro = TP.misGhold || TP.adcsGhold;
  sendTelemetry("ACK,PREPARE");
  sendTelemetry("MISSION,PREP," + String(_tmN) + " targets " + adcsRefText() + (_tmEach ? " EACH" : " AFTER") +
                (cam == "OK" && sd == "OK" ? " cam OK SD OK" : cam.length() ? " cam " + cam + " SD " + sd : payloadHasResponded() ? " cam NO STATUS" : " cam NO REPLY") + (far ? (gyro ? " far " + String(far) + " gyro" : " far " + String(far) + " NO GYRO HOLD") : ""));
  _tmS = TMS_READY;
  _tmFlush();
  sendTelemetry("MISSION,READY");  // MISSION,STATE,READY alone does not enable START in the GS
  return true;
}

// team-7 plan B: the time this target may take. mis.skipS, shortened so that every target still to do gets a share of what
// is left of the GS time limit (never under 8 s); the rescue (shoot without the hold) starts at mis.targetS or 2/3 of it.
inline void _tmTargetBegin() {
  const unsigned long now = millis();
  _tmTgt0 = now; _tmRescue = false; _tmTry = 0;
  float skip = TP.misSkipS;
  if (_tmLimitMs) {
    const float left = ((float)_tmLimitMs - (float)(now - _tmT0)) / 1000.0f, share = left / (float)(_tmN - _tmI);
    const float cap = share > 8.0f ? share : 8.0f;
    if (skip <= 0 || skip > cap) skip = cap;
  }
  float rescue = TP.misTargetS;
  if (skip > 0 && (rescue <= 0 || rescue > skip * 2.0f / 3.0f) && TP.misTargetS > 0) rescue = skip * 2.0f / 3.0f;
  _tmSkipMs = skip > 0 ? (unsigned long)(skip * 1000.0f) : 0;
  _tmRescueMs = rescue > 0 ? (unsigned long)(rescue * 1000.0f) : 0;
}

inline bool _tmStart() {
  String why = "";
  if (_tmS != TMS_READY) why = "NOT_READY";
  else if (rwGetMode() == RW_MODE_MOMENTUM && !rwMomentumProfileReady()) why = "MOMENTUM_PROFILE_NOT_READY";
  else if (!adcsTeamSetTarget(_tmT[0].deg)) why = "TARGET";
  else if (adcsGet().mode != ADCS_AUTO && !adcsAuto()) why = "ADCS_SENSOR_NOT_READY";
  if (why.length()) { sendTelemetry("ERR,START_MISSION," + why); return false; }
  if (manualSequenceRunning()) manualSequenceClear();  // team-9: AUTO owns the wheel now (no rwStop: AUTO is driving)
  _tmI = 0; _tmTry = 0; _tmQn = _tmQi = 0; _tmResMs = 0; _tmLimitSaid = false;
  for (uint8_t i = 0; i < _tmN; i++) _tmT[i].img = "";
  _tmT0 = millis(); _tmEndAt = 0; _tmStarted = true;
  _tmTargetBegin();
  adcsTeamMissionGhold(TP.misGhold);
  if (TP.misCamStop) payloadSendCommand("STREAM_STOP");  // team-8 (audit N2): free the camera web server for the image downloads
  sendTelemetry("ACK,START_MISSION");
  sendTelemetry("MISSION,TIMER,START");
  _tmTargetEvt();
  _tmS = TMS_ACQ;
  _tmFlush();
  return true;
}

inline void _tmNext() {
  _tmI++;
  if (_tmI >= _tmN) {
    _tmI = _tmN - 1;
    _tmEnd(TMS_DONE);
    // team-9 (mis.endStop 1): safe state at COMPLETE like organizer v3.0.6+ (T07 C7); 0 = stay in AUTO on the last target
    if (TP.misEndStop && adcsGet().mode == ADCS_AUTO) { adcsManual(); rwStop(); sendTelemetry("EVT,TEAM_MIS,SAFE_STOP"); }
    if (!_tmEach) for (uint8_t i = 0; i < _tmN; i++) if (_tmT[i].img.length()) _tmQ[_tmQn++] = i;
    return;
  }
  adcsTeamSetTarget(_tmT[_tmI].deg);
  _tmTargetBegin();
  _tmTargetEvt();
  _tmS = TMS_ACQ;
}

inline void _tmCapture() {
  _tmImg0 = payloadImageSeq(); _tmErr0 = payloadCaptureErrSeq(); _tmCap0 = millis(); _tmTry++;
  payloadSendCommand("CAPTURE");
  // pointing at the shutter (the HOLD band lets the body sit up to adcs.unlock off: check it on the rig)
  sendTelemetry("EVT,TEAM_MIS,CAPTURE," + String(_tmI + 1) + "," + String(_tmTry) + ",ERR," + String(adcsGet().error, 2) + ",RATE," + String(adcsGet().rate, 1) + ",TGT," + String(_tmT[_tmI].deg, 1));
  _tmS = TMS_CAP;
}

// team-9: organizer v3.0.7 format first (GS v1.11.x reads MISSION_STATE / TARGET_INDEX / TARGET_COUNT / MISSION_TIME_MS and
// MISSION_ACTIVITY / POINTING / HOLD_MS / HOLD_REQUIRED_MS as key-value pairs); full = + MIS_ON and the image names
inline void _tmStatus(bool full) {
  const unsigned long now = millis();
  _tmStatMs = now;
  const char* st = teamMisTmText(_tmS);
  String s = "TM,MISSION_STATE," + String(st) + ",TARGET_INDEX," + String(_tmN ? _tmI + 1 : 0) + ",TARGET_COUNT," + String(_tmN) +
             ",MISSION_TIME_MS," + String(_tmElapsed());
  if (full) {
    s += ",MIS_ON," + String(TP.misOn);
    for (uint8_t i = 0; i < _tmN; i++) s += ",IMG" + String(i + 1) + "," + (_tmT[i].img.length() ? _tmT[i].img : String("-"));
  }
  sendTelemetry(s);
  String pt = "---";
  unsigned long hm = 0, hr = 0;
  if (_tmN && _tmI < _tmN) {
    const TeamMisTarget& t = _tmT[_tmI];
    hr = (unsigned long)(t.hold * 1000.0f);
    const ADCSState a = adcsGet();
    if (teamMisActive() && a.valid) {
      pt = fabsf(a.error) <= t.tol ? "IN_TOLERANCE" : "OUT_OF_TOLERANCE";
      if (_tmS == TMS_STAB) hm = now - _tmHold0 < hr ? now - _tmHold0 : hr;
      else if (_tmS == TMS_CAP) hm = hr;
    }
  }
  sendTelemetry("TM,MISSION_ACTIVITY," + String(st) + ",POINTING," + pt + ",HOLD_MS," + String(hm) + ",HOLD_REQUIRED_MS," + String(hr));
}
// team-9: the target's action after the hold: CAPTURE, or NONE = done, next target
inline void _tmAct() {
  if (_tmT[_tmI].cap) { _tmCapture(); return; }
  sendTelemetry("EVT,TEAM_MIS,HOLD_DONE," + String(_tmI + 1) + ",ERR," + String(adcsGet().error, 2));
  _tmNext();
}

inline void teamMissionUpdate() {
  const unsigned long now = millis();
  _tmCheckAuto();  // STOP, ADCS_MODE,MANUAL, sensor FAULT
  if (teamMisActive()) {
    if (_tmLimitMs && !_tmLimitSaid && now - _tmT0 >= _tmLimitMs) {
      _tmLimitSaid = true;  // GS: "time limit only" -> report and carry on
      sendTelemetry("EVT,TEAM_MIS,TIME_LIMIT," + String(now - _tmT0));
    }
    const ADCSState a = adcsGet();
    const TeamMisTarget& t = _tmT[_tmI];
    const bool in = a.valid && fabsf(a.error) <= t.tol;
    // team-7 plan B: a target never stalls the mission (fuzz seed 8437: the camera failed twice, then the body kept leaving the
    // tolerance before 2 s in a row -> stuck on target 1 for ever). Fewer points beat none.
    const unsigned long onT = now - _tmTgt0;
    if (_tmS != TMS_CAP && _tmSkipMs && onT >= _tmSkipMs) {
      sendTelemetry("EVT,TEAM_MIS,SKIP," + String(_tmI + 1) + ",ERR," + String(a.error, 2));
      _tmNext();
    } else {
    if (!_tmRescue && _tmRescueMs && onT >= _tmRescueMs && !_tmT[_tmI].img.length()) {
      _tmRescue = true;  // from now on: shoot at the first sample inside the tolerance
      sendTelemetry("EVT,TEAM_MIS,RESCUE," + String(_tmI + 1) + ",ERR," + String(a.error, 2));
    }
    if (_tmS == TMS_ACQ) {
      if (in && _tmRescue) _tmAct();
      else if (in) { _tmS = TMS_STAB; _tmHold0 = now; }
    } else if (_tmS == TMS_STAB) {
      if (!in) _tmS = TMS_ACQ;  // the hold restarts after any sample outside the tolerance (organizer rule)
      else if (_tmRescue) _tmAct();
      else if (now - _tmHold0 >= (unsigned long)(t.hold * 1000.0f)) {
        // team-7: shoot when close and still (sim: the hold ended while the body coasted to the tolerance edge)
        const bool good = (TP.misCapErr <= 0 || fabsf(a.error) <= TP.misCapErr) && (TP.misCapRate <= 0 || fabsf(a.rate) <= TP.misCapRate);
        if (good || now - _tmHold0 >= (unsigned long)(t.hold * 1000.0f + TP.misWaitMs)) _tmAct();
      }
    } else if (_tmS == TMS_CAP) {
      if (payloadImageSeq() != _tmImg0) {
        _tmT[_tmI].img = payloadLastImageName();
        sendTelemetry("EVT,TEAM_MIS,IMAGE," + String(_tmI + 1) + "," + _tmT[_tmI].img);
        if (_tmEach) _tmQ[_tmQn++] = _tmI;
        _tmNext();
      } else if (payloadCaptureErrSeq() != _tmErr0 || now - _tmCap0 >= (unsigned long)TP.misCapMs) {
        if (_tmTry >= TEAM_MIS_TRIES) {
          sendTelemetry("EVT,TEAM_MIS,CAPTURE_FAILED," + String(_tmI + 1));
          _tmNext();
        } else {
          // team-8 (audit N6): a retry passes the capture gate again (it used to shoot at once anywhere in the tolerance). The hold
          // counts as done; off target -> STABILIZING drops to ACQUIRING and the hold starts over. Rescue still shoots at once.
          _tmS = TMS_STAB; _tmHold0 = now - (unsigned long)(t.hold * 1000.0f);
        }
      }
    }
    }
  }
  adcsTeamMissionGhold(TP.misGhold && (teamMisActive() || (_tmS == TMS_DONE && adcsGet().mode == ADCS_AUTO)));
  adcsTeamMissionTol(teamMisActive() ? _tmT[_tmI].tol : 0);
  if (_tmS != _tmSaid && now - _tmSaidMs >= 200) _tmFlush();  // latest state, at most 5 lines/s
  else if (teamMisActive() && now - _tmStatMs >= 250) _tmStatus(false);  // team-9: HOLD_MS / POINTING for the GS, 4 per s
  if (_tmQi < _tmQn && now - _tmResMs >= (unsigned long)TP.misGap) {
    const uint8_t i = _tmQ[_tmQi++];
    sendTelemetry("MISSION,RESULT,IMAGE," + String(i + 1) + "," + _tmT[i].img);
    _tmResMs = now;
  }
}

// true = handled here (else the organizer router continues)
inline bool teamMissionCommand(const String& c) {
  if (c.startsWith("TEAM_MIS_GO,")) {
    _tmCheckAuto();
    float v[TEAM_MIS_MAX];
    const int n = _tmParseList(c.substring(12), v, TEAM_MIS_MAX);
    if (n < 1) { sendTelemetry("ERR,TEAM_MIS_GO,FORMAT_1_TO_10_ANGLES"); return true; }
    if (!_tmConfigOk("TEAM_MIS_GO")) return true;
    for (int i = 0; i < n; i++) _tmT[i] = {v[i], TP.misTol, TP.misHold, "", true};
    _tmN = n; _tmEach = true; _tmLimitMs = 0; _tmName = "TEAM";
    sendTelemetry("ACK,TEAM_MIS_GO," + String(n));
    if (_tmPrepare()) _tmStart();
    return true;
  }
  if (c == "TEAM_MIS_STATUS") { _tmStatus(); return true; }
  const bool abort = c == "ABORT" || c == "MISSION_ABORT";
  if (abort && manualSequenceRunning()) manualSequenceStop();  // team-9
  // team-8 (audit N5): ABORT also ends a TEAM_MIS_GO run when mis.on is 0 (it used to answer ERR and leave the wheel running)
  if (abort && (TP.misOn || teamMisActive() || _tmS == TMS_READY)) {
    missionAbort(); adcsManual(); rwStop();  // ABORT always stops, mission or not (both mission managers)
    sendTelemetry("ACK,ABORT");
    if (c == "MISSION_ABORT") { sendTelemetry("ACK,MISSION_ABORT"); sendTelemetry("EVT,MISSION_ABORTED"); }  // team-9: GS v1.11.x names
    if (teamMisActive() || _tmS == TMS_READY) sendTelemetry("EVT,TEAM_MIS,ABORTED," + String(_tmI + 1));
    _tmEnd(TMS_ABORTED);
    return true;
  }
  if (!TP.misOn) return false;

  if (c.startsWith("MISSION_NAME,")) {
    if (!_tmConfigOk("MISSION_NAME")) return true;
    _tmName = c.substring(13).substring(0, 24);
    sendTelemetry("ACK,MISSION_NAME," + _tmName);
    return true;
  }
  if (c.startsWith("MISSION_TRANSFER,")) {
    const String m = c.substring(17);
    if (m != "EACH" && m != "AFTER") { sendTelemetry("ERR,MISSION_TRANSFER_INVALID"); return true; }
    if (!_tmConfigOk("MISSION_TRANSFER")) return true;
    _tmEach = m == "EACH";
    sendTelemetry("ACK,MISSION_TRANSFER," + m);
    return true;
  }
  if (c.startsWith("MISSION_TIME_LIMIT,") || c.startsWith("MISSION_MAX_MIN,")) {
    const bool min = c.startsWith("MISSION_MAX_MIN,");
    float s;
    if (!ttcParseNumber(c.substring(min ? 16 : 19), s) || s < 0 || s > (min ? 120 : 7200)) { sendTelemetry("ERR,MISSION_TIME_LIMIT_INVALID"); return true; }
    if (!_tmConfigOk("MISSION_TIME_LIMIT")) return true;
    _tmLimitMs = (unsigned long)(s * (min ? 60000.0f : 1000.0f));
    sendTelemetry("ACK,MISSION_TIME_LIMIT," + String(_tmLimitMs / 1000));
    return true;
  }
  if (c == "MISSION_CLEAR_TARGETS" || c == "MISSION_CLEAR") {
    _tmCheckAuto();
    if (!_tmConfigOk("MISSION_CLEAR_TARGETS")) return true;
    _tmN = 0; _tmQn = _tmQi = 0;  // team-8 (audit N8): results still queued would carry the new targets' names
    sendTelemetry("ACK," + c);
    return true;
  }
  if (c.startsWith("MISSION_TARGET,")) {
    // GS: <i>,<deg>,<tol>,<hold> ; organizer form: <deg>,<tol>,<hold> (appended). team-9: either may end with NONE|CAPTURE
    // (GS v1.11.x Operation tab: MISSION_TARGET,<deg>,<tol>,<hold>,<NONE|CAPTURE>); no action field = CAPTURE (imaging mission)
    String body = c.substring(15);
    bool cap = true;
    const int lc = body.lastIndexOf(',');
    const String last = lc >= 0 ? body.substring(lc + 1) : body;
    if (lc >= 0 && (last == "NONE" || last == "CAPTURE")) { cap = last == "CAPTURE"; body = body.substring(0, lc); }
    float v[4];
    const int n = _tmParseList(body, v, 4);
    if (n != 3 && n != 4) { sendTelemetry("ERR,MISSION_TARGET_FORMAT"); return true; }
    const float* p = n == 4 ? v + 1 : v;
    const int idx = n == 4 ? (int)lroundf(v[0]) - 1 : _tmN;
    if ((n == 4 && v[0] != floorf(v[0])) || idx < 0 || idx > _tmN || idx >= TEAM_MIS_MAX || !isfinite(p[0]) || !(p[1] > 0 && p[1] <= 30) || !(p[2] >= 0 && p[2] <= 60)) {
      sendTelemetry("ERR,MISSION_TARGET_INVALID");
      return true;
    }
    if (!_tmConfigOk("MISSION_TARGET")) return true;
    _tmQn = _tmQi = 0;  // team-8 (audit N8)
    _tmT[idx] = {p[0], p[1], p[2], "", cap};
    if (idx == _tmN) _tmN++;
    sendTelemetry("ACK,MISSION_TARGET," + String(idx + 1));
    return true;
  }
  if (c == "PREPARE" || c == "MISSION_PREPARE") {
    _tmCheckAuto();
    if (_tmPrepare() && c == "MISSION_PREPARE") { sendTelemetry("ACK,MISSION_PREPARE"); sendTelemetry("EVT,MISSION_READY"); }  // team-9
    return true;
  }
  if (c == "START_MISSION" || c == "MISSION_START") { if (_tmStart() && c == "MISSION_START") sendTelemetry("ACK,MISSION_START"); return true; }
  if (c == "MISSION_STATUS") { _tmStatus(); return true; }
  if (c == "MISSION_RESET") {
    if (teamMisActive()) { adcsManual(); rwStop(); }
    if (_tmStarted) _tmEnd(TMS_ABORTED);  // team-8 (audit N8): MISSION,TIMER,STOP for a run cut by the reset
    _tmStarted = false; _tmN = 0; _tmQn = _tmQi = 0; _tmS = TMS_IDLE; _tmFlush();
    sendTelemetry("ACK,MISSION_RESET");
    return true;
  }
  return false;
}
