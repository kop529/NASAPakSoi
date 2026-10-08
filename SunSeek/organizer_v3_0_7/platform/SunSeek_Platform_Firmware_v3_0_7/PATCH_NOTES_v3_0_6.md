# SunSeek Platform Firmware v3.0.6 — Mission Safety

Integration build based on v3.0.5.

## Changes
- Mission COMPLETE now enters actuator safe state: ADCS MANUAL, reaction wheel STOP, no autonomous wheel command retained.
- CAPTURE is a blocking mission action with a 5000 ms timeout.
- If IMAGE_READY is not received before timeout, firmware emits `EVT,CAPTURE_TIMEOUT`, enters `MISSION_FAILED`, and safe-stops the actuator.
- Mission failures in PREPARE / ADCS start paths now use the same safe-stop path.
- Firmware emits `EVT,MISSION_FAILED` on transition to FAILED.
- Existing ABORT behavior remains safe-stop.
- Competition `MISSION_TIME_LIMIT_REACHED` policy is intentionally unchanged in this build (it is not treated as FAILED).

## Hardware verification
1. NONE final target -> COMPLETE -> verify ADCS MANUAL and wheel PWM 0.
2. CAPTURE final target + IMAGE_READY -> COMPLETE -> wheel PWM 0.
3. Disconnect/disable payload before CAPTURE -> after ~5 s expect CAPTURE_TIMEOUT + MISSION_FAILED + wheel PWM 0.
4. ABORT during ACQUIRING/HOLDING/CAPTURING -> ABORTED + wheel PWM 0.
