// ===== host-test world: the physics the firmware sees through the mocked ESP32 APIs =====
// Same truth model as the web tool simulator (tool/src/js/07_sim.js), but here the REAL firmware code runs:
// the motor turns only when the firmware's coil pattern on the ULN2003 pins actually steps it.
#pragma once
#include <stdint.h>
#include <string>

struct World {
  // ---- environment (change with "!WORLD key value")
  int lampOn = 1;
  double lampAz = 25, lampK = 1, ambient = 0.03, flicker = 0.08, noiseMv = 4, targetAz = -40, bump = 0;
  // ---- hidden truth of the "satellite"
  double alphaL = 31.0, alphaR = 30.6, qL = 1.35, qR = 1.35, fov = 78;  // q: housing shape of each LDR ("q" sets both)
  double gammaL = 0.62, gammaR = 0.57, r10L = 14000, r10R = 17500;
  double rf = 10000, vcc = 3300, tau = 0.025, tauFall = 0.035;  // CdS: darkening is slower than brightening
  double spr = 4076, backlash = 1.4, maxRate = 1000, camOff = 2.2, hfov = 64;
  int actuator = 1;                     // what is physically connected: 1 = 28BYJ-48 on ULN2003, 2 = servo
  int pinL = 1, pinR = 2;               // where the LDR dividers are really wired
  int uln[4] = {38, 39, 40, 41};        // where IN1..IN4 are really wired
  int wireDir = 1;                      // motor direction for a "+1" phase step
  int servoPin = 42;
  int camModel = 1;                     // camera pinout on the board (1 = S3-EYE/Freenove, 2 = XIAO, 4 = ESP32-CAM, 0 = none)
  int camFrames = 1;                    // 0 = sensor answers but no frame ever arrives (wrong data/PCLK wiring)
  int psram = 1;
  int i2cSda = 8, i2cScl = 9, i2cAddr = 0x3C;
  double txUsPerByte = 0;               // 0 = native USB CDC, 86.8 = UART at 115200 baud
  int btnPin = 0, btnDown = 0;          // the BOOT button (to GND, pulled up): btnDown 1 = held
  int vbatPin = -1;                     // battery divider on this ADC pin (-1 = none)
  double vbatMv = 7400, vdiv = 3, tempC = 41.5;
  int linkRx = 21, linkTx = 14, linkBaud = 9600, linkUp = 1;  // a serial radio wired to these pins (linkUp 0 = none)
  // ---- state
  uint64_t us = 0;
  int coil = 0, rotorIdx = 0;
  long motor = 0;                       // motor shaft in half-steps
  double out = 0;                       // output shaft (deg)
  long glitches = 0, missed = 0, steps = 0;
  uint64_t lastStepUs = 0, lastMotionUs = 0;
  double gL = -1, gR = -1;
  uint64_t lastSensUs = 0;
  double servoCmd = 0;
  int servoSeen = 0;
  int aec = 1, agcCtrl = 1, awb = 1, aecValue = 300, agcGain = 0, hmirror = -1, vflip = -1;
  uint32_t frames = 0;
  long linkBytes = 0;                   // bytes the radio received from the board
};

extern World W;

// harness API (host_main.cpp)
void simAdvance(uint64_t us);
double simBody();
double simThetaTrue();
bool simSet(const std::string& key, const std::string& val);
std::string simTruthJson();
void simFeed(const std::string& line);
void simLinkFeed(const std::string& line);  // a line the ground station sends over the radio
void simFlushLink();                        // print what the radio received ("!LINK line"), between loop() calls
bool simSaveState(const std::string& dir);
bool simLoadState(const std::string& dir);
void simSetResetReason(int r);
void simSetRestartHook(void (*fn)());
void simSeed(uint32_t s);
