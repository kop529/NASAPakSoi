#pragma once
#include <stdint.h>

class TwoWire {
 public:
  bool begin(int sda, int scl, uint32_t freq = 0);
  bool end();
  void setTimeOut(uint16_t ms) { (void)ms; }
  void beginTransmission(uint8_t addr) { addr_ = addr; }
  uint8_t endTransmission(bool stop = true);

 private:
  uint8_t addr_ = 0;
  bool on_ = false;
};
extern TwoWire Wire;
