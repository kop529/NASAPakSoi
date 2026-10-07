#include "sim_world.h"
#include <cmath>
#include <algorithm>
#include <cstdio>
#include <random>

SimWorld world;

static std::mt19937 rng(12345);
static double gauss() { static std::normal_distribution<double> n(0.0, 1.0); return n(rng); }
static double wrap180(double x) { while (x > 180) x -= 360; while (x <= -180) x += 360; return x; }
static const double kDeg = M_PI / 180.0;

double SimWorld::cmdPct() const {
  const double mag = pwm / 255.0 * 100.0;
  if (in1 && !in2) return mag;
  if (!in1 && in2) return -mag;
  return 0;  // IN1 = IN2 = LOW: driver output off, the wheel coasts
}

void SimWorld::step(double dt) {
  const double c = cmdPct();
  const bool atRest = std::fabs(wheelRate) < 20;  // deg/s
  double target;
  if (atRest && std::fabs(c) < minStartPct) {
    target = 0;  // static friction holds the wheel
  } else {
    const double eff = std::max(0.0, std::fabs(c) - minStablePct) / (100.0 - minStablePct);
    target = (c >= 0 ? 1 : -1) * eff * wheelMaxRate;
  }
  // driver off (IN1 = IN2 = LOW): the wheel coasts on its own losses (T01: ~6 s from 30 %), else it follows the PWM
  double dW = c == 0 ? -wheelRate * dt / wheelCoastTau : (target - wheelRate) * dt / wheelTau;
  if (atRest && target == 0) dW = -wheelRate;  // stops completely
  wheelRate += dW;
  // angular momentum exchange wheel <-> body, then bearing drag on the body
  bodyRate += -inertiaRatio * (dW + wheelAir * wheelRate * dt);  // wheel acceleration + air drag the motor keeps feeding
  if (bodyStick > 0) {  // Coulomb friction: breakaway bodyStick, sliding 0.7 * bodyStick
    const double drive = std::fabs(inertiaRatio * (dW + wheelAir * wheelRate * dt)) / dt;
    if (std::fabs(bodyRate) < 0.3 && drive < bodyStick) bodyRate = 0;
    else bodyRate -= (bodyRate > 0 ? 1 : -1) * std::min(std::fabs(bodyRate), 0.7 * bodyStick * dt);
  }
  bodyRate -= bearingDrag * bodyRate * dt;
  bodyDeg = wrap180(bodyDeg + bodyRate * dt);
  t += dt;
}

double SimWorld::sunAngleBody() const { return wrap180(lampDeg - bodyDeg); }

double SimWorld::mvForPin(int pin, double tNow) {
  // pin 17 = SUN_LEFT_PIN looks at +alpha (left), pin 16 looks at -alpha, unless the LDRs are swapped
  bool left = pin == 17;
  if (swapLdrPins) left = !left;
  const double inc = sunAngleBody() - (left ? alpha : -alpha);
  const double c = std::cos(inc * kDeg);
  double vign = (fov - std::fabs(inc)) / 12.0;
  vign = vign < 0 ? 0 : vign > 1 ? 1 : vign;
  const double lamp = lampK * std::pow(c > 0 ? c : 0, q) * vign * (1.0 + flicker * std::sin(2 * M_PI * 100 * tNow));
  const double E = lamp + ambient + 0.002;
  const double R = r10 * std::pow(E / 0.1, -gamma);
  double mv = vcc * rf / (rf + R) + noiseMv * gauss();
  if (mv < 0) mv = 0;
  if (mv > 3150) mv = 3150;  // ESP32-S3 ADC top (12 dB attenuation)
  return mv;
}

int16_t SimWorld::gyroZRaw() {
  const double dps = bodyRateSign * bodyRate + gyroBiasDps + gyroNoiseDps * gauss();
  double raw = dps / 0.00875;
  if (raw > 32767) raw = 32767;
  if (raw < -32768) raw = -32768;
  return (int16_t)std::lround(raw);
}

void SimWorld::magRaw(int16_t& x, int16_t& y, int16_t& z) {
  const double h = (magNorthDeg - bodyDeg) * kDeg;  // 30 uT horizontal field, 0.016 uT/LSB
  x = (int16_t)std::lround(std::cos(h) * 1875 + magOx);
  y = (int16_t)std::lround(std::sin(h) * 1875 * magSy + magOy);
  z = -2000;
}

bool SimWorld::set(const std::string& k, double v) {
  struct { const char* key; double* p; } dbl[] = {
    {"body", &bodyDeg}, {"bodyRate", &bodyRate}, {"wheel", &wheelRate}, {"lamp", &lampDeg}, {"lampK", &lampK},
    {"ambient", &ambient}, {"flicker", &flicker}, {"noise", &noiseMv}, {"alpha", &alpha}, {"gamma", &gamma},
    {"q", &q}, {"minStart", &minStartPct}, {"minStable", &minStablePct}, {"wheelMax", &wheelMaxRate},
    {"wheelTau", &wheelTau}, {"coast", &wheelCoastTau}, {"ratio", &inertiaRatio}, {"drag", &bearingDrag}, {"stick", &bodyStick}, {"air", &wheelAir}, {"gyroBias", &gyroBiasDps},
    {"gyroNoise", &gyroNoiseDps}, {"north", &magNorthDeg}, {"magOx", &magOx}, {"magOy", &magOy}, {"magSy", &magSy}, {"camMs", &camMs}, {"camFail", &camFail}, {"camDead", &camDead},
  };
  for (auto& d : dbl) if (k == d.key) { *d.p = v; return true; }
  if (k == "swap") { swapLdrPins = v != 0; return true; }
  if (k == "rateSign") { bodyRateSign = v < 0 ? -1 : 1; return true; }
  return false;
}

std::string SimWorld::state() const {
  char b[256];
  snprintf(b, sizeof(b), "#STATE t=%.3f body=%.3f rate=%.3f wheel=%.1f cmd=%.1f sun=%.3f", t, bodyDeg, bodyRate,
           wheelRate, cmdPct(), sunAngleBody());
  return b;
}
