# SunSeek Platform Firmware v3.0.4

## Safety fix — AUTO exit / Abort
- `adcsManual()` now always calls `rwStop()` before entering MANUAL.
- This makes AUTO -> MANUAL a safe-state transition and clears Reaction PWM plus Momentum runtime state/timers.
- Existing `MISSION_ABORT`, `RW_STOP`, and `STOP` paths remain compatible; duplicate `rwStop()` calls are intentionally harmless/defensive.

## Momentum AUTO fix — CW/CCW hunting guard
- PD is still calculated as `u = Kp*error - Kd*rate`.
- `abs(PD demand)` remains the Momentum Profile trigger/gate.
- Maneuver direction is now constrained by the sign of the angle error (with `ADCS_CONTROL_SIGN`).
- A derivative term that temporarily reverses the sign of PD before the target is crossed no longer launches the opposite Assist profile. The controller returns/holds at Bias and reassesses.
- CW <-> CCW reversal is allowed after the angle error crosses the target side, reducing discrete Assist hunting.

## Hardware validation required
This is an integration build. Validate on the SunSeek hardware before freezing the training release:
1. AUTO + REACTION -> nonzero wheel command -> ABORT/MANUAL: wheel must stop and remain stopped.
2. AUTO + MOMENTUM with target on CW side: repeated action may be CW -> Recovery -> CW while target remains on that side; it must not issue CCW solely because the D term flips PD sign.
3. After genuine target crossing/overshoot, CCW correction must still be possible.
4. Repeat the same tests in the opposite direction.
