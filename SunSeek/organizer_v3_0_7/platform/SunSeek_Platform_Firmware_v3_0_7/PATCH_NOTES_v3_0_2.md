# SunSeek Platform Firmware v3.0.3

- Momentum Profile adds `MOM_PROFILE_SPINUP,<ms>` (0..15000 ms).
- `MISSION_PREPARE` applies Momentum nominal bias and keeps PREPARING for the characterized Bias Spin-up Time; BODY_RATE is not used as wheel-speed feedback.
- `MISSION_TARGET` accepts optional fourth field `NONE|CAPTURE`.
- NONE advances after hold; CAPTURE commands the payload and advances after IMAGE_READY.
- Mission timing remains OBC-owned and non-blocking.
