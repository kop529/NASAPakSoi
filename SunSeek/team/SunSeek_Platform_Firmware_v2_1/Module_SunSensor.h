#pragma once

/* SunSeek Platform v2.0 — MODULE LAYER */

#include <Arduino.h>
#include "Config_Sensor.h"

struct SunSample {
  int leftRaw;
  int rightRaw;
  float ndv;
  float angleDeg;
  float errorDeg;
  bool valid;
};

inline void sunSensorBegin() {
  pinMode(SUN_LEFT_PIN, INPUT);
  pinMode(SUN_RIGHT_PIN, INPUT);
}

inline bool sunSensorRead(SunSample &s) {
  s.leftRaw = analogRead(SUN_LEFT_PIN);
  s.rightRaw = analogRead(SUN_RIGHT_PIN);

  long sum = (long)s.leftRaw + (long)s.rightRaw;
  if (sum <= 0) {
    s.ndv = 0.0f;
    s.angleDeg = 0.0f;
    s.errorDeg = 0.0f;
    s.valid = false;
    return false;
  }

  s.ndv = ((float)s.leftRaw - (float)s.rightRaw) / (float)sum;
  s.angleDeg = estimateSunAngle(s.ndv);
  s.errorDeg = -s.angleDeg; // legacy T03 field; T04 computes target-dependent error in ADCS.h
  s.valid = true;
  return true;
}
