#pragma once

/* TEAM NasaPakSoi — team telecommands and team telemetry.

   All team commands start with TEAM_ so they can never collide with an organizer command, and all
   replies use the organizer's line format (ACK / ERR / TM key,value) so the Ground Station terminal
   shows them like any other line.

     TEAM_INFO                        TM,TEAM_FW,<version>,SUN_MODEL,<0|1>,UNSAVED,<n>,LUT_N,<n>
     TEAM_LIST                        one TM,TEAM_PARAM,<key>,<value> per parameter
     TEAM_GET,<key>                   TM,TEAM_PARAM,<key>,<value>
     TEAM_SET,<key>,<value>           ACK,TEAM_SET,<key>,<value>   (RAM only until TEAM_SAVE)
     TEAM_SAVE                        ACK,TEAM_SAVE,<n>            (flash; survives reset/power-off)
     TEAM_DEFAULTS,YES                ACK,TEAM_DEFAULTS            (organizer defaults + clears flash; MANUAL only)
     TEAM_LUT_BEGIN,<x0>,<dx>,<n>     start a new LUT (n <= 256 values on the grid x0 + i*dx of the raw angle)
     TEAM_LUT_DATA,<i0>,<v>,<v>,...   values i0, i0+1, ... (keep each line < 240 characters)
     TEAM_LUT_END                     ACK,TEAM_LUT_END,<n> + TM,TEAM_LUT,...  (installs it; TEAM_SAVE keeps it)
     TEAM_LUT_CLEAR / TEAM_LUT_INFO
     TEAM_SUN                         one TM,TEAM_T line now
     TEAM_STREAM,<0..20>              TM,TEAM_T at that rate over USB only (0 = off) = TEAM_SET,team.tm

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

inline bool _teamNeedsManual(const String& key) {
  return key == "sun.model" || key == "adcs.sign" || key == "imu.rsign";
}

inline String teamTelemetryLine() {
  SunSample s;
  sunSensorRead(s);
  const ADCSState a = adcsGet();
  char b[220];
  snprintf(b, sizeof(b),
    "TM,TEAM_T,T,%lu,SEQ,%lu,MVL,%.1f,MVR,%.1f,S,%.5g,D,%.5f,TH,%.3f,ANG,%.3f,NZ,%.3f,SAT,%d,LIT,%d,EST,%.3f,GZ,%.3f,RW,%d,AUTO,%d",
    (unsigned long)millis(), (unsigned long)s.seq, s.mvL, s.mvR, s.teamS, s.teamD, s.teamAngle, s.angleDeg,
    s.noiseDeg, s.sat ? 1 : 0, s.light ? 1 : 0, a.estimatedAngle, a.rate, rwGetMotorCommand(),
    a.mode == ADCS_AUTO ? 1 : 0);
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

  sendTelemetry("ERR,TEAM_UNKNOWN_COMMAND");
}

static unsigned long _teamTmLast = 0;
inline void teamTelemetryUpdate() {
  if (TP.tmHz <= 0) return;
  const unsigned long now = millis();
  if (now - _teamTmLast < 1000UL / (unsigned long)TP.tmHz) return;
  _teamTmLast = now;
  teamSendUsb(teamTelemetryLine());
}
