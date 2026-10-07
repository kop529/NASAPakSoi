# TYSC 2026 — team NasaPakSoi (นาซ่าหน้าปากซอย)

Thailand Young Satellite Challenge 2026 final (5–9 Oct 2026). A turntable "satellite" (ESP32-S3, one reaction wheel,
4-LDR sun sensor, GY-89 IMU, ESP32-CAM) must face a lamp on its own (mission 1) and turn to given angles and take
photos (mission 2). The organizer supplies firmware v3.0 + a Ground Station (GS) app; the team adds `TEAM_*` features on
top. Every team feature can be switched back to organizer behaviour with `TEAM_SET`.

## Where to start (for an audit)

| What | Path |
|---|---|
| Team firmware (organizer v3.0 + team files) | `SunSeek/team/SunSeek_Platform_Firmware_v3_0/` |
| Team-only files | `Team_Mission.h` (mission 2), `Team_Params.h` (all params + defaults), `Team_Commands.h`, `Team_SunModel.h`, `Team_SunSampler.h` |
| Organizer files the team changed (marked `TEAM NasaPakSoi`) | `Module_ADCS.h`, `Module_Estimator.h`, `Module_Payload.h`, `System_CommandRouter.h`, `System_TTC.h`, `.ino` |
| Organizer baseline for diff | `SunSeek/workshop_v3_0/SunSeek_Platform_Firmware_v3_0/` |
| Every change, why, and the evidence (Thai) | `SunSeek/presentation/TEAM_FIRMWARE_CHANGES_TH.md` |
| Findings story with numbers (Thai, slides 35–62) | `SunSeek/presentation/PRESLIDE_TH.md` |
| Rehearsal run sheets | `SunSeek/RUNSHEET_MISSION2_8OCT_TH.md`, `SunSeek/RIG_RUNSHEET_7OCT_TH.md` |
| Real flight-recorder dumps / GS logs | `SunSeek/setup_logs/` (`tools/cdump_report.js` reads the dumps) |
| Camera (payload) firmware copy | `SunSeek/payload_v3_0/` |
| Web tool from the regional round (+ SunSeek mode) | `NasaSat/tool/` |

## Tests (no hardware needed)

The host simulator compiles the real sketch with mocks and a physics/sensor world (`SunSeek/host_test/`).

```bash
wsl -d Ubuntu -- bash /mnt/c/TYSC/SunSeek/host_test/run.sh      # e2e 178 checks + sun calibration 39 checks
```

Mission-2 fuzz (random targets, rigs, camera faults, gyro bias, STOP/ABORT/new PREPARE mid-mission; 17 invariants):
`MFUZZ_N=<runs> MFUZZ_SEED=<first seed>` in front of `node e2e.js` (default 24 runs). 100 000 runs pass except
known test-budget artifacts (see the file header).

ESP32-S3 compile check (Arduino CLI, esp32 core 3.3.11): `node SunSeek/tools/compile_sunseek.js`.

## Known limits of the simulator

The simulated sun sensor over-reads from ~45° and sticks at 60°; the sticky-rig setting is far slower than the real
turntable; no BLE drops, LDR lag, lamp-brightness changes or unlevel rig are modelled. Results marked "จำลอง" are
simulation only.

## Status (7 Oct 2026, night)

Board runs `NasaPakSoi-team-7` (uploaded 7 Oct 16:30). `team-8` = fixes from the 7 Oct night audit (STOP/ABORT end both
mission managers, hold 0 uses a fresh error, nan/inf refused, PREPARE refuses READY when the camera reports SD ERR, START stops the camera stream, mission HOLD lets go at
mis.unlock 2, retry through the capture gate, result queue cleared on reset) is built and host-tested (e2e 178/178, fuzz
5000 all invariants), to be uploaded at the 8 Oct rehearsal.
