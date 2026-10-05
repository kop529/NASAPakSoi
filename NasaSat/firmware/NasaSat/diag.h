// ===== on-site discovery and diagnostics: HWID, PINFIND, DIAG =====
#pragma once

namespace diag {
const char* resetReason();
void hwid(bool scanI2C);
void setPinfind(bool on);
bool pinfind();
void tick();          // sends the ADC pin table every 200 ms while PINFIND is on
void report();        // DIAG: short status for pasting into an AI chat
}  // namespace diag
