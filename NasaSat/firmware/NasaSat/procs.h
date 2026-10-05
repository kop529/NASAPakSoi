// ===== long-running procedures: missions, sweeps, calibrations (non-blocking) =====
// Two slots: "motion" (moves the satellite, one at a time) and "aux" (measurement / camera only).
#pragma once
#include <stdint.h>

namespace procs {
enum M1State : uint8_t { M1_IDLE = 0, M1_SEARCH, M1_FINE, M1_HOLD, M1_LOST };

int m1State();
const char* m1Name(int s);
void setM1Idle(const char* why);

void update();                 // call every loop
void stopAll();                // STOP: abort both slots and stop the actuator
const char* motionName();      // nullptr when idle
const char* auxName();

// starters return false when their slot is busy
bool raw(int ms);
bool amb(int ms);
bool bal(int ms);
bool camLock();
bool zeroTh0(float ref);       // CAL TH0: outside reference says the light is at `ref` deg now
bool sweep(float a, float b, float step, int dwellMs, const char* tag);
bool m1Start(float tgt);       // aborts whatever motion procedure runs
void m1Stop();
bool stepTest(float deg);      // mission 1 must be HOLD
bool backlash();
bool spr();
// mode 0 = photo here (aux slot, works during mission 1); 1 = actuator angle, 2 = sun direction + offset
// (1 and 2 take over from mission 1; refused with snap_fail when unreachable or outside m2.tol)
bool snap(int mode, float value);
}  // namespace procs
