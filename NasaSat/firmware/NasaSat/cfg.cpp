#include "cfg.h"
#include <Arduino.h>
#include <Preferences.h>
#include <math.h>
#include <stddef.h>
#include <string.h>

namespace {
const CfgDef kDefs[CFG_COUNT] = {
#define CFG_ROW(id, k, t, d, mn, mx, st, u, g, desc) {k, t, (float)(d), (float)(mn), (float)(mx), (float)(st), u, g, desc},
    CFG_TABLE(CFG_ROW)
#undef CFG_ROW
};
float vals[CFG_COUNT];
float savedVals[CFG_COUNT];
Lut theLut;
Lut savedLut;
const char* kNs = "nasasat";

struct LutBlob {  // what goes into NVS
  float x0, dx;
  uint16_t n;
  float v[LUT_MAX];
};
}  // namespace

namespace cfg {

const CfgDef& def(int id) { return kDefs[id]; }
float f(CfgId id) { return vals[id]; }
int i(CfgId id) { return (int)lroundf(vals[id]); }
float get(int id) { return vals[id]; }
float saved(int id) { return savedVals[id]; }
Lut& lut() { return theLut; }

int find(const char* key) {
  for (int k = 0; k < CFG_COUNT; k++)
    if (strcmp(kDefs[k].key, key) == 0) return k;
  return -1;
}

bool isPin(int id) {
  return id == CFG_SEN_PIN0 || id == CFG_SEN_PIN1 || id == CFG_ACT_IN1 || id == CFG_ACT_IN2 || id == CFG_ACT_IN3 ||
         id == CFG_ACT_IN4 || id == CFG_ACT_SPIN || id == CFG_HW_SDA || id == CFG_HW_SCL || id == CFG_HW_BTN ||
         id == CFG_HW_VBAT || id == CFG_COM_RX || id == CFG_COM_TX;
}

// A pin that is wired to the flash, the PSRAM or the USB/UART link to the laptop must never be accepted:
// driving it cuts the connection (or crashes the chip), and after SAVE the board would do it again at every boot.
// The camera presets go through the same check: an ESP32-CAM pinout on an ESP32-S3 would drive its flash pins.
const char* gpioWhy(int gpio, PinUse use) {
  if (gpio < 0) return nullptr;  // -1 = not used
  const bool adc = use == PIN_ADC;
#if CONFIG_IDF_TARGET_ESP32S3
  if (gpio > 48 || (gpio >= 22 && gpio <= 25)) return "no such GPIO on the ESP32-S3 (22-25 do not exist)";
  if (gpio >= 26 && gpio <= 32) return "GPIO26-32 = SPI flash/PSRAM of the module";
#if defined(CONFIG_SPIRAM_MODE_OCT) || defined(CONFIG_ESPTOOLPY_OCT_FLASH)
  if (gpio >= 33 && gpio <= 37) return "GPIO33-37 = octal PSRAM in this build (board without PSRAM: Tools > PSRAM > Disabled)";
#endif
#if ARDUINO_USB_CDC_ON_BOOT
  if (gpio == 19 || gpio == 20) return "GPIO19/20 = USB D-/D+, the link to the laptop";
#else
  if (gpio == 43 || gpio == 44) return "GPIO43/44 = UART0 TX/RX, the link to the laptop";
#endif
#elif CONFIG_IDF_TARGET_ESP32
  if (gpio > 39 || gpio == 20 || gpio == 24 || (gpio >= 28 && gpio <= 31)) return "no such GPIO on the ESP32";
  if (gpio >= 6 && gpio <= 11) return "GPIO6-11 = SPI flash of the module";
  if (gpio == 1 || gpio == 3) return "GPIO1/3 = UART0 TX/RX, the link to the laptop";
#ifdef BOARD_HAS_PSRAM
  if (gpio == 16 || gpio == 17) return "GPIO16/17 = PSRAM";
#endif
  if (use == PIN_OUT && gpio >= 34) return "GPIO34-39 are input only";
#endif
  if (adc && digitalPinToAnalogChannel(gpio) < 0) return "not an ADC pin (an LDR or a battery divider needs an analog input)";
  return nullptr;
}

const char* pinWhy(int id, int gpio) {
  if (!isPin(id)) return nullptr;
  const PinUse use = id == CFG_SEN_PIN0 || id == CFG_SEN_PIN1 || id == CFG_HW_VBAT ? PIN_ADC
                     : id == CFG_HW_BTN || id == CFG_COM_RX                     ? PIN_IN
                                                                                 : PIN_OUT;
  return gpioWhy(gpio, use);
}

const char* set(int id, float v) {
  if (id < 0 || id >= CFG_COUNT) return "KEY";
  if (!isfinite(v)) return "VAL";
  const CfgDef& d = kDefs[id];
  if (d.type == 'i') v = roundf(v);
  if (v < d.min || v > d.max) return "RANGE";
  if (pinWhy(id, (int)v)) return "PIN";
  vals[id] = v;
  return nullptr;
}

void defaults() {
  for (int k = 0; k < CFG_COUNT; k++) vals[k] = kDefs[k].def;
  theLut.n = 0;
}

void load() {
  defaults();
  Preferences p;
  if (p.begin(kNs, true)) {
    for (int k = 0; k < CFG_COUNT; k++)
      if (p.isKey(kDefs[k].key)) {
        const float v = p.getFloat(kDefs[k].key, kDefs[k].def);
        if (isfinite(v) && v >= kDefs[k].min && v <= kDefs[k].max && !pinWhy(k, (int)lroundf(v))) vals[k] = v;
      }
    if (p.isKey("lut") && p.getBytesLength("lut") >= offsetof(LutBlob, v)) {
      static LutBlob b;
      memset(&b, 0, sizeof(b));
      p.getBytes("lut", &b, sizeof(b));
      if (b.n <= LUT_MAX && b.dx > 0) {
        theLut.x0 = b.x0;
        theLut.dx = b.dx;
        theLut.n = b.n;
        memcpy(theLut.v, b.v, sizeof(float) * b.n);
      }
    }
    p.end();
  }
  memcpy(savedVals, vals, sizeof(vals));
  savedLut = theLut;
}

void save() {
  Preferences p;
  if (!p.begin(kNs, false)) return;
  for (int k = 0; k < CFG_COUNT; k++)
    if (!p.isKey(kDefs[k].key) || p.getFloat(kDefs[k].key, NAN) != vals[k]) p.putFloat(kDefs[k].key, vals[k]);
  if (theLut.n) {
    static LutBlob b;
    b.x0 = theLut.x0;
    b.dx = theLut.dx;
    b.n = theLut.n;
    memcpy(b.v, theLut.v, sizeof(float) * theLut.n);
    p.putBytes("lut", &b, offsetof(LutBlob, v) + sizeof(float) * theLut.n);
  } else if (p.isKey("lut")) {
    p.remove("lut");
  }
  p.end();
  memcpy(savedVals, vals, sizeof(vals));
  savedLut = theLut;
}

bool saveKey(int id) {
  if (id < 0 || id >= CFG_COUNT) return false;
  Preferences p;
  if (!p.begin(kNs, false)) return false;
  const bool ok = p.putFloat(kDefs[id].key, vals[id]) == sizeof(float);
  p.end();
  if (ok) savedVals[id] = vals[id];
  return ok;
}

void begin() { load(); }

bool setLut(float x0, float dx, const float* v, int n) {
  if (n < 1 || n > LUT_MAX || !(dx > 0)) return false;
  theLut.x0 = x0;
  theLut.dx = dx;
  theLut.n = (uint16_t)n;
  memcpy(theLut.v, v, sizeof(float) * n);
  return true;
}

void clearLut() { theLut.n = 0; }

}  // namespace cfg
