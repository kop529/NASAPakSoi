// ===== world physics + implementations of the mocked Arduino / ESP-IDF APIs =====
#include "sim.h"
#include <Arduino.h>
#include <Preferences.h>
#include <Wire.h>
#include <esp_camera.h>
#include <esp_system.h>
#include <esp_timer.h>
#include <stdarg.h>
#include <deque>
#include <fstream>
#include <map>
#include <random>
#include <set>
#include <sstream>
#include <vector>
#include "mock/tiny_jpeg.h"

World W;

namespace {
const double kDeg = M_PI / 180.0;
std::mt19937 rng(12345);
std::normal_distribution<double> gaussD(0.0, 1.0);
std::uniform_real_distribution<double> uni(0.0, 1.0);
double gauss() { return gaussD(rng); }
double clampd(double x, double a, double b) { return x < a ? a : x > b ? b : x; }
double wrap180(double a) {
  double x = fmod(fmod(a + 180.0, 360.0) + 360.0, 360.0) - 180.0;
  return x == -180.0 ? 180.0 : x;
}

int resetReason = ESP_RST_POWERON;
void (*restartHook)() = nullptr;

// ---------------------------------------------------------------- timers
struct Tmr {
  esp_timer_cb_t cb = nullptr;
  void* arg = nullptr;
  uint64_t period = 0, next = 0;
  bool active = false;
};
Tmr timers[4];
int nTimers = 0;

// ---------------------------------------------------------------- GPIO
uint8_t level[64];
uint8_t mode[64];

// ---------------------------------------------------------------- physics
void backlashUpdate() {
  const double motorDeg = W.motor * 360.0 / W.spr;
  const double b = W.backlash / 2;
  if (motorDeg - W.out > b) W.out = motorDeg - b;
  else if (motorDeg - W.out < -b) W.out = motorDeg + b;
}

void servoPhysics(double dt) {
  if (W.actuator != 2 || !W.servoSeen) return;
  const double want = W.servoCmd * 1.015 + 0.4;  // a real servo: small scale error and offset
  const double d = want - W.out;
  if (fabs(d) > 0.25) W.out += (d > 0 ? 1 : -1) * std::min(fabs(d), 300.0 * dt);
  if (fabs(d) > 0.25) W.lastMotionUs = W.us;
}

void onCoil() {
  static const uint8_t H[8] = {0x1, 0x3, 0x2, 0x6, 0x4, 0xC, 0x8, 0x9};
  if (W.actuator != 1) return;
  int p = 0;
  for (int k = 0; k < 4; k++)
    if (W.uln[k] >= 0 && W.uln[k] < 64 && level[W.uln[k]]) p |= 1 << k;
  if (p == W.coil) return;
  W.coil = p;
  if (p == 0) return;  // all coils off: rotor is free (held only by the gearbox)
  int idx = -1;
  for (int k = 0; k < 8; k++)
    if (H[k] == p) idx = k;
  if (idx < 0) return;  // transient/invalid pattern (e.g. two opposite coils): no torque direction
  int d = ((idx - W.rotorIdx) % 8 + 8) % 8;
  if (d > 4) d -= 8;
  if (d == 0) return;
  if (d == 4 || d == -4) {  // field exactly opposite the rotor: it jumps either way
    W.glitches++;
    d = uni(rng) < 0.5 ? 4 : -4;
  }
  const double interval = (W.us - W.lastStepUs) * 1e-6;
  W.lastStepUs = W.us;
  if (interval < 1.0 / W.maxRate && uni(rng) < 0.3) {  // too fast: rotor does not follow this time
    W.missed++;
    return;
  }
  W.rotorIdx = idx;
  W.motor += W.wireDir * d;
  W.steps++;
  W.lastMotionUs = W.us;
  backlashUpdate();
}

double irradiance(double sensorAz, double tSec, double q) {
  const double inc = wrap180(W.lampAz - sensorAz);
  const double c = cos(inc * kDeg);
  const double vign = clampd((W.fov - fabs(inc)) / 12.0, 0, 1);
  const double flick = 1 + W.flicker * sin(2 * M_PI * 100 * tSec);
  const double lamp = W.lampOn ? W.lampK * pow(std::max(c, 0.0), q) * vign * flick : 0;
  return lamp + W.ambient + 0.002;
}

void ldrUpdate() {
  const double dt = (W.us - W.lastSensUs) * 1e-6;
  W.lastSensUs = W.us;
  const double body = simBody();
  const double t = W.us * 1e-6;
  const double EL = irradiance(body + W.alphaL, t, W.qL);
  const double ER = irradiance(body - W.alphaR, t, W.qR);
  const double gLt = 1.0 / (W.r10L * pow(EL / 0.1, -W.gammaL));
  const double gRt = 1.0 / (W.r10R * pow(ER / 0.1, -W.gammaR));
  auto follow = [&](double g, double target) {
    if (g < 0) return target;
    return g + (target - g) * (1.0 - exp(-dt / (target < g ? W.tauFall : W.tau)));
  };
  W.gL = follow(W.gL, gLt);
  W.gR = follow(W.gR, gRt);
}

double dividerMv(double g) { return W.vcc * W.rf / (W.rf + 1.0 / g); }

std::map<int, double> floating;  // unconnected ADC pins drift around

// ---------------------------------------------------------------- serial
std::deque<uint8_t> rx;
size_t txBytes = 0;
void txCost(size_t n) {
  txBytes += n;
  if (W.txUsPerByte > 0) simAdvance((uint64_t)(n * W.txUsPerByte));
}

// ---------------------------------------------------------------- second port (Serial1) and the radio on it
std::deque<uint8_t> l1rx, l1tx;   // bytes waiting to be read / on their way out of the UART
double l1HeadDoneUs = 0;          // when the byte at the front of l1tx has left the pin
std::string l1line;               // what the radio has received of the current line
std::vector<std::string> l1lines; // complete lines the radio received (printed between loop() calls)

// ---------------------------------------------------------------- NVS
std::map<std::string, std::vector<uint8_t>> nvs;
std::set<std::string> nvsSpaces;

// ---------------------------------------------------------------- camera
bool camOn = false;
int camRes = 1, camQ = 12;
sensor_t theSensor;
int sFramesize(sensor_t*, framesize_t f) { camRes = (int)f; return 0; }
int sQuality(sensor_t*, int q) { camQ = q; return 0; }
int sExposure(sensor_t*, int v) { W.aec = v; return 0; }
int sGainCtrl(sensor_t*, int v) { W.agcCtrl = v; return 0; }
int sWb(sensor_t*, int v) { W.awb = v; return 0; }
int sAecValue(sensor_t*, int v) { W.aecValue = v; return 0; }
int sAgcGain(sensor_t*, int v) { W.agcGain = v; return 0; }
int sHmirror(sensor_t*, int v) { W.hmirror = v; return 0; }
int sVflip(sensor_t*, int v) { W.vflip = v; return 0; }

void frameDims(int fs, int& w, int& h) {
  switch (fs) {
    case FRAMESIZE_QVGA: w = 320; h = 240; break;
    case FRAMESIZE_SVGA: w = 800; h = 600; break;
    case FRAMESIZE_XGA: w = 1024; h = 768; break;
    case FRAMESIZE_HD: w = 1280; h = 720; break;
    case FRAMESIZE_UXGA: w = 1600; h = 1200; break;
    default: w = 640; h = 480; break;
  }
}
}  // namespace

// ================================================================= harness API
void simSeed(uint32_t s) { rng.seed(s); }
void simSetResetReason(int r) { resetReason = r; }
void simSetRestartHook(void (*fn)()) { restartHook = fn; }
double simBody() { return W.out + W.bump; }
double simThetaTrue() { return wrap180(W.lampAz - simBody()); }

void simAdvance(uint64_t d) {
  const uint64_t end = W.us + d;
  for (;;) {
    int best = -1;
    uint64_t bt = end + 1;
    for (int i = 0; i < nTimers; i++)
      if (timers[i].active && timers[i].next <= end && timers[i].next < bt) {
        bt = timers[i].next;
        best = i;
      }
    if (best < 0) break;
    servoPhysics((bt - W.us) * 1e-6);
    W.us = bt;
    timers[best].next += timers[best].period;
    timers[best].cb(timers[best].arg);
  }
  servoPhysics((end - W.us) * 1e-6);
  W.us = end;
  Serial1.drain();  // the UART keeps sending while the CPU does other things
}

void simFeed(const std::string& line) {
  for (char c : line) rx.push_back((uint8_t)c);
  rx.push_back('\n');
}

void simLinkFeed(const std::string& line) {
  if (!Serial1.radioRx()) return;  // nobody listens on the pin/baud the radio uses: the bytes are lost
  for (char c : line) l1rx.push_back((uint8_t)c);
  l1rx.push_back('\n');
}

void simFlushLink() {
  for (const auto& l : l1lines) printf("!LINK %s\n", l.c_str());
  l1lines.clear();
}

bool simSet(const std::string& k, const std::string& v) {
  const double x = atof(v.c_str());
  std::map<std::string, double*> dm = {
      {"lampAz", &W.lampAz}, {"lampK", &W.lampK}, {"ambient", &W.ambient}, {"flicker", &W.flicker},
      {"noiseMv", &W.noiseMv}, {"targetAz", &W.targetAz}, {"bump", &W.bump}, {"alphaL", &W.alphaL},
      {"alphaR", &W.alphaR}, {"qL", &W.qL}, {"qR", &W.qR}, {"fov", &W.fov}, {"gammaL", &W.gammaL}, {"gammaR", &W.gammaR},
      {"r10L", &W.r10L}, {"r10R", &W.r10R}, {"tau", &W.tau}, {"tauFall", &W.tauFall}, {"spr", &W.spr}, {"backlash", &W.backlash},
      {"maxRate", &W.maxRate}, {"camOff", &W.camOff}, {"hfov", &W.hfov}, {"txUsPerByte", &W.txUsPerByte},
      {"out", &W.out}, {"vbatMv", &W.vbatMv}, {"vdiv", &W.vdiv}, {"tempC", &W.tempC}};
  std::map<std::string, int*> im = {{"lampOn", &W.lampOn}, {"actuator", &W.actuator}, {"pinL", &W.pinL},
                                      {"pinR", &W.pinR}, {"wireDir", &W.wireDir}, {"servoPin", &W.servoPin},
                                      {"camModel", &W.camModel}, {"camFrames", &W.camFrames}, {"psram", &W.psram}, {"i2cSda", &W.i2cSda},
                                      {"i2cScl", &W.i2cScl}, {"i2cAddr", &W.i2cAddr}, {"btnPin", &W.btnPin}, {"btnDown", &W.btnDown},
                                      {"vbatPin", &W.vbatPin}, {"linkRx", &W.linkRx}, {"linkTx", &W.linkTx},
                                      {"linkBaud", &W.linkBaud}, {"linkUp", &W.linkUp}};
  if (k == "actuator" && lround(x) == 1 && W.actuator != 1) W.out = W.motor * 360.0 / W.spr;  // gear re-engages
  if (k == "q") { W.qL = W.qR = x; return true; }
  if (dm.count(k)) { *dm[k] = x; return true; }
  if (im.count(k)) { *im[k] = (int)lround(x); return true; }
  if (k == "uln") {  // "4,5,6,7"
    int a[4];
    if (sscanf(v.c_str(), "%d,%d,%d,%d", &a[0], &a[1], &a[2], &a[3]) != 4) return false;
    for (int i = 0; i < 4; i++) W.uln[i] = a[i];
    return true;
  }
  return false;
}

std::string simTruthJson() {
  char b[1024];
  snprintf(b, sizeof(b),
           "{\"t_ms\":%.3f,\"body\":%.4f,\"theta\":%.4f,\"out\":%.4f,\"motorDeg\":%.4f,\"motor\":%ld,\"rotorIdx\":%d,"
           "\"coil\":%d,\"lampAz\":%.3f,\"targetAz\":%.3f,\"camAz\":%.4f,\"camErr\":%.4f,\"bump\":%.3f,\"steps\":%ld,"
           "\"glitches\":%ld,\"missed\":%ld,\"spr\":%.2f,\"backlash\":%.3f,\"camOff\":%.3f,\"aec\":%d,\"agcCtrl\":%d,"
           "\"frames\":%u,\"txBytes\":%zu,\"gL\":%.6g,\"gR\":%.6g,\"hm\":%d,\"vf\":%d,\"linkBytes\":%ld,\"btnDown\":%d}",
           W.us / 1000.0, simBody(), simThetaTrue(), W.out, W.motor * 360.0 / W.spr, W.motor, W.rotorIdx, W.coil,
           W.lampAz, W.targetAz, simBody() + W.camOff, wrap180(simBody() + W.camOff - W.targetAz), W.bump, W.steps,
           W.glitches, W.missed, W.spr, W.backlash, W.camOff, W.aec, W.agcCtrl, W.frames, txBytes, W.gL, W.gR,
           W.hmirror, W.vflip, W.linkBytes, W.btnDown);
  return b;
}

bool simSaveState(const std::string& dir) {
  std::ofstream f(dir + "/world.txt");
  if (!f) return false;
  f.precision(17);
  f << "motor " << W.motor << "\nrotorIdx " << W.rotorIdx << "\nout " << W.out << "\nbump " << W.bump << "\nlampAz "
    << W.lampAz << "\nlampOn " << W.lampOn << "\nlampK " << W.lampK << "\nambient " << W.ambient << "\ntargetAz "
    << W.targetAz << "\nus " << W.us << "\n";
  std::ofstream n(dir + "/nvs.txt");
  if (!n) return false;
  for (const auto& ns : nvsSpaces) n << "ns " << ns << "\n";
  for (const auto& kv : nvs) {
    n << "kv " << kv.first << " ";
    for (uint8_t c : kv.second) {
      char h[3];
      snprintf(h, sizeof(h), "%02x", c);
      n << h;
    }
    n << "\n";
  }
  return true;
}

bool simLoadState(const std::string& dir) {
  std::ifstream n(dir + "/nvs.txt");
  if (n) {
    std::string tag, k, hex;
    while (n >> tag) {
      if (tag == "ns") { n >> k; nvsSpaces.insert(k); }
      else if (tag == "kv") {
        n >> k >> hex;
        std::vector<uint8_t> v;
        for (size_t i = 0; i + 1 < hex.size(); i += 2) v.push_back((uint8_t)strtoul(hex.substr(i, 2).c_str(), nullptr, 16));
        nvs[k] = v;
      }
    }
  }
  std::ifstream f(dir + "/world.txt");
  if (!f) return false;
  std::string k;
  while (f >> k) {
    if (k == "motor") f >> W.motor;
    else if (k == "rotorIdx") f >> W.rotorIdx;
    else if (k == "out") f >> W.out;
    else if (k == "bump") f >> W.bump;
    else if (k == "lampAz") f >> W.lampAz;
    else if (k == "lampOn") f >> W.lampOn;
    else if (k == "lampK") f >> W.lampK;
    else if (k == "ambient") f >> W.ambient;
    else if (k == "targetAz") f >> W.targetAz;
    else if (k == "us") f >> W.us;
    else { std::string skip; f >> skip; }
  }
  return true;
}

// ================================================================= Arduino core mock
MockSerial Serial;
EspClass ESP;

uint32_t millis() { return (uint32_t)(W.us / 1000); }
uint32_t micros() { return (uint32_t)W.us; }
void delay(uint32_t ms) { simAdvance((uint64_t)ms * 1000); }
void delayMicroseconds(uint32_t us) { simAdvance(us); }
void yield() {}
void pinMode(uint8_t pin, uint8_t m) {
  if (pin < 64) mode[pin] = m;
}
void digitalWrite(uint8_t pin, uint8_t val) {
  if (pin >= 64) return;
  level[pin] = val ? 1 : 0;
  for (int k = 0; k < 4; k++)
    if (W.uln[k] == pin) {
      if (mode[pin] != OUTPUT) printf("!WARN digitalWrite on GPIO%d that is not OUTPUT\n", pin);
      onCoil();
    }
}
int digitalRead(uint8_t pin) {
  if ((int)pin == W.btnPin && mode[pin] == INPUT_PULLUP) return W.btnDown ? LOW : HIGH;  // button to GND, pulled up
  return pin < 64 ? level[pin] : 0;
}

uint32_t analogReadMilliVolts(uint8_t pin) {
  simAdvance(40);  // one ADC conversion with calibration
  ldrUpdate();
  if (pin == W.pinL || pin == W.pinR) {
    const double g = pin == W.pinL ? W.gL : W.gR;
    return (uint32_t)lround(clampd(dividerMv(g) + gauss() * W.noiseMv, 0, 3100));
  }
  if ((int)pin == W.vbatPin) return (uint32_t)lround(clampd(W.vbatMv / W.vdiv + gauss() * 4, 0, 3100));
  if (pin == 19 || pin == 20) printf("!WARN ADC read on USB pin GPIO%d\n", pin);
  if (!floating.count(pin)) floating[pin] = pin % 5 == 0 ? 3300 : uni(rng) * 400;
  floating[pin] = clampd(floating[pin] + gauss() * 15, 0, 3300);
  return (uint32_t)lround(std::min(3100.0, floating[pin]));
}
uint16_t analogRead(uint8_t pin) { return (uint16_t)(analogReadMilliVolts(pin) * 4095 / 3100); }
int8_t digitalPinToAnalogChannel(uint8_t pin) {
#ifdef MOCK_ESP32  // the old ESP32: ADC1 on GPIO32-39, ADC2 on 0, 2, 4, 12-15, 25-27
  static const int8_t ch[40] = {11, -1, 12, -1, 10, -1, -1, -1, -1, -1, -1, -1, 15, 14, 16, 13, -1, -1, -1, -1,
                                -1, -1, -1, -1, -1, 18, 19, 17, -1, -1, -1, -1, 4,  5,  6,  7,  0,  1,  2,  3};
  return pin < 40 ? ch[pin] : -1;
#else
  return pin >= 1 && pin <= 20 ? (int8_t)(pin <= 10 ? pin - 1 : pin - 11) : -1;
#endif
}

void enableLoopWDT() {}
bool psramFound() { return W.psram != 0; }
float temperatureRead() { return (float)W.tempC; }
void* ps_malloc(size_t n) { return W.psram ? malloc(n) : nullptr; }
uint32_t EspClass::getPsramSize() { return W.psram ? 8u << 20 : 0; }
void EspClass::restart() {
  fflush(stdout);
  if (restartHook) restartHook();
  exit(3);
}

// servo PWM: the world converts the pulse width into a commanded angle (standard 500..2500 us = -90..+90)
static void servoDuty(int pin, uint32_t duty) {
  if (pin != W.servoPin) return;
  const double us = duty / 65535.0 * 20000.0;
  W.servoCmd = (us - 1500.0) / 1000.0 * 90.0;
  W.servoSeen = 1;
}
// ESP32-S3 LEDC limits, enforced like the real core does: at most 14-bit resolution (SOC_LEDC_TIMER_BIT_WIDTH),
// 8 channels, and freq * 2^bits must fit the 80 MHz APB clock. Anything else fails here exactly as on the chip.
static bool ledcOk(uint32_t freq, uint8_t bits, int ch) {
  return bits >= 1 && bits <= 14 && ch >= 0 && ch < 8 && freq > 0 && (double)freq * (double)(1u << bits) <= 80e6;
}
#if ESP_ARDUINO_VERSION_MAJOR >= 3
static int pinBits[64];
bool ledcAttachChannel(uint8_t pin, uint32_t freq, uint8_t res, int8_t ch) {
  if (!ledcOk(freq, res, ch)) {
    printf("!WARN ledcAttachChannel rejected: %u Hz %u bit ch %d (ESP32-S3 max 14 bit)\n", (unsigned)freq, (unsigned)res, ch);
    return false;
  }
  if (pin < 64) pinBits[pin] = res;
  return true;
}
bool ledcWrite(uint8_t pin, uint32_t duty) {
  if (pin >= 64 || !pinBits[pin] || duty > (1u << pinBits[pin])) return false;  // not attached: refused like the core
  servoDuty(pin, duty << (16 - pinBits[pin]));                                // the world works in 16-bit units
  return true;
}
bool ledcDetach(uint8_t pin) {
  if (pin < 64) pinBits[pin] = 0;
  return true;
}
#else
static int chPin[16] = {-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1};
static int chBits[16];
uint32_t ledcSetup(uint8_t ch, uint32_t freq, uint8_t bits) {
  if (!ledcOk(freq, bits, ch)) {
    printf("!WARN ledcSetup rejected: %u Hz %u bit ch %u (ESP32-S3 max 14 bit)\n", (unsigned)freq, (unsigned)bits, (unsigned)ch);
    return 0;
  }
  chBits[ch] = bits;
  return freq;
}
void ledcAttachPin(uint8_t pin, uint8_t ch) {
  if (ch < 16) chPin[ch] = pin;
}
void ledcWrite(uint8_t ch, uint32_t duty) {
  if (ch < 16 && chPin[ch] >= 0 && chBits[ch]) servoDuty(chPin[ch], duty << (16 - chBits[ch]));
}
void ledcDetachPin(uint8_t pin) {
  for (int& p : chPin)
    if (p == pin) p = -1;
}
#endif

// ---------------------------------------------------------------- Serial
void MockSerial::begin(unsigned long) {}
int MockSerial::available() { return (int)rx.size(); }
int MockSerial::read() {
  if (rx.empty()) return -1;
  const int c = rx.front();
  rx.pop_front();
  return c;
}
int MockSerial::peek() { return rx.empty() ? -1 : rx.front(); }
int MockSerial::availableForWrite() { return W.txUsPerByte > 0 ? 128 : 256; }
size_t MockSerial::setRxBufferSize(size_t n) { return n; }
size_t MockSerial::write(uint8_t c) {
  fputc(c, stdout);
  txCost(1);
  return 1;
}
size_t MockSerial::write(const uint8_t* b, size_t n) {
  fwrite(b, 1, n, stdout);
  txCost(n);
  return n;
}
size_t MockSerial::print(const char* s) { return write((const uint8_t*)s, strlen(s)); }
size_t MockSerial::print(char c) { return write((uint8_t)c); }
size_t MockSerial::print(int v) { char b[16]; snprintf(b, sizeof(b), "%d", v); return print(b); }
size_t MockSerial::print(unsigned v) { char b[16]; snprintf(b, sizeof(b), "%u", v); return print(b); }
size_t MockSerial::print(long v) { char b[24]; snprintf(b, sizeof(b), "%ld", v); return print(b); }
size_t MockSerial::print(unsigned long v) { char b[24]; snprintf(b, sizeof(b), "%lu", v); return print(b); }
size_t MockSerial::print(double v, int digits) { char b[40]; snprintf(b, sizeof(b), "%.*f", digits, v); return print(b); }
size_t MockSerial::println(const char* s) { return print(s) + print('\n'); }

// ---------------------------------------------------------------- Serial1 (second port) with real UART timing
HardwareSerial Serial1;
bool HardwareSerial::radioRx() const { return on_ && W.linkUp && rx_ == W.linkRx && (long)baud_ == W.linkBaud; }
bool HardwareSerial::radioTx() const { return on_ && W.linkUp && tx_ == W.linkTx && (long)baud_ == W.linkBaud; }
void HardwareSerial::begin(unsigned long baud, uint32_t, int8_t rxPin, int8_t txPin) {
  if (on_) end();
  on_ = true;
  baud_ = baud ? baud : 115200;
  rx_ = rxPin;
  tx_ = txPin;
}
void HardwareSerial::end() {
  on_ = false;
  l1tx.clear();
  l1rx.clear();
  l1line.clear();
}
int HardwareSerial::available() { return on_ ? (int)l1rx.size() : 0; }
int HardwareSerial::read() {
  if (!on_ || l1rx.empty()) return -1;
  const int c = l1rx.front();
  l1rx.pop_front();
  return c;
}
int HardwareSerial::peek() { return on_ && !l1rx.empty() ? l1rx.front() : -1; }
void HardwareSerial::drain() {
  if (!on_) return;
  const double byteUs = 1e7 / (double)baud_;  // 10 bits per byte
  while (!l1tx.empty() && (double)W.us >= l1HeadDoneUs) {
    const uint8_t c = l1tx.front();
    l1tx.pop_front();
    l1HeadDoneUs += byteUs;
    if (!radioTx()) continue;  // no radio on that pin / wrong baud: the bytes go nowhere
    W.linkBytes++;
    if (c == '\n') {
      l1lines.push_back(l1line);
      l1line.clear();
    } else if (c != '\r') {
      l1line += (char)c;
    }
  }
}
int HardwareSerial::availableForWrite() {
  if (!on_) return 0;
  drain();
  const size_t cap = 128 + txBuf_;
  return l1tx.size() >= cap ? 0 : (int)(cap - l1tx.size());
}
size_t HardwareSerial::write(const uint8_t* b, size_t n) {
  if (!on_) return 0;
  const size_t cap = 128 + txBuf_;  // hardware FIFO + driver TX buffer
  const double byteUs = 1e7 / (double)baud_;
  for (size_t i = 0; i < n; i++) {
    drain();
    while (l1tx.size() >= cap) {  // the real driver waits for room here: loop() is blocked meanwhile
      simAdvance((uint64_t)byteUs + 1);
      drain();
    }
    if (l1tx.empty()) l1HeadDoneUs = (double)W.us + byteUs;
    l1tx.push_back(b[i]);
  }
  return n;
}
size_t MockSerial::printf(const char* fmt, ...) {
  char b[1024];
  va_list ap;
  va_start(ap, fmt);
  const int n = vsnprintf(b, sizeof(b), fmt, ap);
  va_end(ap);
  return n > 0 ? print(b) : 0;
}

// ---------------------------------------------------------------- esp_timer / esp_system
esp_err_t esp_timer_create(const esp_timer_create_args_t* a, esp_timer_handle_t* out) {
  if (nTimers >= 4 || !a || !a->callback) return ESP_FAIL;
  timers[nTimers].cb = a->callback;
  timers[nTimers].arg = a->arg;
  *out = (esp_timer_handle_t)(intptr_t)(nTimers + 1);
  nTimers++;
  return ESP_OK;
}
esp_err_t esp_timer_start_periodic(esp_timer_handle_t t, uint64_t period) {
  const int i = (int)(intptr_t)t - 1;
  if (i < 0 || i >= nTimers || period < 50) return ESP_FAIL;
  timers[i].period = period;
  timers[i].next = W.us + period;
  timers[i].active = true;
  return ESP_OK;
}
esp_err_t esp_timer_stop(esp_timer_handle_t t) {
  const int i = (int)(intptr_t)t - 1;
  if (i < 0 || i >= nTimers) return ESP_FAIL;
  timers[i].active = false;
  return ESP_OK;
}
int64_t esp_timer_get_time() { return (int64_t)W.us; }
esp_reset_reason_t esp_reset_reason() { return (esp_reset_reason_t)resetReason; }

// ---------------------------------------------------------------- Preferences (NVS rules: names <= 15 chars)
std::string Preferences::full(const char* key) const { return ns_ + "/" + key; }
bool Preferences::begin(const char* name, bool readOnly, const char*) {
  if (!name || strlen(name) > 15) { printf("!NVS namespace too long\n"); return false; }
  if (readOnly && !nvsSpaces.count(name)) return false;  // real NVS: NOT_FOUND on first boot
  nvsSpaces.insert(name);
  ns_ = name;
  ro_ = readOnly;
  open_ = true;
  simAdvance(200);
  return true;
}
void Preferences::end() { open_ = false; }
static bool keyOk(const char* key) {
  if (!key || strlen(key) > 15) {
    printf("!NVS key too long: %s\n", key ? key : "(null)");
    return false;
  }
  return true;
}
bool Preferences::isKey(const char* key) { return open_ && keyOk(key) && nvs.count(full(key)); }
bool Preferences::remove(const char* key) {
  if (!open_ || ro_ || !keyOk(key)) return false;
  return nvs.erase(full(key)) > 0;
}
bool Preferences::clear() {
  if (!open_ || ro_) return false;
  for (auto it = nvs.begin(); it != nvs.end();)
    if (it->first.rfind(ns_ + "/", 0) == 0) it = nvs.erase(it);
    else ++it;
  return true;
}
float Preferences::getFloat(const char* key, float def) {
  if (!isKey(key) || nvs[full(key)].size() != 4) return def;
  float v;
  memcpy(&v, nvs[full(key)].data(), 4);
  return v;
}
size_t Preferences::putFloat(const char* key, float v) {
  if (!open_ || ro_ || !keyOk(key)) return 0;
  std::vector<uint8_t> b(4);
  memcpy(b.data(), &v, 4);
  nvs[full(key)] = b;
  simAdvance(1500);  // flash write
  return 4;
}
size_t Preferences::getBytesLength(const char* key) { return isKey(key) ? nvs[full(key)].size() : 0; }
size_t Preferences::getBytes(const char* key, void* buf, size_t maxLen) {
  if (!isKey(key)) return 0;
  const auto& v = nvs[full(key)];
  if (v.size() > maxLen) return 0;  // real Preferences refuses a too-small buffer
  memcpy(buf, v.data(), v.size());
  return v.size();
}
size_t Preferences::putBytes(const char* key, const void* buf, size_t len) {
  if (!open_ || ro_ || !keyOk(key) || len > 4000) return 0;
  nvs[full(key)] = std::vector<uint8_t>((const uint8_t*)buf, (const uint8_t*)buf + len);
  simAdvance(3000);
  return len;
}

// ---------------------------------------------------------------- Wire
TwoWire Wire;
bool TwoWire::begin(int sda, int scl, uint32_t) {
  on_ = (sda == W.i2cSda && scl == W.i2cScl);
  return true;
}
bool TwoWire::end() {
  on_ = false;
  return true;
}
uint8_t TwoWire::endTransmission(bool) {
  simAdvance(120);
  return on_ && addr_ == W.i2cAddr ? 0 : 2;
}

// ---------------------------------------------------------------- camera
esp_err_t esp_camera_init(const camera_config_t* c) {
  simAdvance(250000);
  if (camOn) return ESP_FAIL;  // must deinit first (the firmware does)
  // the SCCB probe only finds the sensor when XCLK/SDA/SCL/D0 match the real wiring
  struct P { int xclk, sda, scl, d0, pclk; };
  const P eye = {15, 4, 5, 11, 13}, xiao = {10, 40, 39, 15, 13}, aiThinker = {0, 26, 27, 5, 22};
  if (W.camModel == 0) return ESP_ERR_NOT_FOUND;
  const P& r = W.camModel == 1 ? eye : W.camModel == 4 ? aiThinker : xiao;
  if (c->pin_xclk != r.xclk || c->pin_sccb_sda != r.sda || c->pin_sccb_scl != r.scl || c->pin_d0 != r.d0 || c->pin_pclk != r.pclk)
    return ESP_ERR_NOT_FOUND;
  if (c->pixel_format != PIXFORMAT_JPEG || c->fb_count < 1 || c->xclk_freq_hz < 8000000) return ESP_ERR_INVALID_ARG;
  if (c->fb_location == CAMERA_FB_IN_PSRAM && !W.psram) return ESP_FAIL;
  camOn = true;
  camRes = c->frame_size;
  camQ = c->jpeg_quality;
  memset(&theSensor, 0, sizeof(theSensor));
  theSensor.id.PID = 0x26;  // OV2640
  theSensor.set_framesize = sFramesize;
  theSensor.set_quality = sQuality;
  theSensor.set_exposure_ctrl = sExposure;
  theSensor.set_gain_ctrl = sGainCtrl;
  theSensor.set_whitebal = sWb;
  theSensor.set_aec_value = sAecValue;
  theSensor.set_agc_gain = sAgcGain;
  theSensor.set_hmirror = sHmirror;
  theSensor.set_vflip = sVflip;
  W.aec = W.agcCtrl = W.awb = 1;
  W.hmirror = W.vflip = -1;  // whatever the driver left: the firmware must set them itself
  return ESP_OK;
}
esp_err_t esp_camera_deinit() {
  camOn = false;
  return ESP_OK;
}
sensor_t* esp_camera_sensor_get() { return camOn ? &theSensor : nullptr; }

// A real JPEG (SOI + comment segments + the tiny image). The comment carries the ground truth
// at the moment of exposure so the test can grade the pointing like a judge looking at the photo.
camera_fb_t* esp_camera_fb_get() {
  if (!camOn) return nullptr;
  if (!W.camFrames) {  // the real driver waits FB_GET_TIMEOUT (4 s) for a frame, then gives up
    simAdvance(4000000);
    return nullptr;
  }
  simAdvance(66000);  // one frame period (~15 fps)
  int w, h;
  frameDims(camRes, w, h);
  char pay[400];
  const double camAz = simBody() + W.camOff;
  const int moving = (W.us - W.lastMotionUs) < 80000;
  const int locked = W.aec == 0 && W.agcCtrl == 0;
  snprintf(pay, sizeof(pay),
           "NASASIM camAz=%.4f lampAz=%.4f targetAz=%.4f err=%.4f locked=%d moving=%d aecv=%d t=%.3f w=%d h=%d q=%d frame=%u hm=%d vf=%d",
           camAz, W.lampAz, W.targetAz, wrap180(camAz - W.targetAz), locked, moving, W.aecValue, W.us / 1e6, w, h, camQ,
           W.frames + 1, W.hmirror, W.vflip);
  const size_t target = (size_t)std::max(1500.0, w * h * 0.08 * sqrt(12.0 / std::max(camQ, 4)));
  std::vector<uint8_t> v = {0xFF, 0xD8};
  auto com = [&](const uint8_t* d, size_t n) {
    v.push_back(0xFF);
    v.push_back(0xFE);
    v.push_back((uint8_t)((n + 2) >> 8));
    v.push_back((uint8_t)((n + 2) & 0xFF));
    v.insert(v.end(), d, d + n);
  };
  com((const uint8_t*)pay, strlen(pay));
  while (v.size() + sizeof(kTinyJpeg) < target) {  // filler with varied bytes, like compressed data
    std::vector<uint8_t> fill(std::min<size_t>(60000, target - v.size() - sizeof(kTinyJpeg)));
    for (auto& b : fill) b = (uint8_t)(uni(rng) * 255);
    for (auto& b : fill)
      if (b == 0xFF) b = 0xFE;
    com(fill.data(), fill.size());
  }
  v.insert(v.end(), kTinyJpeg + 2, kTinyJpeg + sizeof(kTinyJpeg));
  camera_fb_t* fb = (camera_fb_t*)malloc(sizeof(camera_fb_t));
  fb->buf = (uint8_t*)malloc(v.size());
  memcpy(fb->buf, v.data(), v.size());
  fb->len = v.size();
  fb->width = w;
  fb->height = h;
  fb->format = PIXFORMAT_JPEG;
  W.frames++;
  return fb;
}
void esp_camera_fb_return(camera_fb_t* fb) {
  if (!fb) return;
  free(fb->buf);
  free(fb);
}
