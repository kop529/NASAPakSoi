#include "sensors.h"
#include <Arduino.h>
#include "actuator.h"
#include "cfg.h"

namespace {
int pinL = -1, pinR = -1;
int topo = 0;
bool flip = false;                 // alternate L,R / R,L so both channels share the same mean time
double sumL = 0, sumR = 0;
uint32_t nSamp = 0;
bool satWin = false;
uint32_t winStart = 0;
double emaL = -1, emaR = -1;
Meas last;
bool have = false;

struct Waiter {
  bool active = false;
  int need = 0, got = 0;
  double sL = 0, sR = 0;
  bool sat = false;
  double prevTh = 0, sDiff2 = 0;  // window-to-window angle changes: noise without the slow drift
  int nDiff = 0;
};
Waiter waiters[2];

float readMv(int pin) {
  if (pin < 0) return 0;
  return (float)analogReadMilliVolts(pin);
}

// a clipped ADC reading carries no direction information (both channels "equal" = fake null)
bool clipped(float mv) { return topo == 1 ? mv <= ADC_SAT_LO_MV : mv >= ADC_SAT_HI_MV; }
}  // namespace

namespace sensors {

void applyConfig() {
  pinL = cfg::i(CFG_SEN_PIN0);   // analogReadMilliVolts() configures the pins for the ADC itself
  pinR = cfg::i(CFG_SEN_PIN1);
  topo = cfg::i(CFG_SEN_TOPO);
  sumL = sumR = 0;
  nSamp = 0;
  satWin = false;
  winStart = millis();
  emaL = emaR = -1;
}

void begin() { applyConfig(); }

EstParams params() {
  EstParams p;
  p.gamma = cfg::f(CFG_EST_GAMMA);
  p.gammaR = cfg::f(CFG_EST_GAMMAR);
  p.qL = cfg::f(CFG_EST_QL);
  p.qR = cfg::f(CFG_EST_QR);
  p.alpha = cfg::f(CFG_EST_ALPHA);
  p.g = cfg::f(CFG_EST_G);
  p.aL = cfg::f(CFG_EST_AL);
  p.aR = cfg::f(CFG_EST_AR);
  p.th0 = cfg::f(CFG_EST_TH0);
  p.minS = cfg::f(CFG_EST_MINS);
  p.dmax = cfg::f(CFG_EST_DMAX);
  p.vcc = cfg::f(CFG_SEN_VCC);
  p.topo = cfg::i(CFG_SEN_TOPO);
  p.lutOn = cfg::i(CFG_EST_LUT);
  const Lut& l = cfg::lut();
  p.lutV = l.v;
  p.lutN = l.n;
  p.lutX0 = l.x0;
  p.lutDx = l.dx;
  return p;
}

Meas make(float mvL, float mvR, bool sat) {
  const EstParams p = params();
  Meas m;
  m.mvL = mvL;
  m.mvR = mvR;
  m.GL = estToG(mvL, p.vcc, p.topo);
  m.GR = estToG(mvR, p.vcc, p.topo);
  m.e = estimate(m.GL, m.GR, p);
  m.sat = sat;
  if (sat) m.e.valid = false;  // never steer or lock on clipped data
  m.ang = act::angleDeg();
  m.moving = act::busy();
  m.t = millis();
  return m;
}

void update() {
  // one symmetric sample pair per call
  float a, b;
  if (!flip) { a = readMv(pinL); b = readMv(pinR); }
  else { b = readMv(pinR); a = readMv(pinL); }
  flip = !flip;
  sumL += a;
  sumR += b;
  nSamp++;
  if (clipped(a) || clipped(b)) satWin = true;

  const uint32_t now = millis();
  const uint32_t win = (uint32_t)cfg::i(CFG_SEN_WIN);
  if (now - winStart < win || nSamp == 0) return;
  const double rawL = sumL / nSamp;   // procedures average raw windows: no filter lag after a move
  const double rawR = sumR / nSamp;
  double mL = rawL;
  double mR = rawR;
  const double k = cfg::f(CFG_SEN_EMA);  // the EMA only smooths the live telemetry value
  if (k < 1 && emaL >= 0) {
    mL = emaL + k * (mL - emaL);
    mR = emaR + k * (mR - emaR);
  }
  emaL = mL;
  emaR = mR;
  last = make((float)mL, (float)mR, satWin);
  have = true;
  bool any = false;
  for (const Waiter& w : waiters) any |= w.active && w.got < w.need;
  const double thWin = any ? make((float)rawL, (float)rawR, false).e.theta : 0;  // this window alone
  for (Waiter& w : waiters)
    if (w.active && w.got < w.need) {
      w.sL += rawL;
      w.sR += rawR;
      w.sat |= satWin;
      if (w.got > 0) {
        w.sDiff2 += (thWin - w.prevTh) * (thWin - w.prevTh);
        w.nDiff++;
      }
      w.prevTh = thWin;
      w.got++;
    }
  sumL = sumR = 0;
  nSamp = 0;
  satWin = false;
  winStart = now;
}

bool hasLatest() { return have; }
const Meas& latest() { return last; }

int windowsFor(int ms) {
  const int w = cfg::i(CFG_SEN_WIN);
  int n = (ms + w / 2) / (w > 0 ? w : 1);
  return n < 1 ? 1 : n;
}

void request(int slot, int windows) {
  Waiter& w = waiters[slot & 1];
  w.active = true;
  w.need = windows < 1 ? 1 : windows;
  w.got = 0;
  w.sL = w.sR = 0;
  w.sat = false;
  w.sDiff2 = 0;
  w.nDiff = 0;
}

bool ready(int slot) {
  const Waiter& w = waiters[slot & 1];
  return w.active && w.got >= w.need;
}

Meas result(int slot) {
  Waiter& w = waiters[slot & 1];
  w.active = false;
  const int n = w.got > 0 ? w.got : 1;
  Meas m = make((float)(w.sL / n), (float)(w.sR / n), w.sat);
  // a difference of two independent windows has twice the variance of one window
  m.thSd = w.nDiff > 0 ? (float)sqrt(w.sDiff2 / w.nDiff / 2.0) : 0;
  m.nWin = n;
  return m;
}

void cancel(int slot) { waiters[slot & 1].active = false; }

}  // namespace sensors
