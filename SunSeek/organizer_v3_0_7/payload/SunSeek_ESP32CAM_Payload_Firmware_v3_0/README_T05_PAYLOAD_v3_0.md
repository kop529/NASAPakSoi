# SunSeek ESP32-CAM Payload Firmware v3.0

## File ownership
- `Config_*` — workshop/user configuration; normal editable surface.
- `Module_*` — developer extension layer.
- `System_*` — platform/core behavior; do not edit during normal workshop use.

## T05 bring-up sequence
1. Flash ESP32-CAM while OBC UART is disconnected.
2. Open Serial Monitor at 115200 baud.
3. Test `PING`, `STATUS`, `CAPTURE`, `IMAGE_COUNT`, `LAST_IMAGE`.
4. Test `STREAM_START` then `STREAM_STATUS`.
5. Connect Windows to the payload Wi-Fi AP (defaults in `Config_Payload.h`).
6. Open the IP printed by `WIFI_IP,...` in a browser.
7. Verify `/status`, stored image access, and `/stream`.
8. Only after standalone PASS, disconnect the programmer as required and integrate OBC UART.
9. Re-run the same command path through OBC/BLE, then Ground Station.

## Important UART0 note
GPIO3 RX / GPIO1 TX are shared with programming/debug. Do not connect OBC UART blindly during flashing.

## Deliberate behavior
- Stream state is controlled by UART and survives TT&C loss while the payload remains powered.
- `/stream` is unavailable when STREAM=OFF.
- Streaming does not require microSD.
- Capture-to-storage requires both camera and storage.
- Browser is an engineering/fallback data interface; GS is the operational interface.

## Validation status
This package is a source-level integration build. It has been refactored from v0.2 and statically reviewed here, but it has **not** been compiled with the Arduino ESP32 toolchain or verified on physical AI Thinker ESP32-CAM hardware in this environment. Hardware validation is required before freezing it for the workshop.
