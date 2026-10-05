#include "app.h"
#include <Arduino.h>
#include "actuator.h"
#include "camera.h"
#include "cfg.h"
#include "commands.h"
#include "diag.h"
#include "features.h"
#include "ops.h"
#include "procs.h"
#include "proto.h"
#include "sensors.h"

namespace {
LineReader reader;      // USB (or the board's UART to the laptop)
LineReader linkReader;  // second port, when com.tx is set
uint32_t nextTel = 0, nextLinkTel = 0;

void telemetry() {
  if (!cmd::streaming() || !sensors::hasLatest()) return;
  const int hz = cfg::i(CFG_COM_HZ);
  if (hz <= 0 || (int32_t)(millis() - nextTel) < 0) return;
  nextTel = millis() + 1000 / hz;
  // a radio on the second port gets the rows at its own, slower rate (com.lhz)
  uint8_t where = out::TO_USB;
  const int lhz = cfg::i(CFG_COM_LHZ);
  if (out::linkOn() && lhz > 0 && (int32_t)(millis() - nextLinkTel) >= 0) {
    nextLinkTel = millis() + 1000 / lhz;
    where |= out::TO_LINK;
  }
  if (!Serial) where &= (uint8_t)~out::TO_USB;  // no USB host listening
  if (!where) return;
  const Meas& m = sensors::latest();
  int fl = 0;
  if (m.e.valid) fl |= 1;
  if (act::busy()) fl |= 2;
  if (m.sat) fl |= 4;
  if (m.e.edge) fl |= 8;
  if (procs::motionName() || procs::auxName()) fl |= 16;
  if (cam::locked()) fl |= 32;
  out::to(where);
  out::printf("T,%lu,%d,%.3f,%.3f,%.3f,%.5f,%.4f,%.1f,%.1f,%d,%d", (unsigned long)millis(), procs::m1State(),
              (double)act::angleDeg(), m.e.theta, m.e.theta - cfg::f(CFG_M1_TGT), m.e.D, m.e.S, (double)m.mvL,
              (double)m.mvR, act::energized() ? 1 : 0, fl);
}

void handleLine(char* line, bool overflow) {
  if (overflow) out::err(-1, "LONG", "line longer than %d", CMD_LINE_MAX);
  else cmd::handle(line);
}
}  // namespace

void appSetup() {
  Serial.setRxBufferSize(4096);  // a whole CAL LUT line fits even if loop() is briefly busy
  Serial.begin(SERIAL_BAUD);
  const uint32_t t0 = millis();
  while (!Serial && millis() - t0 < 1500) delay(10);  // give a USB host a moment, never block forever
  cfg::begin();
  sensors::begin();
  act::begin();
  if (cfg::i(CFG_CAM_MODEL) > 0) cam::begin();
  ops::begin();  // after the camera: the button must not use a camera pin
#if ENABLE_WDT
  enableLoopWDT();
#endif
  out::line("# NasaSat firmware boot - team NASA Pak Soi");
  out::event("BOOT %s", diag::resetReason());
  cmd::hello();
  out::line("TH," TEL_COLS);
}

void appLoop() {
  const uint32_t t0 = micros();
  char* line = nullptr;
  bool overflow = false;
  while (reader.poll(Serial, line, overflow)) handleLine(line, overflow);
  if (Stream* l = ops::linkPort())
    while (linkReader.poll(*l, line, overflow)) handleLine(line, overflow);
  sensors::update();
  procs::update();
  cam::pump();
  diag::tick();
  telemetry();
  ops::tick();  // button, automatic start, J hk, and moves queued lines out of the second port
  ops::noteLoop(micros() - t0);
  delay(1);  // lets lower-priority tasks run; the stepper has its own timer
}
