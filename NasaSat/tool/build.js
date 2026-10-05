// Build tool/NasaSatLab.html (single offline file) from tool/src.  Usage: node build.js
'use strict';
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, 'src');
const html = fs.readFileSync(path.join(src, 'index.html'), 'utf8');
// fonts in src/fonts (named Family_Name-400.woff) are embedded as base64, so the page looks the same on any laptop, offline
const fontDir = path.join(src, 'fonts');
const fontFiles = fs.existsSync(fontDir) ? fs.readdirSync(fontDir).filter((f) => /\.woff2?$/.test(f)).sort() : [];
const faces = fontFiles.map((f) => {
  const m = f.match(/^(.+)-(\d{3})\.(woff2?)$/);
  if (!m) throw new Error(`font file name must look like Family_Name-400.woff: ${f}`);
  const data = fs.readFileSync(path.join(fontDir, f)).toString('base64');
  return `@font-face{font-family:"${m[1].replace(/_/g, ' ')}";font-weight:${m[2]};font-style:normal;font-display:block;src:url(data:font/${m[3]};base64,${data}) format("${m[3]}")}`;
});
const css = (faces.length ? `/* embedded fonts (SIL Open Font License 1.1, see tool/src/fonts/OFL.txt) */\n${faces.join('\n')}\n` : '') + fs.readFileSync(path.join(src, 'style.css'), 'utf8');
const jsDir = path.join(src, 'js');
const files = fs.readdirSync(jsDir).filter((f) => f.endsWith('.js')).sort();
// each file gets its own block scope (file-level consts cannot collide); NS is shared through globalThis
const js = "'use strict';\n" + files.map((f) => `// ---- ${f} ----\n{\n${fs.readFileSync(path.join(jsDir, f), 'utf8')}\n}`).join('\n');

if (/<\/script/i.test(js)) throw new Error('JS must not contain a closing script tag');
if (!html.includes('/*__CSS__*/') || !html.includes('/*__JS__*/')) throw new Error('placeholders missing in index.html');

const out = html.replace('/*__CSS__*/', () => css).replace('/*__JS__*/', () => js);
const dest = path.join(__dirname, 'NasaSatLab.html');
fs.writeFileSync(dest, out);
console.log(`built ${dest} (${(Buffer.byteLength(out) / 1024).toFixed(1)} KB, ${files.length} js files, ${fontFiles.length} fonts)`);
