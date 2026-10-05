#include "procs.h"
#include <Arduino.h>
#include <math.h>
#include <string.h>
#include "actuator.h"
#include "camera.h"
#include "cfg.h"
#include "proto.h"
#include "pt.h"
#include "sensors.h"

namespace {

const char* const kM1Names[] = M1_STATE_NAMES;
int m1s = procs::M1_IDLE;

void setM1(int s, const char* extra) {
  m1s = s;
  if (extra && *extra) out::event("M1 %s %s", kM1Names[s], extra);
  else out::event("M1 %s", kM1Names[s]);
}

inline float clampf(float x, float lo, float hi) { return x < lo ? lo : x > hi ? hi : x; }
inline int sgnf(float x) { return x > 0 ? 1 : x < 0 ? -1 : 0; }

// why a measurement cannot be used (saturated ADC is reported separately: the fix is different)
const char* noLight(const Meas& m) { return m.sat ? "adc_saturated" : "no_light"; }

// one correction move toward the light (shared by mission 1 and the null seeker)
// returns true when the move deliberately overshoots (to finish from the ctl.appr side next time)
bool correct(const Meas& m, float err, float maxStep, float k) {
  float mv = clampf(k * err, -maxStep, maxStep);
  if (m.e.edge) mv = copysignf(fminf(maxStep, 30.0f), err);   // outside the accurate range: coarse move
  const int appr = cfg::i(CFG_CTL_APPR);
  const bool over = appr && sgnf(mv) == -appr && fabsf(err) < 5.0f;
  if (over) mv -= appr * 1.5f;  // overshoot, finish from +appr side
  act::moveRel(mv);
  return over;
}

void fault(const char* who, const char* why) { out::event("FAULT %s %s", who, why ? why : "?"); }

// ---------------------------------------------------------------- base
struct Proc {
  const char* name = "";
  int ptLine_ = 0;
  uint32_t ptUntil_ = 0;
  int slot = 0;
  Meas m;
  virtual bool run() = 0;   // true while still running
  virtual void onAbort() {}
  virtual ~Proc() {}
};

Proc* slots[2] = {nullptr, nullptr};

bool startIn(int slot, Proc* p) {
  if (slots[slot]) return false;
  p->ptLine_ = 0;
  p->slot = slot;
  slots[slot] = p;
  out::event("PROC %s START", p->name);
  return true;
}

void finish(int slot, const char* how) {
  Proc* p = slots[slot];
  if (!p) return;
  slots[slot] = nullptr;
  sensors::cancel(slot);
  out::event("PROC %s %s", p->name, how);
}

void abortSlot(int slot) {
  Proc* p = slots[slot];
  if (!p) return;
  p->onAbort();
  finish(slot, "ABORT");
}

#define MEAS(ms)                                         \
  do {                                                   \
    sensors::request(slot, sensors::windowsFor(ms));     \
    PT_WAIT_UNTIL(sensors::ready(slot));                 \
    m = sensors::result(slot);                           \
  } while (0)
#define WAIT_MOTION() PT_WAIT_UNTIL(!act::busy())

// ---------------------------------------------------------------- null seeker (sub-procedure)
struct NullSeek {
  int ptLine_ = 0;
  uint32_t ptUntil_ = 0;
  int slot = 0;
  float tol = 0.2f, k = 1, prevTh = 0, prevAng = 0;
  float nullAng = 0;  // result: actuator angle where the reading is zero (= the sun direction)
  int it = 0;
  bool havePrev = false, lastPlain = false;
  Meas m;
  bool ok = false;
  const char* err = nullptr;
  void start(float t, int s) {
    tol = t;
    slot = s;
    it = 0;
    k = cfg::f(CFG_CTL_K);
    havePrev = lastPlain = false;
    ok = false;
    err = nullptr;
    ptLine_ = 0;
  }
  bool run() {
    PT_BEGIN();
    for (it = 0; it < 25; it++) {
      PT_SLEEP(cfg::i(CFG_CTL_WAIT));
      MEAS(cfg::i(CFG_CTL_MEAS));
      if (!m.e.valid) {
        err = noLight(m);
        PT_EXIT();
      }
      if (fabs(m.e.theta) < tol) {
        nullAng = m.ang + (float)m.e.theta;
        ok = true;
        PT_EXIT();
      }
      // Two readings on both sides of the null, close together: the reading is linear there, so go straight to the
      // interpolated zero (like BACKLASH does). Waiting for a step to land inside +-tol can take forever before the
      // sensor calibration: the reading is ~1.6x the real angle, so +-0.1 is barely more than one 0.088 deg step,
      // and the ctl.appr overshoot throws the seeker back out every time it misses (SPR null_not_converged).
      if (havePrev && (m.e.theta > 0) != (prevTh > 0) && fabsf(m.ang - prevAng) <= 3.0f && fabsf(prevTh) < 5.0f &&
          fabs(m.e.theta) < 5.0) {
        nullAng = prevAng + (m.ang - prevAng) * prevTh / (prevTh - (float)m.e.theta);
        act::gotoDeg(nullAng);
        WAIT_MOTION();
        ok = true;
        PT_EXIT();
      }
      // The angle scale is not exact. When a plain correction jumped far over the null, halve the gain: otherwise
      // the ctl.appr overshoot and the over-correction can chase each other around the null.
      if (havePrev && lastPlain && (m.e.theta > 0) != (prevTh > 0)) k = fmaxf(0.1f, k * 0.5f);
      prevTh = (float)m.e.theta;
      prevAng = m.ang;
      havePrev = true;
      lastPlain = !correct(m, (float)m.e.theta, 30.0f, k);
      WAIT_MOTION();
    }
    err = "null_not_converged";
    PT_END();
  }
};

// ---------------------------------------------------------------- aux: RAW / AMB / BAL / TH0 / camera LOCK
struct RawProc : Proc {
  int ms = 200;
  bool run() override {
    PT_BEGIN();
    MEAS(ms);
    out::printf("J {\"type\":\"raw\",\"mv\":[%.1f,%.1f],\"G\":[%.6f,%.6f],\"D\":%.5f,\"S\":%.5f,\"th\":%.3f,\"valid\":%s,\"sat\":%s,\"edge\":%s,\"ang\":%.3f,\"th_sd\":%.4f,\"n\":%d}",
                (double)m.mvL, (double)m.mvR, m.GL, m.GR, m.e.D, m.e.S, m.e.theta, m.e.valid ? "true" : "false",
                m.sat ? "true" : "false", m.e.edge ? "true" : "false", (double)m.ang, (double)m.thSd, m.nWin);
    PT_END();
  }
} rawProc;

struct AmbProc : Proc {
  int ms = 500, k = 0;
  double prevL = -1, prevR = -1;
  bool run() override {
    PT_BEGIN();
    // CdS cells keep drifting for a while after the lamp goes off: wait until two 250 ms averages agree
    // (measuring right away overestimates the room light and skews the whole calibration)
    prevL = prevR = -1;
    for (k = 0; k < 16; k++) {
      MEAS(250);
      if (m.sat) {
        fault(name, "adc_saturated");
        PT_EXIT();
      }
      if (prevL > 0 && fabs(m.GL - prevL) <= 0.01 * prevL && fabs(m.GR - prevR) <= 0.01 * prevR) break;
      prevL = m.GL;
      prevR = m.GR;
    }
    if (k >= 16) out::event("WARN AMB still_drifting_after_4s");
    MEAS(ms);
    if (m.sat) {
      fault(name, "adc_saturated");
      PT_EXIT();
    }
    {
      const EstParams p = sensors::params();
      const float aL = (float)pow(m.GL, 1.0 / p.gamma);
      const float aR = (float)pow(m.GR, 1.0 / estGammaR(p));  // each LDR in its own power domain
      cfg::set(CFG_EST_AL, aL);
      cfg::set(CFG_EST_AR, aR);
      out::printf("J {\"type\":\"amb\",\"aL\":%.6g,\"aR\":%.6g,\"mv\":[%.1f,%.1f]}", (double)aL, (double)aR, (double)m.mvL, (double)m.mvR);
    }
    PT_END();
  }
} ambProc;

struct BalProc : Proc {
  int ms = 500;
  bool run() override {
    PT_BEGIN();
    WAIT_MOTION();
    PT_SLEEP(cfg::i(CFG_CTL_WAIT));
    MEAS(ms);
    if (m.sat) {
      fault(name, "adc_saturated");
      PT_EXIT();
    }
    {
      const EstParams p = sensors::params();
      const double eL = estChannel(m.GL, p.gamma, p.aL, p.qL);
      const double eR = estChannel(m.GR, estGammaR(p), p.aR, p.qR);
      if (eL <= 0 || eR <= 0) {
        fault(name, "too_dark");
        PT_EXIT();
      }
      cfg::set(CFG_EST_G, (float)(eR / eL));
      const Meas after = sensors::make(m.mvL, m.mvR, m.sat);
      out::printf("J {\"type\":\"bal\",\"g\":%.6g,\"S\":%.5f,\"suggest_minS\":%.4f}", eR / eL, after.e.S, after.e.S * 0.15);
    }
    PT_END();
  }
} balProc;

// CAL TH0 ref: an outside reference (sighting tube, protractor, camera centre) says the light is `ref` degrees
// from the satellite axis right now -> shift est.th0 so the estimator agrees. Fixes the absolute zero, which a
// sweep alone cannot know (sensor mounting, housing asymmetry, model error all look like a constant offset).
struct ZeroProc : Proc {
  float ref = 0;
  bool run() override {
    PT_BEGIN();
    WAIT_MOTION();
    PT_SLEEP(cfg::i(CFG_CTL_WAIT));
    MEAS(600);
    if (!m.e.valid || m.e.edge) {
      fault(name, m.e.edge ? "outside_accurate_range" : noLight(m));
      PT_EXIT();
    }
    {
      const float old = cfg::f(CFG_EST_TH0);
      const float nv = old + ref - (float)m.e.theta;
      if (cfg::set(CFG_EST_TH0, nv)) {
        fault(name, "th0_out_of_range");
        PT_EXIT();
      }
      // the zero is the most valuable number of the calibration: keep it even if the board resets before SAVE
      const bool saved = cfg::saveKey(CFG_EST_TH0);
      out::printf("J {\"type\":\"th0\",\"old\":%.3f,\"new\":%.3f,\"th_before\":%.3f,\"ref\":%.3f,\"saved\":%s}", (double)old,
                  (double)nv, m.e.theta, (double)ref, saved ? "true" : "false");
    }
    PT_END();
  }
} zeroProc;

struct LockProc : Proc {
  int k = 0;
  bool run() override {
    PT_BEGIN();
    if (!cam::ok()) {
      fault(name, "camera_not_ready");
      PT_EXIT();
    }
    cam::autoExposure(true);
    for (k = 0; k < 12; k++) {  // let auto exposure settle on live frames, then freeze it
      cam::grabDiscard();
      PT_SLEEP(100);
    }
    cam::autoExposure(false);
    out::line("J {\"type\":\"cam\",\"locked\":true,\"aec\":\"frozen\",\"agc\":\"frozen\"}");
    PT_END();
  }
} lockProc;

// ---------------------------------------------------------------- SWEEP
struct SweepProc : Proc {
  float a = -60, b = 60, step = 5, ang = 0;
  int dwell = 300, dir = 1, n = 0;
  char tag[12] = "cal";
  bool run() override {
    PT_BEGIN();
    dir = b >= a ? 1 : -1;
    step = fabsf(step) > 0.01f ? fabsf(step) : 5.0f;
    act::gotoDeg(a - dir * 3.0f);  // always approach the first point from the same side
    WAIT_MOTION();
    n = 0;
    for (ang = a; dir > 0 ? ang <= b + 1e-3f : ang >= b - 1e-3f; ang += dir * step) {
      act::gotoDeg(ang);
      WAIT_MOTION();
      PT_SLEEP(dwell);
      MEAS(max(dwell / 2, 2 * cfg::i(CFG_SEN_WIN)));
      n++;
      out::printf("J {\"type\":\"sweep_pt\",\"tag\":\"%s\",\"ang\":%.3f,\"mv\":[%.1f,%.1f],\"G\":[%.6f,%.6f],\"D\":%.5f,\"S\":%.5f,\"th\":%.3f,\"sat\":%s}",
                  tag, (double)m.ang, (double)m.mvL, (double)m.mvR, m.GL, m.GR, m.e.D, m.e.S, m.e.theta, m.sat ? "true" : "false");
    }
    out::printf("J {\"type\":\"sweep_end\",\"tag\":\"%s\",\"n\":%d}", tag, n);
    PT_END();
  }
} sweepProc;

// ---------------------------------------------------------------- MISSION 1: sun tracking
struct M1Proc : Proc {
  float tgt = 0, stepDeg = 0, preMove = 0, peak = 0, err = 0, trimSum = 0, trimMv = 0;
  float kEff = 1, prevErr = 0, sunAz = 0, noiseVar = -1, db = 0.3f;
  bool skipSearch = false, first = true, havePrev = false, lastPlain = false, haveSun = false, found = false;
  uint32_t t0 = 0;
  int iters = 0, nOK = 0, nSat = 0, nTrim = 0, measMs = 60, pass = 0, sdir = 1;

  // Noise of one averaged reading, from the window-to-window spread (smoothed over readings: one reading has only
  // a few windows). With ctl.adapt the reading averages longer (up to 400 ms) while that noise is above a third of
  // ctl.db, and the deadband widens to 2.5x the noise if even that is not enough, so a noisy board still locks
  // (Sonnet audit F04: 25 mV of ADC noise took 6-22 s to lock, or never with ctl.db 0.15). Quiet board: no change.
  void updateNoise(const Meas& r) {
    if (r.nWin < 2) return;
    const float v = r.thSd * r.thSd;
    noiseVar = noiseVar < 0 ? v : 0.8f * noiseVar + 0.2f * v;
  }
  float sdMean() const { return noiseVar > 0 ? sqrtf(noiseVar / (float)sensors::windowsFor(measMs)) : 0; }
  void adapt() {
    db = cfg::f(CFG_CTL_DB);
    if (!cfg::i(CFG_CTL_ADAPT)) {
      measMs = cfg::i(CFG_CTL_MEAS);
      return;
    }
    if (sdMean() > db / 3 && measMs < 400) measMs = measMs * 2 > 400 ? 400 : measMs * 2;
    if (2.5f * sdMean() > db) db = 2.5f * sdMean();
  }

  bool run() override {
    PT_BEGIN();
    if (preMove != 0) {
      act::moveRel(preMove);
      WAIT_MOTION();
    }
    t0 = millis();
    iters = 0;
    first = true;
    peak = 0;
    nTrim = 0;
    trimSum = 0;
    haveSun = false;
    noiseVar = -1;
    measMs = cfg::i(CFG_CTL_MEAS);
    db = cfg::f(CFG_CTL_DB);
    for (;;) {
      if (!(first && skipSearch)) {
        PT_SLEEP(cfg::i(CFG_CTL_WAIT));
        MEAS(cfg::i(CFG_CTL_MEAS));
        if (!m.e.valid) {
          // Light not usable here: turn continuously and stop at the first usable reading, first toward where the
          // light was last seen (else the side with more room), then the whole range the other way. The old
          // stop-wait-measure scan every m1.sstep took 20-29 s when the lamp started behind the satellite.
          setM1(procs::M1_SEARCH, m.sat ? "adc_saturated" : nullptr);
          nSat = 0;
          found = false;
          if (haveSun) sdir = sunAz >= act::angleDeg() ? 1 : -1;
          else sdir = cfg::f(CFG_M1_SMAX) - act::angleDeg() >= act::angleDeg() - cfg::f(CFG_M1_SMIN) ? 1 : -1;
          for (pass = 0; pass < 2 && !found; pass++) {
            act::gotoDeg(sdir > 0 ? cfg::f(CFG_M1_SMAX) : cfg::f(CFG_M1_SMIN));
            while (!found && act::busy()) {
              MEAS(2 * cfg::i(CFG_SEN_WIN));
              // the light angle wraps around, the actuator does not: a lamp behind the far end of the travel shows
              // up "through the back" at an angle M1 could never reach (it would sit at act.max), so keep turning
              if (m.sat) nSat++;
              else if (m.e.valid && act::reachable(m.ang + (float)m.e.theta - tgt)) found = true;
            }
            sdir = -sdir;
          }
          act::stop();
          WAIT_MOTION();
          if (!found) {
            setM1(procs::M1_LOST, nSat ? "adc_saturated" : "no_light");
            PT_SLEEP(1000);
            continue;
          }
        }
      }
      first = false;
      setM1(procs::M1_FINE, nullptr);
      nOK = 0;
      kEff = cfg::f(CFG_CTL_K);
      havePrev = lastPlain = false;
      measMs = cfg::i(CFG_CTL_MEAS);
      for (;;) {  // measure -> correct -> wait, until locked; keep watching while locked
        PT_SLEEP(cfg::i(CFG_CTL_WAIT));
        MEAS(measMs);
        if (!m.e.valid) {  // clipped ADC is never "on target": both channels equal only because they are full
          setM1(procs::M1_LOST, m.sat ? "adc_saturated" : "lost");
          break;
        }
        updateNoise(m);
        adapt();
        err = (float)m.e.theta - tgt;
        sunAz = m.ang + (float)m.e.theta;  // where the light is in actuator angles: SEARCH turns there first
        haveSun = true;
        if (stepDeg != 0 && fabsf(err) > peak) peak = fabsf(err);
        if (m1s == procs::M1_HOLD) {
          if (fabsf(err) > cfg::f(CFG_CTL_HYS)) {
            setM1(procs::M1_FINE, "reacquire");
            nOK = 0;
            kEff = cfg::f(CFG_CTL_K);
            havePrev = false;
          } else {
            // locked: one reading past the deadband is noise, but an offset that stays for ctl.trim readings in a
            // row (lamp nudged, cable pulling the body inside the gear play) is corrected without leaving HOLD
            if (fabsf(err) > db && cfg::i(CFG_CTL_TRIM) > 0) {
              trimSum += err;
              if (++nTrim >= cfg::i(CFG_CTL_TRIM)) {
                trimMv = cfg::f(CFG_CTL_K) * trimSum / nTrim;  // averaged: the noise is mostly gone
                out::event("M1TRIM err=%.3f move=%.3f", (double)(trimSum / nTrim), (double)trimMv);
                nTrim = 0;
                trimSum = 0;
                act::moveRel(trimMv);
                WAIT_MOTION();
              }
            } else {
              nTrim = 0;
              trimSum = 0;
            }
            continue;
          }
        }
        if (fabsf(err) <= db && !m.e.edge) {
          if (++nOK >= cfg::i(CFG_CTL_NLOCK)) {
            char b[80];
            snprintf(b, sizeof(b), "t=%lu it=%d err=%.3f sd=%.3f", (unsigned long)(millis() - t0), iters, (double)err,
                     (double)sdMean());
            nTrim = 0;
            trimSum = 0;
            setM1(procs::M1_HOLD, b);
            if (stepDeg != 0) {
              out::printf("J {\"type\":\"step_result\",\"deg\":%.3f,\"t_lock_ms\":%lu,\"iters\":%d,\"peak_err\":%.3f,\"final_err\":%.3f}",
                          (double)stepDeg, (unsigned long)(millis() - t0), iters, (double)peak, (double)err);
              stepDeg = 0;
            }
          }
          continue;
        }
        nOK = 0;
        iters++;
        // a plain correction that jumped over the target means the reading's scale is too large (no calibration
        // yet, a very different lamp): halve the gain so M1 settles instead of chasing its tail (as the null seeker)
        if (havePrev && lastPlain && (err > 0) != (prevErr > 0)) kEff = fmaxf(0.2f, kEff * 0.5f);
        prevErr = err;
        havePrev = true;
        lastPlain = !correct(m, err, cfg::f(CFG_CTL_MAXSTEP), kEff);
        WAIT_MOTION();
      }
      PT_SLEEP(1000);
    }
    PT_END();
  }
} m1Proc;

// ---------------------------------------------------------------- BACKLASH measurement
struct BacklashProc : Proc {
  float center = 0, from = 0, to = 0, st = 0, a = 0, prevAng = 0, prevTh = 0, cross = NAN, fwd = NAN, bwd = NAN;
  bool havePrev = false;
  int pass = 0;
  void onAbort() override { act::backlashOverride(false); }
  bool run() override {
    PT_BEGIN();
    act::backlashOverride(true);
    center = act::angleDeg();
    for (pass = 0; pass < 2; pass++) {
      from = pass == 0 ? center - 5 : center + 5;
      to = pass == 0 ? center + 5 : center - 5;
      st = pass == 0 ? 0.25f : -0.25f;
      act::gotoDeg(from);
      WAIT_MOTION();
      havePrev = false;
      cross = NAN;
      for (a = from; st > 0 ? a <= to + 1e-3f : a >= to - 1e-3f; a += st) {
        act::gotoDeg(a);
        WAIT_MOTION();
        PT_SLEEP(cfg::i(CFG_CTL_WAIT));
        MEAS(cfg::i(CFG_CTL_MEAS));
        if (!m.e.valid) {
          act::backlashOverride(false);
          fault(name, noLight(m));
          PT_EXIT();
        }
        if (havePrev && (prevTh > 0) != (m.e.theta > 0)) {
          cross = prevAng + (m.ang - prevAng) * prevTh / (prevTh - (float)m.e.theta);
          break;
        }
        prevAng = m.ang;
        prevTh = (float)m.e.theta;
        havePrev = true;
      }
      if (pass == 0) fwd = cross;
      else bwd = cross;
    }
    act::backlashOverride(false);
    if (isnan(fwd) || isnan(bwd)) {
      fault(name, "no_zero_crossing_within_5deg_face_the_lamp_first");
      PT_EXIT();
    }
    out::printf("J {\"type\":\"backlash\",\"deg\":%.3f,\"fwd\":%.3f,\"bwd\":%.3f}", (double)(fwd - bwd), (double)fwd, (double)bwd);
    act::gotoDeg(center);
    WAIT_MOTION();
    PT_END();
  }
} backlashProc;

// ---------------------------------------------------------------- SPR: steps per revolution
struct SprProc : Proc {
  NullSeek seek;
  int32_t s1 = 0;
  bool run() override {
    PT_BEGIN();
    if (act::type() != 1) {
      fault(name, "stepper_only");
      PT_EXIT();
    }
    if (cfg::f(CFG_ACT_MAX) - act::angleDeg() < 365) {
      fault(name, "need_360deg_free_rotation_raise_act.max");
      PT_EXIT();
    }
    // without backlash compensation the two nulls can sit on different sides of the gear play (count off by
    // up to act.bl worth of steps): BACKLASH -> SET act.bl first
    if (cfg::f(CFG_ACT_BL) <= 0) out::event("WARN SPR act.bl_is_0_run_BACKLASH_and_set_act.bl_first");
    seek.start(0.1f, slot);
    PT_WAIT_UNTIL(!seek.run());
    if (!seek.ok) {
      fault(name, seek.err);
      PT_EXIT();
    }
    s1 = act::steps();
    act::moveRel(360);
    WAIT_MOTION();
    seek.start(0.1f, slot);
    PT_WAIT_UNTIL(!seek.run());
    if (!seek.ok) {
      fault(name, seek.err);
      PT_EXIT();
    }
    out::printf("J {\"type\":\"spr\",\"steps\":%ld,\"cfg\":%.2f}", (long)(act::steps() - s1), (double)cfg::f(CFG_ACT_SPR));
    PT_END();
  }
} sprProc;

// ---------------------------------------------------------------- MISSION 2: point + photo
// mode 0 = photo where we are (aux slot: allowed while mission 1 holds, e.g. for the boresight check)
// mode 1 = point the camera to an actuator angle, mode 2 = to (sun direction + offset)
// A mission photo is only taken when the pointing is reachable and within m2.tol; otherwise snap_fail.
struct SnapProc : Proc {
  NullSeek seek;
  int mode = 0;
  float value = 0, target = 0, sunAz = 0, aim = 0, errCmd = 0;
  bool hasSun = false;
  uint32_t settleEnd = 0;
  void failSnap(const char* why) {
    out::printf("J {\"type\":\"snap_fail\",\"reason\":\"%s\",\"tgt\":%.3f,\"aim\":%.3f,\"ang\":%.3f,\"min\":%.1f,\"max\":%.1f,\"tol\":%.3f,\"err_cmd\":%.3f}",
                why, (double)target, (double)aim, (double)act::angleDeg(), (double)cfg::f(CFG_ACT_MIN),
                (double)cfg::f(CFG_ACT_MAX), (double)cfg::f(CFG_M2_TOL), (double)errCmd);
    fault(name, why);
  }
  bool run() override {
    PT_BEGIN();
    if (!cam::ok()) {
      fault(name, "camera_not_ready");
      PT_EXIT();
    }
    hasSun = false;
    target = value;
    aim = 0;
    errCmd = 0;
    if (mode == 2) {  // reference = the sun: immune to a shifted actuator zero
      seek.start(fmaxf(0.1f, cfg::f(CFG_CTL_DB)), slot);
      PT_WAIT_UNTIL(!seek.run());
      if (!seek.ok) {
        fault(name, seek.err);
        PT_EXIT();
      }
      sunAz = seek.nullAng;
      hasSun = true;
      target = sunAz + value;
      out::printf("J {\"type\":\"sun_ref\",\"sun_az\":%.3f,\"offset\":%.3f}", (double)sunAz, (double)value);
    }
    if (mode >= 1) {
      aim = target - cfg::f(CFG_CAM_OFF);
      if (!act::reachable(aim)) {
        failSnap("target_out_of_range");
        PT_EXIT();
      }
      // arrive turning the ctl.appr way, like mission 1 and the tool's scan: gear play that act.bl does not cancel
      // exactly then shifts every photo the same way, so a spot clicked in one photo is hit again by the next
      // (no local variables here: a protothread wait cannot jump over them)
      if (cfg::i(CFG_CTL_APPR) && (aim - act::angleDeg()) * cfg::i(CFG_CTL_APPR) < 0.05f &&
          act::reachable(aim - cfg::i(CFG_CTL_APPR) * 2.0f)) {
        act::gotoDeg(aim - cfg::i(CFG_CTL_APPR) * 2.0f);
        WAIT_MOTION();
      }
      act::gotoDeg(aim);
      WAIT_MOTION();
      errCmd = act::angleDeg() + cfg::f(CFG_CAM_OFF) - target;
      if (fabsf(errCmd) > cfg::f(CFG_M2_TOL)) {
        failSnap("not_in_tol");
        PT_EXIT();
      }
    }
    WAIT_MOTION();
    settleEnd = millis() + (uint32_t)cfg::i(CFG_M2_SETTLE);
    while ((int32_t)(millis() - settleEnd) < 0) {  // keep frames flowing so auto exposure adapts to this view
      if (!cam::locked()) cam::grabDiscard();
      PT_SLEEP(30);
    }
    {
      ImgMeta im;
      im.ang = act::angleDeg();
      im.camAzCmd = im.ang + cfg::f(CFG_CAM_OFF);
      im.th = sensors::hasLatest() && sensors::latest().e.valid ? (float)sensors::latest().e.theta : NAN;
      im.hasTgt = mode >= 1;
      im.tgt = target;
      im.errCmd = im.camAzCmd - target;
      im.tol = cfg::f(CFG_M2_TOL);
      im.hasSun = hasSun;
      im.sunAz = sunAz;
      im.offset = value;
      im.ref = mode == 2 ? "sun" : mode == 1 ? "actuator" : "none";
      im.m1 = kM1Names[m1s];
      im.moving = act::busy();
      const char* e = nullptr;
      if (!cam::capture(im, e)) fault(name, e);
    }
    PT_END();
  }
} snapProc, snapHereProc;

}  // namespace

namespace procs {

int m1State() { return m1s; }
const char* m1Name(int s) { return kM1Names[s < 0 || s > 4 ? 0 : s]; }
void setM1Idle(const char* why) { setM1(M1_IDLE, why); }

void update() {
  for (int s = 0; s < 2; s++)
    if (slots[s] && !slots[s]->run()) finish(s, "END");
}

void stopAll() {
  abortSlot(0);
  abortSlot(1);
  act::stop();
  if (m1s != M1_IDLE) setM1(M1_IDLE, "stopped");
}

const char* motionName() { return slots[0] ? slots[0]->name : nullptr; }
const char* auxName() { return slots[1] ? slots[1]->name : nullptr; }

bool raw(int ms) { rawProc.name = "RAW"; rawProc.ms = ms; return startIn(1, &rawProc); }
bool amb(int ms) { ambProc.name = "AMB"; ambProc.ms = ms; return startIn(1, &ambProc); }
bool bal(int ms) { balProc.name = "BAL"; balProc.ms = ms; return startIn(1, &balProc); }
bool camLock() { lockProc.name = "LOCK"; return startIn(1, &lockProc); }
bool zeroTh0(float ref) { zeroProc.name = "TH0"; zeroProc.ref = ref; return startIn(1, &zeroProc); }

bool sweep(float a, float b, float step, int dwellMs, const char* tag) {
  if (slots[0]) return false;
  sweepProc.name = "SWEEP";
  sweepProc.a = a;
  sweepProc.b = b;
  sweepProc.step = step;
  sweepProc.dwell = dwellMs;
  strncpy(sweepProc.tag, tag && *tag ? tag : "cal", sizeof(sweepProc.tag) - 1);
  sweepProc.tag[sizeof(sweepProc.tag) - 1] = '\0';
  return startIn(0, &sweepProc);
}

bool m1Start(float tgt) {
  abortSlot(0);
  m1Proc.name = "M1";
  m1Proc.tgt = tgt;
  m1Proc.skipSearch = false;
  m1Proc.stepDeg = 0;
  m1Proc.preMove = 0;
  setM1(M1_FINE, "start");
  return startIn(0, &m1Proc);
}

void m1Stop() {
  if (slots[0] == &m1Proc) abortSlot(0);
  act::stop();
  setM1(M1_IDLE, "stopped");
}

bool stepTest(float deg) {
  if (slots[0] != &m1Proc || m1s != M1_HOLD) return false;
  abortSlot(0);
  m1Proc.skipSearch = true;
  m1Proc.stepDeg = deg;
  m1Proc.preMove = deg;
  return startIn(0, &m1Proc);
}

bool backlash() { backlashProc.name = "BACKLASH"; return startIn(0, &backlashProc); }
bool spr() { sprProc.name = "SPR"; return startIn(0, &sprProc); }

bool snap(int mode, float value) {
  if (mode == 0) {
    snapHereProc.name = "SNAP";
    snapHereProc.mode = 0;
    snapHereProc.value = 0;
    return startIn(1, &snapHereProc);
  }
  if (slots[0] == &m1Proc) {  // mission 2 takes over from mission 1 (no separate STOP needed)
    abortSlot(0);
    act::stop();
    setM1(M1_IDLE, "m2_takeover");
  }
  snapProc.name = "SNAP";
  snapProc.mode = mode;
  snapProc.value = value;
  return startIn(0, &snapProc);
}

}  // namespace procs
