// ===== host-test mock of the parts of the ESP32 Arduino core that NasaSat uses =====
// Only for compiling and testing the firmware on a PC (g++). Never used on the real board.
#pragma once
#include <math.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include <algorithm>
#include <cmath>
#include <string>
// the real Arduino.h (core 3.x) pulls in POSIX stat() through lwIP -> fcntl, and newlib's <sys/unistd.h> (link,
// unlink, close, read, ...): include/declare them here too, so a firmware name that clashes with one of them (a
// variable called `stat` or `link`) fails on the PC like it fails in the Arduino IDE
#include <sys/stat.h>
#include <unistd.h>
extern "C" int link(const char* from, const char* to);  // in newlib, not in MinGW's unistd.h

#ifdef MOCK_ESP32
// what the IDE defines for "AI Thinker ESP32-CAM": the old ESP32 with PSRAM, a USB-UART chip on UART0
#define CONFIG_IDF_TARGET_ESP32 1
#define BOARD_HAS_PSRAM 1
#define ARDUINO_USB_CDC_ON_BOOT 0
#else
// what the IDE defines for the usual board settings: ESP32S3 Dev Module, "USB CDC On Boot: Enabled", "PSRAM: OPI PSRAM"
#define CONFIG_IDF_TARGET_ESP32S3 1
#define CONFIG_SPIRAM_MODE_OCT 1
#define ARDUINO_USB_CDC_ON_BOOT 1
#endif

#ifdef MOCK_CORE2
#define ESP_ARDUINO_VERSION_MAJOR 2
#define ESP_ARDUINO_VERSION_MINOR 0
#define ESP_ARDUINO_VERSION_PATCH 17
#else
#define ESP_ARDUINO_VERSION_MAJOR 3
#define ESP_ARDUINO_VERSION_MINOR 3
#define ESP_ARDUINO_VERSION_PATCH 0
#endif

using std::isinf;
using std::isnan;
using std::max;
using std::min;

#define DEG_TO_RAD 0.017453292519943295769236907684886
#define RAD_TO_DEG 57.295779513082320876798154814105
#define constrain(amt, low, high) ((amt) < (low) ? (low) : ((amt) > (high) ? (high) : (amt)))

#define HIGH 1
#define LOW 0
#define INPUT 0x01
#define OUTPUT 0x03
#define INPUT_PULLUP 0x05

typedef bool boolean;
typedef uint8_t byte;

uint32_t millis();
uint32_t micros();
void delay(uint32_t ms);
void delayMicroseconds(uint32_t us);
void yield();
void pinMode(uint8_t pin, uint8_t mode);
void digitalWrite(uint8_t pin, uint8_t val);
int digitalRead(uint8_t pin);
uint32_t analogReadMilliVolts(uint8_t pin);
uint16_t analogRead(uint8_t pin);
int8_t digitalPinToAnalogChannel(uint8_t pin);  // ESP32-S3: GPIO1-10 = ADC1, GPIO11-20 = ADC2, else -1
void enableLoopWDT();
bool psramFound();
void* ps_malloc(size_t n);
float temperatureRead();  // chip temperature sensor (degC)

#if ESP_ARDUINO_VERSION_MAJOR >= 3
bool ledcAttachChannel(uint8_t pin, uint32_t freq, uint8_t resolution, int8_t channel);
bool ledcWrite(uint8_t pin, uint32_t duty);
bool ledcDetach(uint8_t pin);
#else
uint32_t ledcSetup(uint8_t channel, uint32_t freq, uint8_t resolution_bits);
void ledcAttachPin(uint8_t pin, uint8_t channel);
void ledcWrite(uint8_t channel, uint32_t duty);
void ledcDetachPin(uint8_t pin);
#endif

// FreeRTOS critical sections: single-threaded on the host
typedef int portMUX_TYPE;
#define portMUX_INITIALIZER_UNLOCKED 0
#define portENTER_CRITICAL(m) ((void)(m))
#define portEXIT_CRITICAL(m) ((void)(m))

// the small part of Arduino's String class the fallback sketch uses
class String {
 public:
  String(const char* s = "") : s_(s ? s : "") {}
  explicit String(const std::string& s) : s_(s) {}
  const char* c_str() const { return s_.c_str(); }
  void toUpperCase() {
    for (auto& c : s_) c = (char)toupper((unsigned char)c);
  }
  float toFloat() const { return (float)atof(s_.c_str()); }
  bool operator==(const char* o) const { return s_ == o; }
  bool operator==(const String& o) const { return s_ == o.s_; }
  String operator+(const char* o) const { return String(s_ + o); }
  String operator+(const String& o) const { return String(s_ + o.s_); }

 private:
  std::string s_;
};

// the core's Stream (Print + input): HWCDC, USBCDC and HardwareSerial all derive from it
class Stream {
 public:
  virtual ~Stream() {}
  virtual int available() = 0;
  virtual int read() = 0;
  virtual int peek() = 0;
  virtual size_t write(uint8_t c) = 0;
  virtual size_t write(const uint8_t* b, size_t n) = 0;
  virtual int availableForWrite() { return 0; }
};

class MockSerial : public Stream {
 public:
  void begin(unsigned long baud);
  void end() {}
  explicit operator bool() const { return true; }
  int available() override;
  int read() override;
  int peek() override;
  void flush() {}
  int availableForWrite() override;
  size_t setRxBufferSize(size_t n);
  size_t write(uint8_t c) override;
  size_t write(const uint8_t* b, size_t n) override;
  size_t print(const char* s);
  size_t print(char c);
  size_t print(int v);
  size_t print(unsigned v);
  size_t print(long v);
  size_t print(unsigned long v);
  size_t print(double v, int digits = 2);
  size_t println(const char* s = "");
  size_t printf(const char* fmt, ...) __attribute__((format(printf, 2, 3)));
};
extern MockSerial Serial;

// UART1 with real timing: bytes leave at baud/10 per second through a 128-byte FIFO + the TX buffer; the world
// decides whether a radio is wired to the pins the firmware chose (sim.cpp)
#define SERIAL_8N1 0x800001c
class HardwareSerial : public Stream {
 public:
  void begin(unsigned long baud, uint32_t config = SERIAL_8N1, int8_t rxPin = -1, int8_t txPin = -1);
  void end();
  size_t setRxBufferSize(size_t n) { return n; }
  size_t setTxBufferSize(size_t n) { txBuf_ = n; return n; }
  int available() override;
  int read() override;
  int peek() override;
  int availableForWrite() override;
  size_t write(uint8_t c) override { return write(&c, 1); }
  size_t write(const uint8_t* b, size_t n) override;
  void drain();  // the bytes whose time on the wire is over
  bool radioRx() const;  // the world's radio is wired to our RX pin at our baud rate
  bool radioTx() const;  // ... to our TX pin

 private:
  bool on_ = false;
  unsigned long baud_ = 0;
  int rx_ = -1, tx_ = -1;
  size_t txBuf_ = 0;
};
extern HardwareSerial Serial1;

class EspClass {
 public:
#ifdef MOCK_ESP32
  const char* getChipModel() { return "ESP32-D0WD (HOST TEST)"; }
#else
  const char* getChipModel() { return "ESP32-S3 (HOST TEST)"; }
#endif
  uint8_t getChipRevision() { return 2; }
  uint8_t getChipCores() { return 2; }
  uint32_t getCpuFreqMHz() { return 240; }
  uint32_t getFlashChipSize() { return 16u << 20; }
  uint32_t getPsramSize();
  uint32_t getFreeHeap() { return 280000; }
  uint32_t getMinFreeHeap() { return 251000; }
  void restart();
};
extern EspClass ESP;
