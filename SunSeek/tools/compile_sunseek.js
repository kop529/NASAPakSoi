// Real compile check for the SunSeek platform firmware (organizer v3.0 baseline and our team copy; --v21 = the old v2.1 pair),
// using the same arduino-cli + esp32 core as firmware/tools/compile_check.js in the NasaSat project.
//   node SunSeek/tools/compile_sunseek.js            team copy only
//   node SunSeek/tools/compile_sunseek.js --both     organizer baseline + team copy (to compare sizes)
// Set ARDUINO_CLI=<path to arduino-cli> if it is somewhere else.
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const both = process.argv.includes('--both');
const v21 = process.argv.includes('--v21');
const SKETCH = v21 ? 'SunSeek_Platform_Firmware_v2_1' : 'SunSeek_Platform_Firmware_v3_0';

function findCli() {
  const local = process.env.LOCALAPPDATA;
  const list = [
    process.env.ARDUINO_CLI,
    'C:\\Program Files\\Arduino CLI\\arduino-cli.exe',
    local && path.join(local, 'Programs', 'Arduino IDE', 'resources', 'app', 'lib', 'backend', 'resources', 'arduino-cli.exe'),
    'C:\\Program Files\\Arduino IDE\\resources\\app\\lib\\backend\\resources\\arduino-cli.exe',
  ].filter(Boolean);
  const hit = list.find((p) => fs.existsSync(p));
  if (hit) return hit;
  const r = spawnSync('arduino-cli', ['version'], { encoding: 'utf8' });
  return r.status === 0 ? 'arduino-cli' : null;
}

const cli = findCli();
if (!cli) {
  console.log('arduino-cli not found: set ARDUINO_CLI');
  process.exit(2);
}

// SunSeek v1.3 talks over a CP210x USB-UART chip, so USB CDC On Boot stays off.
const FQBN = 'esp32:esp32:esp32s3:CDCOnBoot=default';
const builds = [['team', path.join(root, 'team', SKETCH)]];
if (both) builds.unshift(v21 ? ['organizer v2.1', path.join(root, 'organizer_v2_1', SKETCH)] : ['organizer v3.0', path.join(root, 'organizer_v3_0', 'platform', SKETCH)]);

const ver = spawnSync(cli, ['core', 'list'], { encoding: 'utf8' });
const coreLine = (ver.stdout || '').split(/\r?\n/).find((l) => /^esp32:esp32\s/.test(l));
console.log(`arduino-cli: ${cli}\nesp32 core: ${coreLine ? coreLine.trim().split(/\s+/)[1] : 'NOT INSTALLED'}\nFQBN: ${FQBN}\n`);

let failed = 0;
for (const [label, dir] of builds) {
  // The build folder is outside the sketch so the read-only organizer copy is never written to.
  const buildPath = path.join(os.tmpdir(), 'sunseek_compile', label.replace(/[^A-Za-z0-9]+/g, '_'));
  const t0 = Date.now();
  const r = spawnSync(cli, ['compile', '--fqbn', FQBN, '--warnings', 'all', '--build-path', buildPath, dir],
    { encoding: 'utf8', maxBuffer: 64 << 20 });
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  const lines = out.split(/\r?\n/);
  const ours = (l) => l.includes(dir) || l.includes(`${SKETCH}${path.sep}`);
  const errors = lines.filter((l) => ours(l) && /\berror:/.test(l));
  const warns = lines.filter((l) => ours(l) && /\bwarning:/.test(l));
  const flash = (out.match(/Sketch uses (\d+) bytes \((\d+)%\)/) || []).slice(1);
  const ram = (out.match(/Global variables use (\d+) bytes/) || [])[1];
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(16)} ${((Date.now() - t0) / 1000).toFixed(0).padStart(3)} s` +
    (ok ? `  flash ${flash[0]} B (${flash[1]}%)  RAM ${ram} B  warnings ${warns.length}` : ''));
  for (const l of [...errors, ...warns].slice(0, 20)) console.log('      ' + l.trim());
  if (!ok && !errors.length) console.log(lines.filter((l) => l.trim()).slice(-15).map((l) => '      ' + l).join('\n'));
}
console.log(failed ? `\n${failed} build(s) FAILED` : '\nall builds passed');
process.exitCode = failed ? 1 : 0;
