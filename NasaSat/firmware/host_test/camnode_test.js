// The same firmware on the OLD ESP32 (ESP32-CAM AI-Thinker used as a camera board): that chip's pin rules, the
// cam.model 4 preset, an ESP32-S3 preset refused before it drives the flash pins, the BOOT button switched off
// because GPIO0 is the camera clock there, and a photo end to end.
// usage:  node build.js --esp32 && node camnode_test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Board, isJ, isE, okOf, errOf, jOf } = require('./harness');

const exe = path.join(__dirname, 'build', 'nasasat_host_esp32' + (process.platform === 'win32' ? '.exe' : ''));
let passes = 0;
let fails = 0;
const check = (name, cond, info = '') => {
  if (cond) { passes++; console.log(`  ok   ${name} ${info}`); } else { fails++; console.log(`  FAIL ${name} ${info}`); }
};

(async () => {
  if (!fs.existsSync(exe)) { console.log(`missing ${exe}: run  node build.js --esp32  first`); process.exitCode = 1; return; }
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nasasat-camnode-'));
  const B = new Board(exe, stateDir);
  await B.start();
  let r = await B.run(300);
  const hello = jOf(r, 'hello')[0];
  check('boots on the old ESP32', !!hello && hello.board.includes('ESP32-D0WD'), hello ? hello.board : 'no hello');
  await B.world('camModel', 4);   // an ESP32-CAM (AI-Thinker) board

  console.log('pin rules of the old ESP32');
  r = await B.cmd('SET sen.pin0 6');
  check('GPIO6 refused (SPI flash)', errOf(r).some((m) => m.code === 'PIN' && m.text.includes('flash')), errOf(r).map((m) => m.text).join());
  r = await B.cmd('SET act.in1 34');
  check('GPIO34 refused as an output (input only)', errOf(r).some((m) => m.code === 'PIN' && m.text.includes('input only')));
  r = await B.cmd('SET hw.btn 34');
  check('GPIO34 accepted for a button (an input)', okOf(r).some((m) => m.text === 'hw.btn=34'));
  await B.cmd('SET hw.btn 0');
  r = await B.cmd('SET com.tx 1');
  check('GPIO1 refused for the second port (UART0 = the link to the laptop)', errOf(r).some((m) => m.code === 'PIN' && m.text.includes('UART0')));
  r = await B.cmd('SET sen.pin0 33');
  check('GPIO33 accepted for an LDR (ADC1)', okOf(r).some((m) => m.text === 'sen.pin0=33'));

  console.log('camera board: act.type 0, cam.model 4');
  await B.cmd('SET act.type 0');
  await B.cmd('SET cam.model 1');
  r = await B.cmd('M2 INIT', 400);
  const e1 = errOf(r).find((m) => m.code === 'CAM');
  check('cam.model 1 (ESP32-S3 pins) on this chip -> refused before touching its PSRAM/flash pins', !!e1 && e1.text.includes('not for this chip') && /PSRAM|flash/.test(e1.text), e1 ? e1.text : '');
  await B.cmd('SET cam.model 4');
  r = await B.cmd('M2 INIT', 400);
  check('cam.model 4 (ESP32-CAM AI-Thinker) -> camera up', okOf(r).some((m) => m.text.includes('ok sensor')), [...okOf(r), ...errOf(r)].map((m) => m.text).join());
  check('BOOT button switched off: GPIO0 is the camera clock on this board', r.some((m) => m.kind === 'e' && m.evt === 'WARN' && m.args[0] === 'BTN'), r.filter((m) => m.kind === 'e').map((m) => m.raw).join(' | '));
  r = await B.cmd('HWID', 100);
  check('HWID says btn -1', (jOf(r, 'hwid')[0] || {}).btn === -1);
  await B.world('btnDown', 1);
  r = await B.run(600);
  await B.world('btnDown', 0);
  check('pulling GPIO0 low does nothing (no BTN event)', !r.some(isE('BTN')));

  B.send('M2 LOCK');
  await B.until(isJ('cam'), 5000);
  const n0 = B.images.length;
  B.send('M2 SNAP');
  const u = await B.until(() => B.images.length > n0, 30000, 200);
  const img = B.images[B.images.length - 1];
  const meta = jOf(u.lines, 'img_meta')[0];
  check('photo from the ESP32-CAM preset: intact, 640 wide, flips reported', !!u.hit && img.ok && meta && meta.w === 640 && meta.hm === 0 && meta.vf === 0, meta ? `${img.bytes.length} B` : 'no photo');
  const w = await B.until(isJ('hk'), 3000);
  check('J hk on the old ESP32: temp_c null (its sensor is not usable)', !!w.hit && w.hit.json.temp_c === null, w.hit ? JSON.stringify(w.hit.json) : 'no hk');
  check('no watchdog trips / mock warnings', B.warn.length === 0, B.warn.slice(0, 3).join(' | '));
  check('every line parses', B.bad.length === 0, B.bad.slice(0, 3).join(' | '));

  await B.quit();
  fs.rmSync(stateDir, { recursive: true, force: true });
  console.log(`\n${passes} passed, ${fails} failed`);
  process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
