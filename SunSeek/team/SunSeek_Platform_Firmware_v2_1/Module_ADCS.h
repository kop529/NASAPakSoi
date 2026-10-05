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
  float u=0;
  if(fabsf(_a.error)>=TP.adcsDb)
    u=_a.kp*_a.error-_a.kd*_a.rate;

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
