// ===== non-blocking stepper driver for 28BYJ-48 + ULN2003 =====
// Steps are generated from a periodic esp_timer, so they stay smooth even while loop() is busy
// (e.g. taking a photo). Trapezoidal speed profile, backlash compensation, coil release when idle.
#pragma once
#include <stdint.h>

class Stepper {
 public:
  void begin();                              // start the step timer (once)
  void setPins(const int pins[4]);           // IN1..IN4; old pins are released
  void setMode(int seq, int dir);            // seq 0 wave, 1 full, 2 half ; dir +1/-1
  void setProfile(float vmaxSps, float accSps2);
  void setBacklash(int32_t steps);           // gear play to take up when turning the other way (0 = off)
  void setHold(bool hold);                   // keep coils energized when idle
  void moveTo(int32_t target);
  void stop();                               // stop at the current position
  void release();                            // coils off (motor can be turned by hand)
  void zero();                               // current position becomes 0
  int32_t pos() const { return L_; }
  int32_t target() const { return T_; }
  bool busy() const { return T_ != L_ || comp_ > 0; }
  bool energized() const { return energized_; }
  void tick(uint32_t dtUs);                  // called from the timer

 private:
  void writeCoils(uint8_t pattern);
  int pins_[4] = {-1, -1, -1, -1};
  const uint8_t* seq_ = nullptr;
  int seqLen_ = 8;
  int dirSign_ = 1;
  volatile int32_t L_ = 0;       // logical position (steps)
  volatile int32_t T_ = 0;       // target (steps)
  volatile int32_t comp_ = 0;    // backlash steps still to issue
  volatile int32_t off_ = 0;     // backlash steps issued so far (motor - logical): 0 = turning +, -backlash_ = turning -
  volatile int8_t lastDir_ = 0;
  volatile bool energized_ = false;
  volatile bool hold_ = false;
  int32_t backlash_ = 0;
  float vmax_ = 455, acc_ = 1700, v_ = 0, accum_ = 0;
  int phase_ = 0;
  uint32_t idleUs_ = 0;
  bool started_ = false;
};

extern Stepper stepper;
