#pragma once

/* SunSeek Platform v2.0 — MODULE LAYER */
#include <Arduino.h>
#include "Config_Actuator.h"

/*
  ReactionWheel.h — T02 v1.2

  T01 capability carried forward:
    signed Reaction command -100..+100

  T02 capability added:
    Momentum-biased manual operation with non-blocking Assist maneuvers.

  IMPORTANT
    - Invalid momentum targets are rejected by the command router; they are
      not silently clamped.
    - STOP resets the commanded momentum operating point to 0 so the state is
      deterministic for training and subsequent telecommands.
*/

enum RWMode {
  RW_MODE_REACTION,
  RW_MODE_MOMENTUM
};

enum RWState {
  RW_STOPPED,
  RW_REACTION_DRIVE,
  RW_MOMENTUM_TARGET,
  RW_MOMENTUM_ASSIST
};

static RWMode _rwMode = RW_MODE_REACTION;
static RWState _rwState = RW_STOPPED;

static int _rwMotorCommand = 0;
static int _rwCurrentBias = 0;
static int _rwDelta = 0;
static int _rwTarget = 0;
static int _rwAssist = 0;
static unsigned long _rwDuration = 0;
static unsigned long _rwAssistStart = 0;
static bool _rwManeuverCompleteEvent = false;

inline int _rwPercentToPWM(int percent) {
  percent = constrain(percent, 0, 100);
  return map(percent, 0, 100, 0, 255);
}

inline void _rwDrive(int command) {
  command = constrain(command, -100, 100);
  _rwMotorCommand = command;

  int pwm = _rwPercentToPWM(abs(command));

  if (command == 0) {
    analogWrite(RW_PIN_PWMA, 0);
    digitalWrite(RW_PIN_AIN1, LOW);
    digitalWrite(RW_PIN_AIN2, LOW);
  } else if (command > 0) {
    digitalWrite(RW_PIN_AIN1, HIGH);
    digitalWrite(RW_PIN_AIN2, LOW);
    analogWrite(RW_PIN_PWMA, pwm);
  } else {
    digitalWrite(RW_PIN_AIN1, LOW);
    digitalWrite(RW_PIN_AIN2, HIGH);
    analogWrite(RW_PIN_PWMA, pwm);
  }
}

inline void _rwResetMomentumState() {
  _rwCurrentBias = 0;
  _rwDelta = 0;
  _rwTarget = 0;
  _rwAssist = 0;
  _rwDuration = 0;
  _rwAssistStart = 0;
  _rwManeuverCompleteEvent = false;
}

inline void rwBegin() {
  pinMode(RW_PIN_PWMA, OUTPUT);
  pinMode(RW_PIN_AIN1, OUTPUT);
  pinMode(RW_PIN_AIN2, OUTPUT);
  _rwDrive(0);
  _rwResetMomentumState();
}

inline void rwUpdate() {
  if (_rwState == RW_MOMENTUM_ASSIST &&
      millis() - _rwAssistStart >= _rwDuration) {
    _rwDrive(_rwTarget);
    _rwState = RW_MOMENTUM_TARGET;
    _rwManeuverCompleteEvent = true;
  }
}

inline bool rwTakeManeuverCompleteEvent() {
  if (!_rwManeuverCompleteEvent) return false;
  _rwManeuverCompleteEvent = false;
  return true;
}

inline void rwSetMode(RWMode mode) {
  _rwDrive(0);
  _rwState = RW_STOPPED;
  _rwMode = mode;
  _rwResetMomentumState();
}

inline void rwSetReactionCommand(int command) {
  _rwDrive(command);
  _rwState = (command == 0) ? RW_STOPPED : RW_REACTION_DRIVE;
}

inline void rwStop() {
  _rwDrive(0);
  _rwState = RW_STOPPED;
  _rwResetMomentumState();
}

inline bool rwSetBias(int bias) {
  if (bias < 0 || bias > 100) return false;

  _rwCurrentBias = bias;
  _rwDelta = 0;
  _rwTarget = bias;
  _rwAssist = 0;
  _rwDuration = 0;
  _rwManeuverCompleteEvent = false;

  _rwDrive(bias);
  _rwState = (bias == 0) ? RW_STOPPED : RW_MOMENTUM_TARGET;
  return true;
}

inline bool rwMomentumCommand(int delta, int assist, unsigned long durationMs) {
  long requested = (long)_rwCurrentBias + delta;

  if (requested < 0 || requested > 100) return false;
  if (assist < -100 || assist > 100) return false;

  _rwDelta = delta;
  _rwTarget = (int)requested;
  _rwAssist = assist;
  _rwDuration = durationMs;
  _rwCurrentBias = _rwTarget;
  _rwManeuverCompleteEvent = false;

  if (assist == 0 || durationMs == 0) {
    _rwDrive(_rwTarget);
    _rwState = (_rwTarget == 0) ? RW_STOPPED : RW_MOMENTUM_TARGET;
    return true;
  }

  _rwDrive(assist);
  _rwAssistStart = millis();
  _rwState = RW_MOMENTUM_ASSIST;
  return true;
}

inline RWMode rwGetMode() { return _rwMode; }
inline RWState rwGetState() { return _rwState; }
inline int rwGetMotorCommand() { return _rwMotorCommand; }
inline int rwGetCurrentBias() { return _rwCurrentBias; }
inline int rwGetDelta() { return _rwDelta; }
inline int rwGetTarget() { return _rwTarget; }
inline int rwGetAssist() { return _rwAssist; }
inline unsigned long rwGetDuration() { return _rwDuration; }

inline String rwModeText() {
  return _rwMode == RW_MODE_REACTION ? "REACTION" : "MOMENTUM";
}

inline String rwStateText() {
  switch (_rwState) {
    case RW_STOPPED: return "STOPPED";
    case RW_REACTION_DRIVE: return "REACTION_DRIVE";
    case RW_MOMENTUM_TARGET: return "MOMENTUM_TARGET";
    case RW_MOMENTUM_ASSIST: return "MOMENTUM_ASSIST";
  }
  return "UNKNOWN";
}
