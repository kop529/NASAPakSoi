#include "commands.h"
#include <Arduino.h>
#include <ctype.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>
#include "actuator.h"
#include "camera.h"
#include "cfg.h"
#include "diag.h"
#include "ops.h"
#include "procs.h"
#include "proto.h"
#include "sensors.h"

namespace {
bool streamOn = true;

bool ieq(const char* a, const char* b) {
  if (!a || !b) return false;
  while (*a && *b) {
    if (toupper((unsigned char)*a) != toupper((unsigned char)*b)) return false;
    a++;
    b++;
  }
  return *a == *b;
}

bool isNum(const char* s) {
  if (!s || !*s) return false;
  char* end = nullptr;
  strtod(s, &end);
  return end && *end == '\0';
}
float num(const char* s, float d) { return isNum(s) ? strtof(s, nullptr) : d; }

bool motionBusy(int id) {
  const char* n = procs::motionName();
  if (!n) return false;
  out::err(id, "BUSY", "%s", n);
  return true;
}

void afterSet(const char* key) {
  if (strncmp(key, "act.", 4) == 0) act::applyConfig();
  if (strncmp(key, "sen.", 4) == 0) sensors::applyConfig();
  if (strncmp(key, "hw.", 3) == 0 || strncmp(key, "com.", 4) == 0) ops::applyConfig();
}

// two keys on one GPIO is allowed (you may be moving a wire), but say so: it is usually a typo
void warnSharedPin(int k) {
  if (!cfg::isPin(k)) return;
  const int g = (int)lroundf(cfg::get(k));
  if (g < 0) return;
  for (int j = 0; j < CFG_COUNT; j++)
    if (j != k && cfg::isPin(j) && (int)lroundf(cfg::get(j)) == g)
      out::event("WARN PIN GPIO%d %s %s", g, cfg::def(k).key, cfg::def(j).key);
  int cp[20];
  const int n = cam::pinsInUse(cp, 20);
  for (int j = 0; j < n; j++)
    if (cp[j] == g) out::event("WARN PIN GPIO%d %s camera", g, cfg::def(k).key);
}

void cfgList(int id) {
  out::put("J {\"type\":\"cfg\",\"items\":[");
  for (int k = 0; k < CFG_COUNT; k++) {
    const CfgDef& d = cfg::def(k);
    out::put(k ? ",{\"k\":" : "{\"k\":");
    out::putStr(d.key);
    out::putf(",\"t\":\"%c\",\"v\":", d.type);
    out::putNum(cfg::get(k));
    out::put(",\"d\":");
    out::putNum(d.def);
    out::put(",\"min\":");
    out::putNum(d.min);
    out::put(",\"max\":");
    out::putNum(d.max);
    out::put(",\"step\":");
    out::putNum(d.step);
    out::put(",\"u\":");
    out::putStr(d.unit);
    out::put(",\"g\":");
    out::putStr(d.group);
    out::put(",\"desc\":");
    out::putStr(d.desc);
    out::put(",\"sv\":");
    out::putNum(cfg::saved(k));
    out::put("}");
  }
  out::put("]}");
  out::end();
  out::ok(id, "%d", (int)CFG_COUNT);
}

void calGet(int id) {
  const Lut& l = cfg::lut();
  out::put("J {\"type\":\"cal\",\"lut\":");
  if (l.n) {
    out::putf("{\"x0\":%g,\"dx\":%g,\"v\":[", (double)l.x0, (double)l.dx);
    for (int k = 0; k < l.n; k++) out::putf(k ? ",%.3f" : "%.3f", (double)l.v[k]);
    out::put("]}");
  } else {
    out::put("null");
  }
  const EstParams p = sensors::params();
  out::putf(",\"est\":{\"gamma\":%g,\"gammaR\":%g,\"qL\":%g,\"qR\":%g,\"alpha\":%g,\"g\":%g,\"aL\":%g,\"aR\":%g,\"th0\":%g,\"lutOn\":%d,\"minS\":%g,\"dmax\":%g,\"vcc\":%g,\"topo\":%d}}",
            p.gamma, p.gammaR, p.qL, p.qR, p.alpha, p.g, p.aL, p.aR, p.th0, p.lutOn, p.minS, p.dmax, p.vcc, p.topo);
  out::end();
  out::ok(id);
}

// "CAL LUT x0 dx v0,v1,..." ; returns nullptr or an error text
const char* calLut(const char* x0s, const char* dxs, const char* list) {
  static float v[LUT_MAX];
  if (!isNum(x0s) || !isNum(dxs) || !(strtof(dxs, nullptr) > 0)) return "x0_dx";
  int n = 0;
  for (const char* p = list; *p;) {
    if (n >= LUT_MAX) return "too_many_values_max_" LUT_MAX_STR;
    char* end = nullptr;
    const float f = strtof(p, &end);
    if (end == p || !isfinite(f) || (*end && *end != ',')) return "bad_number";
    v[n++] = f;
    p = *end ? end + 1 : end;
  }
  if (!n || !cfg::setLut(strtof(x0s, nullptr), strtof(dxs, nullptr), v, n)) return "empty";
  return nullptr;
}

void help(int id) {
  out::line("# HELLO HELP CFG LIST | GET k | SET k v | SAVE [k ..] | LOAD | DEFAULTS | STREAM ON [hz] | STREAM OFF");
  out::line("# RAW [ms] | AMB [ms] | BAL [ms] | SWEEP a b step [dwell] [tag] | MOVE d | GOTO a | ZERO | RELEASE | STOP");
  out::line("# M1 START [tgt] | M1 STOP | STEP d | BACKLASH | SPR");
  out::line("# M2 INIT | M2 LOCK | M2 UNLOCK | M2 MANUAL | M2 SNAP | M2 GO [tgt] | M2 GO SUN offset");
  out::line("# CAL LUT x0 dx v0,v1,.. | CAL TH0 [ref] | CAL CLR | CAL GET | HWID [I2C] | PINFIND ON|OFF | DIAG | REBOOT | IMG GET id seq,seq");
  out::line("# no laptop: m1.auto (start M1 N s after power-on), hw.btn (button starts/stops M1), com.tx/com.rx (second port)");
  out::ok(id);
}
}  // namespace

namespace cmd {

bool streaming() { return streamOn; }

void hello() {
  out::putf("J {\"type\":\"hello\",\"fw\":\"%s\",\"ver\":\"%s\",\"board\":\"%s", FW_NAME, FW_VERSION, ESP.getChipModel());
  if (ESP.getPsramSize()) out::putf(" + PSRAM %luMB", (unsigned long)(ESP.getPsramSize() / (1024UL * 1024UL)));
  out::put("\",\"proto\":1,\"caps\":[\"stepper\"");
#if ENABLE_SERVO
  out::put(",\"servo\"");
#endif
  out::put(",\"m1\",\"m2\",\"sweep\",\"pinfind\",\"lut\",\"hk\",\"auto\",\"btn\"");
#if ENABLE_LINK
  out::put(",\"link\"");
#endif
  if (cam::ok()) out::put(",\"cam\"");
  out::put("]}");
  out::end();
}

void handle(char* line) {
  // optional "@id " prefix
  int id = -1;
  char* p = line;
  // skip spaces and any non-ASCII garbage (boot noise, a BOM from a terminal) in front of the command
  while (*p && ((unsigned char)*p <= ' ' || (unsigned char)*p > '~')) p++;
  if (*p == '@') {
    id = atoi(p + 1);
    p = strchr(p, ' ');
    if (!p) return;
  }
  // split into tokens (in place)
  char* t[12];
  int nt = 0;
  while (*p && nt < 12) {
    while (*p == ' ') *p++ = '\0';
    if (!*p) break;
    t[nt++] = p;
    while (*p && *p != ' ') p++;
  }
  if (!nt) return;
  const char* c = t[0];
  const char* a1 = nt > 1 ? t[1] : nullptr;
  const char* a2 = nt > 2 ? t[2] : nullptr;

  if (ieq(c, "HELLO")) { hello(); out::ok(id); return; }
  if (ieq(c, "HELP")) { help(id); return; }

  if (ieq(c, "CFG")) {
    if (ieq(a1, "LIST")) cfgList(id);
    else out::err(id, "ARG", "CFG LIST");
    return;
  }
  if (ieq(c, "GET")) {
    const int k = a1 ? cfg::find(a1) : -1;
    if (k < 0) { out::err(id, "KEY", "%s", a1 ? a1 : ""); return; }
    out::ok(id, "%s=%.7g", a1, (double)cfg::get(k));
    return;
  }
  if (ieq(c, "SET")) {
    const int k = a1 ? cfg::find(a1) : -1;
    if (k < 0) { out::err(id, "KEY", "%s", a1 ? a1 : ""); return; }
    if (!isNum(a2)) { out::err(id, "VAL", "%s", a2 ? a2 : ""); return; }
    const float v = strtof(a2, nullptr);
    const char* e = cfg::set(k, v);
    if (e && strcmp(e, "PIN") == 0) {
      out::err(id, e, "%s=%d %s", a1, (int)lroundf(v), cfg::pinWhy(k, (int)lroundf(v)));
      return;
    }
    if (e) {
      out::err(id, e, "%s %g..%g", a1, (double)cfg::def(k).min, (double)cfg::def(k).max);
      return;
    }
    afterSet(a1);
    warnSharedPin(k);
    out::ok(id, "%s=%.7g", a1, (double)cfg::get(k));
    return;
  }
  if (ieq(c, "SAVE")) {
    if (nt == 1) { cfg::save(); out::ok(id, "saved"); return; }
    // "SAVE k1 k2": only these keys (the tool keeps a measured value without saving half-finished experiments)
    for (int k = 1; k < nt; k++)
      if (cfg::find(t[k]) < 0) { out::err(id, "KEY", "%s", t[k]); return; }
    for (int k = 1; k < nt; k++)
      if (!cfg::saveKey(cfg::find(t[k]))) { out::err(id, "NVS", "%s", t[k]); return; }
    out::ok(id, "saved %d", nt - 1);
    return;
  }
  if (ieq(c, "LOAD") || ieq(c, "DEFAULTS")) {
    if (ieq(c, "LOAD")) cfg::load(); else cfg::defaults();
    act::applyConfig();
    sensors::applyConfig();
    ops::applyConfig();
    out::ok(id, ieq(c, "LOAD") ? "loaded" : "defaults (not saved)");
    return;
  }
  if (ieq(c, "STREAM")) {
    if (ieq(a1, "ON") && isNum(a2) && cfg::set(CFG_COM_HZ, num(a2, 20))) { out::err(id, "RANGE", "com.hz 0..100"); return; }
    streamOn = ieq(a1, "ON");
    if (streamOn) out::line("TH," TEL_COLS);
    out::ok(id, streamOn ? "on" : "off");
    return;
  }

  // ---- measurement (aux slot)
  if (ieq(c, "RAW") || ieq(c, "AMB") || ieq(c, "BAL")) {
    const int ms = (int)num(a1, ieq(c, "RAW") ? 200 : 500);
    const bool okStart = ieq(c, "RAW") ? procs::raw(ms) : ieq(c, "AMB") ? procs::amb(ms) : procs::bal(ms);
    if (okStart) out::ok(id);
    else out::err(id, "BUSY", "%s", procs::auxName() ? procs::auxName() : "aux");
    return;
  }

  // ---- motion
  if (ieq(c, "STOP")) { ops::cancelAuto(); procs::stopAll(); out::ok(id, "stopped"); return; }
  if (ieq(c, "SWEEP")) {
    if (nt < 4) { out::err(id, "ARG", "SWEEP a b step [dwell] [tag]"); return; }
    if (motionBusy(id)) return;
    procs::sweep(num(t[1], -60), num(t[2], 60), num(t[3], 5), (int)num(nt > 4 ? t[4] : nullptr, 300), nt > 5 ? t[5] : "cal");
    out::ok(id, "started");
    return;
  }
  if (ieq(c, "MOVE") || ieq(c, "GOTO")) {
    if (motionBusy(id)) return;
    if (!isNum(a1)) { out::err(id, "ARG", "%s deg", c); return; }
    if (ieq(c, "MOVE")) act::moveRel(num(a1, 0)); else act::gotoDeg(num(a1, 0));
    out::ok(id);
    return;
  }
  if (ieq(c, "ZERO")) {
    if (motionBusy(id)) return;
    if (act::busy()) { out::err(id, "BUSY", "moving"); return; }
    act::zero();
    out::ok(id, "zeroed");
    return;
  }
  if (ieq(c, "RELEASE")) { act::release(); out::ok(id); return; }
  if (ieq(c, "M1")) {
    if (ieq(a1, "START")) {
      if (isNum(a2) && cfg::set(CFG_M1_TGT, num(a2, 0))) {  // never run with an old target silently
        out::err(id, "RANGE", "m1.tgt %g..%g", (double)cfg::def(CFG_M1_TGT).min, (double)cfg::def(CFG_M1_TGT).max);
        return;
      }
      procs::m1Start(cfg::f(CFG_M1_TGT));
      out::ok(id, "started");
    } else if (ieq(a1, "STOP")) {
      procs::m1Stop();
      out::ok(id);
    } else {
      out::err(id, "ARG", "M1 START|STOP");
    }
    return;
  }
  if (ieq(c, "STEP")) {
    if (procs::stepTest(num(a1, 10))) out::ok(id, "started");
    else out::err(id, "STATE", "M1 must be HOLD");
    return;
  }
  if (ieq(c, "BACKLASH") || ieq(c, "SPR")) {
    if (motionBusy(id)) return;
    if (ieq(c, "BACKLASH")) procs::backlash(); else procs::spr();
    out::ok(id, "started");
    return;
  }

  // ---- mission 2
  if (ieq(c, "M2")) {
    if (ieq(a1, "INIT")) {
      const bool okCam = cam::begin();
      ops::applyConfig();  // the camera may now own the button's pin (ESP32-CAM: GPIO0)
      if (okCam) out::ok(id, "%s", cam::status());
      else out::err(id, "CAM", "%s", cam::status());
    } else if (ieq(a1, "LOCK")) {
      if (!cam::ok()) out::err(id, "CAM", "%s", cam::status());
      else if (procs::camLock()) out::ok(id, "locking");
      else out::err(id, "BUSY", "aux");
    } else if (ieq(a1, "UNLOCK")) {
      cam::autoExposure(true);
      out::line("J {\"type\":\"cam\",\"locked\":false}");
      out::ok(id);
    } else if (ieq(a1, "MANUAL")) {
      if (cam::manualExposure(cfg::i(CFG_CAM_AEC), cfg::i(CFG_CAM_AGC))) {
        out::printf("J {\"type\":\"cam\",\"locked\":true,\"aec\":%d,\"agc\":%d}", cfg::i(CFG_CAM_AEC), cfg::i(CFG_CAM_AGC));
        out::ok(id);
      } else {
        out::err(id, "CAM", "%s", cam::status());
      }
    } else if (ieq(a1, "SNAP") || ieq(a1, "GO")) {
      if (!cam::ok()) { out::err(id, "CAM", "%s", cam::status()); return; }
      bool started = false;
      if (ieq(a1, "SNAP")) {
        started = procs::snap(0, 0);
        if (!started) { out::err(id, "BUSY", "%s", procs::auxName() ? procs::auxName() : "aux"); return; }
      } else {
        if (ieq(a2, "SUN")) {
          if (!isNum(nt > 3 ? t[3] : nullptr)) { out::err(id, "ARG", "M2 GO SUN offset_deg"); return; }
          started = procs::snap(2, num(t[3], 0));
        } else {
          if (isNum(a2) && cfg::set(CFG_M2_TGT, num(a2, 0))) {
            out::err(id, "RANGE", "m2.tgt %g..%g", (double)cfg::def(CFG_M2_TGT).min, (double)cfg::def(CFG_M2_TGT).max);
            return;
          }
          started = procs::snap(1, cfg::f(CFG_M2_TGT));
        }
        if (!started) { out::err(id, "BUSY", "%s", procs::motionName() ? procs::motionName() : "motion"); return; }
      }
      out::ok(id, "started");
    } else {
      out::err(id, "ARG", "M2 INIT|LOCK|UNLOCK|MANUAL|SNAP|GO [tgt]|GO SUN offset");
    }
    return;
  }

  // ---- calibration table
  if (ieq(c, "CAL")) {
    if (ieq(a1, "LUT")) {
      const char* e = nt < 5 ? "usage" : calLut(t[2], t[3], t[4]);
      if (e) { out::err(id, "ARG", "CAL LUT x0 dx v0,v1,... (%s)", e); return; }
      out::ok(id, "lut n=%d", (int)cfg::lut().n);
    } else if (ieq(a1, "TH0")) {
      if (a2 && !isNum(a2)) { out::err(id, "ARG", "CAL TH0 [ref_deg]"); return; }
      if (procs::zeroTh0(num(a2, 0))) out::ok(id, "measuring");
      else out::err(id, "BUSY", "%s", procs::auxName() ? procs::auxName() : "aux");
    } else if (ieq(a1, "CLR")) {
      cfg::clearLut();
      out::ok(id);
    } else if (ieq(a1, "GET")) {
      calGet(id);
    } else {
      out::err(id, "ARG", "CAL LUT|TH0|CLR|GET");
    }
    return;
  }

  // ---- system
  if (ieq(c, "HWID")) { diag::hwid(ieq(a1, "I2C")); out::ok(id); return; }
  if (ieq(c, "PINFIND")) { diag::setPinfind(!ieq(a1, "OFF")); out::ok(id, diag::pinfind() ? "on" : "off"); return; }
  if (ieq(c, "DIAG")) { diag::report(); out::ok(id); return; }
  if (ieq(c, "REBOOT")) {
    out::ok(id, "rebooting");
    Serial.flush();
    delay(100);
    ESP.restart();
    return;
  }
  if (ieq(c, "IMG")) {
    if (ieq(a1, "GET") && a2 && nt > 3 && cam::resend(a2, t[3])) out::ok(id);
    else out::err(id, "IMG", "not_cached");
    return;
  }
  out::err(id, "CMD", "%s", c);
}

}  // namespace cmd
