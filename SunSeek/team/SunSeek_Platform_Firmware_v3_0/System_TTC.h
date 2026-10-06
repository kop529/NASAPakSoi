#pragma once

/* SunSeek Platform v2.0 — SYSTEM LAYER */

#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include "Config_System.h"

/*
  Communication.h — T02 v1.6 / GS v1.8 Compatibility

  Transport contract
    USB = Development Link
    BLE = TT&C / Control Plane

  Message framing
    One UTF-8 ASCII message per line, terminated by \n.

  Notes
    - The BLE Nordic-UART-style UUIDs are intentionally unchanged so the
      Ground Station does not need a transport-layer change.
    - Preferred ATT MTU is raised to reduce failures with commands such as
      ADCS_STRATEGY,MOMENTUM and future T03-T07 messages.
    - RX is line-buffered so newline-framed commands remain deterministic.
*/

#define TTC_SERVICE_UUID "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
#define TTC_RX_UUID      "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"
#define TTC_TX_UUID      "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"

#define TTC_PREFERRED_MTU 185
#define TTC_MAX_RX_LINE   240

typedef void (*TelecommandHandler)(String command);

static BLEServer *_ttcServer = nullptr;
static BLECharacteristic *_ttcTx = nullptr;
static bool _ttcConnected = false;
static bool _ttcOldConnected = false;
static String _ttcSerialBuffer = "";
static String _ttcBleBuffer = "";
// TEAM NasaPakSoi team-5: the BLE write callback runs in the NimBLE task (core 0). Running the command there let its replies
// race the loop telemetry (core 1) and kept the BLE host busy (delay 3 ms per reply) -> replies lost: 7 Oct the GS PREPARE
// burst lost ACK,ADCS_PREPARE + EVT,ADCS_READY (RUN never enabled) and a STOP could be overwritten by the control step.
// Now the callback only copies the bytes into this ring (no heap, short critical section); loop() runs the commands.
static char _ttcBleRing[1024];
static volatile uint16_t _ttcBleHead = 0, _ttcBleTail = 0;
static volatile bool _ttcBleOverflow = false, _ttcBleReset = false;
static portMUX_TYPE _ttcBleMux = portMUX_INITIALIZER_UNLOCKED;
inline void ttcBleRxBytes(const char* p, size_t n) {
  portENTER_CRITICAL(&_ttcBleMux);
  for (size_t i = 0; i < n; i++) {
    const uint16_t nx = (uint16_t)((_ttcBleHead + 1) % sizeof(_ttcBleRing));
    if (nx == _ttcBleTail) { _ttcBleOverflow = true; break; }
    _ttcBleRing[_ttcBleHead] = p[i];
    _ttcBleHead = nx;
  }
  portEXIT_CRITICAL(&_ttcBleMux);
}
static TelecommandHandler _ttcHandler = nullptr;

inline String getSpacecraftID() {
  return String("SUNSEEK-") + TEAM_NAME;
}

inline void sendTelemetry(const String &text) {
  // Every emitted message is also visible on the USB Development Link.
  Serial.println(text);

  if (_ttcConnected && _ttcTx) {
    String packet = text + "\n";
    _ttcTx->setValue((uint8_t*)packet.c_str(), packet.length());
    _ttcTx->notify();
    delay(3);
  }
}

inline void _ttcDispatchBufferedLines(String &buffer) {
  int newlineIndex = buffer.indexOf('\n');

  while (newlineIndex >= 0) {
    String command = buffer.substring(0, newlineIndex);
    buffer.remove(0, newlineIndex + 1);
    command.trim();

    if (command.length() && _ttcHandler) {
      _ttcHandler(command);
    }

    newlineIndex = buffer.indexOf('\n');
  }
}

class TTCServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer*) override {
    _ttcConnected = true;
    Serial.println("BLE client connected");
  }

  void onDisconnect(BLEServer*) override {
    _ttcConnected = false;
    _ttcBleReset = true;  // team-5: the loop clears the buffers (no String work in the BLE task)
    Serial.println("BLE client disconnected");
  }
};

class TTCRxCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *characteristic) override {
    // ESP32 Arduino Core compatibility:
    // - older BLE API revisions may return std::string
    // - ESP32 Arduino Core 3.3.x returns Arduino String
    // Keep the inferred return type so the same code does not depend on either.
    auto rx = characteristic->getValue();
    if (rx.length() == 0) return;
    ttcBleRxBytes(rx.c_str(), rx.length());  // team-5: queue only; communicationUpdate() runs it
  }
};

inline void communicationBegin(TelecommandHandler handler) {
  _ttcHandler = handler;

  String spacecraftID = getSpacecraftID();

  BLEDevice::init(spacecraftID.c_str());
  BLEDevice::setMTU(TTC_PREFERRED_MTU);

  _ttcServer = BLEDevice::createServer();
  _ttcServer->setCallbacks(new TTCServerCallbacks());

  BLEService *service = _ttcServer->createService(TTC_SERVICE_UUID);

  _ttcTx = service->createCharacteristic(
    TTC_TX_UUID,
    BLECharacteristic::PROPERTY_NOTIFY
  );
  _ttcTx->addDescriptor(new BLE2902());

  BLECharacteristic *rx = service->createCharacteristic(
    TTC_RX_UUID,
    BLECharacteristic::PROPERTY_WRITE |
    BLECharacteristic::PROPERTY_WRITE_NR
  );
  rx->setCallbacks(new TTCRxCallbacks());

  service->start();

  BLEAdvertising *advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(TTC_SERVICE_UUID);
  advertising->setScanResponse(true);
  BLEDevice::startAdvertising();
}

inline void communicationUpdate() {
  // TEAM NasaPakSoi team-5: BLE commands queued by the write callback run here, in loop()
  if (_ttcBleReset) {
    _ttcBleReset = false;
    portENTER_CRITICAL(&_ttcBleMux); _ttcBleTail = _ttcBleHead; _ttcBleOverflow = false; portEXIT_CRITICAL(&_ttcBleMux);
    _ttcBleBuffer = "";
  }
  for (;;) {
    char tmp[128]; size_t n = 0; bool ov;
    portENTER_CRITICAL(&_ttcBleMux);
    while (_ttcBleTail != _ttcBleHead && n < sizeof(tmp)) { tmp[n++] = _ttcBleRing[_ttcBleTail]; _ttcBleTail = (uint16_t)((_ttcBleTail + 1) % sizeof(_ttcBleRing)); }
    ov = _ttcBleOverflow; _ttcBleOverflow = false;
    portEXIT_CRITICAL(&_ttcBleMux);
    if (ov) { _ttcBleBuffer = ""; sendTelemetry("ERR,RX_OVERFLOW"); }
    for (size_t i = 0; i < n; i++) {
      if (tmp[i] != '\r') _ttcBleBuffer += tmp[i];
      if (_ttcBleBuffer.length() > TTC_MAX_RX_LINE) { _ttcBleBuffer = ""; sendTelemetry("ERR,RX_LINE_TOO_LONG"); }
    }
    if (n) _ttcDispatchBufferedLines(_ttcBleBuffer);
    if (n < sizeof(tmp)) break;
  }

  // USB Serial uses the same newline-framed TC contract as BLE.
  while (Serial.available()) {
    char c = Serial.read();

    if (c != '\r') {
      _ttcSerialBuffer += c;
    }

    if (_ttcSerialBuffer.length() > TTC_MAX_RX_LINE) {
      _ttcSerialBuffer = "";
      sendTelemetry("ERR,RX_LINE_TOO_LONG");
      break;
    }

    _ttcDispatchBufferedLines(_ttcSerialBuffer);
  }

  // Resume advertising after a disconnect.
  if (!_ttcConnected && _ttcOldConnected) {
    delay(200);
    _ttcServer->startAdvertising();
    _ttcOldConnected = false;
  }

  if (_ttcConnected && !_ttcOldConnected) {
    _ttcOldConnected = true;
  }
}

inline bool isCommunicationConnected() {
  return _ttcConnected;
}
