// Real compile check: builds NasaSat and Fallback with the ESP32 Arduino core that the Arduino IDE installed,
// using the arduino-cli that ships inside Arduino IDE 2.x (nothing extra to install). The PC host test cannot
// see everything the real core does (it found neither the `stat` name clash nor the .ino prototype order),
// so run this after every code change, before trusting a build on the board.
//   node firmware/tools/compile_check.js          the usual board settings
//   node firmware/tools/compile_check.js --all    + TinyUSB and an ESP32-CAM (AI-Thinker) board
// Set ARDUINO_CLI=<path to arduino-cli> if it is somewhere else.
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const fw = path.join(__dirname, '..');
const all = process.argv.includes('--all');

function findCli() {
  const local = process.env.LOCALAPPDATA;
  const list = [
    process.env.ARDUINO_CLI,
    local && path.join(local, 'Programs', 'Arduino IDE', 'resources', 'app', 'lib', 'backend', 'resources', 'arduino-cli.exe'),
    'C:\\Program Files\\Arduino IDE\\resources\\app\\lib\\backend\\resources\\arduino-cli.exe',
    '/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli',
  ].filter(Boolean);
  const hit = list.find((p) => fs.existsSync(p));
  if (hit) return hit;
  const r = spawnSync('arduino-cli', ['version'], { encoding: 'utf8' });
  return r.status === 0 ? 'arduino-cli' : null;
}

const cli = findCli();
if (!cli) {
  console.log('arduino-cli not found: install Arduino IDE 2.x + the esp32 core (firmware/INSTALL_CHECKLIST.md), or set ARDUINO_CLI');
  process.exit(2);
}

// [sketch folder, FQBN, what it stands for]
const variants = [
  ['NasaSat', 'esp32:esp32:esp32s3:CDCOnBoot=cdc,PSRAM=opi', 'S3, USB CDC On Boot, OPI PSRAM (usual)'],
  ['NasaSat', 'esp32:esp32:esp32s3:CDCOnBoot=default,PSRAM=disabled', 'S3, USB-UART chip, no PSRAM'],
  ['Fallback', 'esp32:esp32:esp32s3:CDCOnBoot=cdc', 'Fallback, S3 USB CDC'],
  ['Fallback', 'esp32:esp32:esp32s3:CDCOnBoot=default', 'Fallback, S3 USB-UART chip'],
];
if (all) {
  variants.push(['NasaSat', 'esp32:esp32:esp32s3:CDCOnBoot=cdc,USBMode=default,PSRAM=opi', 'S3, USB-OTG (TinyUSB)']);
  variants.push(['NasaSat', 'esp32:esp32:esp32cam', 'ESP32-CAM (AI-Thinker, classic ESP32)']);
}

const ver = spawnSync(cli, ['core', 'list'], { encoding: 'utf8' });
const coreLine = (ver.stdout || '').split(/\r?\n/).find((l) => /^esp32:esp32\s/.test(l));
console.log(`arduino-cli: ${cli}\nesp32 core: ${coreLine ? coreLine.trim().split(/\s+/)[1] : 'NOT INSTALLED (Boards Manager > esp32)'}\n`);

let failed = 0;
for (const [sketch, fqbn, label] of variants) {
  const dir = path.join(fw, sketch);
  const buildPath = path.join(os.tmpdir(), 'nasasat_compile', `${sketch}_${fqbn.replace(/[^A-Za-z0-9]+/g, '_')}`);
  const t0 = Date.now();
  const r = spawnSync(cli, ['compile', '--fqbn', fqbn, '--warnings', 'all', '--build-path', buildPath, dir], { encoding: 'utf8', maxBuffer: 64 << 20 });
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  const lines = out.split(/\r?\n/);
  const ours = (l) => l.includes(path.join(fw, sketch)) || l.includes(`${sketch}${path.sep}`);
  const errors = lines.filter((l) => ours(l) && /\berror:/.test(l));
  // protothreads fall through case labels on purpose (pt.h): that warning is expected, everything else is not
  const warns = lines.filter((l) => ours(l) && /\bwarning:/.test(l) && !/implicit-fallthrough/.test(l));
  const flash = (out.match(/Sketch uses (\d+) bytes \((\d+)%\)/) || []).slice(1);
  const ram = (out.match(/Global variables use (\d+) bytes/) || [])[1];
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(40)} ${((Date.now() - t0) / 1000).toFixed(0).padStart(3)} s` +
    (ok ? `  flash ${flash[0]} B (${flash[1]}%)  RAM ${ram} B  warnings ${warns.length}` : ''));
  for (const l of [...errors, ...warns].slice(0, 12)) console.log('      ' + l.trim());
  if (!ok && !errors.length) console.log(lines.filter((l) => l.trim()).slice(-15).map((l) => '      ' + l).join('\n'));
}
console.log(failed ? `\n${failed} build(s) FAILED` : '\nall builds passed');
process.exitCode = failed ? 1 : 0;
