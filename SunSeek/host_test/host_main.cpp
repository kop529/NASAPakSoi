// SunSeek team firmware on the PC: the real sketch (all header-only) + mocks + sim_world.
// stdin, one line at a time:
//   #WAIT <ms>          run the firmware for <ms> of simulated time (loop() every 1 ms)
//   #SET <key> <value>  change the world (see SimWorld::set)
//   #STATE              print "#STATE t=... body=... rate=... wheel=... cmd=... sun=..."
//   #BLE 0|1            a BLE central connected: telemetry lines cost delay(3) each, like the board with the GS
//   anything else       typed into the USB serial port (a telecommand)
// stdout: every line the firmware prints, plus "#..." harness lines.
// $SUNSEEK_NVS = file that keeps the NVS (Preferences) between runs (a "reset" = run the program again).
#include <cstdio>
#include <fstream>
#include <iostream>
#include <map>
#include <sstream>
#include <vector>

#include <Arduino.h>
#include <Preferences.h>
#include <Wire.h>
#include "sim_world.h"

// ---------------- simulated time + I/O used by the firmware ----------------
static uint64_t g_us = 0;
static bool g_inLoop = false;
static void advance(uint32_t ms, bool runLoop);

unsigned long millis() { return (unsigned long)(g_us / 1000); }
unsigned long micros() { return (unsigned long)g_us; }
void delay(uint32_t ms) { advance(ms, false); }

void pinMode(uint8_t, uint8_t) {}
void digitalWrite(uint8_t pin, uint8_t val) {
  if (pin == world.pinIn1) world.in1 = val;
  if (pin == world.pinIn2) world.in2 = val;
}
void analogWrite(uint8_t pin, int val) { if (pin == world.pinPwm) world.pwm = val; }
uint32_t analogReadMilliVolts(uint8_t pin) { return (uint32_t)std::lround(world.mvForPin(pin, g_us * 1e-6)); }
uint16_t analogRead(uint8_t pin) {
  const double mv = world.mvForPin(pin, g_us * 1e-6);
  return (uint16_t)std::min(4095.0, std::max(0.0, std::round(mv * 4095.0 / 3150.0)));
}

static std::string g_outLine;
MockSerial Serial;
void MockSerial::writeText(const std::string& s) {
  for (char c : s) {
    if (c == '\n') { std::cout << g_outLine << "\n"; g_outLine.clear(); }
    else if (c != '\r') g_outLine += c;
  }
  std::cout.flush();
}
void HardwareSerial::writeText(const std::string& s) {
  std::string t = s;
  if (!t.empty() && t.back() == '\n') t.pop_back();
  if (!t.empty()) std::cout << "#PAYLOAD_TX " << t << "\n";
}

// ---------------- I2C: GY-89 registers from the world ----------------
TwoWire Wire;
static bool i2cPresent(uint8_t a) { return a == 0x1D || a == 0x6B || a == 0x77; }
uint8_t TwoWire::endTransmission(bool) {
  if (!i2cPresent(addr_)) return 2;  // NACK
  if (tx_.size() == 1) ptr_[addr_ & 0x7F] = tx_[0] & 0x7F;  // register pointer (0x80 = auto increment)
  return 0;
}
uint8_t TwoWire::requestFrom(uint8_t addr, uint8_t n) {
  rx_.clear();
  rxPos_ = 0;
  if (!i2cPresent(addr)) return 0;
  if (addr == 0x6B && millis() < world.i2cDownUntilMs) return 0;  // injected I2C glitch
  uint8_t reg = ptr_[addr & 0x7F];
  uint8_t regs[256] = {0};
  if (addr == 0x1D) {
    regs[0x0F] = 0x49;
    int16_t mx, my, mz;
    world.magRaw(mx, my, mz);
    const int16_t m[3] = {mx, my, mz}, acc[3] = {0, 0, 16384};
    for (int i = 0; i < 3; i++) {
      regs[0x08 + 2 * i] = (uint8_t)(m[i] & 0xFF); regs[0x09 + 2 * i] = (uint8_t)((uint16_t)m[i] >> 8);
      regs[0x28 + 2 * i] = (uint8_t)(acc[i] & 0xFF); regs[0x29 + 2 * i] = (uint8_t)((uint16_t)acc[i] >> 8);
    }
  } else if (addr == 0x6B) {
    regs[0x0F] = 0xD4;
    const int16_t gz = world.gyroZRaw();
    regs[0x2C] = (uint8_t)(gz & 0xFF); regs[0x2D] = (uint8_t)((uint16_t)gz >> 8);
  }
  for (uint8_t i = 0; i < n; i++) rx_.push_back(regs[(uint8_t)(reg + i)]);
  return n;
}

// ---------------- NVS ----------------
static std::map<std::string, std::vector<uint8_t>> g_nvs;
static bool g_nvsLoaded = false;
static const char* nvsFile() { const char* f = getenv("SUNSEEK_NVS"); return f && *f ? f : nullptr; }
static void nvsLoad() {
  if (g_nvsLoaded) return;
  g_nvsLoaded = true;
  if (!nvsFile()) return;
  std::ifstream in(nvsFile());
  std::string key, hex;
  while (in >> key >> hex) {
    std::vector<uint8_t> v;
    for (size_t i = 0; i + 1 < hex.size(); i += 2) v.push_back((uint8_t)std::stoi(hex.substr(i, 2), nullptr, 16));
    if (hex == "-") v.clear();
    g_nvs[key] = v;
  }
}
static void nvsSave() {
  if (!nvsFile()) return;
  std::ofstream out(nvsFile(), std::ios::trunc);
  for (auto& kv : g_nvs) {
    out << kv.first << " ";
    if (kv.second.empty()) out << "-";
    for (uint8_t b : kv.second) { char h[3]; snprintf(h, 3, "%02x", b); out << h; }
    out << "\n";
  }
}
bool Preferences::begin(const char* name, bool readOnly, const char*) {
  nvsLoad();
  ns_ = name;
  ro_ = readOnly;
  open_ = true;
  if (readOnly) {  // like the real NVS: read-only open of a namespace that was never written fails
    for (auto& kv : g_nvs) if (kv.first.rfind(ns_ + "/", 0) == 0) return true;
    open_ = false;
    return false;
  }
  return true;
}
void Preferences::end() { open_ = false; }
bool Preferences::isKey(const char* key) { return open_ && g_nvs.count(full(key)); }
bool Preferences::remove(const char* key) { if (!open_ || ro_) return false; g_nvs.erase(full(key)); nvsSave(); return true; }
bool Preferences::clear() {
  if (!open_ || ro_) return false;
  for (auto it = g_nvs.begin(); it != g_nvs.end();) it = it->first.rfind(ns_ + "/", 0) == 0 ? g_nvs.erase(it) : std::next(it);
  nvsSave();
  return true;
}
double Preferences::getDouble(const char* key, double def) {
  auto it = g_nvs.find(full(key));
  if (!open_ || it == g_nvs.end() || it->second.size() != sizeof(double)) return def;
  double v; memcpy(&v, it->second.data(), sizeof v); return v;
}
size_t Preferences::putDouble(const char* key, double v) { return putBytes(key, &v, sizeof v); }
int32_t Preferences::getInt(const char* key, int32_t def) {
  auto it = g_nvs.find(full(key));
  if (!open_ || it == g_nvs.end() || it->second.size() != sizeof(int32_t)) return def;
  int32_t v; memcpy(&v, it->second.data(), sizeof v); return v;
}
size_t Preferences::putInt(const char* key, int32_t v) { return putBytes(key, &v, sizeof v); }
size_t Preferences::getBytesLength(const char* key) { auto it = g_nvs.find(full(key)); return open_ && it != g_nvs.end() ? it->second.size() : 0; }
size_t Preferences::getBytes(const char* key, void* buf, size_t maxLen) {
  auto it = g_nvs.find(full(key));
  if (!open_ || it == g_nvs.end()) return 0;
  const size_t n = std::min(maxLen, it->second.size());
  memcpy(buf, it->second.data(), n);
  return n;
}
size_t Preferences::putBytes(const char* key, const void* buf, size_t len) {
  if (!open_ || ro_) return 0;
  g_nvs[full(key)] = std::vector<uint8_t>((const uint8_t*)buf, (const uint8_t*)buf + len);
  nvsSave();
  return len;
}

// ---------------- the sketch ----------------
#ifndef TEAM_INO
#define TEAM_INO "SunSeek_Platform_Firmware_v3_0.ino"
#endif
#include TEAM_INO

// ---------------- time stepping ----------------
static void advance(uint32_t ms, bool runLoop) {
  for (uint32_t i = 0; i < ms; i++) {
    world.step(0.001);
    g_us += 1000;
    if ((g_us / 1000) % 2 == 0) {  // the sun sampler task runs every 2 ms
      teamSunSamplerStep(millis(), analogRead(SUN_LEFT_PIN), analogReadMilliVolts(SUN_LEFT_PIN),
                         analogRead(SUN_RIGHT_PIN), analogReadMilliVolts(SUN_RIGHT_PIN));
    }
    if (runLoop && !g_inLoop) { g_inLoop = true; loop(); g_inLoop = false; }
  }
}

int main() {
  std::ios::sync_with_stdio(false);
  setup();
  advance(10, true);
  std::string line;
  while (std::getline(std::cin, line)) {
    if (!line.empty() && line.back() == '\r') line.pop_back();
    if (line.rfind("#WAIT ", 0) == 0) { advance((uint32_t)std::stoul(line.substr(6)), true); continue; }
    if (line.rfind("#SET ", 0) == 0) {
      std::istringstream ss(line.substr(5));
      std::string k; double v;
      if (ss >> k >> v && k == "i2cDown") { world.i2cDownUntilMs = millis() + v; std::cout << "#OK i2cDown\n"; continue; }
      if (!ss.fail() && world.set(k, v)) std::cout << "#OK " << k << "\n"; else std::cout << "#BADSET " << line << "\n";
      continue;
    }
    if (line == "#STATE") { std::cout << world.state() << "\n"; continue; }
    // a BLE central (the Ground Station) connected: every sendTelemetry() then also notifies and waits delay(3)
    if (line.rfind("#BLE ", 0) == 0) { _ttcConnected = line.substr(5) == "1"; std::cout << "#OK ble\n"; continue; }
    Serial.feed(line + "\n");
    advance(2, true);
  }
  std::cout.flush();
  return 0;
}
