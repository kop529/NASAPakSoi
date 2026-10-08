#pragma once
#include <Arduino.h>
#include "Module_ReactionWheel.h"

// v3.0.1 training extension: deterministic manual Reaction-wheel sequence.
// Timing is executed on the OBC, never by the Windows Ground Station.
struct ManualSequenceStep { int command; unsigned long durationMs; };
static const uint8_t MAN_SEQ_MAX_STEPS=12;
static ManualSequenceStep _manSeq[MAN_SEQ_MAX_STEPS];
static uint8_t _manSeqCount=0, _manSeqIndex=0;
static bool _manSeqRunning=false, _manSeqStepEvent=false, _manSeqDoneEvent=false;
static unsigned long _manSeqStepStart=0;

inline void manualSequenceClear(){ _manSeqCount=0; _manSeqIndex=0; _manSeqRunning=false; _manSeqStepEvent=false; _manSeqDoneEvent=false; }
inline bool manualSequenceAdd(int command,unsigned long durationMs){
  if(_manSeqRunning||_manSeqCount>=MAN_SEQ_MAX_STEPS||command<-100||command>100||durationMs<10||durationMs>10000)return false;
  _manSeq[_manSeqCount++]={command,durationMs}; return true;
}
inline bool manualSequenceRun(){
  if(_manSeqRunning||_manSeqCount==0||rwGetMode()!=RW_MODE_REACTION)return false;
  _manSeqIndex=0; _manSeqRunning=true; _manSeqDoneEvent=false; _manSeqStepEvent=false;
  rwSetReactionCommand(_manSeq[0].command); _manSeqStepStart=millis(); return true;
}
inline void manualSequenceStop(){
  // v3.0.5 safety invariant: an interrupted manual experiment never leaves residual wheel command.
  _manSeqRunning=false; _manSeqIndex=0; _manSeqStepEvent=false; _manSeqDoneEvent=false; rwStop();
}
inline void manualSequenceUpdate(){
  if(!_manSeqRunning)return; unsigned long now=millis();
  if(now-_manSeqStepStart < _manSeq[_manSeqIndex].durationMs)return;
  _manSeqStepEvent=true; _manSeqIndex++;
  if(_manSeqIndex>=_manSeqCount){ _manSeqRunning=false; rwStop(); _manSeqDoneEvent=true; return; }
  rwSetReactionCommand(_manSeq[_manSeqIndex].command); _manSeqStepStart=now;
}
inline bool manualSequenceRunning(){return _manSeqRunning;}
inline uint8_t manualSequenceCount(){return _manSeqCount;}
inline uint8_t manualSequenceIndex(){return _manSeqIndex;}
inline bool manualSequenceTakeStepEvent(){if(!_manSeqStepEvent)return false;_manSeqStepEvent=false;return true;}
inline bool manualSequenceTakeDoneEvent(){if(!_manSeqDoneEvent)return false;_manSeqDoneEvent=false;return true;}
