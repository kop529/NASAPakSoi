#include "actuator.h"
#include <Arduino.h>
#include <math.h>
#include "cfg.h"
#include "compat.h"
#include "proto.h"
#include "stepper.h"

namespace {
int curType = -1;
int stepPins[4] = {-1, -1, -1, -1};
bool blOff = false;
// servo state
int servoPin = -1;
float servoAng = 0;
uint32_t servoBusyUntil = 0;

float spr() { return cfg::f(CFG_ACT_SPR); }

void servoWrite(float ang) {
#if ENABLE_SERVO
  if (servoPin < 0) return;
  const float rng = cfg::f(CFG_ACT_SRNG);
  const float us = cfg::f(CFG_ACT_SMIN) + (ang + rng / 2) / rng * (cfg::f(CFG_ACT_SMAX) - cfg::f(CFG_ACT_SMIN));
  const uint32_t duty = (uint32_t)(us / 20000.0f * (float)((1u << SERVO_BITS) - 1) + 0.5f);  // 50 Hz = 20 ms period
  pwmWrite(servoPin, SERVO_LEDC_CH, duty);
#else
  (void)ang;
#endif
}

void servoDetach() {
#if ENABLE_SERVO
  if (servoPin >= 0) pwmDetach(servoPin);
#endif
  servoPin = -1;
}
}  // namespace

namespace act {

int type() { return curType; }
const char* typeName() {
  if (curType == 1) return "stepper ULN2003";
  if (curType == 2) return servoPin >= 0 ? "servo" : "servo (PWM not attached)";
  return "none";
}

void applyConfig() {
  const int t = cfg::i(CFG_ACT_TYPE);
  const int pins[4] = {cfg::i(CFG_ACT_IN1), cfg::i(CFG_ACT_IN2), cfg::i(CFG_ACT_IN3), cfg::i(CFG_ACT_IN4)};
  if (t != curType) {  // switching actuator kind
    if (curType == 1) {
      stepper.release();
      const int none[4] = {-1, -1, -1, -1};
      stepper.setPins(none);
      for (int k = 0; k < 4; k++) stepPins[k] = -1;
    }
    if (curType == 2) servoDetach();
    curType = t;
  }
  if (curType == 1) {
    bool changed = false;
    for (int k = 0; k < 4; k++) changed |= pins[k] != stepPins[k];
    if (changed) {
      stepper.setPins(pins);
      for (int k = 0; k < 4; k++) stepPins[k] = pins[k];
    }
    stepper.setMode(cfg::i(CFG_ACT_SEQ), cfg::i(CFG_ACT_DIR) < 0 ? -1 : 1);
    stepper.setProfile(cfg::f(CFG_ACT_VMAX) * spr() / 360.0f, cfg::f(CFG_ACT_ACC) * spr() / 360.0f);
    stepper.setBacklash(blOff ? 0 : (int32_t)lroundf(cfg::f(CFG_ACT_BL) * spr() / 360.0f));
    stepper.setHold(cfg::i(CFG_ACT_HOLD) != 0);
  }
#if ENABLE_SERVO
  if (curType == 2) {
    const int p = cfg::i(CFG_ACT_SPIN);
    if (p != servoPin) {
      servoDetach();
      if (pwmAttach(p, SERVO_LEDC_CH, 50, SERVO_BITS)) {
        servoPin = p;
        servoWrite(servoAng);
      } else {
        out::event("FAULT ACT servo_pwm_attach_failed pin=%d", p);
      }
    }
  }
#endif
}

void begin() {
  stepper.begin();
  applyConfig();
}

void gotoDeg(float a) {
  const float lo = cfg::f(CFG_ACT_MIN);
  const float hi = cfg::f(CFG_ACT_MAX);
  if (a < lo || a > hi) {
    out::event("LIMIT %.2f", (double)a);
    a = a < lo ? lo : hi;
  }
  if (curType == 1) {
    stepper.moveTo((int32_t)lroundf(a * spr() / 360.0f));
  } else if (curType == 2) {
    const float half = cfg::f(CFG_ACT_SRNG) / 2;  // a servo cannot go past its own travel
    if (a < -half || a > half) {
      out::event("LIMIT %.2f servo", (double)a);
      a = a < -half ? -half : half;
    }
    const float d = fabsf(a - servoAng);
    servoAng = a;
    servoWrite(a);
    servoBusyUntil = millis() + (uint32_t)(d / 250.0f * 1000.0f) + 150;
  }
}

void moveRel(float d) { gotoDeg(angleDeg() + d); }

bool reachable(float a) {
  if (a < cfg::f(CFG_ACT_MIN) - 1e-3f || a > cfg::f(CFG_ACT_MAX) + 1e-3f) return false;
  if (curType == 2 && fabsf(a) > cfg::f(CFG_ACT_SRNG) / 2 + 1e-3f) return false;
  return curType == 1 || curType == 2;
}

float angleDeg() {
  if (curType == 1) return stepper.pos() * 360.0f / spr();
  if (curType == 2) return servoAng;
  return 0;
}

bool busy() {
  if (curType == 1) return stepper.busy();
  if (curType == 2) return (int32_t)(millis() - servoBusyUntil) < 0;
  return false;
}

void stop() {
  if (curType == 1) stepper.stop();
  if (curType == 2) servoBusyUntil = millis();
}

void release() {
  if (curType == 1) stepper.release();
}

void zero() {
  if (curType == 1) stepper.zero();
  if (curType == 2) servoAng = 0;
}

bool energized() { return curType == 1 ? stepper.energized() : curType == 2; }
int32_t steps() { return curType == 1 ? stepper.pos() : 0; }

void backlashOverride(bool disable) {
  blOff = disable;
  if (curType == 1) stepper.setBacklash(blOff ? 0 : (int32_t)lroundf(cfg::f(CFG_ACT_BL) * spr() / 360.0f));
}

int pinsInUse(int* outPins, int max) {
  int n = 0;
  if (curType == 1)
    for (int k = 0; k < 4 && n < max; k++)
      if (stepPins[k] >= 0) outPins[n++] = stepPins[k];
  if (curType == 2 && servoPin >= 0 && n < max) outPins[n++] = servoPin;
  return n;
}

}  // namespace act
