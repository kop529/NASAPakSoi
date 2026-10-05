// ===== config registry: every tunable value, stored in NVS (flash) through Preferences =====
#pragma once
#include <stdint.h>
#include "features.h"
#include "cfg_table.h"

enum CfgId : uint8_t {
#define CFG_ENUM(id, k, t, d, mn, mx, st, u, g, desc) CFG_##id,
  CFG_TABLE(CFG_ENUM)
#undef CFG_ENUM
  CFG_COUNT
};

struct CfgDef {
  const char* key;
  char type;          // 'i' or 'f'
  float def, min, max, step;
  const char* unit;
  const char* group;
  const char* desc;
};

// what a GPIO is used for: input-only pins (ESP32 GPIO34-39) are fine for PIN_IN, an LDR or battery needs PIN_ADC
enum PinUse : uint8_t { PIN_OUT = 0, PIN_IN, PIN_ADC };

struct Lut {
  float x0 = 0;
  float dx = 1;
  uint16_t n = 0;
  float v[LUT_MAX];
};

namespace cfg {
void begin();                       // defaults, then values saved in NVS
float f(CfgId id);
int i(CfgId id);
const CfgDef& def(int id);
int find(const char* key);          // index or -1
const char* set(int id, float v);   // nullptr = ok, else error code ("RANGE", "PIN")
bool isPin(int id);                 // the value of this key is a GPIO number
const char* gpioWhy(int gpio, PinUse use);  // why this chip cannot use the GPIO that way (nullptr = fine, -1 = unused)
const char* pinWhy(int id, int gpio);  // why this GPIO cannot be used for this key (nullptr = fine)
float get(int id);
float saved(int id);
void save();
bool saveKey(int id);               // write just this one value to flash
void load();
void defaults();
Lut& lut();
bool setLut(float x0, float dx, const float* v, int n);
void clearLut();
}  // namespace cfg
