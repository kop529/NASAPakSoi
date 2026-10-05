#include "stepper.h"
#include <Arduino.h>
#include <esp_timer.h>
#include "features.h"

Stepper stepper;

namespace {
// coil patterns, bit0 = IN1 ... bit3 = IN4
const uint8_t kHalf[8] = {0x1, 0x3, 0x2, 0x6, 0x4, 0xC, 0x8, 0x9};
const uint8_t kFull[4] = {0x3, 0x6, 0xC, 0x9};
const uint8_t kWave[4] = {0x1, 0x2, 0x4, 0x8};
const float kVmin = 120.0f;  // start/stop speed (steps/s): 28BYJ-48 starts cleanly from here
portMUX_TYPE mux = portMUX_INITIALIZER_UNLOCKED;
esp_timer_handle_t timerHandle = nullptr;

void onTick(void*) { stepper.tick(STEP_TICK_US); }
}  // namespace

void Stepper::begin() {
  if (!seq_) setMode(2, 1);
  if (started_) return;
  esp_timer_create_args_t a = {};
  a.callback = &onTick;
  a.arg = nullptr;
  a.dispatch_method = ESP_TIMER_TASK;
  a.name = "stepper";
  if (esp_timer_create(&a, &timerHandle) == ESP_OK && esp_timer_start_periodic(timerHandle, STEP_TICK_US) == ESP_OK)
    started_ = true;
}

void Stepper::writeCoils(uint8_t p) {
  for (int k = 0; k < 4; k++)
    if (pins_[k] >= 0) digitalWrite(pins_[k], (p >> k) & 1 ? HIGH : LOW);
}

void Stepper::setPins(const int pins[4]) {
  portENTER_CRITICAL(&mux);
  const bool wasOn = energized_;
  portEXIT_CRITICAL(&mux);
  for (int k = 0; k < 4; k++)
    if (pins_[k] >= 0) digitalWrite(pins_[k], LOW);
  for (int k = 0; k < 4; k++) {
    pins_[k] = pins[k];
    if (pins_[k] >= 0) {
      pinMode(pins_[k], OUTPUT);
      digitalWrite(pins_[k], LOW);
    }
  }
  if (wasOn && seq_) writeCoils(seq_[phase_]);
}

void Stepper::setMode(int seq, int dir) {
  portENTER_CRITICAL(&mux);
  const uint8_t* s = seq == 0 ? kWave : seq == 1 ? kFull : kHalf;
  const int n = seq == 2 ? 8 : 4;
  if (s != seq_) {
    seq_ = s;
    seqLen_ = n;
    phase_ = 0;
  }
  dirSign_ = dir < 0 ? -1 : 1;
  portEXIT_CRITICAL(&mux);
}

void Stepper::setProfile(float vmaxSps, float accSps2) {
  portENTER_CRITICAL(&mux);
  vmax_ = vmaxSps < kVmin ? kVmin : vmaxSps;
  acc_ = accSps2 < 10 ? 10 : accSps2;
  portEXIT_CRITICAL(&mux);
}

void Stepper::setBacklash(int32_t steps) { backlash_ = steps < 0 ? 0 : steps; }
void Stepper::setHold(bool hold) { hold_ = hold; }

void Stepper::moveTo(int32_t target) {
  portENTER_CRITICAL(&mux);
  const int32_t d = target > L_ ? 1 : target < L_ ? -1 : 0;
  if (d != 0) {
    // Gear play: turning +, the motor must be backlash_ steps further on than where turning - leaves it, so the
    // + side wants off_ = 0 and the - side off_ = -backlash_. Issue the steps that are missing: all of backlash_ on a
    // normal reversal, none otherwise. Counting from off_ (not "on every reversal") stays right after the
    // compensation was off for a while (BACKLASH test, act.bl changed), which used to leave the output off by
    // act.bl for good. backlash_ 0 = off: nothing is added and off_ is kept for when it comes back.
    const int32_t need = d > 0 ? -off_ : off_ + backlash_;
    comp_ = backlash_ > 0 && need > 0 ? need : 0;
    if (lastDir_ != 0 && d != lastDir_ && v_ > kVmin) v_ = kVmin;  // reversing: drop to start speed first
    lastDir_ = (int8_t)d;
  }
  T_ = target;
  portEXIT_CRITICAL(&mux);
}

void Stepper::stop() {
  portENTER_CRITICAL(&mux);
  T_ = L_;
  comp_ = 0;
  v_ = 0;
  accum_ = 0;
  portEXIT_CRITICAL(&mux);
}

void Stepper::release() {
  portENTER_CRITICAL(&mux);
  T_ = L_;
  comp_ = 0;
  energized_ = false;
  portEXIT_CRITICAL(&mux);
  writeCoils(0);
}

void Stepper::zero() {
  portENTER_CRITICAL(&mux);
  L_ = 0;
  T_ = 0;
  comp_ = 0;
  portEXIT_CRITICAL(&mux);
}

void Stepper::tick(uint32_t dtUs) {
  int write = -1;  // coil pattern to output after leaving the critical section
  portENTER_CRITICAL(&mux);
  const float dt = dtUs * 1e-6f;
  const int32_t rem = (T_ > L_ ? T_ - L_ : L_ - T_) + comp_;
  if (rem > 0 && seq_) {
    const float brake = v_ * v_ / (2.0f * acc_);
    if (v_ < kVmin) v_ = kVmin;
    else if ((float)rem <= brake) v_ = (v_ - acc_ * dt) < kVmin ? kVmin : v_ - acc_ * dt;
    else v_ = (v_ + acc_ * dt) > vmax_ ? vmax_ : v_ + acc_ * dt;
    accum_ += v_ * dt;
    if (accum_ >= 1.0f) {  // at most one step per tick keeps every coil phase on the wire
      accum_ -= 1.0f;
      if (accum_ > 1.0f) accum_ = 1.0f;
      const int8_t d = comp_ > 0 ? lastDir_ : (T_ > L_ ? 1 : -1);
      if (comp_ > 0) {
        comp_ = comp_ - 1;  // not comp_--: decrementing a volatile is deprecated (C++20 -Wvolatile)
        off_ = off_ + d;
      } else {
        L_ += d;
      }
      phase_ = (phase_ + d * dirSign_ + seqLen_) % seqLen_;
      write = seq_[phase_];
      energized_ = true;
    }
    idleUs_ = 0;
  } else {
    v_ = 0;
    accum_ = 0;
    if (energized_ && !hold_) {
      idleUs_ += dtUs;
      if (idleUs_ > 100000) {
        energized_ = false;
        write = 0;
      }
    }
  }
  portEXIT_CRITICAL(&mux);
  if (write >= 0) writeCoils((uint8_t)write);
}
