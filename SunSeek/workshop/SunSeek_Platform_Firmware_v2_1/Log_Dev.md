# Log_Dev — SunSeek Platform Firmware v2.1

## v2.1 — Manual / AUTO Actuator Ownership
- Replaced the legacy `RW_CMD_USE_T02_T03_FOR_ASSIST_EXPERIMENT` restriction.
- In `MANUAL`, direct `RW_CMD` is allowed for Engineering/T01/T02 experiments,
  including momentum-bias characterization after `RW_BIAS`.
- In `AUTO`, direct `RW_CMD` is rejected with `ERR,RW_CMD_REQUIRES_MANUAL_MODE`
  because ADCS owns the actuator.
- `RW_STOP` remains available as the explicit stop/safety path.
- No intentional estimator, telemetry, BLE, payload, or ADCS control-law change.


This is the single development-history file for the SunSeek training firmware.
Historical notes below are preserved from the development lineage. v2.0 is a
codebase reorganization release: Config / Module / System. The runtime baseline
is T07 FIX6 Estimator Continuous + MA500.

## v2.0 — Codebase Reorganization
- Renamed the firmware baseline to SunSeek Platform Firmware v2.0.
- Introduced three educational layers:
  - `Config_*` — learner-facing parameters/configuration.
  - `Module_*` — subsystem and algorithm implementation; advanced modification.
  - `System_*` — TT&C, routing and telemetry infrastructure; normally not edited.
- Consolidated IMU and Sun Sensor learner settings into `Config_Sensor.h`.
- Consolidated all historical CHANGELOG / FIX / README development notes into this file.
- Consolidated interface-contract documents into `Interface_Contract.md`.
- No intentional control-law, estimator-algorithm, TT&C protocol, payload-interface,
  or mission behavior change from the FIX6 runtime baseline.

## File Access Policy
- BASIC / INTERMEDIATE: edit `Config_*` only when instructed.
- ADVANCED: inspect/modify `Module_*` for algorithm/subsystem exercises.
- PLATFORM / DEVELOPER: `System_*`; preserve interface contract unless intentionally revising the platform.



---

## Historical source: `CHANGELOG.md`

# Changelog

## T04 v0.2
- Rebased T04 on T03 v0.3 instead of the earlier provisional T04 branch.
- Added reference-agnostic SUN/MAG Pointing Error.
- Added MANUAL/AUTO P/PD controller and runtime tuning.
- Added heading wrap-around, deadband, output limiting and control sign.
- Added Reaction and Momentum AUTO paths.
- Added fail-safe sensor fault handling.
- Changed Sun Sensor config to an editable Team Estimator function.
- Documented GS v1.8 generic Pointing Error limitation.

Hardware verification still required before freeze.


---

## Historical source: `CHANGELOG_T05.md`

# T05 Changelog

## v0.1
- Based directly on SunSeek Training Firmware T04 v0.2.
- Added HardwareSerial1 payload link: GPIO41 TX / GPIO42 RX, 115200 8N1.
- Added Ground Station payload command routing.
- Added asynchronous payload response forwarding.
- Added Ground Station-compatible flat TM for payload IP, status and image metadata.
- Preserved T04 BLE, sensors, ADCS and reaction/momentum-wheel implementation without redesign.

## v0.2
- Added minimal Payload v0.3 Live View UART bridge: START/STOP/STATUS.
- Preserved T04 ADCS, BLE, reaction-wheel, sensor and capture behavior.


---

## Historical source: `CHANGELOG_T05_v0_3.md`

# T05 v0.3 Changelog

- Added `Config_Estimator.h`.
- Added `Estimator.h` standard LPF + complementary gyro fusion.
- Integrated estimated angle into ADCS pointing-error calculation.
- Preserved existing Reaction and Momentum control laws.
- Added estimator TT&C commands and telemetry.
- Added wrapped-angle handling for magnetometer filtering/fusion.
- Defaults LPF/Fusion OFF for T05 v0.2 backward behavior.
- No changes to payload UART / Live View protocol.
- Hardware validation still required.


---

## Historical source: `CHANGELOG_T07_v0_1.md`

# T07 v0.1 Changelog
- Branched from T05 v0.3 Estimation Integration.
- Added TelemetryManager with SUN/MAG/GYRO streams default OFF.
- Added per-sensor stream commands, rate control and one-shot snapshots.
- Added first MissionManager target-sequence state machine.
- Added PREPARE/READY/START/ABORT/RESET mission commands.
- Added Maximum Mission Duration guard behavior without automatic abort.
- Preserved T05 payload, estimator, BLE, ADCS and RW architecture.
- Automatic camera transaction and Momentum dynamic READY qualification are
  intentionally deferred to the next integration increment.


---

## Historical source: `FIX2_NOTES.md`

# T07 v0.1 FIX2 — Telemetry Gate

Root cause fixed:
- `sensorADCSUpdate()` was still called every loop and transmitted
  `sensorSendADCSSnapshot()` periodically even when SUN/MAG/GYRO streams were OFF.
- That ADCS packet contains SUN_ERROR, MAG_ERROR, GYRO_Z and estimator values,
  so Ground Station continued to display changing sensor values.

FIX2:
- Continuous SUN/MAG/GYRO streams remain OFF after boot.
- Continuous ADCS/Estimator telemetry is now also OFF after boot.
- New commands:
  - `TM_STREAM,ADCS,ON`
  - `TM_STREAM,ADCS,OFF`
- `TM_STREAM_STATUS` now reports ADCS state too.
- `TM_STREAM,ALL,ON|OFF` continues to mean Engineering sensor streams
  SUN/MAG/GYRO only; it does not silently enable ADCS telemetry.
- One-shot STATUS/SNAPSHOT commands may still return requested information.
- Sensor acquisition for ADCS remains independent of downlink telemetry.

Expected after boot:
`SUN=OFF, MAG=OFF, GYRO=OFF, ADCS=OFF`
No continuous sensor/ADCS telemetry should be emitted until commanded.


---

## Historical source: `FIX3_NOTES.md`

# T07 v0.1 FIX3 — Telemetry Quiet Mode

- Gyroscope acquisition remains available internally for estimator and ADCS.
- `TM_STREAM,GYRO,OFF` suppresses Engineering gyro downlink only.
- `TM_STREAM,ADCS,OFF` suppresses operational ADCS/Estimator downlink, including Body Rate carried by that stream.
- Added `TM_STREAM,QUIET` to switch SUN/MAG/GYRO/ADCS continuous downlink OFF in one command.
- This avoids confusing "sensor OFF" tests while preserving internal sensor acquisition.


---

## Historical source: `FIX6_NOTES.txt`

SunSeek T07 v0.1 FIX6 — Estimator Continuous + MA500

Fixes
1) Moving Average 1..500 samples is now represented with uint16_t for:
   - movingAverageWindow
   - ring-buffer count
   - ring-buffer head
   - iteration indices
   This removes the previous uint8_t overflow above 255.

2) Sensor/estimator update is no longer AUTO-only.
   adcsUpdate() now runs adcsRead() periodically in MANUAL and AUTO.
   In MANUAL it updates sensing/estimation and returns before actuator control.
   In AUTO it continues into the existing verified PD/reaction/momentum control law.

3) ADCS telemetry no longer calls adcsRead().
   Telemetry observes the latest spacecraft state instead of changing estimator state.
   Therefore enabling/disabling ADCS telemetry does not change the Moving Average
   sampling behavior.

Expected Engineering behavior
- Moving Average can be characterized while ADCS is MANUAL.
- Window 1: Filtered Angle follows Raw closely.
- Larger windows: progressively smoother response with increasing lag.
- Windows 256..500 are now valid and no longer truncate/wrap.

No controller gains, reaction/momentum laws, BLE protocol, or payload interface
were intentionally changed.

Validation performed here: source-level structural checks + ZIP integrity.
Hardware/Arduino compile validation remains to be performed on the SunSeek board.


---

## Historical source: `README_T04.md`

# SunSeek v1.3 — T04 ADCS Control & Pointing v0.2

**Status: hardware-test candidate — not frozen Student Template.**

Built from the T03 v0.3 codebase so the tested BLE, Reaction Wheel, GY-89 and
Sun Sensor architecture is retained. T04 adds only the control layer.

## New T04 capability
- `ADCS_REFERENCE,SUN|MAG`
- `SET_TARGET,<deg>`
- `ADCS_MODE,MANUAL|AUTO`
- `ADCS_STRATEGY,REACTION|MOMENTUM`
- `ADCS_TUNE,<Kp>,<Kd>,<MomentumBias>`
- P/PD law: `u = Kp*POINTING_ERROR - Kd*GYRO_Z`
- deadband, output limit and configurable `ADCS_CONTROL_SIGN`
- MAG shortest-path heading error
- periodic flat ADCS telemetry

## First hardware test
1. Put the spacecraft in MANUAL + REACTION.
2. Select SUN and target 0 deg.
3. Use low manual `RW,20` and `RW,-20` commands to verify the body/control sign.
4. If the sign is wrong, change only `ADCS_CONTROL_SIGN` in `Config_ADCS.h`.
5. Start P-only: `ADCS_TUNE,0.5,0,40`.
6. Enable AUTO and keep `STOP` ready.
7. If |POINTING_ERROR| grows, STOP immediately and correct the sign.
8. Only after this passes, proceed to P/PD tuning in the T04 Workbook.

## Calibration prerequisite
Copy the team's verified T03 values into `Config_IMU.h`. `Config_SunSensor.h`
contains the Team Estimator function; replace its simple default with the team's
verified T03 estimator if desired.

## Ground Station v1.8 limitation
The firmware emits `POINTING_ERROR`, `MAG_ERROR` and `ADCS_REFERENCE`, but GS
v1.8 does not yet bind these fields to the Operation Pointing Error widget.
SUN experiments remain partly visible through legacy `SUN_ERROR`; MAG generic
Pointing Error must be read in the TT&C monitor until the T04 GS update is made.

Mission automation remains outside T04.


---

## Historical source: `README_T05.md`

# SunSeek Training Firmware — T05 v0.1

T05 extends the tested T04 OBC/ADCS baseline with the ESP32-CAM payload control plane.

## Wiring

- SunSeek GPIO41 (TX) -> ESP32-CAM GPIO3 / RX0
- SunSeek GPIO42 (RX) <- ESP32-CAM GPIO1 / TX0
- GND -> GND
- UART: 115200 8N1

Do not connect the ESP32-CAM USB/programmer UART and SunSeek UART drivers to the same RX/TX lines at the same time unless the hardware is specifically designed for that arrangement.

## Architecture

Control plane: Ground Station -> BLE -> SunSeek OBC -> UART -> ESP32-CAM

Payload data plane: ESP32-CAM -> Wi-Fi/HTTP -> Ground Station

JPEG data is never forwarded through BLE or OBC UART.

## First hardware test

1. Flash ESP32-CAM Payload Firmware v0.2 and boot it with microSD installed.
2. Flash this T05 firmware to SunSeek v1.3.
3. Connect common GND and the crossed UART wiring above.
4. Connect Ground Station over BLE.
5. Send `PAYLOAD_STATUS`.
6. Expect `ACK,PAYLOAD_STATUS`, followed by `PAYLOAD,STATUS,...` and a flat `TM,...PAYLOAD_IP,...` update.
7. Send `CAPTURE`.
8. Expect `ACK,CAPTURE`, `PAYLOAD,EVENT,CAPTURE_STARTED`, then `PAYLOAD,IMAGE_READY,...` and `TM,...LAST_IMAGE,...`.
9. Use Ground Station Wi-Fi/HTTP Preview Latest to retrieve the JPEG directly from the payload.

## Added T05 telecommands

- `PAYLOAD_PING`
- `PAYLOAD_STATUS`
- `CAPTURE`
- `PAYLOAD_IMAGE_COUNT`
- `PAYLOAD_LAST_IMAGE`

T01-T04 commands are retained from the T04 v0.2 baseline.


## v0.2 Live View bridge
Ground Station commands:
- `PAYLOAD_STREAM_START` -> ESP32-CAM UART `STREAM_START`
- `PAYLOAD_STREAM_STOP` -> ESP32-CAM UART `STREAM_STOP`
- `PAYLOAD_STREAM_STATUS` -> ESP32-CAM UART `STREAM_STATUS`

Payload responses `ACK,STREAM_*`, `EVENT,STREAM_*`, `STREAM_URL,...` and
`STREAM_STATUS,...` are forwarded to the Ground Station as `PAYLOAD,...`.

The JPEG/MJPEG data path remains direct ESP32-CAM -> Wi-Fi -> Ground Station.
No image data is routed through BLE or the OBC UART.


---

## Historical source: `README_T05_v0_3.md`

# SunSeek Training Firmware — T05 v0.3 Estimation Integration

Baseline: T05 v0.2, preserving the tested BLE TT&C, Reaction Wheel / ADCS,
sensor, Payload UART and Live View paths.

## What is new

A standard estimation layer is inserted between the selected absolute reference
and the existing PD controller:

`SUN/MAG Reference -> optional LPF -> optional Gyro Complementary Fusion
 -> Estimated Angle -> Pointing Error -> existing PD -> existing RW law`

Power-up defaults keep LPF and Fusion **OFF**, so the verified T05 v0.2 control
behavior remains the baseline until the operator explicitly enables estimation.

### Filter parameter

`ESTIMATOR_FILTER,<0..1>`

This is **Filter Strength**, matching the Ground Station UI:

- `0.00` = Fast (alpha = 1.00)
- `1.00` = Smooth (alpha = 0.00)

Internally: `alpha = 1 - FilterStrength`.

### Fusion parameter

`ESTIMATOR_GYRO_WEIGHT,<0..1>`

- `0.00` = filtered absolute reference dominates
- `1.00` = gyro propagation dominates between reference corrections

Magnetometer calculations use wrapped shortest-angle differences so 359° and
1° are treated as 2° apart.

## New TT&C

- `ESTIMATOR_STATUS`
- `ESTIMATOR_LPF,ON`
- `ESTIMATOR_LPF,OFF`
- `ESTIMATOR_FILTER,<0..1>`
- `ESTIMATOR_FUSION,ON`
- `ESTIMATOR_FUSION,OFF`
- `ESTIMATOR_GYRO_WEIGHT,<0..1>`

## New telemetry

- `EST_RAW`
- `EST_FILTERED`
- `EST_ANGLE`
- `EST_LPF`
- `EST_FILTER_STRENGTH`
- `EST_FUSION`
- `EST_GYRO_WEIGHT`
- `EST_VALID`

Ground Station should calculate Static Stability (1 sigma) and dynamic
Estimator Difference from telemetry; these are intentionally not calculated
inside the spacecraft firmware.

## Hardware-test sequence

1. Flash v0.3 and confirm `STATUS`, sensors, RW and Payload Live View still work.
2. Keep LPF OFF / Fusion OFF and verify ADCS behavior matches v0.2.
3. MANUAL mode: enable LPF and test Filter Strength while plotting raw reference,
   filtered reference and estimated angle.
4. Enable Fusion and test Gyro Weight while manually rotating the spacecraft.
5. Test SUN reference in AUTO, first Reaction then Momentum.
6. Return MANUAL; test MAG reference in AUTO, first Reaction then Momentum.
7. Only after the above passes should these settings be treated as a verified
   Estimation Profile.

This package is a hardware-test candidate; it has not been hardware-validated
by this build process.


---

## Historical source: `README_T07_FIX4_MOVING_AVERAGE.md`

# T07 FIX4 — Moving Average Estimator
Default: Filter ON, MOVING_AVERAGE, Window=10 samples, Gyro Fusion ON, Gyro Weight=0.98.
Advanced filters: LPF and CUSTOM. CUSTOM is a reserved pass-through hook until team code is added.
New TC: ESTIMATOR_FILTER_ENABLE, ESTIMATOR_FILTER_TYPE, ESTIMATOR_MA_WINDOW.
Legacy ESTIMATOR_LPF ON/OFF remains accepted as filter master enable/disable.


---

## Historical source: `README_T07_FIX5_OPERATION_PREPARE.md`

# T07 FIX5
- Moving Average window range expanded to 1..500 samples.
- Added ADCS_PREPARE for Operation AUTO readiness.
- ADCS_PREPARE is separate from Competition MISSION_PREPARE.
- Reaction reports READY after sensor/config readiness.
- Momentum applies configured bias before READY. Dynamic steady-state qualification remains a hardware-characterization item; this baseline does not invent an unvalidated threshold.


---

## Historical source: `README_T07_v0_1.md`

# SunSeek Training Firmware T07 v0.1 — Integrated Mission Baseline

Purpose: first integrated firmware baseline for Ground Station Operation /
Competition development and hardware testing.

Inherited from T05:
- BLE TT&C
- Reaction Wheel and ADCS
- Sun / IMU sensing
- Standard LPF + complementary gyro estimator
- Payload UART bridge and Live View

New in T07 v0.1:
1. Engineering sensor telemetry is subscription-controlled and defaults OFF.
2. SUN / MAG / GYRO telemetry can be enabled independently.
3. Sensor acquisition is independent of telemetry transmission.
4. Mission Manager baseline supports target sequences, tolerance, hold time,
   PREPARE / READY / START / ABORT and maximum mission duration.
5. Time-limit expiry does NOT auto-abort or auto-stop the reaction wheel.

## Telemetry commands

TM_STREAM,SUN,ON|OFF
TM_STREAM,MAG,ON|OFF
TM_STREAM,GYRO,ON|OFF
TM_STREAM,ALL,ON|OFF
TM_RATE,<1..20 Hz>
TM_STREAM_STATUS
TM_SNAPSHOT,SUN|MAG|GYRO|ALL

Power-up default:
SUN OFF, MAG OFF, GYRO OFF, rate 5 Hz.

## Mission commands

MISSION_CLEAR
MISSION_TARGET,<angleDeg>,<toleranceDeg>,<holdSec>
MISSION_MAX_MIN,<1..15|20|30>
MISSION_PREPARE
MISSION_START
MISSION_STATUS
MISSION_ABORT
MISSION_RESET

## Important v0.1 limits

This is intentionally the FIRST T07 baseline, not final mission firmware.

- Momentum PREPARE currently exposes the state transition but does NOT yet use
  characterized angular-acceleration steady-state qualification.
- Mission Manager reaches CAPTURING after tolerance+hold, but automatic payload
  capture -> IMAGE_READY -> next target is intentionally left as the next
  hardware/GS integration step.
- Mission Name, Run ID, observation metadata and image-transfer strategy remain
  primarily Ground Station workflow until their spacecraft-side contract is
  validated.
- Hardware validation is required.
