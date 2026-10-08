# SunSeek Payload Interface Contract — v3.0

## Architecture

Control plane: `Ground Station -> BLE -> SunSeek OBC -> UART -> ESP32-CAM`

Payload data plane: `ESP32-CAM -> Wi-Fi/HTTP -> Browser or Ground Station`

Loss of TT&C does **not** force the payload data link OFF. The payload continues its last commanded stream state. When TT&C is lost, Ground Station must treat spacecraft-reported payload state as **last known**, while HTTP reachability is an independent ground observation.

## UART commands
`PING`, `STATUS`, `CAPTURE`, `IMAGE_COUNT`, `LAST_IMAGE`, `STREAM_START`, `STREAM_STOP`, `STREAM_STATUS`

## Typical responses
`PONG,CAMERA`

`STATUS,READY,CAMERA,OK,STORAGE,OK,WIFI,READY,IP,192.168.4.1,STREAM,ON,IMAGE_COUNT,12,LAST_IMAGE,/IMG_0012.JPG`

`EVENT,CAPTURE_STARTED`

`IMAGE_READY,/IMG_0013.JPG,245731`

`ACK,STREAM_START` / `EVENT,STREAM_ON`

`ACK,STREAM_STOP` / `EVENT,STREAM_OFF`

`STREAM_STATUS,ON|OFF`

## HTTP
- `GET /status` — JSON health/state
- `GET /images` — JSON stored-image list; requires storage
- `GET /image?name=/IMG_0001.JPG` — JPEG; requires storage
- `GET /stream` — MJPEG live stream; requires camera + STREAM=ON, not storage
- `GET /` — engineering/fallback page

## State semantics
Keep these separate:
1. **Commanded state** — what ground last asked for.
2. **Reported state** — authoritative payload state received via TT&C; becomes last-known if TT&C is lost.
3. **Observed link** — whether ground can currently reach HTTP/stream over Wi-Fi.

`CAMERA`, `STORAGE`, `WIFI`, and `STREAM` are independent status fields. `PAYLOAD READY` means camera + Wi-Fi are ready; storage failure does not prevent live streaming.
