#!/usr/bin/env bash
# Host tests for the team firmware. Run inside WSL Ubuntu (Smart App Control does not apply there):
#   wsl -d Ubuntu -- bash /mnt/c/TYSC/SunSeek/host_test/run.sh
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p build
FW=../team/SunSeek_Platform_Firmware_v2_1

g++ -std=c++17 -O2 -Wall -Wextra -Werror -o build/sunmodel_parity sunmodel_parity.cpp
node sunmodel_parity.js

# the whole sketch (organizer code has sign-compare warnings of its own: errors only)
g++ -std=c++17 -O1 -DTEAM_HOST_TEST -Imock -I"$FW" -w -o build/sunseek_host host_main.cpp sim_world.cpp
node e2e.js
