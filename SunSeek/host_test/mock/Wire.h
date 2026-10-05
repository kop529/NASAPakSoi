// Host-test I2C bus: register-level stand-ins for the GY-89 chips (LSM303D 0x1D, L3GD20 0x6B, BMP180 0x77).
// The register values come from the simulated world (sim_world.cpp).
#pragma once
#include <stdint.h>
#include <vector>

class TwoWire {
 public:
  bool begin(int sda = -1, int scl = -1, uint32_t freq = 0) { (void)sda; (void)scl; (void)freq; return true; }
  void setClock(uint32_t) {}
  void beginTransmission(uint8_t addr) { addr_ = addr; tx_.clear(); }
  size_t write(uint8_t b) { tx_.push_back(b); return 1; }
  uint8_t endTransmission(bool stop = true);
  uint8_t requestFrom(uint8_t addr, uint8_t n);
  int read() { if (rxPos_ >= rx_.size()) return -1; return rx_[rxPos_++]; }
  int available() { return (int)(rx_.size() - rxPos_); }

 private:
  uint8_t addr_ = 0;
  std::vector<uint8_t> tx_, rx_;
  size_t rxPos_ = 0;
  uint8_t ptr_[128] = {0};  // register pointer per address
};
extern TwoWire Wire;
