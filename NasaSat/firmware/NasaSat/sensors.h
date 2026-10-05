// ===== LDR sampling: symmetric L,R,R,L reads, flicker-cancelling windows, estimate per window =====
#pragma once
#include <stdint.h>
#include "estimator.h"

struct Meas {
  float mvL = 0, mvR = 0;   // averaged millivolts
  double GL = 0, GR = 0;    // relative conductance
  EstOut e{};               // angle estimate
  bool sat = false;         // an ADC reading hit the top of the range
  float ang = 0;            // actuator angle when measured
  bool moving = false;
  uint32_t t = 0;           // millis()
  float thSd = 0;           // noise of ONE window's angle (from window-to-window differences: slow drift ignored)
  int nWin = 0;             // windows averaged (noise of this reading ~ thSd / sqrt(nWin))
};

namespace sensors {
void begin();
void applyConfig();                   // after SET sen.*
void update();                        // call every loop
bool hasLatest();
const Meas& latest();
EstParams params();                   // from cfg + LUT
Meas make(float mvL, float mvR, bool sat);
int windowsFor(int ms);               // how many windows make up `ms`
void request(int slot, int windows);  // slot 0 = motion procedure, 1 = aux procedure
bool ready(int slot);
Meas result(int slot);
void cancel(int slot);
}  // namespace sensors
