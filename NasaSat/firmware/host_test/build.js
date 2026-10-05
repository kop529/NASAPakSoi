// Compile the real firmware + mocks + simulated world into a PC program (needs only g++ on PATH).
// usage: node build.js [--core2] [--fallback] [--esp32]
//   -> build/nasasat_host(.exe)          main firmware, ESP32 Arduino core 3.x API
//      build/nasasat_host_core2(.exe)    main firmware, core 2.x API (LEDC etc.)
//      build/nasasat_host_esp32(.exe)    main firmware on the old ESP32 (ESP32-CAM AI-Thinker pin rules)
//      build/fallback_host(.exe)         the single-file backup sketch firmware/Fallback/Fallback.ino
'use strict';
(() => {
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const core2 = process.argv.includes('--core2');
const fallback = process.argv.includes('--fallback');
const esp32 = process.argv.includes('--esp32');
const here = __dirname;
const fw = path.join(here, '..', 'NasaSat');
const outDir = path.join(here, 'build');
fs.mkdirSync(outDir, { recursive: true });
const exe = path.join(outDir, (fallback ? 'fallback_host' : 'nasasat_host') + (core2 ? '_core2' : '') + (esp32 ? '_esp32' : '') + (process.platform === 'win32' ? '.exe' : ''));

const fwSrc = fallback ? [] : fs.readdirSync(fw).filter((f) => f.endsWith('.cpp')).map((f) => path.join(fw, f));
const ino = fallback ? path.join(here, '..', 'Fallback', 'Fallback.ino') : path.join(fw, 'NasaSat.ino');

// The Arduino IDE does not compile a .ino as it is: it adds a prototype for every function, inserted just
// before the first function definition. Do the same, so a sketch that depends on the order of its definitions
// (a struct used as a return type but declared after the first function) fails here exactly like in the IDE.
function inoToCpp(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const fn = /^([A-Za-z_][\w\s*&:<>,]*?)\s*\b([A-Za-z_]\w*)\s*\(([^()]*)\)\s*(?:const\s*)?\{/;
  const protos = [];
  let first = -1;
  let depth = 0;
  lines.forEach((l, i) => {
    const code = l.replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/'(?:\\.|[^'\\])*'/g, "''").replace(/\/\/.*$/, '');
    const m = depth === 0 ? code.match(fn) : null;
    if (m && !/^(else|return|struct|class|enum|union|namespace)\b/.test(m[1])) {
      protos.push(`${m[1].trim()} ${m[2]}(${m[3].trim()});`);
      if (first < 0) first = i;
    }
    depth += (code.match(/\{/g) || []).length - (code.match(/\}/g) || []).length;
  });
  if (first < 0) return lines.join('\n');
  const where = JSON.stringify(file);
  return [...lines.slice(0, first), ...protos, `#line ${first + 1} ${where}`, ...lines.slice(first)].join('\n');
}
const inoCpp = path.join(outDir, path.basename(ino) + '.cpp');
fs.writeFileSync(inoCpp, `#line 1 ${JSON.stringify(ino)}\n` + inoToCpp(ino) + '\n');

const args = [
  '-std=gnu++17', '-O1', '-g', '-Wall', '-Wextra', '-Wno-unused-parameter', '-Wno-missing-field-initializers',
  '-Wno-implicit-fallthrough', // protothread case labels fall through on purpose
  '-I', path.join(here, 'mock'), '-I', fw, '-I', here, '-I', path.dirname(ino),
  '-include', 'Arduino.h', // what the Arduino IDE silently adds to every .ino
  ...(core2 ? ['-DMOCK_CORE2'] : []),
  ...(esp32 ? ['-DMOCK_ESP32'] : []),
  ...fwSrc,
  inoCpp,
  path.join(here, 'sim.cpp'), path.join(here, 'host_main.cpp'),
  '-o', exe,
];
const t0 = Date.now();
const r = spawnSync('g++', args, { encoding: 'utf8' });
process.stdout.write(r.stdout || '');
process.stderr.write(r.stderr || '');
if (r.status !== 0) { console.error(`BUILD FAILED (${r.status}${r.error ? ' ' + r.error.message : ''})`); process.exitCode = 1; return; }
console.log(`built ${path.relative(process.cwd(), exe)} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
})();
