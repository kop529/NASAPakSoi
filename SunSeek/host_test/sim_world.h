// Simulated world for the SunSeek host test: a satellite body on a bearing, a DC reaction wheel driven
// by the TB6612 pins, a GY-89 IMU (gyro + magnetometer registers) and two LDRs in a V looking at a lamp.
// Physics constants are guesses until the T01/T03 measurements; tests check behaviour, not exact numbers.
#pragma once
#include <cstdint>
#include <string>

struct SimWorld {
  // ---- truth state ----
  double t = 0;          // s
  double bodyDeg = 0;    // body azimuth (world frame), deg; positive = counter-clockwise seen from above
  double bodyRate = 0;   // deg/s
  double wheelRate = 0;  // wheel speed relative to the body, deg/s

  // ---- scene ----
  double lampDeg = 0;     // lamp azimuth (world)
  double lampK = 1.0;     // lamp brightness
  double ambient = 0.03;  // room light
  double flicker = 0.0;   // 100 Hz flicker depth (0..1)
  double noiseMv = 2.0;   // ADC noise (mV rms)
  double magNorthDeg = 0; // world direction of magnetic north
  double magOx = 0, magOy = 0, magSy = 1;
  double i2cDownUntilMs = 0;
  // payload camera: CAPTURE -> EVENT,CAPTURE_STARTED, then after camMs IMAGE_READY (camFail first tries ERR,CAPTURE_FAILED; camDead 1 = no reply)
  double camMs = 700, camFail = 0, camDead = 0;  // #SET i2cDown <ms>: the gyro does not answer for that long (NACK)  // hard-iron offset (LSB) + y scale, like the rig (15:36 log: centre ~(28, 20) uT)

  // ---- sensor truth (the team model with these values is exact) ----
  double alpha = 30, gamma = 0.6, q = 1.0, r10 = 15000, rf = 10000, vcc = 3300, fov = 85;
  // team-9: false reading past the edge (8 Oct hotel, room light): past |aliasAt| deg the LDR pair reads as if the lamp sat
  // at aliasAt - aliasK * (|s| - aliasAt) (folds back), never beyond +-aliasAt and still "lit". 0 = off
  double aliasAt = 0, aliasK = 3;
  bool swapLdrPins = false;  // true = the LDR on SUN_LEFT_PIN is on the body's right side

  // ---- actuator / dynamics ----
  double wheelMaxRate = 30000;  // deg/s at 100 % PWM (no load)
  double wheelTau = 0.35;       // s, motor time constant
  double wheelCoastTau = 2.0;   // s, coast-down time constant with the driver off (T01: 30 % -> stop in ~6 s)
  double minStartPct = 10;      // static friction: PWM needed to start from rest (T01, 5 Oct)
  double minStablePct = 5;      // below this a spinning wheel stops (T01)
  double inertiaRatio = 1.0 / 400;  // I_wheel / I_body
  double bearingDrag = 0.15;    // 1/s, body rate decay on the bearing
  double wheelAir = 0;          // 1/s: wheel speed lost to air drag per second; that torque pushes the room air, so its
                                // reaction stays on the body: a steady torque while the wheel spins (venue, 5 Oct: RW,30
                                // alone kept the body turning). Coast-down from 30 % took ~6 s = all losses <= ~0.17/s
  double bodyStick = 0;         // deg/s^2: platform static friction; the wheel reaction must exceed it to move a body at rest
                                // (T02: +-10 % momentum steps did not move the body, an 80 % assist did)
  double gyroBiasDps = 0.0;     // true gyro bias (Z)
  double gyroNoiseDps = 0.05;
  int bodyRateSign = 1;         // -1 = IMU mounted upside down

  // ---- what the firmware drives ----
  int pinPwm = 1, pinIn1 = 38, pinIn2 = 39;
  int pwm = 0, in1 = 0, in2 = 0;

  void step(double dt);
  double cmdPct() const;  // signed PWM % actually applied
  double sunAngleBody() const;  // lamp direction relative to the body axis, deg (positive = left)
  double mvForPin(int pin, double tNow);
  int16_t gyroZRaw();
  void magRaw(int16_t& x, int16_t& y, int16_t& z);
  bool set(const std::string& key, double v);
  std::string state() const;
};

extern SimWorld world;
