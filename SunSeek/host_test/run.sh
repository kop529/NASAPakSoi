#!/usr/bin/env bash
# Host tests for the team firmware. Run inside WSL Ubuntu (Smart App Control does not apply there):
#   wsl -d Ubuntu -- bash /mnt/c/TYSC/SunSeek/host_test/run.sh
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p build
g++ -std=c++17 -O2 -Wall -Wextra -Werror -o build/sunmodel_parity sunmodel_parity.cpp
node sunmodel_parity.js
