// Host test: the firmware's Team_SunModel.h must give the same angle as the web tool's 04_estimator.js.
// Reads cases from stdin, one per line:
//   mvL mvR gamma gammaR qL qR alpha g aL aR th0 minS dmax vcc topo lutOn
// and prints: theta raw S D valid edge   (full precision). The LUT is fixed and identical in the JS side.
#include <cstdio>
#include "../team/SunSeek_Platform_Firmware_v2_1/Team_SunModel.h"

static const float kLut[] = {1.5f, 1.0f, 0.4f, 0.0f, -0.3f, -0.2f, 0.25f, 0.8f, 1.2f};

int main() {
  double mvL, mvR;
  TeamSunParams p;
  int topo, lutOn;
  while (scanf("%lf %lf %lf %lf %lf %lf %lf %lf %lf %lf %lf %lf %lf %lf %d %d", &mvL, &mvR, &p.gamma, &p.gammaR, &p.qL,
               &p.qR, &p.alpha, &p.g, &p.aL, &p.aR, &p.th0, &p.minS, &p.dmax, &p.vcc, &topo, &lutOn) == 16) {
    p.topo = topo;
    p.lutOn = lutOn;
    p.lutV = kLut;
    p.lutN = sizeof(kLut) / sizeof(kLut[0]);
    p.lutX0 = -40;
    p.lutDx = 10;
    const TeamSunOut o = teamSunFromMv(mvL, mvR, p);
    printf("%.15g %.15g %.15g %.15g %d %d\n", o.theta, o.raw, o.S, o.D, o.valid ? 1 : 0, o.edge ? 1 : 0);
  }
  return 0;
}
