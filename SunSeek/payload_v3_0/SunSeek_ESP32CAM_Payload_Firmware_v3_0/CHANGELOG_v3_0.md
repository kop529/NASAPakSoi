# v3.0 changes
- Refactored into Config / Module / System layers.
- Separated camera readiness from storage readiness.
- Added UART `STREAM_START`, `STREAM_STOP`, `STREAM_STATUS`.
- Added HTTP MJPEG `/stream`.
- Streaming no longer depends on microSD.
- Stream state is independent of TT&C connection and persists as last commanded while powered.
- `/status` now reports camera, storage, Wi-Fi, stream, image metadata.
- Preserved v0.2 commands: PING, STATUS, CAPTURE, IMAGE_COUNT, LAST_IMAGE.
- Preserved HTTP image endpoints: /status, /images, /image.
