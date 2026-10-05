#pragma once

/* TEAM NasaPakSoi — sun sensor sampling (ported from NasaSat firmware/NasaSat/sensors.cpp).

   The organizer read each LDR once per control step. One reading carries the lamp's 100 Hz flicker
   and ADC noise straight into the angle. Here a small FreeRTOS task samples both LDRs every 2 ms
   (L,R then R,L so both channels share the same mean time) and averages over a window of
   sun.win ms (a multiple of 10 ms cancels the flicker). Each finished window is published whole;
   the control loop always takes the latest complete window and never waits for the ADC.

   Per window:
     - averaged ADC counts (kept for the organizer's SUN_L / SUN_R / SUN_NDV telemetry)
     - averaged calibrated millivolts (input of the team model)
     - clipped flag (any sample at the ADC limit: no direction information)
     - angle from the team model, and a noise estimate from window-to-window angle changes */

#include <Arduino.h>
#include "Config_Sensor.h"
#include "Team_Params.h"
#include "Team_SunModel.h"

struct TeamSunWindow {
  float cntL = 0, cntR = 0;  // averaged ADC counts
  float mvL = 0, mvR = 0;    // averaged millivolts
  bool sat = false;          // a sample hit the ADC limit
  uint16_t n = 0;            // sample pairs in the window
  uint32_t t = 0;            // millis() at the end of the window
  TeamSunOut est{};          // team model output (always computed, used when sun.model = 1)
  float noiseDeg = 0;        // noise of ONE window's team angle (slow drift ignored)
  uint32_t seq = 0;          // increments with every window
};

static TeamSunWindow _teamSunLast;
static volatile bool _teamSunHave = false;
static TaskHandle_t _teamSunTask = nullptr;

inline bool teamSunClipped(float mv) {
  return TP.sun.topo == 1 ? mv <= TP.sunSatLo : mv >= TP.sunSatHi;
}

// accumulator of the window being filled (only the sampler task touches it)
struct TeamSunAcc {
  double sL = 0, sR = 0, cL = 0, cR = 0;
  uint16_t n = 0;
  bool sat = false;
  uint32_t winStart = 0;
  double prevTheta = 0, noise2 = 0;
  bool havePrev = false;
  uint32_t seq = 0;
};
static TeamSunAcc _teamSunAcc;

// One sample pair. Separate from the ADC reads so the host test can feed it synthetic light.
inline void teamSunSamplerStep(uint32_t now, int rL, uint32_t mL, int rR, uint32_t mR) {
  TeamSunAcc& a = _teamSunAcc;
  a.cL += rL; a.cR += rR; a.sL += mL; a.sR += mR; a.n++;
  if (teamSunClipped((float)mL) || teamSunClipped((float)mR)) a.sat = true;

  const uint32_t win = (uint32_t)(TP.sunWinMs > 0 ? TP.sunWinMs : 20);
  if (now - a.winStart < win || a.n == 0) return;
  TeamSunWindow w;
  w.cntL = (float)(a.cL / a.n); w.cntR = (float)(a.cR / a.n);
  w.mvL = (float)(a.sL / a.n);  w.mvR = (float)(a.sR / a.n);
  w.sat = a.sat; w.n = a.n; w.t = now;
  const TeamSunParams p = teamSunParamsSnapshot();
  w.est = teamSunFromMv(w.mvL, w.mvR, p);
  if (w.sat) w.est.valid = false;  // never steer or hold on clipped data
  // difference of two independent windows has twice the variance of one window
  if (a.havePrev) {
    const double d = w.est.theta - a.prevTheta;
    a.noise2 = a.noise2 <= 0 ? d * d / 2 : a.noise2 + 0.05 * (d * d / 2 - a.noise2);
  }
  a.prevTheta = w.est.theta; a.havePrev = true;
  w.noiseDeg = (float)sqrt(a.noise2);
  w.seq = ++a.seq;
  portENTER_CRITICAL(&_teamMux);
  _teamSunLast = w;
  portEXIT_CRITICAL(&_teamMux);
  _teamSunHave = true;
  a.sL = a.sR = a.cL = a.cR = 0; a.n = 0; a.sat = false; a.winStart = now;
}

inline void _teamSunTaskFn(void*) {
  bool flip = false;
  _teamSunAcc.winStart = millis();
  for (;;) {
    int rL, rR;
    uint32_t mL, mR;
    if (!flip) {
      rL = analogRead(SUN_LEFT_PIN); mL = analogReadMilliVolts(SUN_LEFT_PIN);
      rR = analogRead(SUN_RIGHT_PIN); mR = analogReadMilliVolts(SUN_RIGHT_PIN);
    } else {
      rR = analogRead(SUN_RIGHT_PIN); mR = analogReadMilliVolts(SUN_RIGHT_PIN);
      rL = analogRead(SUN_LEFT_PIN); mL = analogReadMilliVolts(SUN_LEFT_PIN);
    }
    flip = !flip;
    teamSunSamplerStep(millis(), rL, mL, rR, mR);
    vTaskDelay(pdMS_TO_TICKS(2));
  }
}

inline void teamSunSamplerBegin() {
#ifndef TEAM_HOST_TEST
  if (_teamSunTask) return;
  // same core as loop(); priority above loop() so sampling stays regular while telemetry is sent
  xTaskCreatePinnedToCore(_teamSunTaskFn, "teamSun", 4096, nullptr, 2, &_teamSunTask, 1);
#endif
}

inline bool teamSunLatest(TeamSunWindow& w) {
  if (!_teamSunHave) return false;
  portENTER_CRITICAL(&_teamMux);
  w = _teamSunLast;
  portEXIT_CRITICAL(&_teamMux);
  return true;
}
