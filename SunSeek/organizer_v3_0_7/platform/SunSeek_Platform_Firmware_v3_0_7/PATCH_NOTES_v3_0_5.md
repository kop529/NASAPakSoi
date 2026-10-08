# SunSeek Platform Firmware v3.0.5

Manual Actuator Profile safety refinement.

- `MAN_SEQ_STOP` cancels the active sequence, clears runtime step/event state, and always calls `rwStop()`.
- Natural sequence completion already calls `rwStop()` before emitting `EVT,MAN_SEQ_COMPLETE`; this behavior is retained.
- Safety rule: Manual Profile COMPLETE / STOP leaves no residual actuator command.
- Momentum Bias remains a separately commanded operating state and is not treated as residual Manual Profile output.

Hardware validation required after flashing.
