// ===== host harness: runs the real NasaSat firmware (setup/loop) against the simulated world =====
// stdin : firmware commands (fed to Serial) and harness commands starting with '!'
//   !RUN ms          run the firmware for ms of simulated time, then print "!DONE t=<ms>"
//   !WORLD key value change the world (lamp, bump, wiring, ...), see sim.cpp simSet()
//   !TRUTH           print "!TRUTH {json}" with the true angles
//   !LINKIN text     the ground station sends `text` over the radio on the second port (com.rx)
//   !QUIT            save state and exit
// what the radio receives from the second port (com.tx) is printed as "!LINK line" between loop() calls
// args: --state DIR (nvs + world files, survive REBOOT), --resume (boot after ESP.restart()), --seed N
#include <fcntl.h>
#include <stdio.h>
#include <iostream>
#include <string>
#include "sim.h"
#ifdef _WIN32
#include <io.h>
#endif

void setup();
void loop();

static std::string stateDir;
static uint64_t maxLoopUs = 0;
static long wdtTrips = 0;

static void onRestart() {
  if (!stateDir.empty()) simSaveState(stateDir);
  printf("\n!RESTART\n");
  fflush(stdout);
}

int main(int argc, char** argv) {
#ifdef _WIN32
  _setmode(_fileno(stdout), _O_BINARY);
#endif
  setvbuf(stdout, nullptr, _IOFBF, 1 << 16);
  bool resume = false;
  uint32_t seed = 12345;
  for (int i = 1; i < argc; i++) {
    const std::string a = argv[i];
    if (a == "--state" && i + 1 < argc) stateDir = argv[++i];
    else if (a == "--resume") resume = true;
    else if (a == "--seed" && i + 1 < argc) seed = (uint32_t)strtoul(argv[++i], nullptr, 10);
  }
  simSeed(seed + (resume ? 7919u : 0u));
  if (!stateDir.empty()) simLoadState(stateDir);
  simSetResetReason(resume ? 3 /* ESP_RST_SW */ : 1 /* ESP_RST_POWERON */);
  simSetRestartHook(onRestart);

  setup();
  simFlushLink();
  printf("!READY\n");
  fflush(stdout);

  std::string line;
  while (std::getline(std::cin, line)) {
    if (!line.empty() && line.back() == '\r') line.pop_back();
    if (line.rfind("!RUN", 0) == 0) {
      const double ms = atof(line.c_str() + 4);
      extern World W;
      const uint64_t end = W.us + (uint64_t)(ms * 1000);
      while (W.us < end) {
        const uint64_t t0 = W.us;
        loop();
        simFlushLink();
        if (W.us == t0) simAdvance(50);  // a loop without delay() still costs CPU time
        const uint64_t dt = W.us - t0;
        if (dt > maxLoopUs) maxLoopUs = dt;
        if (dt > 5000000) {
          wdtTrips++;
          printf("\n!WDT loop() blocked for %.0f ms\n", dt / 1000.0);
        }
      }
      printf("\n!DONE t=%.3f maxloop_ms=%.3f wdt=%ld\n", W.us / 1000.0, maxLoopUs / 1000.0, wdtTrips);
      fflush(stdout);
    } else if (line.rfind("!WORLD", 0) == 0) {
      char k[64], v[128];
      if (sscanf(line.c_str() + 6, "%63s %127s", k, v) == 2 && simSet(k, v)) printf("!OK %s=%s\n", k, v);
      else printf("!ERR world %s\n", line.c_str());
      fflush(stdout);
    } else if (line.rfind("!LINKIN ", 0) == 0) {
      simLinkFeed(line.substr(8));
    } else if (line == "!TRUTH") {
      printf("!TRUTH %s\n", simTruthJson().c_str());
      fflush(stdout);
    } else if (line == "!MAXLOOP") {
      printf("!MAXLOOP %.3f\n", maxLoopUs / 1000.0);
      maxLoopUs = 0;
      fflush(stdout);
    } else if (line == "!QUIT") {
      if (!stateDir.empty()) simSaveState(stateDir);
      printf("!BYE\n");
      fflush(stdout);
      return 0;
    } else {
      simFeed(line);
    }
  }
  if (!stateDir.empty()) simSaveState(stateDir);
  return 0;
}
