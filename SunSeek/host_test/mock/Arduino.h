// Host-test stand-in for the ESP32 Arduino core: only what the SunSeek firmware uses.
// Time is simulated (host_main.cpp advances it); delay() advances the world without running loop().
#pragma once
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <deque>
#include <string>

using std::isfinite;

typedef uint8_t byte;
#define PI 3.14159265358979323846
#define DEG_TO_RAD 0.017453292519943295769236907684886
#define RAD_TO_DEG 57.295779513082320876798154814105
#define HEX 16
#define DEC 10
#define INPUT 0x01
#define OUTPUT 0x03
#define LOW 0x0
#define HIGH 0x1
#define constrain(amt, low, high) ((amt) < (low) ? (low) : ((amt) > (high) ? (high) : (amt)))
using std::min; using std::max;  // the ESP32 core brings these in (organizer v3.0 uses them)
inline long map(long x, long in_min, long in_max, long out_min, long out_max) {
  return (x - in_min) * (out_max - out_min) / (in_max - in_min) + out_min;
}

unsigned long millis();
unsigned long micros();
void delay(uint32_t ms);
void pinMode(uint8_t pin, uint8_t mode);
void digitalWrite(uint8_t pin, uint8_t val);
void analogWrite(uint8_t pin, int val);
uint16_t analogRead(uint8_t pin);
uint32_t analogReadMilliVolts(uint8_t pin);

// ---- FreeRTOS bits (single-threaded host: the harness calls the sampler step itself) ----
typedef void* TaskHandle_t;
typedef int BaseType_t;
struct portMUX_TYPE { int unused; };
#define portMUX_INITIALIZER_UNLOCKED {0}
#define portENTER_CRITICAL(m) ((void)(m))
#define portEXIT_CRITICAL(m) ((void)(m))
#define pdMS_TO_TICKS(ms) (ms)
inline void vTaskDelay(int) {}
inline BaseType_t xTaskCreatePinnedToCore(void (*)(void*), const char*, uint32_t, void*, int, TaskHandle_t*, int) { return 1; }

// ---- Arduino String (the subset the firmware uses, same semantics) ----
class String {
 public:
  String() {}
  String(const char* s) : s_(s ? s : "") {}
  String(const std::string& s) : s_(s) {}
  String(char c) : s_(1, c) {}
  String(unsigned char v, unsigned char base = 10) { num((unsigned long)v, base); }
  String(int v, unsigned char base = 10) { if (base == 10) s_ = std::to_string(v); else num((unsigned long)(unsigned int)v, base); }
  String(unsigned int v, unsigned char base = 10) { num(v, base); }
  String(long v, unsigned char base = 10) { if (base == 10) s_ = std::to_string(v); else num((unsigned long)v, base); }
  String(unsigned long v, unsigned char base = 10) { num(v, base); }
  String(float v, unsigned char decimals = 2) { flt(v, decimals); }
  String(double v, unsigned char decimals = 2) { flt(v, decimals); }

  unsigned int length() const { return (unsigned int)s_.size(); }
  const char* c_str() const { return s_.c_str(); }
  char operator[](unsigned int i) const { return i < s_.size() ? s_[i] : 0; }
  char charAt(unsigned int i) const { return (*this)[i]; }
  void reserve(unsigned int n) { s_.reserve(n); }

  String substring(unsigned int from) const { return from >= s_.size() ? String() : String(s_.substr(from)); }
  String substring(unsigned int from, unsigned int to) const {
    if (from > to) std::swap(from, to);
    if (from >= s_.size()) return String();
    if (to > s_.size()) to = (unsigned int)s_.size();
    return String(s_.substr(from, to - from));
  }
  int indexOf(char c, unsigned int from = 0) const { size_t p = s_.find(c, from); return p == std::string::npos ? -1 : (int)p; }
  int indexOf(const String& t, unsigned int from = 0) const { size_t p = s_.find(t.s_, from); return p == std::string::npos ? -1 : (int)p; }
  int lastIndexOf(char c) const { size_t p = s_.rfind(c); return p == std::string::npos ? -1 : (int)p; }
  bool startsWith(const String& p) const { return s_.compare(0, p.s_.size(), p.s_) == 0 && s_.size() >= p.s_.size(); }
  bool endsWith(const String& p) const { return s_.size() >= p.s_.size() && s_.compare(s_.size() - p.s_.size(), p.s_.size(), p.s_) == 0; }
  void trim() {
    size_t a = 0, b = s_.size();
    while (a < b && isspace((unsigned char)s_[a])) a++;
    while (b > a && isspace((unsigned char)s_[b - 1])) b--;
    s_ = s_.substr(a, b - a);
  }
  void remove(unsigned int index) { if (index < s_.size()) s_.erase(index); }
  void remove(unsigned int index, unsigned int count) { if (index < s_.size()) s_.erase(index, count); }
  long toInt() const { return strtol(s_.c_str(), nullptr, 10); }
  float toFloat() const { return strtof(s_.c_str(), nullptr); }

  bool operator==(const String& o) const { return s_ == o.s_; }
  bool operator==(const char* o) const { return s_ == (o ? o : ""); }
  bool operator!=(const String& o) const { return s_ != o.s_; }
  bool operator!=(const char* o) const { return !(*this == o); }
  String& operator+=(const String& o) { s_ += o.s_; return *this; }
  String& operator+=(const char* o) { s_ += (o ? o : ""); return *this; }
  String& operator+=(char c) { s_ += c; return *this; }
  friend String operator+(const String& a, const String& b) { return String(a.s_ + b.s_); }
  friend String operator+(const String& a, const char* b) { return String(a.s_ + (b ? b : "")); }
  friend String operator+(const char* a, const String& b) { return String(std::string(a ? a : "") + b.s_); }
  friend String operator+(const String& a, char c) { return String(a.s_ + c); }

  const std::string& std() const { return s_; }

 private:
  std::string s_;
  void num(unsigned long v, unsigned char base) {
    if (base == 16) { char b[24]; snprintf(b, sizeof(b), "%lx", v); for (char* p = b; *p; ++p) *p = (char)toupper(*p); s_ = b; }
    else s_ = std::to_string(v);
  }
  void flt(double v, unsigned char d) {
    if (std::isnan(v)) { s_ = "nan"; return; }
    if (std::isinf(v)) { s_ = "inf"; return; }
    char b[64]; snprintf(b, sizeof(b), "%.*f", (int)d, v); s_ = b;
  }
};

// ---- Serial: output lines go to the harness, input comes from the harness ----
class Stream {
 public:
  virtual ~Stream() {}
  virtual void writeText(const std::string& s) = 0;
  void print(const String& s) { writeText(s.std()); }
  void print(const char* s) { writeText(s ? s : ""); }
  void print(char c) { writeText(std::string(1, c)); }
  void println(const String& s) { writeText(s.std() + "\n"); }
  void println(const char* s) { writeText(std::string(s ? s : "") + "\n"); }
  void println() { writeText("\n"); }
  int available() { return (int)in.size(); }
  int read() { if (in.empty()) return -1; int c = (unsigned char)in.front(); in.pop_front(); return c; }
  void feed(const std::string& s) { for (char c : s) in.push_back(c); }
  std::deque<char> in;
};

class MockSerial : public Stream {
 public:
  void begin(unsigned long) {}
  size_t setTxBufferSize(size_t n) { return n; }
  void writeText(const std::string& s) override;
  operator bool() const { return true; }
};
extern MockSerial Serial;

#define SERIAL_8N1 0x800001c
class HardwareSerial : public Stream {
 public:
  explicit HardwareSerial(int n) : n_(n) {}
  void begin(unsigned long, uint32_t = SERIAL_8N1, int8_t = -1, int8_t = -1) {}
  void writeText(const std::string& s) override;  // what the OBC sends to the payload
 private:
  int n_;
};
