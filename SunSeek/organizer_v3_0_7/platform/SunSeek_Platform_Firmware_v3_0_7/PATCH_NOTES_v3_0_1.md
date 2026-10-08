# SunSeek Platform Firmware v3.0.1
Compatibility patch for GS v1.10.6.

- Adds non-blocking Manual Actuator Sequence for Reaction-wheel characterization.
- Commands: MAN_SEQ_CLEAR, MAN_SEQ_ADD,<command>,<duration_ms>, MAN_SEQ_RUN, MAN_SEQ_STOP.
- Up to 12 steps; command -100..100%; duration 10..10000 ms.
- Sequence timing executes on the OBC. MAN_SEQ_STOP/RW_STOP remains the safe interrupt path.
- Existing v3.0 ADCS, Momentum Profile, mission, telemetry and payload contracts are preserved.
