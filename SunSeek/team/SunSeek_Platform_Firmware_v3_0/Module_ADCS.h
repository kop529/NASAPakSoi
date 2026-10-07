#pragma once

/* SunSeek Platform v2.0 — MODULE LAYER */
#include <Arduino.h>
#include <math.h>
#include "Config_ADCS.h"
#include "Module_IMU.h"
#include "Module_SunSensor.h"
#include "Module_ReactionWheel.h"
#include "Module_Estimator.h"
#include "System_TTC.h"  // TEAM NasaPakSoi F7: sendTelemetry for the search events

enum ADCSMode { ADCS_MANUAL, ADCS_AUTO };
enum ADCSReference { ADCS_SUN, ADCS_MAG };

struct ADCSState {
  ADCSMode mode;
  ADCSReference ref;
  float target, kp, kd;
  int bias;

  // Raw sensor-domain errors retained for Engineering telemetry.
  float sunError, magError;

  // Controller-domain values.
  float error, rate, u;

  // Estimation chain.
  float rawReference;
  float filteredReference;
  float estimatedAngle;

  bool valid;
};

static ADCSState _a = {
  ADCS_MANUAL, ADCS_SUN,
  ADCS_DEFAULT_TARGET_DEG, ADCS_DEFAULT_KP, ADCS_DEFAULT_KD,
  RW_DEFAULT_BIAS_PERCENT,
  0, 0, 0, 0, 0,
  0, 0, 0,
  false
};

static unsigned long _aLast = 0;
static float _aI = 0;  // TEAM NasaPakSoi F4: integral term of the controller (PWM %)
// TEAM NasaPakSoi F7: sun search state
static bool _aSunSeen = true;        // last reading: usable light and inside the field of view
static float _aLastSeenAngle = 0;    // ADCS angle when the lamp was last seen
static bool _aEverSeen = false;
static bool _aSearch = false;
static float _aS = 0;                // search rate loop output (PWM %, same domain as u)
static unsigned long _aLostSince = 0, _aSeenSince = 0;
// TEAM NasaPakSoi F5: hold at the target
static bool _aHold = false;
static unsigned long _aInSince = 0;  // last time |error| was outside adcs.lock
// TEAM NasaPakSoi F4 stiction kick
static float _aK = 0;                // kick term (PWM %), fades
static unsigned long _aMovedAt = 0;  // start of the current "still" window (the body turned, or nothing had to move)
static float _aKickE0 = 0;           // |error| at the start of that window
// TEAM NasaPakSoi diagnostics (TM,TEAM_C / EVT,TEAM_AUTO) + anti-windup
static float _aAng = 0;              // sun-sensor angle of the last read
static float _aSatDir = 0;           // wheel command at +-adcs.max in the last step: +1 / -1 (u domain), 0 = not saturated
// TEAM NasaPakSoi ratchet (adcs.ratchet): stuck with the wheel already at +-adcs.max toward the target
static bool _aRat = false;
static unsigned long _aRatT0 = 0;
static float _aRatDir = 0;
// team-7: the team mission turns the gyro hold on for itself (mis.ghold) while it runs, whatever adcs.ghold says
static bool _aMisGhold = false;
inline void adcsTeamMissionGhold(bool on) { _aMisGhold = on; }
inline bool adcsGholdOn() { return TP.adcsGhold || _aMisGhold; }
// team-7: the HOLD band must fit inside the mission tolerance (fuzz seed 171: tol 2, unlock 3 -> the body sat 2.2 deg off in
// HOLD, no kick allowed, never captured). While a mission target is active: unlock <= tol, lock <= 0.75 tol (lock is not
// cut further: below lock there is no HOLD, so a kick may fire close to the target -> fuzz 1711: tol/2 let a kick at 1.1 deg
// throw the body 5 deg, the slip seen on the rig on 6 Oct).
static float _aMisTol = 0;
inline void adcsTeamMissionTol(float tol) { _aMisTol = tol; }
inline float adcsLockEff() { return _aMisTol > 0 && TP.adcsLock > 0.75f * _aMisTol ? 0.75f * _aMisTol : TP.adcsLock; }
inline bool adcsTeamHold() { return _aHold; }
inline bool adcsTeamSearching() { return _aSearch; }

inline float adcsWrap180(float x){ while(x>180)x-=360; while(x<=-180)x+=360; return x; }
// TEAM NasaPakSoi cam.off: the controller points (target + cam.off); 0 = the organizer target as given
inline float adcsTargetEff(){ return TP.camOff==0.0f?_a.target:(_a.ref==ADCS_MAG?fmodf(_a.target+TP.camOff+720.0f,360.0f):adcsWrap180(_a.target+TP.camOff)); }
inline const char* adcsModeText(){return _a.mode==ADCS_AUTO?"AUTO":"MANUAL";}
inline const char* adcsRefText(){return _a.ref==ADCS_MAG?"MAG":"SUN";}

inline void adcsBegin(){
  estimatorBegin();
  // TEAM NasaPakSoi: gains/bias start from the team's saved values (organizer defaults if none)
  _a.kp=TP.adcsKp;_a.kd=TP.adcsKd;_a.bias=(int)lroundf(TP.adcsBias);
  _aLast=millis();
}

inline ADCSState adcsGet(){return _a;}
// TEAM NasaPakSoi: end of an AUTO run in the log (what the controller saw last)
inline void adcsTeamAutoOff(const char* why){
  char b[120];
  snprintf(b,sizeof(b),"EVT,TEAM_AUTO,%s,ERR,%.2f,EST,%.2f,ANG,%.2f,I,%.1f",why,_a.error,_a.estimatedAngle,_aAng,_aI);
  sendTelemetry(b);
}
inline void adcsManual(){if(_a.mode==ADCS_AUTO)adcsTeamAutoOff("OFF");_a.mode=ADCS_MANUAL;_a.u=0;}

inline bool adcsReference(ADCSReference r){
  if(_a.mode==ADCS_AUTO&&!TP.adcsRetarget)return false;  // TEAM NasaPakSoi: adcs.retarget=1 allows a new target in AUTO (wheel keeps running)
  _a.ref=r;
  estimatorSetReference(r==ADCS_MAG ? EST_REF_MAG : EST_REF_SUN);
  return true;
}

inline bool adcsTarget(float t){
  if(_a.mode==ADCS_AUTO&&!TP.adcsRetarget)return false;  // TEAM NasaPakSoi: adcs.retarget=1 allows a new target in AUTO (wheel keeps running)
  if(_a.ref==ADCS_SUN&&(t < -90 || t > 90))return false;
  if(_a.ref==ADCS_MAG&&(t<0||t>=360))return false;
  _a.target=t;
  if(_a.mode==ADCS_AUTO){_aK=0;_aMovedAt=millis();_aKickE0=1e9f;_aHold=false;_aInSince=millis();_aRat=false;}  // TEAM: fresh kick/hold state for the new target
  return true;
}

// TEAM NasaPakSoi team-6 mission: next target while in AUTO whatever adcs.retarget says (same checks and reset as adcsTarget)
// team-8 (audit N4): the error is still the old target's until the next control step -> mark it stale (hold 0 shot the next target before turning)
inline bool adcsTeamSetTarget(float t){const int r=TP.adcsRetarget;TP.adcsRetarget=1;const bool ok=adcsTarget(t);TP.adcsRetarget=r;if(ok)_a.valid=false;return ok;}

inline bool adcsTune(float kp,float kd,int bias){
  if(kp<0||kp>ADCS_KP_MAX||kd<0||kd>ADCS_KD_MAX||bias<0||bias>100)return false;
  _a.kp=kp;_a.kd=kd;_a.bias=bias;
  // TEAM NasaPakSoi: ADCS_TUNE and TEAM_SET adcs.* share one store, so TEAM_SAVE keeps either
  if(TP.adcsKp!=kp||TP.adcsKd!=kd||TP.adcsBias!=(float)bias){
    TP.adcsKp=kp;TP.adcsKd=kd;TP.adcsBias=(float)bias;
    for(int i=0;i<TEAM_PARAM_COUNT;i++){String k=_tpDefs[i].key;if(k=="adcs.kp"||k=="adcs.kd"||k=="adcs.bias")_tpDirty[i]=true;}
  }
  return true;
}

inline bool adcsRead(){
  IMURawSample r;
  IMUProcessedSample p;
  SunSample s;
  if(!imuReadRaw(r)||!imuProcess(r,p)||!sunSensorRead(s)){
    _a.valid=false;
    return false;
  }

  // TEAM NasaPakSoi F7: is the lamp really seen? (team flags: S >= sun.minS, not clipped, |D| <= sun.dmax)
  _aSunSeen = s.light && !s.edge;
  if (_aSunSeen) { _aLastSeenAngle = s.angleDeg; _aEverSeen = true; }
  _aAng = s.angleDeg;

  _a.sunError = _a.target - s.angleDeg;
  _a.magError = adcsWrap180(_a.target - p.heading);
  _a.rate = p.bodyRate;

  _a.rawReference = (_a.ref==ADCS_MAG) ? p.heading : s.angleDeg;
  // TEAM NasaPakSoi F8 (adcs.ghold): lamp not seen -> feed the estimator its own gyro prediction, so the angle
  // continues on the gyro alone (no pull toward the meaningless dark/edge reading). Lets SET_TARGET go past the
  // sun sensor's range (camera targets); the lamp seen again pulls the estimate back (fusion correction).
  // team-7: during a team mission, while the TARGET is past mis.trust deg, a reading past mis.trust counts as not seen too
  // (sim: the sensor over-reads from ~45 deg and sticks at 60 deg while still "lit" -> the gyro hold started from a wrong
  // angle, photos 4-9 deg off). Targets inside mis.trust use every lit reading (fuzz 5000: distrusting them there too left a
  // gyro-drifted estimate that never re-synced, photo 6.9 deg off at -37.8).
  const bool trusted=_aSunSeen&&!(_aMisGhold&&TP.misTrust>0&&fabsf(adcsTargetEff())>TP.misTrust&&fabsf(s.angleDeg)>TP.misTrust);
  if(adcsGholdOn()&&_a.ref==ADCS_SUN&&!trusted&&_aEverSeen){
    const EstimatorState e0=estimatorGet();
    if(e0.valid)_a.rawReference=e0.estimatedAngleDeg+_a.rate*(ADCS_CONTROL_PERIOD_MS/1000.0f);
  }
  EstimatorReference er = (_a.ref==ADCS_MAG) ? EST_REF_MAG : EST_REF_SUN;
  if(!estimatorUpdate(_a.rawReference, _a.rate, er)){
    _a.valid=false;
    return false;
  }

  EstimatorState es = estimatorGet();
  _a.filteredReference = es.filteredReferenceDeg;
  _a.estimatedAngle = es.estimatedAngleDeg;

  // Controller now consumes the estimator output.
  // With LPF=OFF and Fusion=OFF this is equivalent to the verified v0.2 path.
  // TEAM NasaPakSoi adcs.wrap: the SUN estimate is never wrapped (the estimator integrates the gyro through every
  // turn, also in MANUAL, and its correction toward the sun angle is taken mod 360) -> after whole turns it stays
  // k*360 off and the organizer error (target - estimate) makes AUTO unwind them: 6 Oct 15:36 the body turned
  // ~-1040 deg (3 turns) at rw -40 before it pointed. adcs.wrap 1 takes the error the short way round.
  const float tEff = adcsTargetEff();
  _a.error = (_a.ref==ADCS_MAG || TP.adcsWrap)
    ? adcsWrap180(tEff - _a.estimatedAngle)
    : (tEff - _a.estimatedAngle);

  _a.valid=true;
  return true;
}

// ---- TEAM NasaPakSoi flight recorder: every AUTO run in RAM (the GS holds the only BLE link and its CSV log has no
// controller values) -> TEAM_CDUMP afterwards over BLE/USB. Cleared at each AUTO entry, recorded every TEAM_CREC-th
// control step (default 2 = 25 Hz), stops when full (keeps the start of the run). Lost on reset/power-off. ----
#define TEAM_REC_MAX 2400
struct TeamRecSample { uint32_t t; int16_t tgt, ang, est, err, gz, u, i, k; int8_t rw; uint8_t fl; };  // x10 except t, rw
static TeamRecSample _recBuf[TEAM_REC_MAX];
static int _recN = 0, _recDiv = 2, _recTick = 0;
static bool _recFull = false;
static char _recEntry[180] = "";  // the EVT,TEAM_AUTO,ON line of the recorded run
inline int16_t _recQ(float v){ v*=10.0f; return (int16_t)(v>32767.0f?32767:(v<-32767.0f?-32767:lroundf(v))); }
inline void teamRecPush(){
  if(_recDiv<=0||_recFull)return;
  if(++_recTick<_recDiv)return;
  _recTick=0;
  if(_recN>=TEAM_REC_MAX){_recFull=true;return;}
  TeamRecSample& r=_recBuf[_recN++];
  r.t=millis(); r.tgt=_recQ(adcsTargetEff()); r.ang=_recQ(_aAng); r.est=_recQ(_a.estimatedAngle); r.err=_recQ(_a.error);
  r.gz=_recQ(_a.rate); r.u=_recQ(_a.u); r.i=_recQ(_aI); r.k=_recQ(_aK); r.rw=(int8_t)constrain(rwGetAppliedCommand(),-100,100);
  r.fl=(_aSunSeen?1:0)|(_aHold?2:0)|(_aSearch?4:0)|(_aSatDir>0?8:0)|(_aSatDir<0?16:0);
}

inline bool adcsAuto(){
  if(!adcsRead())return false;
  if(rwGetMode()==RW_MODE_MOMENTUM && !rwMomentumProfileReady())return false;
  rwStop();
  if(rwGetMode()==RW_MODE_MOMENTUM && !rwApplyProfileBias())return false;
  // TEAM NasaPakSoi adcs.wrap: start from the sun angle itself when the lamp is seen (a fast turn just before AUTO
  // leaves the fused estimate up to ~1 s behind; whole turns are already handled by the wrapped error)
  bool sync=false;
  if(TP.adcsWrap&&_a.ref==ADCS_SUN&&_aSunSeen){estimatorReset();if(!adcsRead())return false;sync=true;}
  _a.mode=ADCS_AUTO;
  _aLast=0;
  _aSatDir=0;
  {
    char b[180];
    snprintf(b,sizeof(b),"EVT,TEAM_AUTO,ON,TGT,%.2f,EST,%.2f,ANG,%.2f,LIT,%d,ERR,%.2f,KP,%g,KD,%g,KI,%g,SIGN,%d,RSIGN,%d,MAX,%g,DB,%g,WRAP,%d,SYNC,%d,STRAT,%s",
      adcsTargetEff(),_a.estimatedAngle,_aAng,_aSunSeen?1:0,_a.error,_a.kp,_a.kd,TP.adcsKi,(int)TP.adcsSign,(int)TP.imuRsign,
      TP.adcsMax,TP.adcsDb,TP.adcsWrap,sync?1:0,rwGetMode()==RW_MODE_MOMENTUM?"MOM":"RW");
    sendTelemetry(b);
    strncpy(_recEntry,b,sizeof(_recEntry)-1);_recN=0;_recTick=_recDiv;_recFull=false;  // new recording, first sample at once
  }
  _aI=0;  // TEAM NasaPakSoi
  _aSearch=false;_aS=0;_aLostSince=_aSeenSince=millis();  // TEAM NasaPakSoi F7
  _aHold=false;_aInSince=millis();  // TEAM NasaPakSoi F5
  _aK=0;_aMovedAt=millis();_aKickE0=1e9f;  // TEAM NasaPakSoi F4 stiction kick
  _aRat=false;
  return true;
}

inline void adcsFault(){if(_a.mode==ADCS_AUTO)adcsTeamAutoOff("FAULT");rwStop();_a.mode=ADCS_MANUAL;_a.u=0;_a.valid=false;}

inline void _adcsStep();
inline void adcsUpdate(){
  const unsigned long l0=_aLast;
  _adcsStep();
  if(_aLast!=l0&&_a.mode==ADCS_AUTO)teamRecPush();  // TEAM NasaPakSoi: one sample per control step that ran in AUTO
}

inline void _adcsStep(){
  unsigned long n=millis(); if(n-_aLast<ADCS_CONTROL_PERIOD_MS)return; _aLast=n;
  // TEAM NasaPakSoi F6 (team-4): up to adcs.miss failed reads in a row keep the last wheel command (one I2C glitch = 20 ms)
  static int _aMiss=0;
  if(!adcsRead()){
    if(_a.mode==ADCS_AUTO){
      if(++_aMiss<=TP.adcsMiss){ if(_aMiss==1)sendTelemetry("EVT,TEAM_ADCS_MISS,START"); return; }
      sendTelemetry("EVT,TEAM_ADCS_MISS,FAULT,"+String(_aMiss)); _aMiss=0; adcsFault();
    } else _a.valid=false;
    return;
  }
  if(_aMiss){ sendTelemetry("EVT,TEAM_ADCS_MISS,RECOVERED,"+String(_aMiss)); _aMiss=0; }
  if(_a.mode!=ADCS_AUTO)return;

  // TEAM NasaPakSoi: deadband / output limit / control sign are team parameters (TEAM_SET adcs.db,
  // adcs.max, adcs.sign) instead of compile-time constants; defaults are the organizer's values.
  // TEAM NasaPakSoi F7: lamp not seen for 0.3 s -> turn at adcs.srate toward where it was last seen (gyro rate loop),
  // seen again for 0.2 s -> back to the normal law, the integrator taking over the wheel command (no jump).
  const float dtS=ADCS_CONTROL_PERIOD_MS/1000.0f;
  if(TP.adcsSrate>0&&_a.ref==ADCS_SUN&&!adcsGholdOn()){  // F8 on: no search, the gyro carries the angle
    if(_aSunSeen)_aLostSince=n; else _aSeenSince=n;  // lost since = last time seen, and the other way round
    if(!_aSearch&&!_aSunSeen&&n-_aLostSince>=300){
      _aSearch=true;_aS=_a.u;
      sendTelemetry("EVT,TEAM_SUN_SEARCH,START,DIR,"+String(!_aEverSeen||adcsTargetEff()-_aLastSeenAngle>=0?1:-1));
    }else if(_aSearch&&_aSunSeen&&n-_aSeenSince>=200){
      _aSearch=false;
      if(TP.adcsKi>0)_aI=constrain(_aS-(_a.kp*_a.error-_a.kd*_a.rate),-TP.adcsMax,TP.adcsMax);
      sendTelemetry("EVT,TEAM_SUN_SEARCH,FOUND,ANGLE,"+String(_aLastSeenAngle,2));
    }
  }else _aSearch=false;

  // TEAM NasaPakSoi F5: HOLD after adcs.lockMs inside adcs.lock, released only beyond adcs.unlock (never while searching)
  const float ae=fabsf(_a.error);
  const float lk=adcsLockEff();
  if(TP.adcsLock>0&&!_aSearch){
    float unl=TP.adcsUnlock>TP.adcsLock?TP.adcsUnlock:2.0f*TP.adcsLock;
    if(_aMisTol>0&&unl>_aMisTol)unl=_aMisTol;  // team-7
    if(_aMisTol>0&&TP.misUnlock>lk&&unl>TP.misUnlock)unl=TP.misUnlock;  // team-8 (audit N3): mission only, never at or under the lock
    if(!_aHold){
      if(ae>lk)_aInSince=n;
      else if(n-_aInSince>=(unsigned long)TP.adcsLockMs){_aHold=true;sendTelemetry("EVT,TEAM_HOLD,ON,ERR,"+String(_a.error,2));}
    }else if(ae>unl){_aHold=false;_aInSince=n;sendTelemetry("EVT,TEAM_HOLD,OFF,ERR,"+String(_a.error,2));}
  }else{_aHold=false;_aInSince=n;}
  const float hg=_aHold?TP.adcsHgain:1.0f;

  float u=0;
  bool pd=false;  // the PD law runs (outside the deadband, not searching)
  if(_aSearch){
    const float dir=(!_aEverSeen||adcsTargetEff()-_aLastSeenAngle>=0)?1.0f:-1.0f;  // d(angle)/dt = +BODY_RATE (W3 check)
    _aS=constrain(_aS+TP.adcsSk*(dir*TP.adcsSrate-_a.rate)*dtS,-TP.adcsMax,TP.adcsMax);
    u=_aS;
  }else if(fabsf(_a.error)>=(_aHold&&lk>TP.adcsDb?lk:TP.adcsDb)){  // F5: in HOLD the deadband is adcs.lock
    pd=true;
    // TEAM NasaPakSoi F4: integral term (adcs.ki); clamped to +-adcs.max. adcs.aw 1: no integrating further into a
    // saturated wheel command (15:36: I ran up to the limit while the body stuck at -5 deg, then held the wheel at +40
    // past the target -> +7 deg overshoot)
    if(TP.adcsKi>0){
      const float dI=hg*TP.adcsKi*_a.error*dtS;
      if(!(TP.adcsAw&&_aSatDir*dI>0)&&!_aRat)_aI=constrain(_aI+dI,-TP.adcsMax,TP.adcsMax);
    }
    u=hg*(_a.kp*_a.error-_a.kd*_a.rate)+_aI;  // hg: F5 hold gain
    // TEAM NasaPakSoi F4 stiction kick: still for adcs.kickMs although outside the deadband -> step toward the target
    if(TP.adcsKick>0&&!_aRat&&!_aHold){  // team-4: no kick in HOLD (rig: a kick slips 3-4.5 deg -> past the target)
      if(fabsf(_a.rate)>=TP.adcsKrate){_aMovedAt=n;_aKickE0=fabsf(_a.error);}
      else if(n-_aMovedAt>=(unsigned long)TP.adcsKickMs){
        // stuck = slow AND the error did not shrink 0.2 deg in the window (a body creeping toward the target on a
        // slippery platform is left alone: a kick there only overshoots)
        if(fabsf(_a.error)>_aKickE0-0.2f){
          const float ed=_a.error>0?1.0f:-1.0f;
          if(TP.adcsAw&&_aSatDir==ed){
            // the wheel is already at +-adcs.max toward the target: a kick adds nothing now and, piled up (15:36 sim: K 37 %),
            // drives an overshoot once the body breaks free. Ratchet instead: back the wheel off by adcs.kick % slowly
            // (over adcs.ratchet ms: a small torque that the platform friction holds), then let it jump back to the
            // limit (rw.slew: ~40 ms) = a torque step toward the target that breaks the static friction.
            if(TP.adcsRatchet>0){_aRat=true;_aRatT0=n;_aRatDir=ed;_aK=0;sendTelemetry("EVT,TEAM_RATCHET,"+String((int)ed)+",ERR,"+String(_a.error,2));}
          }else{
            _aK=constrain(_aK+ed*TP.adcsKick,-TP.adcsMax,TP.adcsMax);
            sendTelemetry("EVT,TEAM_KICK,"+String(_aK,1)+",ERR,"+String(_a.error,2));
          }
        }
        _aMovedAt=n;_aKickE0=fabsf(_a.error);
      }
    }
  }else if(TP.adcsKi>0){
    // inside the deadband hold the integrator: the wheel keeps its speed (u=0 would let it coast down,
    // and that momentum would turn the body out of the deadband again)
    u=_aI;
  }
  if(_aSearch||TP.adcsKick<=0)_aK=0;
  else{u+=_aK;_aK*=expf(-dtS/2.0f);}  // the kick step fades (2 s): its slow return gives only a small reverse torque
  if(_aRat){  // TEAM ratchet back-off; ends after adcs.ratchet ms or as soon as the body moves (then the step helps it on)
    const float fr=(float)(n-_aRatT0)/TP.adcsRatchet;
    if(!pd||_aSearch||fr>=1.0f||fabsf(_a.rate)>=TP.adcsKrate||TP.adcsRatchet<=0){_aRat=false;_aMovedAt=n;_aKickE0=fabsf(_a.error);}
    else u=_aRatDir*(TP.adcsMax-TP.adcsKick*fr);
  }
  if(!pd){_aMovedAt=n;_aKickE0=fabsf(_a.error);}  // inside the deadband / hold band or searching: nothing has to move
  _a.u=u;

  if(rwGetMode()==RW_MODE_REACTION){
    float cu=TP.adcsSign*u;
    // TEAM NasaPakSoi F4: below rw.minStable the wheel does not turn, so the PD stalls short of the target
    // (|Kp*e| < minStable). With adcs.dzc=1 any command outside the deadband is lifted past the deadzone:
    // minStart from rest (wheel command 0), minStable while it already turns. Inside the deadband u=0 -> 0.
    if(TP.adcsDzc&&cu!=0.0f){
      float lo=(rwGetMotorCommand()==0)?TP.rwMinStart:TP.rwMinStable;
      cu=(cu>0?1.0f:-1.0f)*(lo+fabsf(cu));
    }
    _aSatDir=fabsf(cu)>=TP.adcsMax&&TP.adcsMax>0?(cu>0?1.0f:-1.0f)*TP.adcsSign:0.0f;  // TEAM: u-domain direction
    int c=(int)roundf(constrain(
      cu,
      -TP.adcsMax,
      TP.adcsMax));
    if(((volatile ADCSState&)_a).mode!=ADCS_AUTO)return;  // team-4: BLE commands run on core 0; STOP may land mid-step
    rwSetReactionCommand(c); return;
  }

  // v3.0 profile-based Momentum AUTO.
  // The PD output is a CONTROL DEMAND; the strategy layer chooses a characterized maneuver.
  if(!rwMomentumProfileReady()){adcsFault();return;}
  if(rwIsMomentumBusy())return; // never restart an assist/recovery every 20 ms
  // Each characterized maneuver begins from nominal BIAS. After a maneuver,
  // recover first; do not stack repeated Assist pulses from a non-bias target.
  if(rwGetState()==RW_MOMENTUM_CONTROL_TARGET){rwStartRecovery();return;}

  MomentumProfile mp=rwMomentumProfileGet();
  float demand=TP.adcsSign*u;  // TEAM NasaPakSoi: adcs.sign
  bool settled=(fabsf(_a.error)<TP.adcsDb &&  /* TEAM: adcs.db */ fabsf(_a.rate)<ADCS_RATE_DEADBAND_DPS);

  if(settled || fabsf(demand)<mp.trigger){ rwStartRecovery(); return; }
  if(demand>=mp.trigger){ rwStartProfileCW(); return; }
  if(demand<=-mp.trigger){ rwStartProfileCCW(); return; }
}
