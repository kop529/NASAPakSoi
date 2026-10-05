#pragma once

/* TEAM NasaPakSoi — sun-angle model (ported from NasaSat firmware/NasaSat/estimator.cpp).
   Pure C++ (no Arduino) so the host test can compile it unchanged.
   Same math as the web tool (NasaSat tool/src/js/04_estimator.js):

     mV -> G = V/(Vcc-V)  (relative conductance of the LDR; topo 1 = LDR on the GND side)
        -> e = G^(1/gamma) - ambient -> e^(1/q)        (per channel; right channel divided by gain g)
        -> D = (eL - eR)/(eL + eR) = tan(theta)*tan(alpha)
        -> theta = atan(D / tan(alpha)) + th0 + LUT(raw)

   "L" here is the channel on SUN_LEFT_PIN (io17), the same channel the organizer's NDV puts first,
   so a positive angle means the same thing as the organizer's 90*NDV default. */

#include <math.h>
#include <stdint.h>

#define TEAM_LUT_MAX 256

struct TeamSunParams {
  double vcc = 3300;
  int topo = 0;          // 0: LDR on the 3.3 V side (V rises with light), 1: LDR on the GND side
  double gamma = 0.6;    // left LDR
  double gammaR = 0;     // right LDR, 0 = same as gamma
  double qL = 1, qR = 1; // housing shape exponent per channel
  double alpha = 30;     // half angle between the two LDR axes [deg]
  double g = 1;          // right/left channel gain
  double aL = 0, aR = 0; // room light in the e-domain (measured with the lamp off)
  double th0 = 0;        // zero offset against an external reference [deg]
  double minS = 0.05;    // below this total signal there is no usable light
  double dmax = 0.95;    // |D| above this = at the edge of the field of view
  int lutOn = 1;
  const float* lutV = nullptr;
  int lutN = 0;
  double lutX0 = 0, lutDx = 1;
};

struct TeamSunOut {
  double eL, eR, S, D, raw, theta;
  bool valid, edge;
};

inline double teamSunToG(double mv, double vcc, int topo) {
  double v = mv;
  if (v < 1) v = 1;
  if (v > vcc - 1) v = vcc - 1;
  return topo == 1 ? (vcc - v) / v : v / (vcc - v);
}

inline double teamSunChannel(double G, double gamma, double ambient, double q) {
  double e = pow(G > 1e-9 ? G : 1e-9, 1.0 / gamma) - ambient;
  if (e < 0) e = 0;
  return q != 1.0 ? pow(e, 1.0 / q) : e;
}

inline double teamSunLut(const float* v, int n, double x0, double dx, double x) {
  if (!v || n <= 0 || !(dx > 0)) return 0;
  const double u = (x - x0) / dx;
  if (u <= 0) return v[0];
  if (u >= n - 1) return v[n - 1];
  const int i = (int)floor(u);
  const double f = u - i;
  return v[i] * (1 - f) + v[i + 1] * f;
}

inline TeamSunOut teamSunEstimate(double GL, double GR, const TeamSunParams& p) {
  static const double kDeg = 3.14159265358979323846 / 180.0;
  static const double kRad = 180.0 / 3.14159265358979323846;
  TeamSunOut o;
  const double gR = p.gammaR > 0 ? p.gammaR : p.gamma;
  o.eL = teamSunChannel(GL, p.gamma, p.aL, p.qL);
  o.eR = teamSunChannel(GR, gR, p.aR, p.qR) / (p.g != 0 ? p.g : 1.0);
  o.S = o.eL + o.eR;
  o.D = o.S > 1e-12 ? (o.eL - o.eR) / o.S : 0;
  double ta = tan(p.alpha * kDeg);
  if (fabs(ta) < 1e-6) ta = ta < 0 ? -1e-6 : 1e-6;
  o.raw = atan(o.D / ta) * kRad;
  o.theta = o.raw + p.th0;
  if (p.lutOn && p.lutV && p.lutN > 0) o.theta += teamSunLut(p.lutV, p.lutN, p.lutX0, p.lutDx, o.raw);
  o.valid = o.S >= p.minS;
  o.edge = fabs(o.D) > p.dmax;
  return o;
}

inline TeamSunOut teamSunFromMv(double mvL, double mvR, const TeamSunParams& p) {
  return teamSunEstimate(teamSunToG(mvL, p.vcc, p.topo), teamSunToG(mvR, p.vcc, p.topo), p);
}
