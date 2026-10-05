// ===== command dispatcher: every command the web tool (and the Serial Monitor) can send =====
#pragma once

namespace cmd {
void handle(char* line);
void hello();
bool streaming();
}  // namespace cmd
