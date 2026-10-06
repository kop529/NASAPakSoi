#pragma once

/* SunSeek Platform v2.0 — MODULE LAYER */
#include <Arduino.h>
#include <math.h>
#include "Module_ADCS.h"
#include "Module_ReactionWheel.h"

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

struct MissionTarget {
  float angleDeg;
  float toleranceDeg;
  float holdSec;
};

#define MISSION_MAX_TARGETS 10

struct MissionRuntime {
  MissionState state;
  MissionTarget targets[MISSION_MAX_TARGETS];
  uint8_t targetCount;
  uint8_t currentIndex;
  unsigned long startMs;
  unsigned long holdStartMs;
  unsigned long maxDurationMs;
  bool timeLimitReached;
};

static MissionRuntime _mission = {MISSION_IDLE, {}, 0, 0, 0, 0, 5UL*60UL*1000UL, false};

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

inline void missionBegin(){ _mission.state=MISSION_IDLE; }

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

inline bool missionAddTarget(float angle,float tolerance,float holdSec){
  if(_mission.state!=MISSION_IDLE || _mission.targetCount>=MISSION_MAX_TARGETS) return false;
  if(!isfinite(angle)||!isfinite(tolerance)||!isfinite(holdSec)) return false;
  if(tolerance<=0 || tolerance>30 || holdSec<0 || holdSec>60) return false;
  _mission.targets[_mission.targetCount++]={angle,tolerance,holdSec};
  return true;
}

inline bool missionPrepare(){
  if(_mission.state!=MISSION_IDLE || _mission.targetCount<1) return false;
  _mission.state=MISSION_PREPARING;

  // v0.1: Reaction is immediately ready after configuration checks.
  // Momentum preparation state is exposed now; dynamic steady-state qualification
  // will be hardware-characterized before it becomes an automatic READY criterion.
  _mission.state=MISSION_READY;
  return true;
}

inline bool missionStart(){
  if(_mission.state!=MISSION_READY || _mission.targetCount<1) return false;
  _mission.currentIndex=0;
  _mission.startMs=millis();
  _mission.holdStartMs=0;
  _mission.timeLimitReached=false;
  _mission.state=MISSION_ACQUIRING;
  return true;
}

inline void missionAbort(){
  if(_mission.state==MISSION_IDLE) return;
  adcsManual(); rwStop(); _mission.state=MISSION_ABORTED;
}

inline void missionReset(){
  adcsManual(); rwStop();
  _mission.state=MISSION_IDLE;
  _mission.currentIndex=0;
  _mission.startMs=0; _mission.holdStartMs=0; _mission.timeLimitReached=false;
}

inline MissionRuntime missionGet(){return _mission;}

inline void missionUpdate(){
  if(_mission.state!=MISSION_ACQUIRING && _mission.state!=MISSION_HOLDING) return;

  unsigned long now=millis();
  if(!_mission.timeLimitReached && now-_mission.startMs>=_mission.maxDurationMs){
    _mission.timeLimitReached=true;
    _mission.state=MISSION_TIME_LIMIT_REACHED;
    // IMPORTANT: competition rule — do NOT auto-abort and do NOT auto RW STOP.
    return;
  }

  if(_mission.currentIndex>=_mission.targetCount){
    _mission.state=MISSION_COMPLETE; return;
  }

  MissionTarget &t=_mission.targets[_mission.currentIndex];

  // Mission Manager configures the same verified ADCS path used by Operation.
  if(adcsGet().mode!=ADCS_AUTO){
    if(!adcsTarget(t.angleDeg) || !adcsAuto()){
      _mission.state=MISSION_FAILED; return;
    }
  }

  ADCSState a=adcsGet();
  if(!a.valid) return;

  if(fabsf(a.error)<=t.toleranceDeg){
    if(_mission.state!=MISSION_HOLDING){
      _mission.state=MISSION_HOLDING;
      _mission.holdStartMs=now;
    } else if(now-_mission.holdStartMs >= (unsigned long)(t.holdSec*1000.0f)){
      // v0.1 stops at CAPTURING as an explicit integration point for the
      // payload capture/IMAGE_READY transaction to be validated with GS.
      _mission.state=MISSION_CAPTURING;
    }
  } else {
    _mission.state=MISSION_ACQUIRING;
    _mission.holdStartMs=0;
  }
}
