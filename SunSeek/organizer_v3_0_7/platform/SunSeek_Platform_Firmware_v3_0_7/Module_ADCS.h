#pragma once

/* SunSeek Platform v2.0 — MODULE LAYER */
#include <Arduino.h>
#include <math.h>
#include "Config_ADCS.h"
#include "Module_IMU.h"
#include "Module_SunSensor.h"
#include "Module_ReactionWheel.h"
#include "Module_Estimator.h"

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

inline float adcsWrap180(float x){ while(x>180)x-=360; while(x<=-180)x+=360; return x; }
inline const char* adcsModeText(){return _a.mode==ADCS_AUTO?"AUTO":"MANUAL";}
inline const char* adcsRefText(){return _a.ref==ADCS_MAG?"MAG":"SUN";}

inline void adcsBegin(){
  estimatorBegin();
  _aLast=millis();
}

inline ADCSState adcsGet(){return _a;}
inline void adcsManual(){
  // v3.0.4 safety invariant: leaving AUTO must also remove actuator output.
  // This prevents the last Reaction PWM command (or a Momentum maneuver timer)
  // from surviving an AUTO -> MANUAL / ABORT transition.
  rwStop();
  _a.mode=ADCS_MANUAL;
  _a.u=0;
}

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
  _a.kp=kp;_a.kd=kd;_a.bias=bias;return true;
}

inline bool adcsRead(){
  IMURawSample r;
  IMUProcessedSample p;
  SunSample s;
  if(!imuReadRaw(r)||!imuProcess(r,p)||!sunSensorRead(s)){
    _a.valid=false;
    return false;
  }

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
  if(rwGetMode()==RW_MODE_MOMENTUM && !rwMomentumProfileReady())return false;
  rwStop();
  if(rwGetMode()==RW_MODE_MOMENTUM && !rwApplyProfileBias())return false;
  _a.mode=ADCS_AUTO; _aLast=0; return true;
}

inline void adcsFault(){rwStop();_a.mode=ADCS_MANUAL;_a.u=0;_a.valid=false;}

inline void adcsUpdate(){
  unsigned long n=millis(); if(n-_aLast<ADCS_CONTROL_PERIOD_MS)return; _aLast=n;
  if(!adcsRead()){ if(_a.mode==ADCS_AUTO)adcsFault(); else _a.valid=false; return; }
  if(_a.mode!=ADCS_AUTO)return;

  float u=0; if(fabsf(_a.error)>=ADCS_DEADBAND_DEG)u=_a.kp*_a.error-_a.kd*_a.rate; _a.u=u;

  if(rwGetMode()==RW_MODE_REACTION){
    int c=(int)roundf(constrain(ADCS_CONTROL_SIGN*u,-(float)ADCS_MAX_RW_COMMAND,(float)ADCS_MAX_RW_COMMAND));
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
  float demand=ADCS_CONTROL_SIGN*u;
  float positionDemand=ADCS_CONTROL_SIGN*_a.error;
  bool settled=(fabsf(_a.error)<ADCS_DEADBAND_DEG && fabsf(_a.rate)<ADCS_RATE_DEADBAND_DPS);

  // v3.0.4 Momentum reversal guard.
  // PD remains the control-demand gate, but the ANGLE ERROR determines which
  // side of the target the spacecraft is on.  A large D term may oppose the
  // current motion before the target is crossed; that is a damping request,
  // not permission to fire the opposite characterized Assist pulse.
  // Opposite Assist is therefore allowed only after the angle error itself
  // crosses the target (positionDemand changes sign).  Otherwise recover/hold
  // at nominal bias and reassess on the next control cycle.
  if(settled || fabsf(demand)<mp.trigger){ rwStartRecovery(); return; }
  if(positionDemand>=ADCS_DEADBAND_DEG && demand>=mp.trigger){ rwStartProfileCW(); return; }
  if(positionDemand<=-ADCS_DEADBAND_DEG && demand<=-mp.trigger){ rwStartProfileCCW(); return; }
  rwStartRecovery();
}
