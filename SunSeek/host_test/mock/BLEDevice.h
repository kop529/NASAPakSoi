// Host-test BLE: the TT&C server exists but no Ground Station is connected (USB development link only).
#pragma once
#include <Arduino.h>

class BLEServer;
class BLECharacteristic;

class BLEServerCallbacks {
 public:
  virtual ~BLEServerCallbacks() {}
  virtual void onConnect(BLEServer*) {}
  virtual void onDisconnect(BLEServer*) {}
};

class BLECharacteristicCallbacks {
 public:
  virtual ~BLECharacteristicCallbacks() {}
  virtual void onWrite(BLECharacteristic*) {}
};

class BLEDescriptor {
 public:
  virtual ~BLEDescriptor() {}
};

class BLECharacteristic {
 public:
  static const uint32_t PROPERTY_READ = 1 << 0;
  static const uint32_t PROPERTY_WRITE = 1 << 1;
  static const uint32_t PROPERTY_NOTIFY = 1 << 2;
  static const uint32_t PROPERTY_WRITE_NR = 1 << 4;
  void addDescriptor(BLEDescriptor*) {}
  void setCallbacks(BLECharacteristicCallbacks* cb) { cb_ = cb; }
  void setValue(uint8_t* data, size_t len) { value_ = String(std::string((const char*)data, len)); }
  void notify() {}
  String getValue() { return value_; }

 private:
  BLECharacteristicCallbacks* cb_ = nullptr;
  String value_;
};

class BLEService {
 public:
  BLECharacteristic* createCharacteristic(const char*, uint32_t) { return new BLECharacteristic(); }
  void start() {}
};

class BLEServer {
 public:
  void setCallbacks(BLEServerCallbacks* cb) { cb_ = cb; }
  BLEService* createService(const char*) { return new BLEService(); }
  void startAdvertising() {}

 private:
  BLEServerCallbacks* cb_ = nullptr;
};

class BLEAdvertising {
 public:
  void addServiceUUID(const char*) {}
  void setScanResponse(bool) {}
};

class BLEDevice {
 public:
  static void init(const char*) {}
  static void setMTU(uint16_t) {}
  static BLEServer* createServer() { return new BLEServer(); }
  static BLEAdvertising* getAdvertising() { static BLEAdvertising a; return &a; }
  static void startAdvertising() {}
};
