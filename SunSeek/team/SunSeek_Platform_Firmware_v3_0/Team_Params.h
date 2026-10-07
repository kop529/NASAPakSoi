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

#define TEAM_FW_VERSION "NasaPakSoi-team-7"
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
  // compass (team-4): the organizer MAG_CAL only REPORTS offsets ("SAVE_VALUES_TO_CONFIG_IMU" = edit the code and upload again);
  // here MAG_CAL_STOP writes them to these params (RAM, TEAM_SAVE keeps them). Raw LSB; scale x/y only (the rig turns in yaw only).
  float magOx = 0, magOy = 0, magOz = 0, magSx = 1, magSy = 1, magH0 = 0;
  // F6 (team-4): failed sensor reads in AUTO tolerated in a row before FAULT, keeping the last wheel command (0 = organizer:
  // FAULT at once -> rwStop -> the wheel coasts and gives its stored momentum (16-20 % in hold) to the body)
  int adcsMiss = 5;
  // team-5: SUN estimate wrapped to +-180 (1) or unbounded like the organizer (0)
  int estWrap = 1;
  // team-6 mission 2 (Team_Mission.h): the GS Competition tab names (PREPARE / START_MISSION / ABORT / MISSION_*) run the team
  // mission (1) or stay with the organizer router (0 = ERR,MISSION_NOT_AVAILABLE_T04 as in v3.0). TEAM_MIS_GO works either way.
  int misOn = 0;
  float misTol = 3, misHold = 2;  // TEAM_MIS_GO tolerance (deg) / hold (s) per target (the GS sends its own)
  float misCapMs = 6000;          // no IMAGE_READY after this -> CAPTURE again (3 tries)
  float misGap = 2500;            // ms between MISSION,RESULT,IMAGE lines (the GS reads the name back 300 ms later)
  // team-7: after the hold, CAPTURE only when |error| <= mis.capErr deg and |rate| <= mis.capRate deg/s (0 = no check);
  // still not there mis.waitMs later -> CAPTURE anyway (inside the tolerance)
  float misCapErr = 1.5, misCapRate = 3, misWaitMs = 4000;
  // team-7: 1 = ADCS_TUNE (sent by every GS PREPARE / RUN / Competition PREPARE) keeps our adcs.kp/kd/bias and answers
  // ACK with them + EVT,TEAM_KEEP_TUNE,IGNORED,<their values>; 0 = organizer (the GS numbers replace ours in RAM)
  int adcsKeepTune = 0;
  // team-7: 1 = the gyro hold (adcs.ghold) is on while a team mission runs (also after COMPLETE while still in AUTO).
  // Sim: adcs.ghold 0 + target 75 / 85 deg (past the sun sensor) -> the body spins and never captures; on -> within 1.5 deg
  int misGhold = 1;
  // team-7 plan B (a target never stalls the mission): mis.targetS without an image -> shoot at the first sample inside the
  // tolerance (no hold, no capture gate); mis.skipS -> give the target up, next one. Both counted from the target start;
  // with a GS time limit the skip comes earlier so every remaining target gets a share (>= 8 s). 0 = off.
  float misTargetS = 30, misSkipS = 45;
  float misTrust = 45;  // deg: with mis.ghold, sun readings beyond this are left to the gyro (0 = trust every lit reading)
  // reaction wheel characterization from T01
  float rwMinStart = RW_MIN_START_PERCENT;
  float rwMinStable = RW_MIN_START_PERCENT;
  // F4: wheel deadzone compensation in REACTION mode (0 = organizer law, 1 = command starts at rw.minStart/minStable)
  int adcsDzc = 0;
  // F4: integral gain (%/(deg*s), 0 = organizer law). The wheel PWM sets wheel SPEED, so Kp*e alone ends where the
  // wheel speed left by bearing drag needs Kp*e = that PWM (sim: 4.8 deg short); the integrator supplies that PWM.
  float adcsKi = 0;
  // wheel command slew limit in %/s (0 = organizer behaviour: jump at once). A jump +100 -> -100 puts ~2x the
  // supply across the spinning motor: a current spike, a body kick that threw the balance ring off (5 Oct), a brown-out risk.
  float rwSlew = 0;
  // F6: 1 = measure the gyro Z bias at boot when the satellite is still (RAM only; TEAM_GYRO_ZERO + TEAM_SAVE keeps one)
  int imuAutoZ = 0;
  // F7: sun search in AUTO when the lamp is not seen (no usable light or at the edge of the field of view):
  // turn at adcs.srate deg/s (0 = off, organizer behaviour) toward where the light was last seen; adcs.sk = rate loop gain
  float adcsSrate = 0;
  float adcsSk = 1;
  // F5: hold at the target. Inside adcs.lock deg for adcs.lockMs -> HOLD: the deadband widens to adcs.lock (the wheel
  // keeps its speed instead of twitching) and Kp/Kd/Ki x adcs.hgain; out again only past adcs.unlock deg (hysteresis).
  // adcs.lock 0 = off (organizer law)
  float adcsLock = 0;
  float adcsUnlock = 2;
  float adcsLockMs = 500;
  float adcsHgain = 0.5;
  // F4 stiction kick: outside the deadband but the body has not moved (gyro under adcs.krate deg/s) for adcs.kickMs
  // -> step the wheel command by adcs.kick % toward the target (a torque impulse that breaks the platform static
  // friction; 5 Oct: +-10..15 % steps did not move the body, +20 % while it turned moved it at once). The step
  // fades with a 2 s time constant. adcs.kick 0 = off.
  float adcsKick = 0;
  float adcsKickMs = 1500;  // sim scan 5 Oct: 600 ms also kicked at the turning points of a slow swing
  float adcsKrate = 1;
  int adcsGhold = 0;     // F8: lamp not seen (SUN reference) -> the angle continues on the gyro alone (adcs.ghold)
  int adcsRetarget = 0;  // SET_TARGET accepted in AUTO (adcs.retarget)
  // 1 = SUN pointing error the short way round (wrap +-180) + estimate re-synced to the sun angle at AUTO entry when the
  // lamp is seen. 0 = organizer: error = target - estimate, and the estimate keeps every whole turn made since boot
  // (6 Oct 15:36: AUTO unwound 3 turns first). Default ON: a fix, it changes nothing while the body never turned a full turn.
  int adcsWrap = 1;
  int adcsAw = 1;        // anti-windup: no integrating further while the wheel command is at +-adcs.max (only with adcs.ki > 0)
  // stuck with the wheel at +-adcs.max toward the target (kick on): back off adcs.kick % over adcs.ratchet ms, then jump
  // back to the limit (a torque step). 0 = off (kicks are then just skipped while saturated, with adcs.aw 1)
  float adcsRatchet = 1500;
  float camOff = 0;      // the controller points (target + cam.off) deg: camera fixed 90 deg from the sun sensor (fallback)
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
  {"adcs.miss",   TPT_INT,    &TP.adcsMiss,      0, 0, 25},
  {"est.wrap",    TPT_INT,    &TP.estWrap,       0, 0, 1},
  {"mis.on",      TPT_INT,    &TP.misOn,         0, 0, 1},
  {"mis.tol",     TPT_FLOAT,  &TP.misTol,        0, 0.1, 30},
  {"mis.hold",    TPT_FLOAT,  &TP.misHold,       0, 0, 60},
  {"mis.capMs",   TPT_FLOAT,  &TP.misCapMs,      0, 1000, 20000},
  {"mis.gap",     TPT_FLOAT,  &TP.misGap,        0, 500, 10000},
  {"mis.capErr",  TPT_FLOAT,  &TP.misCapErr,     0, 0, 30},
  {"mis.capRate", TPT_FLOAT,  &TP.misCapRate,    0, 0, 100},
  {"mis.waitMs",  TPT_FLOAT,  &TP.misWaitMs,     0, 0, 60000},
  {"adcs.keepTune",TPT_INT,   &TP.adcsKeepTune,  0, 0, 1},
  {"mis.ghold",   TPT_INT,    &TP.misGhold,      0, 0, 1},
  {"mis.trust",   TPT_FLOAT,  &TP.misTrust,      0, 0, 90},
  {"mis.targetS", TPT_FLOAT,  &TP.misTargetS,    0, 0, 600},
  {"mis.skipS",   TPT_FLOAT,  &TP.misSkipS,      0, 0, 600},
  {"mag.ox",      TPT_FLOAT,  &TP.magOx,         0, -20000, 20000},
  {"mag.oy",      TPT_FLOAT,  &TP.magOy,         0, -20000, 20000},
  {"mag.oz",      TPT_FLOAT,  &TP.magOz,         0, -20000, 20000},
  {"mag.sx",      TPT_FLOAT,  &TP.magSx,         0, 0.5, 2},
  {"mag.sy",      TPT_FLOAT,  &TP.magSy,         0, 0.5, 2},
  {"mag.h0",      TPT_FLOAT,  &TP.magH0,         0, -180, 180},
  {"rw.minStart", TPT_FLOAT,  &TP.rwMinStart,    0, 0, 100},
  {"rw.minStable",TPT_FLOAT,  &TP.rwMinStable,   0, 0, 100},
  {"adcs.dzc",    TPT_INT,    &TP.adcsDzc,       0, 0, 1},
  {"adcs.ki",     TPT_FLOAT,  &TP.adcsKi,        0, 0, 10},
  {"rw.slew",     TPT_FLOAT,  &TP.rwSlew,        0, 0, 5000},
  {"imu.autoz",   TPT_INT,    &TP.imuAutoZ,      0, 0, 1},
  {"adcs.srate",  TPT_FLOAT,  &TP.adcsSrate,     0, 0, 60},
  {"adcs.sk",     TPT_FLOAT,  &TP.adcsSk,        0, 0, 20},
  {"adcs.lock",   TPT_FLOAT,  &TP.adcsLock,      0, 0, 10},
  {"adcs.unlock", TPT_FLOAT,  &TP.adcsUnlock,    0, 0, 30},
  {"adcs.lockMs", TPT_FLOAT,  &TP.adcsLockMs,    0, 0, 10000},
  {"adcs.hgain",  TPT_FLOAT,  &TP.adcsHgain,     0, 0.05, 1},
  {"adcs.kick",   TPT_FLOAT,  &TP.adcsKick,      0, 0, 60},
  {"adcs.kickMs", TPT_FLOAT,  &TP.adcsKickMs,    0, 100, 10000},
  {"adcs.krate",  TPT_FLOAT,  &TP.adcsKrate,     0, 0, 30},
  {"adcs.ghold",  TPT_INT,    &TP.adcsGhold,      0, 0, 1},
  {"adcs.retarget", TPT_INT,  &TP.adcsRetarget,   0, 0, 1},
  {"adcs.wrap",   TPT_INT,    &TP.adcsWrap,      0, 0, 1},
  {"adcs.aw",     TPT_INT,    &TP.adcsAw,        0, 0, 1},
  {"adcs.ratchet",TPT_FLOAT,  &TP.adcsRatchet,   0, 0, 10000},
  {"cam.off",     TPT_FLOAT,  &TP.camOff,        0, -180, 180},
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
    if (prefs.putDouble(_tpDefs[i].key, teamParamGet(_tpDefs[i])) == 0) { prefs.end(); return -1; }  // team-4: report a failed write
    _tpDirty[i] = false;
    n++;
  }
  if (_teamLutDirty) {
    prefs.putInt("lut.n", TP.sun.lutN);
    prefs.putDouble("lut.x0", TP.sun.lutX0);
    prefs.putDouble("lut.dx", TP.sun.lutDx);
    if (TP.sun.lutN > 0) { if (prefs.putBytes("lut.v", TP.sun.lutV, TP.sun.lutN * sizeof(float)) == 0) { prefs.end(); return -1; } }
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
