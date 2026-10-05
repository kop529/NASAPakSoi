#include "diag.h"
#include <Arduino.h>
#include <Wire.h>
#include <esp_system.h>
#include "actuator.h"
#include "camera.h"
#include "cfg.h"
#include "compat.h"
#include "ops.h"
#include "procs.h"
#include "proto.h"
#include "sensors.h"

namespace {
bool pinOn = false;
uint32_t nextPins = 0;

bool contains(const int* a, int n, int v) {
  for (int k = 0; k < n; k++)
    if (a[k] == v) return true;
  return false;
}

// pins that must never be touched by a scan: motor, camera, button and second port (an analogRead would take the
// pin away from its job: the UART would go silent, the button would stop working)
int busyPins(int* o) {
  int n = act::pinsInUse(o, 20);
  n += cam::pinsInUse(o + n, 20);
  if (ops::buttonPin() >= 0) o[n++] = ops::buttonPin();
  if (out::linkOn()) {
    o[n++] = cfg::i(CFG_COM_RX);
    o[n++] = cfg::i(CFG_COM_TX);
  }
  return n;
}
}  // namespace

namespace diag {

const char* resetReason() {
  switch (esp_reset_reason()) {
    case ESP_RST_POWERON: return "POWERON";
    case ESP_RST_EXT: return "EXTERNAL";
    case ESP_RST_SW: return "SOFTWARE";
    case ESP_RST_PANIC: return "PANIC";
    case ESP_RST_INT_WDT: return "INT_WDT";
    case ESP_RST_TASK_WDT: return "TASK_WDT";
    case ESP_RST_WDT: return "WDT";
    case ESP_RST_DEEPSLEEP: return "DEEPSLEEP";
    case ESP_RST_BROWNOUT: return "BROWNOUT";
    case ESP_RST_SDIO: return "SDIO";
    default: return "OTHER";
  }
}

void hwid(bool scanI2C) {
  out::putf("J {\"type\":\"hwid\",\"chip\":\"%s\",\"rev\":%d,\"cores\":%d,\"cpu_mhz\":%lu,\"flash_mb\":%lu,\"psram_mb\":%.1f",
            ESP.getChipModel(), (int)ESP.getChipRevision(), (int)ESP.getChipCores(), (unsigned long)ESP.getCpuFreqMHz(),
            (unsigned long)(ESP.getFlashChipSize() / (1024UL * 1024UL)), (double)ESP.getPsramSize() / (1024.0 * 1024.0));
  out::putf(",\"core\":\"%d.%d.%d\",\"fw\":\"%s %s\",\"reset\":\"%s\",\"uptime_ms\":%lu,\"free_heap\":%lu",
            ESP_ARDUINO_VERSION_MAJOR, ESP_ARDUINO_VERSION_MINOR, ESP_ARDUINO_VERSION_PATCH, FW_NAME, FW_VERSION,
            resetReason(), (unsigned long)millis(), (unsigned long)ESP.getFreeHeap());
  out::put(",\"camera\":");
  out::putStr(cam::status());
  out::put(",\"actuator\":");
  out::putStr(act::typeName());
  out::putf(",\"ldr_pins\":[%d,%d],\"uln_pins\":[%d,%d,%d,%d],\"btn\":%d,\"link\":", cfg::i(CFG_SEN_PIN0),
            cfg::i(CFG_SEN_PIN1), cfg::i(CFG_ACT_IN1), cfg::i(CFG_ACT_IN2), cfg::i(CFG_ACT_IN3), cfg::i(CFG_ACT_IN4),
            ops::buttonPin());
  if (out::linkOn()) out::putf("\"rx=%d tx=%d baud=%d\"", cfg::i(CFG_COM_RX), cfg::i(CFG_COM_TX), cfg::i(CFG_COM_BAUD));
  else out::put("\"off\"");
  if (scanI2C) {
    const int sda = cfg::i(CFG_HW_SDA);
    const int scl = cfg::i(CFG_HW_SCL);
    int used[48];
    int n = busyPins(used);
    used[n++] = cfg::i(CFG_SEN_PIN0);
    used[n++] = cfg::i(CFG_SEN_PIN1);
    if (sda < 0 || scl < 0 || sda == scl) {
      out::put(",\"i2c\":\"off (set hw.sda / hw.scl)\"");
    } else if (contains(used, n, sda) || contains(used, n, scl)) {
      out::put(",\"i2c\":\"skipped: hw.sda/hw.scl already used by LDR, motor, camera, button or second port\"");
    } else {
      out::put(",\"i2c\":[");
      Wire.begin(sda, scl, 100000);
      Wire.setTimeOut(10);
      bool firstAddr = true;
      const uint32_t t0 = millis();
      for (uint8_t a = 1; a < 127 && millis() - t0 < 2000; a++) {  // time budget: stuck bus must not trip the WDT
        Wire.beginTransmission(a);
        if (Wire.endTransmission() == 0) {
          out::putf("%s\"0x%02X\"", firstAddr ? "" : ",", a);
          firstAddr = false;
        }
      }
      Wire.end();
      out::put("]");
    }
  }
  out::put("}");
  out::end();
}

void setPinfind(bool on) {
  pinOn = on;
  nextPins = millis();
}
bool pinfind() { return pinOn; }

void tick() {
  if (!pinOn || (int32_t)(millis() - nextPins) < 0) return;
  nextPins = millis() + 200;
  int skip[48];
  const int n = busyPins(skip);
  out::putf("J {\"type\":\"pins\",\"t\":%lu,\"mv\":{", (unsigned long)millis());
  bool firstPin = true;
  for (int p = 1; p <= 18; p++) {  // ADC-capable GPIO1..18 (19/20 = native USB)
    if (contains(skip, n, p)) continue;
    out::putf("%s\"%d\":%lu", firstPin ? "" : ",", p, (unsigned long)analogReadMilliVolts(p));
    firstPin = false;
  }
  out::put("}}");
  out::end();
}

void report() {
  const Meas& m = sensors::latest();
  const Lut& l = cfg::lut();
  const char* mo = procs::motionName();
  const char* au = procs::auxName();
  out::putf("J {\"type\":\"diag\",\"lines\":[\"uptime=%.1fs proc=%s aux=%s m1=%s reset=%s heap=%lu\"",
            millis() / 1000.0, mo ? mo : "-", au ? au : "-", procs::m1Name(procs::m1State()), resetReason(),
            (unsigned long)ESP.getFreeHeap());
  if (sensors::hasLatest())
    out::putf(",\"mv=[%.0f,%.0f] G=[%.4f,%.4f] D=%.4f S=%.4f th=%.2f valid=%d edge=%d sat=%d\"", (double)m.mvL,
              (double)m.mvR, m.GL, m.GR, m.e.D, m.e.S, m.e.theta, m.e.valid, m.e.edge, m.sat);
  out::putf(",\"ang=%.2f energized=%d steps=%ld actuator=%s\"", (double)act::angleDeg(), act::energized(),
            (long)act::steps(), act::typeName());
  out::putf(",\"est: alpha=%g gamma=%g/%g qL=%g qR=%g g=%g aL=%g aR=%g th0=%g dmax=%g minS=%g lut=%d\"",
            (double)cfg::f(CFG_EST_ALPHA), (double)cfg::f(CFG_EST_GAMMA), (double)cfg::f(CFG_EST_GAMMAR), (double)cfg::f(CFG_EST_QL),
            (double)cfg::f(CFG_EST_QR), (double)cfg::f(CFG_EST_G), (double)cfg::f(CFG_EST_AL), (double)cfg::f(CFG_EST_AR),
            (double)cfg::f(CFG_EST_TH0), (double)cfg::f(CFG_EST_DMAX), (double)cfg::f(CFG_EST_MINS), (int)l.n);
  out::putf(",\"ctl: k=%g db=%g hys=%g trim=%d adapt=%d wait=%d meas=%d appr=%d bl=%g spr=%g vmax=%g\"", (double)cfg::f(CFG_CTL_K),
            (double)cfg::f(CFG_CTL_DB), (double)cfg::f(CFG_CTL_HYS), cfg::i(CFG_CTL_TRIM), cfg::i(CFG_CTL_ADAPT), cfg::i(CFG_CTL_WAIT),
            cfg::i(CFG_CTL_MEAS), cfg::i(CFG_CTL_APPR), (double)cfg::f(CFG_ACT_BL), (double)cfg::f(CFG_ACT_SPR),
            (double)cfg::f(CFG_ACT_VMAX));
  out::put(",\"cam: ");
  out::put(cam::status());
  out::putf(" locked=%d res=%d q=%d off=%g dir=%d hfov=%g hm=%d vf=%d\"", cam::locked(), cfg::i(CFG_CAM_RES),
            cfg::i(CFG_CAM_Q), (double)cfg::f(CFG_CAM_OFF), cfg::i(CFG_CAM_DIR), (double)cfg::f(CFG_CAM_HFOV),
            cfg::i(CFG_CAM_HMIRROR), cfg::i(CFG_CAM_VFLIP));
  uint32_t lines, dropped, queued;
  out::linkStats(lines, dropped, queued);
  out::putf(",\"sys: m1.auto=%d btn=%d vbat_pin=%d hk=%d link=%s baud=%d lhz=%d lines=%lu drop=%lu queued=%lu\"]}",
            cfg::i(CFG_M1_AUTO), ops::buttonPin(), cfg::i(CFG_HW_VBAT), cfg::i(CFG_COM_HK), out::linkOn() ? "on" : "off",
            cfg::i(CFG_COM_BAUD), cfg::i(CFG_COM_LHZ), (unsigned long)lines, (unsigned long)dropped, (unsigned long)queued);
  out::end();
}

}  // namespace diag
