// ===== sun-angle estimator: the same math as the web tool (tool/src/js/04_estimator.js) =====
// mV -> G (relative conductance of the LDR) -> ^(1/gamma) - room light -> ^(1/q) -> gain match
//    -> D = (eL - eR)/(eL + eR) = tan(theta)*tan(alpha) -> theta = atan(D / tan(alpha)) + th0 + LUT(raw)
// Pure C++ (no Arduino) so it can be unit-tested on a PC.
#pragma once

struct EstParams {
  double gamma = 0.6, gammaR = 0;  // gamma of the left / right LDR (gammaR 0 = same as gamma)
  double qL = 1, qR = 1, alpha = 30, g = 1, aL = 0, aR = 0, th0 = 0;
  double minS = 0.05, dmax = 0.95, vcc = 3300;
  int topo = 0;        // 0: LDR on the 3.3 V side, 1: LDR on the GND side
  int lutOn = 1;
  const float* lutV = nullptr;
  int lutN = 0;
  double lutX0 = 0, lutDx = 1;
};

struct EstOut {
  double eL, eR, S, D, raw, theta;
  bool valid, edge;
};

double estToG(double mv, double vcc, int topo);
double estChannel(double G, double gamma, double ambient, double q);
double estLut(const float* v, int n, double x0, double dx, double x);
inline double estGammaR(const EstParams& p) { return p.gammaR > 0 ? p.gammaR : p.gamma; }
EstOut estimate(double GL, double GR, const EstParams& p);
