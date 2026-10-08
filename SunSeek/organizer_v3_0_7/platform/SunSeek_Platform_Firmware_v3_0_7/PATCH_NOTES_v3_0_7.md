# SunSeek Platform Firmware v3.0.7 — Mission Observability

Based on v3.0.6. Sensor/IMU/Estimator configuration and algorithms are unchanged.

## Changes
- OBC is authoritative for Mission elapsed time. Elapsed time freezes on COMPLETE, ABORTED, FAILED, or TIME_LIMIT_REACHED.
- Periodic mission telemetry reports mission state, target index/count, elapsed time, pointing tolerance state, and hold progress.
- Mission terminal transitions force an immediate status telemetry update.

## Telemetry
- `TM,MISSION_STATE,<state>,TARGET_INDEX,<n>,TARGET_COUNT,<count>,MISSION_TIME_MS,<ms>`
- `TM,MISSION_ACTIVITY,<state>,POINTING,<IN_TOLERANCE|OUT_OF_TOLERANCE|--->,HOLD_MS,<ms>,HOLD_REQUIRED_MS,<ms>`

## Hardware verification
1. NONE-action target: observe ACQUIRING -> HOLDING and HOLD_MS reset if tolerance is lost.
2. Final target: COMPLETE must freeze MISSION_TIME_MS and safe-stop the wheel.
3. ABORT: elapsed time freezes and wheel stops.
4. CAPTURE without payload: timeout -> FAILED, elapsed freezes, wheel stops.
