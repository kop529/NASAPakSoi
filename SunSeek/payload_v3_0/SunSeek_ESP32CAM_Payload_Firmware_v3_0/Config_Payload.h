#pragma once
// ============================================================
// SunSeek ESP32-CAM Payload v3.0 — USER / WORKSHOP CONFIG
// Safe to edit for normal workshop deployment.
// ============================================================
#define PAYLOAD_WIFI_AP_MODE       1
#define PAYLOAD_WIFI_SSID          "SUNSEEK-PAYLOAD-NasaPakSoi"  // NasaPakSoi: default name is the same for every team
#define PAYLOAD_WIFI_PASSWORD      "sunseek01"   // >= 8 chars
// NasaPakSoi 7 Oct: every SunSeek camera AP starts on channel 1 (softAP default); at the hotel channel 1 also carried the
// hotel Wi-Fi and another team's camera, and our link dropped 3 times in 20 min while streaming (camera did not reboot).
// 1..13 allowed in Thailand; 13 had no network in the scan.
#define PAYLOAD_WIFI_CHANNEL       13
#define PAYLOAD_STA_SSID           "YOUR_WIFI"
#define PAYLOAD_STA_PASSWORD       "YOUR_PASSWORD"
#define PAYLOAD_UART_BAUD          115200
#define PAYLOAD_HTTP_PORT          80
#define PAYLOAD_IMAGE_PREFIX       "/IMG_"
#define PAYLOAD_STREAM_DEFAULT_ON  0
#define PAYLOAD_STREAM_FRAME_MS    80
