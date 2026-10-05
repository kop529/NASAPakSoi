#include "ops.h"
#include <Arduino.h>
#include <math.h>
#include "camera.h"
#include "cfg.h"
#include "commands.h"
#include "features.h"
#include "procs.h"
#include "proto.h"

namespace {
// ---- automatic start of mission 1 after power-on
bool autoPending = false;
uint32_t autoAt = 0;

// ---- push button: armed after it has been released for 100 ms, fires after 40 ms pressed. A pin that toggles
// by itself (a clock, a floating wire) never stays high 100 ms in a row, so it never fires.
int btnPin = -1, btnWarned = -1;
bool btnUp = true, btnArmed = false;
uint32_t btnSince = 0;

// ---- housekeeping
uint32_t nextHk = 0, loopMaxUs = 0;

// ---- second port
int linkRx = -2, linkTx = -2;
long linkBaud = 0;
bool linkUp = false;

bool camUses(int gpio) {
  int pins[20];
  const int n = cam::pinsInUse(pins, 20);
  for (int k = 0; k < n; k++)
    if (pins[k] == gpio) return true;
  return false;
}

void buttonApply() {
  int p = cfg::i(CFG_HW_BTN);
  if (p >= 0 && camUses(p)) {  // ESP32-CAM: GPIO0 is the camera clock, not a button
    if (btnWarned != p) out::event("WARN BTN GPIO%d_used_by_camera_button_off", p);
    btnWarned = p;
    p = -1;
  }
  if (p == btnPin) return;
  btnPin = p;
  if (p >= 0) pinMode(p, INPUT_PULLUP);
  btnUp = true;
  btnArmed = false;
  btnSince = millis();
}

void buttonTick() {
  if (btnPin < 0) return;
  const bool up = digitalRead(btnPin) != LOW;
  const uint32_t now = millis();
  if (up != btnUp) {
    btnUp = up;
    btnSince = now;
  }
  if (btnUp) {
    if (now - btnSince >= 100) btnArmed = true;
    return;
  }
  if (!btnArmed || now - btnSince < 40) return;
  btnArmed = false;  // once per press
  autoPending = false;
  if (procs::m1State() != procs::M1_IDLE) {
    out::event("BTN M1_STOP");
    procs::m1Stop();
  } else {
    out::event("BTN M1_START");
    procs::m1Start(cfg::f(CFG_M1_TGT));
  }
}

void autoTick() {
  if (!autoPending || (int32_t)(millis() - autoAt) < 0) return;
  autoPending = false;
  const char* busy = procs::motionName();
  if (busy) {  // somebody already started something: never interrupt it
    out::event("AUTO SKIPPED busy_%s", busy);
    return;
  }
  out::event("AUTO M1_START");
  procs::m1Start(cfg::f(CFG_M1_TGT));
}

void hkTick() {
  const int every = cfg::i(CFG_COM_HK);
  if (every <= 0 || !cmd::streaming() || (int32_t)(millis() - nextHk) < 0) return;
  nextHk = millis() + (uint32_t)every * 1000u;
  out::putf("J {\"type\":\"hk\",\"t\":%lu,\"temp_c\":", (unsigned long)millis());
#if CONFIG_IDF_TARGET_ESP32
  out::put("null");  // the old ESP32's internal sensor gives no usable value
#else
  out::putNum(temperatureRead());
#endif
  out::putf(",\"heap\":%lu,\"heap_min\":%lu,\"loop_max_ms\":%.1f,\"vbat_mv\":", (unsigned long)ESP.getFreeHeap(),
            (unsigned long)ESP.getMinFreeHeap(), loopMaxUs / 1000.0);
  const int vp = cfg::i(CFG_HW_VBAT);
  if (vp >= 0) {
    uint32_t s = 0;
    for (int k = 0; k < 8; k++) s += analogReadMilliVolts(vp);
    out::putf("%.0f", s / 8.0 * cfg::f(CFG_HW_VDIV));
  } else {
    out::put("null");
  }
  out::putf(",\"m1\":\"%s\",\"btn\":%d", procs::m1Name(procs::m1State()), btnPin);
  if (out::linkOn()) {
    uint32_t lines, dropped, queued;
    out::linkStats(lines, dropped, queued);
    out::putf(",\"link\":{\"lines\":%lu,\"drop\":%lu,\"queued\":%lu}", (unsigned long)lines, (unsigned long)dropped,
              (unsigned long)queued);
  }
  out::put("}");
  out::end();
  loopMaxUs = 0;
}

void linkApply() {
#if ENABLE_LINK
  const int rx = cfg::i(CFG_COM_RX);
  const int tx = cfg::i(CFG_COM_TX);
  const long baud = lroundf(cfg::f(CFG_COM_BAUD));
  if (rx == linkRx && tx == linkTx && baud == linkBaud) return;
  if (linkUp) {
    out::linkEnd();
    Serial1.end();
    linkUp = false;
  }
  linkRx = rx;
  linkTx = tx;
  linkBaud = baud;
  if (tx < 0) return;  // com.tx = -1: no second port
  Serial1.setRxBufferSize(1024);
  Serial1.setTxBufferSize(1024);
  Serial1.begin((unsigned long)baud, SERIAL_8N1, rx, tx);
  linkUp = out::linkBegin(&Serial1, 64 * 1024);
  if (linkUp) {
    out::event("LINK ON rx=%d tx=%d baud=%ld", rx, tx, baud);
  } else {
    Serial1.end();
    out::event("FAULT LINK no_memory");
  }
#endif
}
}  // namespace

namespace ops {

void begin() {
  applyConfig();
  const int s = cfg::i(CFG_M1_AUTO);
  if (s > 0) {
    autoPending = true;
    autoAt = millis() + (uint32_t)s * 1000u;
    out::event("AUTO M1_IN %d", s);
  }
  nextHk = millis() + 1000;
}

void applyConfig() {
  buttonApply();
  linkApply();
}

void tick() {
  out::linkPump();
  buttonTick();
  autoTick();
  hkTick();
}

void cancelAuto() {
  if (!autoPending) return;
  autoPending = false;
  out::event("AUTO CANCELLED");
}

void noteLoop(uint32_t us) {
  if (us > loopMaxUs) loopMaxUs = us;
}

Stream* linkPort() {
#if ENABLE_LINK
  return linkUp ? &Serial1 : nullptr;
#else
  return nullptr;
#endif
}

int buttonPin() { return btnPin; }

}  // namespace ops
