#pragma once

/* SunSeek Platform v2.0 — MODULE LAYER
   TEAM NasaPakSoi: readings now come from Team_SunSampler.h (windowed averages instead of one
   analogRead), and the angle comes from the team model when sun.model = 1. Field meanings that
   the organizer code and the Ground Station use are unchanged:
     leftRaw/rightRaw = ADC counts (now window averages), ndv = (L-R)/(L+R) from those counts,
     angleDeg = the angle the ADCS uses, valid = "a reading exists" (L+R > 0) exactly as before. */

#include <Arduino.h>
#include "Config_Sensor.h"
#include "Team_Params.h"
#include "Team_SunSampler.h"

struct SunSample {
  int leftRaw;
  int rightRaw;
  float ndv;
  float angleDeg;
  float errorDeg;
  bool valid;
  // TEAM NasaPakSoi BEGIN — extra detail (not sent to the Ground Station)
  float mvL, mvR;     // averaged millivolts
  float teamS;        // team model total signal
  float teamD;        // team model normalized difference
  float teamRaw;      // team model angle before th0/LUT
  float teamAngle;    // team model angle
  float noiseDeg;     // noise of one window's team angle
  bool sat;           // ADC clipped in this window
  bool light;         // usable light: team S >= sun.minS and not clipped
  bool edge;          // |D| > sun.dmax
  uint32_t seq;       // window number (0 = direct read, sampler not running yet)
  // TEAM NasaPakSoi END
};

inline void sunSensorBegin() {
  pinMode(SUN_LEFT_PIN, INPUT);
  pinMode(SUN_RIGHT_PIN, INPUT);
  teamSunSamplerBegin();  // TEAM NasaPakSoi
}

inline bool sunSensorRead(SunSample &s) {
  TeamSunWindow w;
  if (teamSunLatest(w)) {
    s.leftRaw = (int)lroundf(w.cntL);
    s.rightRaw = (int)lroundf(w.cntR);
    s.mvL = w.mvL; s.mvR = w.mvR;
    s.teamS = (float)w.est.S; s.teamD = (float)w.est.D;
    s.teamRaw = (float)w.est.raw; s.teamAngle = (float)w.est.theta;
    s.noiseDeg = w.noiseDeg;
    s.sat = w.sat;
    s.light = w.est.valid;   // the sampler already cleared it for clipped windows
    s.edge = w.est.edge;
    s.seq = w.seq;
  } else {
    // before the first window (first ~20 ms after boot): the organizer's single read
    s.leftRaw = analogRead(SUN_LEFT_PIN);
    s.rightRaw = analogRead(SUN_RIGHT_PIN);
    s.mvL = s.mvR = 0; s.teamS = s.teamD = s.teamRaw = s.teamAngle = s.noiseDeg = 0;
    s.sat = false; s.light = false; s.edge = false; s.seq = 0;
  }

  long sum = (long)s.leftRaw + (long)s.rightRaw;
  if (sum <= 0) {
    s.ndv = 0.0f;
    s.angleDeg = 0.0f;
    s.errorDeg = 0.0f;
    s.valid = false;
    return false;
  }

  s.ndv = ((float)s.leftRaw - (float)s.rightRaw) / (float)sum;
  // TEAM NasaPakSoi: sun.model 1 = team model (only once a window exists)
  s.angleDeg = (TP.sunModel == 1 && s.seq > 0) ? s.teamAngle : estimateSunAngle(s.ndv);
  s.errorDeg = -s.angleDeg; // legacy T03 field; T04 computes target-dependent error in ADCS.h
  s.valid = true;
  return true;
}
