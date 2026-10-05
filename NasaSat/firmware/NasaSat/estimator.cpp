#include "estimator.h"
#include <math.h>

static const double kDeg = 3.14159265358979323846 / 180.0;
static const double kRad = 180.0 / 3.14159265358979323846;

double estToG(double mv, double vcc, int topo) {
  double v = mv;
  if (v < 1) v = 1;
  if (v > vcc - 1) v = vcc - 1;
  return topo == 1 ? (vcc - v) / v : v / (vcc - v);
}

double estChannel(double G, double gamma, double ambient, double q) {
  double e = pow(G > 1e-9 ? G : 1e-9, 1.0 / gamma) - ambient;
  if (e < 0) e = 0;
  return q != 1.0 ? pow(e, 1.0 / q) : e;
}

double estLut(const float* v, int n, double x0, double dx, double x) {
  if (!v || n <= 0 || !(dx > 0)) return 0;
  const double u = (x - x0) / dx;
  if (u <= 0) return v[0];
  if (u >= n - 1) return v[n - 1];
  const int i = (int)floor(u);
  const double f = u - i;
  return v[i] * (1 - f) + v[i + 1] * f;
}

EstOut estimate(double GL, double GR, const EstParams& p) {
  EstOut o;
  o.eL = estChannel(GL, p.gamma, p.aL, p.qL);
  o.eR = estChannel(GR, estGammaR(p), p.aR, p.qR) / (p.g != 0 ? p.g : 1.0);
  o.S = o.eL + o.eR;
  o.D = o.S > 1e-12 ? (o.eL - o.eR) / o.S : 0;
  double ta = tan(p.alpha * kDeg);
  if (fabs(ta) < 1e-6) ta = ta < 0 ? -1e-6 : 1e-6;
  o.raw = atan(o.D / ta) * kRad;
  o.theta = o.raw + p.th0;
  if (p.lutOn && p.lutV && p.lutN > 0) o.theta += estLut(p.lutV, p.lutN, p.lutX0, p.lutDx, o.raw);
  o.valid = o.S >= p.minS;
  o.edge = fabs(o.D) > p.dmax;
  return o;
}
