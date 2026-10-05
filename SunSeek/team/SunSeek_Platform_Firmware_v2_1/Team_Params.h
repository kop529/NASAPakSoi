#pragma once

/* TEAM NasaPakSoi — runtime parameters stored in flash (NVS).

   Every value the team tunes on the bench can be changed with TEAM_SET and kept with TEAM_SAVE,
   so tuning in the contest room needs no re-upload, and a reset (brown-out from the wheel motor,
   a cable knock) does not lose the tuned values.

   Defaults are the organizer's Config_*.h values, so an empty flash behaves exactly like v2.1
   (sun.model 0 = the organizer's estimateSunAngle(NDV)).

   NVS keys are the parameter keys themselves (all are <= 15 characters, the NVS limit). */

#include <Arduino.h>
#include <Preferences.h>
#include "Config_ADCS.h"
#include "Config_Actuator.h"
#include "Config_Sensor.h"
#include "Team_SunModel.h"

#define TEAM_FW_VERSION "NasaPakSoi-team-1"
#define TEAM_NVS_NAMESPACE "nps"

struct TeamParams {
  // sun sensor
  int sunModel = 0;            // 0 = organizer estimateSunAngle(NDV), 1 = team model (needs a calibration)
  int sunWinMs = 20;           // averaging window; a multiple of 10 ms cancels 100 Hz lamp flicker
  float sunSatHi = 3050;       // mV at/above this = ADC clipped (topo 0: too much light)
  float sunSatLo = 60;         // mV at/below this = ADC clipped (topo 1: too much light)
  TeamSunParams sun;
  // ADCS (organizer defaults)
  float adcsKp = ADCS_DEFAULT_KP;
  float adcsKd = ADCS_DEFAULT_KD;
  float adcsBias = RW_DEFAULT_BIAS_PERCENT;
  float adcsDb = ADCS_DEADBAND_DEG;
  float adcsMax = ADCS_MAX_RW_COMMAND;
  float adcsSign = ADCS_CONTROL_SIGN;
  // IMU (organizer defaults)
  float imuGbz = GYRO_BIAS_Z_DPS;
  float imuRsign = IMU_BODY_RATE_SIGN;
  // reaction wheel characterization from T01
  float rwMinStart = RW_MIN_START_PERCENT;
  float rwMinStable = RW_MIN_START_PERCENT;
  // team telemetry over USB, 0 = off
  int tmHz = 0;
};

static TeamParams TP;

// ---- parameter table ----
enum TeamParamType : uint8_t { TPT_INT, TPT_FLOAT, TPT_DOUBLE, TPT_SIGN };

struct TeamParamDef {
  const char* key;
  TeamParamType type;
  void* ptr;
  double def, mn, mx;
};

// Built at boot from TP's initial values, so the defaults live in one place (the struct above).
static TeamParamDef _tpDefs[] = {
  {"sun.model",   TPT_INT,    &TP.sunModel,      0, 0, 1},
  {"sun.win",     TPT_INT,    &TP.sunWinMs,      0, 10, 200},
  {"sun.satHi",   TPT_FLOAT,  &TP.sunSatHi,      0, 500, 5000},
  {"sun.satLo",   TPT_FLOAT,  &TP.sunSatLo,      0, 0, 2000},
  {"sun.vcc",     TPT_DOUBLE, &TP.sun.vcc,       0, 1000, 5000},
  {"sun.topo",    TPT_INT,    &TP.sun.topo,      0, 0, 1},
  {"sun.gamma",   TPT_DOUBLE, &TP.sun.gamma,     0, 0.05, 3},
  {"sun.gammaR",  TPT_DOUBLE, &TP.sun.gammaR,    0, 0, 3},
  {"sun.qL",      TPT_DOUBLE, &TP.sun.qL,        0, 0.2, 5},
  {"sun.qR",      TPT_DOUBLE, &TP.sun.qR,        0, 0.2, 5},
  {"sun.alpha",   TPT_DOUBLE, &TP.sun.alpha,     0, 1, 89},
  {"sun.g",       TPT_DOUBLE, &TP.sun.g,         0, 0.01, 100},
  {"sun.aL",      TPT_DOUBLE, &TP.sun.aL,        0, 0, 1e9},
  {"sun.aR",      TPT_DOUBLE, &TP.sun.aR,        0, 0, 1e9},
  {"sun.th0",     TPT_DOUBLE, &TP.sun.th0,       0, -90, 90},
  {"sun.minS",    TPT_DOUBLE, &TP.sun.minS,      0, 0, 1e9},
  {"sun.dmax",    TPT_DOUBLE, &TP.sun.dmax,      0, 0, 1},
  {"sun.lut",     TPT_INT,    &TP.sun.lutOn,     0, 0, 1},
  {"adcs.kp",     TPT_FLOAT,  &TP.adcsKp,        0, 0, ADCS_KP_MAX},
  {"adcs.kd",     TPT_FLOAT,  &TP.adcsKd,        0, 0, ADCS_KD_MAX},
  {"adcs.bias",   TPT_FLOAT,  &TP.adcsBias,      0, 0, 100},
  {"adcs.db",     TPT_FLOAT,  &TP.adcsDb,        0, 0, 30},
  {"adcs.max",    TPT_FLOAT,  &TP.adcsMax,       0, 0, 100},
  {"adcs.sign",   TPT_SIGN,   &TP.adcsSign,      0, -1, 1},
  {"imu.gbz",     TPT_FLOAT,  &TP.imuGbz,        0, -50, 50},
  {"imu.rsign",   TPT_SIGN,   &TP.imuRsign,      0, -1, 1},
  {"rw.minStart", TPT_FLOAT,  &TP.rwMinStart,    0, 0, 100},
  {"rw.minStable",TPT_FLOAT,  &TP.rwMinStable,   0, 0, 100},
  {"team.tm",     TPT_INT,    &TP.tmHz,          0, 0, 20},
};
static const int TEAM_PARAM_COUNT = sizeof(_tpDefs) / sizeof(_tpDefs[0]);
static bool _tpDirty[sizeof(_tpDefs) / sizeof(_tpDefs[0])];

inline double teamParamGet(const TeamParamDef& d) {
  switch (d.type) {
    case TPT_INT: return *(int*)d.ptr;
    case TPT_DOUBLE: return *(double*)d.ptr;
    default: return *(float*)d.ptr;
  }
}

inline void _teamParamStore(const TeamParamDef& d, double v) {
  switch (d.type) {
    case TPT_INT: *(int*)d.ptr = (int)lround(v); break;
    case TPT_DOUBLE: *(double*)d.ptr = v; break;
    default: *(float*)d.ptr = (float)v; break;
  }
}

inline bool teamParamValid(const TeamParamDef& d, double v) {
  if (!isfinite(v)) return false;
  if (d.type == TPT_SIGN) return v == 1.0 || v == -1.0;
  if (d.type == TPT_INT && fabs(v - lround(v)) > 1e-9) return false;
  return v >= d.mn && v <= d.mx;
}

inline int teamParamFind(const String& key) {
  for (int i = 0; i < TEAM_PARAM_COUNT; i++) if (key == _tpDefs[i].key) return i;
  return -1;
}

inline int teamParamUnsaved() {
  int n = 0;
  for (int i = 0; i < TEAM_PARAM_COUNT; i++) n += _tpDirty[i] ? 1 : 0;
  return n;
}

// "%.6g" keeps tiny ambient values (1e-5) and large ones readable in one short token
inline String teamFmt(double v) {
  char b[24];
  snprintf(b, sizeof(b), "%.6g", v);
  return String(b);
}

inline bool teamParseNum(String s, double& v) {
  s.trim();
  if (!s.length()) return false;
  char* e = nullptr;
  v = strtod(s.c_str(), &e);
  return e && *e == '\0' && isfinite(v);
}

// ---- LUT: staged while TEAM_LUT_DATA lines arrive, then installed in one step ----
// Two live buffers: the sun sampler task keeps reading the old one while the new one is written.
static float _teamLutBuf[2][TEAM_LUT_MAX];
static int _teamLutActive = 0;
static float _teamLutStage[TEAM_LUT_MAX];
static bool _teamLutStageHave[TEAM_LUT_MAX];
static int _teamLutStageN = 0;
static double _teamLutStageX0 = 0, _teamLutStageDx = 1;
static bool _teamLutStaging = false;
static bool _teamLutDirty = false;
static portMUX_TYPE _teamMux = portMUX_INITIALIZER_UNLOCKED;

inline void teamLutInstall(const float* v, int n, double x0, double dx) {
  const int next = 1 - _teamLutActive;
  for (int i = 0; i < n; i++) _teamLutBuf[next][i] = v[i];
  portENTER_CRITICAL(&_teamMux);
  _teamLutActive = next;
  TP.sun.lutV = n > 0 ? _teamLutBuf[next] : nullptr;
  TP.sun.lutN = n;
  TP.sun.lutX0 = x0;
  TP.sun.lutDx = dx;
  portEXIT_CRITICAL(&_teamMux);
}

// A consistent copy of the sun parameters for the sampler task (the LUT pointer stays valid
// until the NEXT install, and installs come seconds apart from typed/serial commands).
inline TeamSunParams teamSunParamsSnapshot() {
  portENTER_CRITICAL(&_teamMux);
  TeamSunParams p = TP.sun;
  portEXIT_CRITICAL(&_teamMux);
  return p;
}

// ---- NVS ----
inline void teamParamsLoad() {
  Preferences prefs;
  if (!prefs.begin(TEAM_NVS_NAMESPACE, true)) return;  // nothing saved yet
  for (int i = 0; i < TEAM_PARAM_COUNT; i++) {
    const TeamParamDef& d = _tpDefs[i];
    if (!prefs.isKey(d.key)) continue;
    const double v = prefs.getDouble(d.key, teamParamGet(d));
    if (teamParamValid(d, v)) _teamParamStore(d, v);  // a bad saved value never loads
  }
  const int n = prefs.getInt("lut.n", 0);
  if (n > 0 && n <= TEAM_LUT_MAX && prefs.getBytesLength("lut.v") == (size_t)n * sizeof(float)) {
    static float tmp[TEAM_LUT_MAX];
    prefs.getBytes("lut.v", tmp, n * sizeof(float));
    const double dx = prefs.getDouble("lut.dx", 1);
    if (dx > 0) teamLutInstall(tmp, n, prefs.getDouble("lut.x0", 0), dx);
  }
  prefs.end();
}

inline int teamParamsSave() {
  Preferences prefs;
  if (!prefs.begin(TEAM_NVS_NAMESPACE, false)) return -1;
  int n = 0;
  for (int i = 0; i < TEAM_PARAM_COUNT; i++) {
    prefs.putDouble(_tpDefs[i].key, teamParamGet(_tpDefs[i]));
    _tpDirty[i] = false;
    n++;
  }
  if (_teamLutDirty) {
    prefs.putInt("lut.n", TP.sun.lutN);
    prefs.putDouble("lut.x0", TP.sun.lutX0);
    prefs.putDouble("lut.dx", TP.sun.lutDx);
    if (TP.sun.lutN > 0) prefs.putBytes("lut.v", TP.sun.lutV, TP.sun.lutN * sizeof(float));
    else prefs.remove("lut.v");
    _teamLutDirty = false;
  }
  prefs.end();
  return n;
}

inline void teamParamsClearFlash() {
  Preferences prefs;
  if (prefs.begin(TEAM_NVS_NAMESPACE, false)) { prefs.clear(); prefs.end(); }
}

// Remember the compiled-in defaults (TP's initializers) so TEAM_DEFAULTS can restore them.
inline void teamParamsCaptureDefaults() {
  for (int i = 0; i < TEAM_PARAM_COUNT; i++) _tpDefs[i].def = teamParamGet(_tpDefs[i]);
}

inline void teamParamsRestoreDefaults() {
  for (int i = 0; i < TEAM_PARAM_COUNT; i++) { _teamParamStore(_tpDefs[i], _tpDefs[i].def); _tpDirty[i] = false; }
  teamLutInstall(nullptr, 0, 0, 1);
  _teamLutDirty = false;
}

inline void teamParamsBegin() {
  teamParamsCaptureDefaults();
  teamParamsLoad();
}
