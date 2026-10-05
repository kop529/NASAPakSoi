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
inline bool adcsTeamHold() { return _aHold; }
inline bool adcsTeamSearching() { return _aSearch; }

inline float adcsWrap180(float x){ while(x>180)x-=360; while(x<=-180)x+=360; return x; }
inline const char* adcsModeText(){return _a.mode==ADCS_AUTO?"AUTO":"MANUAL";}
inline const char* adcsRefText(){return _a.ref==ADCS_MAG?"MAG":"SUN";}

inline void adcsBegin(){
  estimatorBegin();
  // TEAM NasaPakSoi: gains/bias start from the team's saved values (organizer defaults if none)
  _a.kp=TP.adcsKp;_a.kd=TP.adcsKd;_a.bias=(int)lroundf(TP.adcsBias);
  _aLast=millis();
}

inline ADCSState adcsGet(){return _a;}
inline void adcsManual(){_a.mode=ADCS_MANUAL;_a.u=0;}

inline bool adcsReference(ADCSReference r){
  if(_a.mode==ADCS_AUTO)return false;
  _a.ref=r;
  estimatorSetReference(r==ADCS_MAG ? EST_REF_MAG : EST_REF_SUN);
  return true;
}

inline bool adcsTarget(float t){
  if(_a.mode==ADCS_AUTO)return false;
  if(_a.ref==ADCS_SUN&&(t < -90 || t > 90))return false;
  if(_a.ref==ADCS_MAG&&(t<0||t>=360))return false;
  _a.target=t;
  return true;
}

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

  _a.sunError = _a.target - s.angleDeg;
  _a.magError = adcsWrap180(_a.target - p.heading);
  _a.rate = p.bodyRate;

  _a.rawReference = (_a.ref==ADCS_MAG) ? p.heading : s.angleDeg;
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
  _a.error = (_a.ref==ADCS_MAG)
    ? adcsWrap180(_a.target - _a.estimatedAngle)
    : (_a.target - _a.estimatedAngle);

  _a.valid=true;
  return true;
}

inline bool adcsAuto(){
  if(!adcsRead())return false;
  rwStop();
  if(rwGetMode()==RW_MODE_MOMENTUM)rwSetBias(_a.bias);
  _a.mode=ADCS_AUTO;
  _aLast=0;
  _aI=0;  // TEAM NasaPakSoi
  _aSearch=false;_aS=0;_aLostSince=_aSeenSince=millis();  // TEAM NasaPakSoi F7
  _aHold=false;_aInSince=millis();  // TEAM NasaPakSoi F5
  return true;
}

inline void adcsFault(){rwStop();_a.mode=ADCS_MANUAL;_a.u=0;_a.valid=false;}

inline void adcsUpdate(){
  // Sensor acquisition + estimator are spacecraft services, not AUTO-only.
  // Keep them alive in MANUAL so Engineering can characterize
  // Raw -> Filtered -> Estimated response without enabling the controller.
  unsigned long n=millis();
  if(n-_aLast<ADCS_CONTROL_PERIOD_MS)return;
  _aLast=n;

  if(!adcsRead()){
    if(_a.mode==ADCS_AUTO) adcsFault();
    else _a.valid=false;
    return;
  }

  // In MANUAL we update sensing/estimation only; actuator remains operator-controlled.
  if(_a.mode!=ADCS_AUTO)return;

  // TEAM NasaPakSoi: deadband / output limit / control sign are team parameters (TEAM_SET adcs.db,
  // adcs.max, adcs.sign) instead of compile-time constants; defaults are the organizer's values.
  // TEAM NasaPakSoi F7: lamp not seen for 0.3 s -> turn at adcs.srate toward where it was last seen (gyro rate loop),
  // seen again for 0.2 s -> back to the normal law, the integrator taking over the wheel command (no jump).
  const float dtS=ADCS_CONTROL_PERIOD_MS/1000.0f;
  if(TP.adcsSrate>0&&_a.ref==ADCS_SUN){
    if(_aSunSeen)_aLostSince=n; else _aSeenSince=n;  // lost since = last time seen, and the other way round
    if(!_aSearch&&!_aSunSeen&&n-_aLostSince>=300){
      _aSearch=true;_aS=_a.u;
      sendTelemetry("EVT,TEAM_SUN_SEARCH,START,DIR,"+String(!_aEverSeen||_a.target-_aLastSeenAngle>=0?1:-1));
    }else if(_aSearch&&_aSunSeen&&n-_aSeenSince>=200){
      _aSearch=false;
      if(TP.adcsKi>0)_aI=constrain(_aS-(_a.kp*_a.error-_a.kd*_a.rate),-TP.adcsMax,TP.adcsMax);
      sendTelemetry("EVT,TEAM_SUN_SEARCH,FOUND,ANGLE,"+String(_aLastSeenAngle,2));
    }
  }else _aSearch=false;

  // TEAM NasaPakSoi F5: HOLD after adcs.lockMs inside adcs.lock, released only beyond adcs.unlock (never while searching)
  const float ae=fabsf(_a.error);
  if(TP.adcsLock>0&&!_aSearch){
    const float unl=TP.adcsUnlock>TP.adcsLock?TP.adcsUnlock:2.0f*TP.adcsLock;
    if(!_aHold){
      if(ae>TP.adcsLock)_aInSince=n;
      else if(n-_aInSince>=(unsigned long)TP.adcsLockMs){_aHold=true;sendTelemetry("EVT,TEAM_HOLD,ON,ERR,"+String(_a.error,2));}
    }else if(ae>unl){_aHold=false;_aInSince=n;sendTelemetry("EVT,TEAM_HOLD,OFF,ERR,"+String(_a.error,2));}
  }else{_aHold=false;_aInSince=n;}
  const float hg=_aHold?TP.adcsHgain:1.0f;

  float u=0;
  if(_aSearch){
    const float dir=(!_aEverSeen||_a.target-_aLastSeenAngle>=0)?1.0f:-1.0f;  // d(angle)/dt = +BODY_RATE (W3 check)
    _aS=constrain(_aS+TP.adcsSk*(dir*TP.adcsSrate-_a.rate)*dtS,-TP.adcsMax,TP.adcsMax);
    u=_aS;
  }else if(fabsf(_a.error)>=(_aHold&&TP.adcsLock>TP.adcsDb?TP.adcsLock:TP.adcsDb)){  // F5: in HOLD the deadband is adcs.lock
    // TEAM NasaPakSoi F4: integral term (adcs.ki); clamped to +-adcs.max so it cannot wind up
    if(TP.adcsKi>0)_aI=constrain(_aI+hg*TP.adcsKi*_a.error*dtS,-TP.adcsMax,TP.adcsMax);
    u=hg*(_a.kp*_a.error-_a.kd*_a.rate)+_aI;  // hg: F5 hold gain
  }else if(TP.adcsKi>0){
    // inside the deadband hold the integrator: the wheel keeps its speed (u=0 would let it coast down,
    // and that momentum would turn the body out of the deadband again)
    u=_aI;
  }

  _a.u=u;

  // IMPORTANT: preserve the verified T04/T05 reaction and momentum laws.
  if(rwGetMode()==RW_MODE_REACTION){
    float cu=TP.adcsSign*u;
    // TEAM NasaPakSoi F4: below rw.minStable the wheel does not turn, so the PD stalls short of the target
    // (|Kp*e| < minStable). With adcs.dzc=1 any command outside the deadband is lifted past the deadzone:
    // minStart from rest (wheel command 0), minStable while it already turns. Inside the deadband u=0 -> 0.
    if(TP.adcsDzc&&cu!=0.0f){
      float lo=(rwGetMotorCommand()==0)?TP.rwMinStart:TP.rwMinStable;
      cu=(cu>0?1.0f:-1.0f)*(lo+fabsf(cu));
    }
    int c=(int)roundf(constrain(
      cu,
      -TP.adcsMax,
      TP.adcsMax));
    rwSetReactionCommand(c);
  }else{
    int c=(int)roundf(constrain(
      (float)_a.bias+TP.adcsSign*u,
      0.0f,
      TP.adcsMax));
    rwSetBias(c);
  }
}
