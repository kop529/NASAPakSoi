// ===== actuator facade: stepper (ULN2003) or servo, chosen by act.type =====
#pragma once
#include <stdint.h>

namespace act {
void begin();
void applyConfig();                 // re-read act.* after a SET
void gotoDeg(float angle);          // absolute angle, clamped to act.min..act.max
bool reachable(float angle);        // inside act.min..act.max (and the servo's own travel)
void moveRel(float delta);
float angleDeg();                   // commanded/logical angle
bool busy();
void stop();
void release();
void zero();
bool energized();
int32_t steps();
int type();
const char* typeName();
void backlashOverride(bool disable);   // BACKLASH test measures with compensation off
int pinsInUse(int* out, int max);      // pins owned by the actuator (PINFIND skips them)
}  // namespace act
