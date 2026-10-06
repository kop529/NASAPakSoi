#pragma once

/* TEAM NasaPakSoi — team telecommands and team telemetry.

   All team commands start with TEAM_ so they can never collide with an organizer command, and all
   replies use the organizer's line format (ACK / ERR / TM key,value) so the Ground Station terminal
   shows them like any other line.

     TEAM_INFO                        TM,TEAM_FW,<version>,SUN_MODEL,<0|1>,UNSAVED,<n>,LUT_N,<n>
     TEAM_LIST                        one TM,TEAM_PARAM,<key>,<value> per parameter
     TEAM_GET,<key>                   TM,TEAM_PARAM,<key>,<value>
     TEAM_SET,<key>,<value>           ACK,TEAM_SET,<key>,<value>   (RAM only until TEAM_SAVE)
     TEAM_SAVE                        ACK,TEAM_SAVE,<n>            (flash; survives reset/power-off; MANUAL only)
     TEAM_DEFAULTS,YES                ACK,TEAM_DEFAULTS            (organizer defaults + clears flash; MANUAL only)
     TEAM_LUT_BEGIN,<x0>,<dx>,<n>     start a new LUT (n <= 256 values on the grid x0 + i*dx of the raw angle)
     TEAM_LUT_DATA,<i0>,<v>,<v>,...   values i0, i0+1, ... (keep each line < 240 characters)
     TEAM_LUT_END                     ACK,TEAM_LUT_END,<n> + TM,TEAM_LUT,...  (installs it; TEAM_SAVE keeps it)
     TEAM_LUT_CLEAR / TEAM_LUT_INFO
     TEAM_SUN                         one TM,TEAM_T line now
     TEAM_STREAM,<0..20>              TM,TEAM_T at that rate over USB only (0 = off) = TEAM_SET,team.tm
     TEAM_CSTREAM,<0..20>             TM,TEAM_C (what the controller sees and does) at that rate over BLE + USB, RAM only,
                                      not stopped by STOP (0 = off):
                                      TM,TEAM_C,T,<ms>,M,<AUTO 0|1>,TGT,<target+cam.off>,ANG,<sun angle>,EST,<estimate>,
                                      ERR,<error>,GZ,<body rate>,U,<u %>,I,<integral %>,K,<kick %>,RW,<applied %>,LIT,<0|1>,
                                      H,<hold 0|1>,SR,<search 0|1>,SAT,<wheel at +-max: 1|-1|0>
     TEAM_CREC,<0..50>                flight recorder: every n-th 20 ms AUTO step (0 = off, default 2 = 25 Hz, 2400 samples)
                                      -> ACK,TEAM_CREC,<n>,N,<samples>,FULL,<0|1>
     TEAM_CDUMP[,<step>]              (MANUAL) the last AUTO run, every <step>-th sample, ~100 lines/s over BLE + USB:
                                      ACK,TEAM_CDUMP,<lines> / TM,TEAM_CR_AUTO,<the EVT,TEAM_AUTO,ON fields> /
                                      TM,TEAM_CR_HEAD,N,<n>,DIV,<d>,COLS,i;t;tgt;ang;est;err;gz;u;I;K;rw;fl /
                                      TM,TEAM_CR,<i>,<ms>,<tgt>,<ang>,<est>,<err>,<gz>,<u>,<I>,<K>,<rw>,<fl> ... /
                                      EVT,TEAM_CDUMP,END,<lines>   (fl: 1 LIT, 2 HOLD, 4 SEARCH, 8 wheel at +max, 16 at -max)
   Events: EVT,TEAM_AUTO,ON,TGT,..,EST,..,ANG,..,LIT,..,ERR,..,KP,..,KD,..,KI,..,SIGN,..,RSIGN,..,MAX,..,DB,..,WRAP,..,SYNC,..,STRAT,..
           at every AUTO entry; EVT,TEAM_AUTO,OFF|FAULT,ERR,..,EST,..,ANG,..,I,.. when it ends.
     TEAM_GYRO_ZERO[,<ms 500..10000>] ACK now, then EVT,TEAM_GYRO_ZERO,BZ,<dps>,SD,..  (imu.gbz in RAM; TEAM_SAVE keeps it)
                                      or ERR,TEAM_GYRO_ZERO_MOVING / _WHEEL_ON / _NO_GYRO / _ABORTED (MANUAL, wheel stopped)

   sun.model, adcs.sign and imu.rsign change the meaning of the control loop, so they (and
   TEAM_DEFAULTS) are refused in AUTO. */

#include <Arduino.h>
#include "System_TTC.h"
#include "Team_Params.h"
#include "Team_SunSampler.h"
#include "Module_SunSensor.h"
#include "Module_ADCS.h"
#include "Module_ReactionWheel.h"

// USB Development Link only: high-rate team telemetry must not crowd the BLE TT&C link.
inline void teamSendUsb(const String& text) { Serial.println(text); }
static int _teamCHz = 0;  // TEAM_CSTREAM rate (RAM only)
static bool _tdOn = false;  // TEAM_CDUMP in progress
static int _tdI = 0, _tdStep = 1, _tdLines = 0;
static unsigned long _tdLast = 0;

// one recorded sample per call, ~100 lines/s: 80-byte lines stay under the 115200-baud USB port (11.5 kB/s)
inline void teamDumpUpdate() {
  if (!_tdOn) return;
  const unsigned long now = millis();
  if (now - _tdLast < 10) return;
  _tdLast = now;
  if (adcsGet().mode == ADCS_AUTO || _tdI >= _recN) {  // finished, or a new AUTO run started (the buffer restarts)
    _tdOn = false;
    sendTelemetry("EVT,TEAM_CDUMP,END," + String(_tdLines));
    return;
  }
  const TeamRecSample& r = _recBuf[_tdI];
  char b[120];
  snprintf(b, sizeof(b), "TM,TEAM_CR,%d,%lu,%.1f,%.1f,%.1f,%.1f,%.1f,%.1f,%.1f,%.1f,%d,%u", _tdI, (unsigned long)r.t, r.tgt / 10.0, r.ang / 10.0,
           r.est / 10.0, r.err / 10.0, r.gz / 10.0, r.u / 10.0, r.i / 10.0, r.k / 10.0, (int)r.rw, (unsigned)r.fl);
  sendTelemetry(b);
  _tdLines++;
  _tdI += _tdStep;
}

// team-4: MAG_CAL_STOP -> apply the min/max centre as hard-iron offset (+ x/y scale) instead of only reporting it.
// Needs a full turn: both half-ranges > 300 LSB (4.8 uT) and within 2x of each other.
inline void teamMagCalApply() {
  const float hx = ((float)_magMaxX - (float)_magMinX) * 0.5f, hy = ((float)_magMaxY - (float)_magMinY) * 0.5f;
  if (hx < 300 || hy < 300 || hx > 2 * hy || hy > 2 * hx) {
    sendTelemetry("EVT,TEAM_MAG_CAL,NOT_APPLIED,HX," + String(hx, 0) + ",HY," + String(hy, 0) + ",TURN_A_FULL_CIRCLE");
    return;
  }
  TP.magOx = ((float)_magMinX + (float)_magMaxX) * 0.5f;
  TP.magOy = ((float)_magMinY + (float)_magMaxY) * 0.5f;
  TP.magOz = ((float)_magMinZ + (float)_magMaxZ) * 0.5f;
  const float h = (hx + hy) * 0.5f;
  TP.magSx = h / hx; TP.magSy = h / hy;
  for (const char* k : {"mag.ox", "mag.oy", "mag.oz", "mag.sx", "mag.sy"}) { const int i = teamParamFind(k); if (i >= 0) _tpDirty[i] = true; }
  sendTelemetry("EVT,TEAM_MAG_CAL,APPLIED,OX," + String(TP.magOx, 0) + ",OY," + String(TP.magOy, 0) + ",OZ," + String(TP.magOz, 0) +
    ",SX," + String(TP.magSx, 3) + ",SY," + String(TP.magSy, 3) + ",R_UT," + String(h * MAG_SENSITIVITY_UT_PER_LSB, 1));
}

inline bool _teamNeedsManual(const String& key) {
  return key.startsWith("mag.") || key == "sun.model" || key == "adcs.sign" || key == "imu.rsign" || key == "adcs.wrap" || key == "cam.off";
}

inline String teamTelemetryLine() {
  SunSample s;
  sunSensorRead(s);
  const ADCSState a = adcsGet();
  char b[220];
  snprintf(b, sizeof(b),
    "TM,TEAM_T,T,%lu,SEQ,%lu,MVL,%.1f,MVR,%.1f,S,%.5g,D,%.5f,TH,%.3f,ANG,%.3f,NZ,%.3f,SAT,%d,LIT,%d,EST,%.3f,GZ,%.3f,RW,%d,AUTO,%d",
    (unsigned long)millis(), (unsigned long)s.seq, s.mvL, s.mvR, s.teamS, s.teamD, s.teamAngle, s.angleDeg,
    s.noiseDeg, s.sat ? 1 : 0, s.light ? 1 : 0, a.estimatedAngle, a.rate, rwGetAppliedCommand(),
    a.mode == ADCS_AUTO ? 1 : 0);
  return String(b);
}

// what the controller sees and does (Module_ADCS.h state of the last 20 ms step)
inline String teamControlLine() {
  const ADCSState a = adcsGet();
  char b[200];
  snprintf(b, sizeof(b),
    "TM,TEAM_C,T,%lu,M,%d,TGT,%.2f,ANG,%.2f,EST,%.2f,ERR,%.2f,GZ,%.1f,U,%.1f,I,%.1f,K,%.1f,RW,%d,LIT,%d,H,%d,SR,%d,SAT,%d",
    (unsigned long)millis(), a.mode == ADCS_AUTO ? 1 : 0, adcsTargetEff(), _aAng, a.estimatedAngle, a.error, a.rate, a.u, _aI, _aK,
    rwGetAppliedCommand(), _aSunSeen ? 1 : 0, _aHold ? 1 : 0, _aSearch ? 1 : 0, (int)_aSatDir);
  return String(b);
}

inline void teamSendInfo() {
  sendTelemetry("TM,TEAM_FW," TEAM_FW_VERSION ",SUN_MODEL," + String(TP.sunModel) + ",UNSAVED," +
                String(teamParamUnsaved() + (_teamLutDirty ? 1 : 0)) + ",LUT_N," + String(TP.sun.lutN));
}

inline void teamSendLutInfo() {
  double sum = 0;
  for (int i = 0; i < TP.sun.lutN; i++) sum += TP.sun.lutV[i];
  sendTelemetry("TM,TEAM_LUT,N," + String(TP.sun.lutN) + ",X0," + teamFmt(TP.sun.lutX0) + ",DX," +
                teamFmt(TP.sun.lutDx) + ",SUM," + teamFmt(sum) + ",ON," + String(TP.sun.lutOn));
}

inline void teamSendParam(int i) {
  sendTelemetry(String("TM,TEAM_PARAM,") + _tpDefs[i].key + "," + teamFmt(teamParamGet(_tpDefs[i])));
}

// side effects of a changed parameter on the organizer modules
inline void _teamApply(const String& key) {
  if (key == "adcs.kp" || key == "adcs.kd" || key == "adcs.bias")
    adcsTune(TP.adcsKp, TP.adcsKd, (int)lroundf(TP.adcsBias));
}

// ---- F6: gyro Z bias from a still satellite, without blocking the loop (the organizer's GYRO_OFFSET waits 3 s in
// delay() and only prints the result). TEAM_GYRO_ZERO[,ms] or at boot with imu.autoz 1.
// A slowly turning body has a steady gyro reading too, so "still" also needs the sun angle not to move.
#define TEAM_GZ_MAX_SD_DPS 0.5f     // gyro noise is ~0.1 dps; more = something moves or vibrates
#define TEAM_GZ_MAX_DRIFT_DEG 0.3f  // team sun angle change over the window (when the lamp is seen)
struct TeamGyroZero { bool on = false, boot = false, light0 = false; unsigned long t0 = 0, dur = 0, last = 0; double s = 0, s2 = 0; int n = 0; float ang0 = 0; };
static TeamGyroZero _tgz;
static bool _tgzBootDone = false;

inline bool teamGyroZeroStart(unsigned long ms, bool boot) {
  if (!imuGyroReady()) { sendTelemetry("ERR,TEAM_GYRO_ZERO_NO_GYRO"); return false; }
  if (adcsGet().mode == ADCS_AUTO) { sendTelemetry("ERR,TEAM_REQUIRES_MANUAL,TEAM_GYRO_ZERO"); return false; }
  if (rwGetMotorCommand() != 0) { sendTelemetry("ERR,TEAM_GYRO_ZERO_WHEEL_ON"); return false; }
  SunSample s;
  sunSensorRead(s);
  _tgz = TeamGyroZero();
  _tgz.on = true; _tgz.boot = boot; _tgz.t0 = millis(); _tgz.dur = ms; _tgz.light0 = s.light; _tgz.ang0 = s.teamAngle;
  return true;
}

inline void teamGyroZeroUpdate() {
  if (!_tgzBootDone) {  // first loop after boot
    _tgzBootDone = true;
    if (TP.imuAutoZ && imuGyroReady() && teamGyroZeroStart(2000, true)) sendTelemetry("EVT,TEAM_GYRO_ZERO,BOOT,KEEP_STILL");
  }
  if (!_tgz.on) return;
  const unsigned long now = millis();
  if (adcsGet().mode == ADCS_AUTO || rwGetMotorCommand() != 0) { _tgz.on = false; sendTelemetry("ERR,TEAM_GYRO_ZERO_ABORTED"); return; }
  if (now - _tgz.last >= 10) {
    _tgz.last = now;
    IMURawSample r;
    if (imuReadRaw(r)) { const double v = r.gz * GYRO_SENSITIVITY_DPS_PER_LSB; _tgz.s += v; _tgz.s2 += v * v; _tgz.n++; }
  }
  if (now - _tgz.t0 < _tgz.dur) return;
  _tgz.on = false;
  const String tag = _tgz.boot ? "BOOT," : "";
  if (_tgz.n < 50) { sendTelemetry("ERR,TEAM_GYRO_ZERO_SAMPLES," + String(_tgz.n)); return; }
  const double mean = _tgz.s / _tgz.n;
  const double sd = sqrt(fmax(0.0, _tgz.s2 / _tgz.n - mean * mean));
  SunSample s;
  sunSensorRead(s);
  const bool seen = _tgz.light0 && s.light;
  const float drift = seen ? fabsf(s.teamAngle - _tgz.ang0) : 0.0f;
  if (sd > TEAM_GZ_MAX_SD_DPS || drift > TEAM_GZ_MAX_DRIFT_DEG || !(fabs(mean) <= 50.0)) {
    sendTelemetry("ERR,TEAM_GYRO_ZERO_MOVING," + tag + "SD," + teamFmt(sd) + ",DRIFT," + teamFmt(drift));
    return;
  }
  TP.imuGbz = (float)mean;
  if (!_tgz.boot) { const int i = teamParamFind("imu.gbz"); if (i >= 0) _tpDirty[i] = true; }  // boot value: RAM only
  sendTelemetry("EVT,TEAM_GYRO_ZERO," + tag + "BZ," + teamFmt(mean) + ",SD," + teamFmt(sd) + ",N," + String(_tgz.n) +
                ",SUN_CHECK," + String(seen ? 1 : 0));
}

// splits "a,b,c" after the command name; returns the number of fields
inline int _teamFields(const String& s, String* out, int maxN) {
  int n = 0, start = 0;
  while (n < maxN) {
    const int k = s.indexOf(',', start);
    out[n++] = k < 0 ? s.substring(start) : s.substring(start, k);
    if (k < 0) break;
    start = k + 1;
  }
  return n;
}

inline void teamHandleCommand(const String& command) {
  const bool manual = adcsGet().mode != ADCS_AUTO;

  if (command == "TEAM_INFO") { sendTelemetry("ACK,TEAM_INFO"); teamSendInfo(); return; }

  if (command == "TEAM_LIST") {
    sendTelemetry("ACK,TEAM_LIST," + String(TEAM_PARAM_COUNT));
    for (int i = 0; i < TEAM_PARAM_COUNT; i++) teamSendParam(i);
    teamSendLutInfo();
    return;
  }

  if (command.startsWith("TEAM_GET,")) {
    const String key = command.substring(9);
    const int i = teamParamFind(key);
    if (i < 0) { sendTelemetry("ERR,TEAM_UNKNOWN_KEY," + key); return; }
    sendTelemetry("ACK,TEAM_GET," + key);
    teamSendParam(i);
    return;
  }

  if (command.startsWith("TEAM_SET,")) {
    String f[3];
    if (_teamFields(command.substring(9), f, 3) != 2) { sendTelemetry("ERR,TEAM_SET_SYNTAX"); return; }
    const int i = teamParamFind(f[0]);
    if (i < 0) { sendTelemetry("ERR,TEAM_UNKNOWN_KEY," + f[0]); return; }
    double v;
    if (!teamParseNum(f[1], v)) { sendTelemetry("ERR,TEAM_VALUE," + f[0]); return; }
    const TeamParamDef& d = _tpDefs[i];
    if (!teamParamValid(d, v)) {
      if (d.type == TPT_SIGN) sendTelemetry("ERR,TEAM_RANGE," + f[0] + ",-1|1");
      else sendTelemetry("ERR,TEAM_RANGE," + f[0] + "," + teamFmt(d.mn) + "," + teamFmt(d.mx));
      return;
    }
    if (!manual && _teamNeedsManual(f[0])) { sendTelemetry("ERR,TEAM_REQUIRES_MANUAL," + f[0]); return; }
    _teamParamStore(d, v);
    _tpDirty[i] = true;
    _teamApply(f[0]);
    sendTelemetry("ACK,TEAM_SET," + f[0] + "," + teamFmt(teamParamGet(d)));
    return;
  }

  if (command == "TEAM_SAVE") {
    if (!manual) { sendTelemetry("ERR,TEAM_REQUIRES_MANUAL,TEAM_SAVE"); return; }  // team-4: a flash write stalls both cores
    const int n = teamParamsSave();
    if (n < 0) { sendTelemetry("ERR,TEAM_SAVE_FLASH"); return; }
    sendTelemetry("ACK,TEAM_SAVE," + String(n));
    return;
  }

  if (command == "TEAM_DEFAULTS,YES") {
    if (!manual) { sendTelemetry("ERR,TEAM_REQUIRES_MANUAL,TEAM_DEFAULTS"); return; }
    teamParamsRestoreDefaults();
    teamParamsClearFlash();
    adcsTune(TP.adcsKp, TP.adcsKd, (int)lroundf(TP.adcsBias));
    for (int i = 0; i < TEAM_PARAM_COUNT; i++) _tpDirty[i] = false;
    sendTelemetry("ACK,TEAM_DEFAULTS");
    teamSendInfo();
    return;
  }
  if (command == "TEAM_DEFAULTS") { sendTelemetry("ERR,TEAM_DEFAULTS_NEEDS_YES"); return; }

  if (command.startsWith("TEAM_LUT_BEGIN,")) {
    String f[4];
    double x0, dx, n;
    if (_teamFields(command.substring(15), f, 4) != 3 || !teamParseNum(f[0], x0) || !teamParseNum(f[1], dx) ||
        !teamParseNum(f[2], n) || !(dx > 0) || n < 1 || n > TEAM_LUT_MAX || n != floor(n)) {
      sendTelemetry("ERR,TEAM_LUT_BEGIN_SYNTAX");
      return;
    }
    _teamLutStageN = (int)n; _teamLutStageX0 = x0; _teamLutStageDx = dx;
    for (int i = 0; i < TEAM_LUT_MAX; i++) _teamLutStageHave[i] = false;
    _teamLutStaging = true;
    sendTelemetry("ACK,TEAM_LUT_BEGIN," + String(_teamLutStageN));
    return;
  }

  if (command.startsWith("TEAM_LUT_DATA,")) {
    if (!_teamLutStaging) { sendTelemetry("ERR,TEAM_LUT_NOT_STARTED"); return; }
    static String f[40];
    const int nf = _teamFields(command.substring(14), f, 40);
    double i0;
    if (nf < 2 || !teamParseNum(f[0], i0) || i0 < 0 || i0 != floor(i0)) { sendTelemetry("ERR,TEAM_LUT_DATA_SYNTAX"); return; }
    for (int k = 1; k < nf; k++) {
      double v;
      const int idx = (int)i0 + k - 1;
      if (idx >= _teamLutStageN || !teamParseNum(f[k], v) || fabs(v) > 90) { sendTelemetry("ERR,TEAM_LUT_DATA_VALUE," + String(idx)); return; }
      _teamLutStage[idx] = (float)v;
      _teamLutStageHave[idx] = true;
    }
    sendTelemetry("ACK,TEAM_LUT_DATA," + String((int)i0) + "," + String(nf - 1));
    return;
  }

  if (command == "TEAM_LUT_END") {
    if (!_teamLutStaging) { sendTelemetry("ERR,TEAM_LUT_NOT_STARTED"); return; }
    int missing = 0;
    for (int i = 0; i < _teamLutStageN; i++) missing += _teamLutStageHave[i] ? 0 : 1;
    if (missing) { sendTelemetry("ERR,TEAM_LUT_INCOMPLETE," + String(missing)); return; }
    teamLutInstall(_teamLutStage, _teamLutStageN, _teamLutStageX0, _teamLutStageDx);
    _teamLutStaging = false;
    _teamLutDirty = true;
    sendTelemetry("ACK,TEAM_LUT_END," + String(TP.sun.lutN));
    teamSendLutInfo();
    return;
  }

  if (command == "TEAM_LUT_CLEAR") {
    teamLutInstall(nullptr, 0, 0, 1);
    _teamLutStaging = false;
    _teamLutDirty = true;
    sendTelemetry("ACK,TEAM_LUT_CLEAR");
    return;
  }

  if (command == "TEAM_LUT_INFO") { sendTelemetry("ACK,TEAM_LUT_INFO"); teamSendLutInfo(); return; }

  if (command == "TEAM_GYRO_ZERO" || command.startsWith("TEAM_GYRO_ZERO,")) {
    double ms = 2000;
    if (command.length() > 14 && (!teamParseNum(command.substring(15), ms) || ms < 500 || ms > 10000)) { sendTelemetry("ERR,TEAM_GYRO_ZERO_RANGE_500_TO_10000"); return; }
    if (teamGyroZeroStart((unsigned long)ms, false)) sendTelemetry("ACK,TEAM_GYRO_ZERO," + String((unsigned long)ms));
    return;
  }

  if (command == "TEAM_SUN") { sendTelemetry("ACK,TEAM_SUN"); sendTelemetry(teamTelemetryLine()); return; }

  if (command.startsWith("TEAM_STREAM,")) {
    double hz;
    if (!teamParseNum(command.substring(12), hz) || hz < 0 || hz > 20 || hz != floor(hz)) { sendTelemetry("ERR,TEAM_STREAM_RANGE_0_TO_20"); return; }
    TP.tmHz = (int)hz;
    const int i = teamParamFind("team.tm");
    if (i >= 0) _tpDirty[i] = true;
    sendTelemetry("ACK,TEAM_STREAM," + String(TP.tmHz));
    return;
  }

  if (command.startsWith("TEAM_CREC,")) {
    double d;
    if (!teamParseNum(command.substring(10), d) || d < 0 || d > 50 || d != floor(d)) { sendTelemetry("ERR,TEAM_CREC_RANGE_0_TO_50"); return; }
    _recDiv = (int)d;
    sendTelemetry("ACK,TEAM_CREC," + String(_recDiv) + ",N," + String(_recN) + ",FULL," + String(_recFull ? 1 : 0));
    return;
  }

  if (command == "TEAM_CDUMP" || command.startsWith("TEAM_CDUMP,")) {
    double st = 1;
    if (command.length() > 10 && (!teamParseNum(command.substring(11), st) || st < 1 || st > 50 || st != floor(st))) { sendTelemetry("ERR,TEAM_CDUMP_STEP_1_TO_50"); return; }
    if (!manual) { sendTelemetry("ERR,TEAM_REQUIRES_MANUAL,TEAM_CDUMP"); return; }
    _tdStep = (int)st; _tdI = 0; _tdOn = true; _tdLines = 0; _tdLast = millis();
    sendTelemetry("ACK,TEAM_CDUMP," + String((_recN + _tdStep - 1) / _tdStep));
    if (_recEntry[0]) sendTelemetry(String("TM,TEAM_CR_AUTO,") + (_recEntry + 14));  // drop "EVT,TEAM_AUTO,"
    sendTelemetry("TM,TEAM_CR_HEAD,N," + String(_recN) + ",DIV," + String(_recDiv) + ",COLS,i;t;tgt;ang;est;err;gz;u;I;K;rw;fl");
    return;
  }

  if (command.startsWith("TEAM_CSTREAM,")) {
    double hz;
    if (!teamParseNum(command.substring(13), hz) || hz < 0 || hz > 20 || hz != floor(hz)) { sendTelemetry("ERR,TEAM_CSTREAM_RANGE_0_TO_20"); return; }
    _teamCHz = (int)hz;
    sendTelemetry("ACK,TEAM_CSTREAM," + String(_teamCHz));
    return;
  }

  sendTelemetry("ERR,TEAM_UNKNOWN_COMMAND");
}

static unsigned long _teamTmLast = 0, _teamCLast = 0;
inline void teamTelemetryUpdate() {
  teamGyroZeroUpdate();  // F6 (here so the organizer's loop() keeps one team call)
  const unsigned long now = millis();
  teamDumpUpdate();
  if (_teamCHz > 0 && now - _teamCLast >= 1000UL / (unsigned long)_teamCHz) { _teamCLast = now; sendTelemetry(teamControlLine()); }
  if (TP.tmHz <= 0) return;
  if (now - _teamTmLast < 1000UL / (unsigned long)TP.tmHz) return;
  _teamTmLast = now;
  teamSendUsb(teamTelemetryLine());
}
