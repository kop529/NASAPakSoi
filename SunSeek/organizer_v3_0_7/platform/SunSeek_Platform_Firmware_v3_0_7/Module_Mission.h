#pragma once

/* SunSeek Platform v2.0 — MODULE LAYER */
#include <Arduino.h>
#include <math.h>
#include "Module_ADCS.h"
#include "Module_ReactionWheel.h"
#include "Module_Payload.h"

enum MissionState {
  MISSION_IDLE,
  MISSION_PREPARING,
  MISSION_READY,
  MISSION_ACQUIRING,
  MISSION_HOLDING,
  MISSION_CAPTURING,
  MISSION_IMAGE_READY,
  MISSION_COMPLETE,
  MISSION_ABORTED,
  MISSION_FAILED,
  MISSION_TIME_LIMIT_REACHED
};

enum MissionAction { MISSION_ACTION_NONE, MISSION_ACTION_CAPTURE };

struct MissionTarget {
  float angleDeg;
  float toleranceDeg;
  float holdSec;
  MissionAction action;
};

#define MISSION_MAX_TARGETS 10
#define MISSION_CAPTURE_TIMEOUT_MS 5000UL
#define MISSION_STATUS_TM_PERIOD_MS 200UL

struct MissionRuntime {
  MissionState state;
  MissionTarget targets[MISSION_MAX_TARGETS];
  uint8_t targetCount;
  uint8_t currentIndex;
  unsigned long startMs;
  unsigned long holdStartMs;
  unsigned long maxDurationMs;
  unsigned long prepareStartMs;
  unsigned long captureStartMs;
  unsigned long elapsedMs;
  bool timeLimitReached;
};

static MissionRuntime _mission = {MISSION_IDLE, {}, 0, 0, 0, 0, 5UL*60UL*1000UL, 0, 0, 0, false};
static unsigned long _missionLastStatusTmMs = 0;

inline const char* missionStateText(){
  switch(_mission.state){
    case MISSION_IDLE:return "IDLE";
    case MISSION_PREPARING:return "PREPARING";
    case MISSION_READY:return "READY";
    case MISSION_ACQUIRING:return "ACQUIRING";
    case MISSION_HOLDING:return "HOLDING";
    case MISSION_CAPTURING:return "CAPTURING";
    case MISSION_IMAGE_READY:return "IMAGE_READY";
    case MISSION_COMPLETE:return "COMPLETE";
    case MISSION_ABORTED:return "ABORTED";
    case MISSION_FAILED:return "FAILED";
    case MISSION_TIME_LIMIT_REACHED:return "TIME_LIMIT_REACHED";
  }
  return "UNKNOWN";
}

inline void missionBegin(){ _mission.state=MISSION_IDLE; _mission.elapsedMs=0; }
inline bool missionIsTimedActive(){
  return _mission.state==MISSION_ACQUIRING || _mission.state==MISSION_HOLDING || _mission.state==MISSION_CAPTURING || _mission.state==MISSION_IMAGE_READY;
}

inline unsigned long missionElapsedMs(){
  if(_mission.startMs==0) return 0;
  return missionIsTimedActive() ? (millis()-_mission.startMs) : _mission.elapsedMs;
}

inline void missionFreezeElapsed(){
  if(_mission.startMs!=0 && missionIsTimedActive()) _mission.elapsedMs=millis()-_mission.startMs;
}

inline void missionSendStatus(bool force=false){
  unsigned long now=millis();
  if(!force && _mission.state!=MISSION_PREPARING && !missionIsTimedActive()) return;
  if(!force && now-_missionLastStatusTmMs<MISSION_STATUS_TM_PERIOD_MS) return;
  _missionLastStatusTmMs=now;
  uint8_t shownIndex=_mission.targetCount ? min((uint8_t)(_mission.currentIndex+1),_mission.targetCount) : 0;
  sendTelemetry("TM,MISSION_STATE,"+String(missionStateText())+",TARGET_INDEX,"+String(shownIndex)+",TARGET_COUNT,"+String(_mission.targetCount)+",MISSION_TIME_MS,"+String(missionElapsedMs()));

  String pointing="---";
  unsigned long holdMs=0, holdRequiredMs=0;
  if(_mission.currentIndex<_mission.targetCount){
    MissionTarget &t=_mission.targets[_mission.currentIndex];
    holdRequiredMs=(unsigned long)(t.holdSec*1000.0f);
    ADCSState a=adcsGet();
    if(a.valid){
      bool inTol=fabsf(a.error)<=t.toleranceDeg;
      pointing=inTol ? "IN_TOLERANCE" : "OUT_OF_TOLERANCE";
      if(_mission.state==MISSION_HOLDING && _mission.holdStartMs!=0) holdMs=min(now-_mission.holdStartMs,holdRequiredMs);
    }
  }
  sendTelemetry("TM,MISSION_ACTIVITY,"+String(missionStateText())+",POINTING,"+pointing+",HOLD_MS,"+String(holdMs)+",HOLD_REQUIRED_MS,"+String(holdRequiredMs));
}


inline void missionSafeStop(){
  // Mission terminal states must not leave autonomous actuator commands alive.
  adcsManual();
  rwStop();
}

inline void missionComplete(){
  missionFreezeElapsed();
  missionSafeStop();
  _mission.state=MISSION_COMPLETE;
  missionSendStatus(true);
}

inline void missionFail(){
  missionFreezeElapsed();
  missionSafeStop();
  _mission.state=MISSION_FAILED;
  missionSendStatus(true);
}

inline bool missionSetMaxMinutes(uint16_t minutes){
  if(!((minutes>=1 && minutes<=15)||minutes==20||minutes==30)) return false;
  if(_mission.state!=MISSION_IDLE && _mission.state!=MISSION_READY) return false;
  _mission.maxDurationMs=(unsigned long)minutes*60UL*1000UL;
  return true;
}

inline bool missionClearTargets(){
  if(_mission.state!=MISSION_IDLE) return false;
  _mission.targetCount=0; _mission.currentIndex=0; return true;
}

inline bool missionAddTarget(float angle,float tolerance,float holdSec,MissionAction action=MISSION_ACTION_NONE){
  if(_mission.state!=MISSION_IDLE || _mission.targetCount>=MISSION_MAX_TARGETS) return false;
  if(!isfinite(angle)||!isfinite(tolerance)||!isfinite(holdSec)) return false;
  if(tolerance<=0 || tolerance>30 || holdSec<0 || holdSec>60) return false;
  _mission.targets[_mission.targetCount++]={angle,tolerance,holdSec,action};
  return true;
}

inline bool missionPrepare(){
  if(_mission.state!=MISSION_IDLE || _mission.targetCount<1) return false;
  _mission.state=MISSION_PREPARING; _mission.prepareStartMs=millis();
  if(rwGetMode()==RW_MODE_MOMENTUM){
    if(!rwMomentumProfileReady() || !rwApplyProfileBias()){ missionFail(); return false; }
    // READY is produced by missionUpdate after the characterized Bias Spin-up Time.
    return true;
  }
  _mission.state=MISSION_READY; return true;
}

inline bool missionStart(){
  if(_mission.state!=MISSION_READY || _mission.targetCount<1) return false;
  _mission.currentIndex=0;
  _mission.startMs=millis();
  _mission.holdStartMs=0;
  _mission.timeLimitReached=false;
  _mission.elapsedMs=0;
  _mission.state=MISSION_ACQUIRING;
  missionSendStatus(true);
  return true;
}

inline void missionAbort(){
  if(_mission.state==MISSION_IDLE) return;
  missionFreezeElapsed();
  adcsManual(); rwStop(); _mission.state=MISSION_ABORTED;
  missionSendStatus(true);
}

inline void missionReset(){
  adcsManual(); rwStop();
  _mission.state=MISSION_IDLE;
  _mission.currentIndex=0;
  _mission.startMs=0; _mission.holdStartMs=0; _mission.captureStartMs=0; _mission.elapsedMs=0; _mission.timeLimitReached=false;
}

inline MissionRuntime missionGet(){return _mission;}

inline void missionPayloadImageReady(){
  if(_mission.state!=MISSION_CAPTURING) return;
  _mission.state=MISSION_IMAGE_READY;
  _mission.currentIndex++; _mission.holdStartMs=0; _mission.captureStartMs=0;
  if(_mission.currentIndex>=_mission.targetCount) missionComplete();
  else _mission.state=MISSION_ACQUIRING;
}

inline void missionUpdate(){
  missionSendStatus(false);
  if(_mission.state==MISSION_PREPARING){
    if(rwGetMode()!=RW_MODE_MOMENTUM || millis()-_mission.prepareStartMs>=rwMomentumProfileSpinupMs()){
      _mission.state=MISSION_READY;
      sendTelemetry("EVT,MISSION_READY");
      missionSendStatus(true);
    }
    return;
  }
  unsigned long now=millis();

  // CAPTURE is a blocking mission action, but never indefinitely.
  if(_mission.state==MISSION_CAPTURING){
    if(now-_mission.captureStartMs>=MISSION_CAPTURE_TIMEOUT_MS){
      sendTelemetry("EVT,CAPTURE_TIMEOUT");
      missionFail();
    }
    return;
  }

  if(_mission.state!=MISSION_ACQUIRING && _mission.state!=MISSION_HOLDING) return;
  if(!_mission.timeLimitReached && now-_mission.startMs>=_mission.maxDurationMs){
    _mission.timeLimitReached=true;
    missionFreezeElapsed();
    _mission.state=MISSION_TIME_LIMIT_REACHED;
    missionSendStatus(true);
    // IMPORTANT: competition rule — do NOT auto-abort and do NOT auto RW STOP.
    return;
  }

  if(_mission.currentIndex>=_mission.targetCount){
    missionComplete(); return;
  }

  MissionTarget &t=_mission.targets[_mission.currentIndex];

  // Mission Manager configures the same saved ADCS configuration path used by Operation.
  if(adcsGet().mode!=ADCS_AUTO){
    if(!adcsTarget(t.angleDeg) || !adcsAuto()){
      missionFail(); return;
    }
  }

  ADCSState a=adcsGet();
  if(!a.valid) return;

  if(fabsf(a.error)<=t.toleranceDeg){
    if(_mission.state!=MISSION_HOLDING){
      _mission.state=MISSION_HOLDING;
      _mission.holdStartMs=now;
    } else if(now-_mission.holdStartMs >= (unsigned long)(t.holdSec*1000.0f)){
      if(t.action==MISSION_ACTION_CAPTURE){
        _mission.state=MISSION_CAPTURING; _mission.captureStartMs=now; payloadSendCommand("CAPTURE");
      } else {
        _mission.currentIndex++; _mission.holdStartMs=0;
        if(_mission.currentIndex>=_mission.targetCount) missionComplete();
        else _mission.state=MISSION_ACQUIRING;
      }
    }
  } else {
    _mission.state=MISSION_ACQUIRING;
    _mission.holdStartMs=0;
  }
}
