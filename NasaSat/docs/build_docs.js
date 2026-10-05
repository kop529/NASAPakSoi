// Turns the Thai Markdown documents into single-file HTML pages (figures inlined, print-ready A4, works offline).
// usage: node docs/build_docs.js                       -> every document below
//        node docs/build_docs.js SUNSEEK_CHEATSHEET_TH   -> only the document(s) whose .md name contains the argument
// -> docs/THEORY_TH.html, PLAYBOOK_TH.html, CHEATSHEET_TH.html, SUNSEEK_CHEATSHEET_TH.html
// PDF (A4, no header/footer): chrome --headless=new --no-pdf-header-footer --print-to-pdf=<out.pdf> file:///C:/TYSC/NasaSat/docs/<name>.html
//   (a file URL with spaces needs %20)
'use strict';
const fs = require('fs');
const path = require('path');

const here = __dirname;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function inline(text) {
  const codes = [];
  let s = text.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = esc(s).replace(/\\\|/g, '|');
  s = s.replace(/\s*¶\s*/g, '<br>'); // "¶" = line break inside a table cell
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?=[^*\w]|$)/g, '$1<em>$2</em>');
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => `<a href="${u}">${t}</a>`);
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[+i])}</code>`);
}

const slug = (() => {
  let n = 0;
  return () => `s${++n}`;
})();

function figure(alt, src) {
  const file = path.join(here, src);
  if (/\.svg$/i.test(src) && fs.existsSync(file)) {
    let svg = fs.readFileSync(file, 'utf8');
    svg = svg.slice(svg.indexOf('<svg'));
    svg = svg.replace(/<svg([^>]*?)\swidth="[^"]*"/, '<svg$1').replace(/<svg([^>]*?)\sheight="[^"]*"/, '<svg$1');
    return `<figure>${svg}<figcaption>${inline(alt)}</figcaption></figure>`;
  }
  return `<figure><img src="${src}" alt="${esc(alt)}"><figcaption>${inline(alt)}</figcaption></figure>`;
}

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') { cur += '\\|'; i++; continue; }
    if (s[i] === '|') { cells.push(cur.trim()); cur = ''; continue; }
    cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}

function convert(md) {
  const lines = md.replace(/\r/g, '').split('\n');
  const out = [];
  const toc = [];
  let i = 0;
  let para = [];
  const flush = () => { if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; } };
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      flush();
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flush();
      const lvl = h[1].length;
      const id = slug();
      if (lvl === 2) toc.push({ id, text: h[2] });
      out.push(`<h${lvl} id="${id}">${inline(h[2])}</h${lvl}>`);
      i++;
      continue;
    }
    if (/^---+\s*$/.test(line)) { flush(); out.push('<hr>'); i++; continue; }
    const img = line.match(/^!\[(.*?)\]\((.*?)\)\s*$/);
    if (img) { flush(); out.push(figure(img[1], img[2])); i++; continue; }
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) {
      flush();
      const head = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(splitRow(lines[i++]));
      out.push(`<div class="tw"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^>\s?/.test(line)) {
      flush();
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      const warn = /^\*\*ระวัง/.test(buf[0]);
      out.push(`<blockquote${warn ? ' class="warn"' : ''}>${buf.map(inline).join('<br>')}</blockquote>`);
      continue;
    }
    const li = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
    if (li) {
      flush();
      // nested lists by indentation
      const stack = [];
      const open = (ordered, indent) => { stack.push({ ordered, indent }); out.push(ordered ? '<ol>' : '<ul>'); };
      const close = () => { const t = stack.pop(); out.push(t.ordered ? '</ol>' : '</ul>'); };
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
        if (!m) {
          if (/^\s{2,}\S/.test(lines[i]) && stack.length) { out[out.length - 1] = out[out.length - 1].replace(/<\/li>$/, `<br>${inline(lines[i].trim())}</li>`); i++; continue; }
          break;
        }
        const indent = m[1].length;
        const ordered = /\d+\./.test(m[2]);
        while (stack.length && indent < stack[stack.length - 1].indent) close();
        if (!stack.length || indent > stack[stack.length - 1].indent) open(ordered, indent);
        let body = m[3];
        let cls = '';
        const cb = body.match(/^\[( |x)\]\s+(.*)$/i);
        if (cb) { body = cb[2]; cls = ' class="task"'; }
        out.push(`<li${cls}>${cb ? `<span class="box">${cb[1].trim() ? '☑' : '☐'}</span> ` : ''}${inline(body)}</li>`);
        i++;
      }
      while (stack.length) close();
      continue;
    }
    if (/^\s*$/.test(line)) { flush(); i++; continue; }
    para.push(line.trim());
    i++;
  }
  flush();
  return { html: out.join('\n'), toc };
}

const CSS = `
:root { --bg: #ffffff; --fg: #1d1f23; --muted: #5b616b; --line: #d9dde3; --soft: #f3f5f8; --accent: #1f6fb2; --quote: #eef6ee; --quoteLine: #2f8f5b; --code: #f1f3f6; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #16181c; --fg: #e8eaed; --muted: #a3a9b3; --line: #353a42; --soft: #1f2329; --accent: #7db7ea; --quote: #1c2a22; --quoteLine: #5cc28b; --code: #23272e; } }
:root[data-theme="dark"] { --bg: #16181c; --fg: #e8eaed; --muted: #a3a9b3; --line: #353a42; --soft: #1f2329; --accent: #7db7ea; --quote: #1c2a22; --quoteLine: #5cc28b; --code: #23272e; }
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--bg); color: var(--fg); font-family: 'Leelawadee UI', 'Sarabun', 'Noto Sans Thai', Tahoma, sans-serif; line-height: 1.65; font-size: 16px; }
main { max-width: 860px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { font-size: 1.7rem; line-height: 1.3; margin: 0.2em 0 0.6em; }
h2 { font-size: 1.3rem; margin: 2em 0 0.6em; padding-top: 0.4em; border-top: 2px solid var(--line); }
h3 { font-size: 1.08rem; margin: 1.5em 0 0.4em; }
h4 { font-size: 1rem; margin: 1.2em 0 0.3em; }
p { margin: 0.5em 0; }
a { color: var(--accent); }
code { font-family: Consolas, 'Cascadia Mono', monospace; background: var(--code); padding: 0 4px; border-radius: 4px; font-size: 0.92em; }
pre { background: var(--code); padding: 10px 12px; border-radius: 8px; overflow-x: auto; font-size: 0.9rem; line-height: 1.5; }
pre code { background: none; padding: 0; font-family: Consolas, 'Cascadia Mono', 'Leelawadee UI', monospace; }
.tw { overflow-x: auto; margin: 0.7em 0; }
table { border-collapse: collapse; width: 100%; font-size: 0.93rem; }
th, td { border: 1px solid var(--line); padding: 5px 8px; text-align: left; vertical-align: top; }
th { background: var(--soft); }
blockquote { margin: 1em 0; padding: 10px 14px; background: var(--quote); border-left: 4px solid var(--quoteLine); border-radius: 6px; }
figure { margin: 1em 0; }
figure svg, figure img { width: 100%; height: auto; display: block; background: #ffffff; border-radius: 6px; }
figcaption { color: var(--muted); font-size: 0.88rem; margin-top: 4px; }
hr { border: 0; border-top: 1px solid var(--line); margin: 1.5em 0; }
ul, ol { padding-left: 1.4em; }
li { margin: 0.15em 0; }
li.task { list-style: none; margin-left: -1.2em; }
.box { display: inline-block; width: 1.1em; }
.toc { background: var(--soft); border-radius: 8px; padding: 10px 16px; margin: 1em 0 1.5em; }
.toc ul { margin: 0.3em 0; padding-left: 0; list-style: none; columns: 2; column-gap: 28px; }
.meta { color: var(--muted); font-size: 0.85rem; }
@media (max-width: 640px) { .toc ul { columns: 1; } body { font-size: 15px; } }
@media print {
  @page { size: A4; margin: 14mm 13mm; }
  body { font-size: 10.5pt; background: #fff; color: #000; }
  main { max-width: none; padding: 0; }
  h2 { break-before: page; border-top: 0; }
  h2:first-of-type { break-before: auto; }
  figure, table, pre, blockquote { break-inside: avoid; }
  tr { break-inside: avoid; }
  a { color: #000; text-decoration: none; }
  .toc { break-after: page; }
}
.cheat main { max-width: 1100px; }
.cheat h2 { break-before: auto; border-top: 1px solid var(--line); font-size: 1.02rem; margin: 0.8em 0 0.3em; }
.cheat .cols { columns: 2; column-gap: 22px; }
.cheat .cols > * { break-inside: avoid; }
.cheat table { font-size: 0.86rem; }
.cheat th, .cheat td { padding: 3px 6px; }
@media (max-width: 800px) { .cheat .cols { columns: 1; } }
@media print {
  html.cheat { font-size: 8.2pt; }
  html.cheat body { font-size: 8.2pt; line-height: 1.35; }
  html.cheat h1 { font-size: 12pt; margin: 0 0 3px; }
  html.cheat h2 { font-size: 9pt; margin: 0.5em 0 0.2em; }
  html.cheat p { margin: 0.25em 0; }
  html.cheat .tw { margin: 0.3em 0; }
  html.cheat th, html.cheat td { padding: 1.5px 4px; }
  html.cheat .meta { display: none; }
}
blockquote.warn { background: #fdecea; border-left-color: #c62828; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) blockquote.warn { background: #34201f; border-left-color: #ef6a62; } }
:root[data-theme="dark"] blockquote.warn { background: #34201f; border-left-color: #ef6a62; }
.sop .cols > * { break-inside: auto; }
.sop .cols > figure, .sop .cols > pre, .sop .cols > blockquote, .sop .cols > h2, .sop .cols > h3, .sop .cols > h4 { break-inside: avoid; }
.sop h2, .sop h3, .sop h4 { break-after: avoid; }
.sop h3 { font-size: 1rem; margin: 0.9em 0 0.25em; }
.sop h4 { font-size: 0.95rem; margin: 0.6em 0 0.2em; }
.sop pre { white-space: pre-wrap; word-break: break-all; font-size: 0.8rem; margin: 0.35em 0; padding: 5px 8px; }
.sop code { overflow-wrap: anywhere; }
.sop table { font-size: 0.8rem; }
.sop td:empty { height: 2.1em; }
.sop blockquote { padding: 4px 8px; margin: 0.5em 0; }
.sop ol, .sop ul { margin: 0.25em 0; padding-left: 1.3em; }
.sop figure { margin: 0.5em 0; }
@media print {
  html.sop, html.sop body { font-size: 8pt; line-height: 1.32; }
  html.sop * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html.sop h1 { font-size: 12.5pt; }
  html.sop h2 { font-size: 9.6pt; margin: 0.7em 0 0.2em; border-top: 1.5px solid #444; }
  html.sop h3 { font-size: 8.8pt; margin: 0.6em 0 0.15em; }
  html.sop h4 { font-size: 8.3pt; margin: 0.4em 0 0.1em; }
  html.sop pre { font-size: 6.9pt; padding: 2px 5px; margin: 0.25em 0; }
  html.sop table { font-size: 7.4pt; }
  html.sop th, html.sop td { padding: 1.5px 3px; }
  html.sop td:empty { height: 6.4mm; }
  html.sop blockquote { padding: 2px 6px; margin: 0.3em 0; }
  html.sop ol, html.sop ul { margin: 0.15em 0; }
  html.sop li { margin: 0.05em 0; }
  html.sop figure { margin: 0.3em 0; }
  html.sop figcaption { font-size: 7pt; }
}
`;

function page(file, title, { cheat = false, sop = false } = {}) {
  const cls = cheat ? (sop ? 'cheat sop' : 'cheat') : '';
  const md = fs.readFileSync(path.join(here, file), 'utf8');
  const { html, toc } = convert(md);
  let body = html;
  if (!cheat && toc.length > 3) {
    const tocHtml = `<nav class="toc"><strong>สารบัญ</strong><ul>${toc.map((t) => `<li><a href="#${t.id}">${inline(t.text)}</a></li>`).join('')}</ul></nav>`;
    const firstH2 = body.indexOf('<h2');
    body = body.slice(0, firstH2) + tocHtml + body.slice(firstH2);
  }
  if (cheat) {
    const h1end = body.indexOf('</h1>') + 5;
    body = body.slice(0, h1end) + '<div class="cols">' + body.slice(h1end) + '</div>';
  }
  const stamp = new Date().toISOString().slice(0, 10);
  return `<!doctype html>
<html lang="th"${cls ? ` class="${cls}"` : ''}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title><style>${CSS}</style></head>
<body class="${cls}"><main>
${body}
<p class="meta">สร้างจาก ${file} เมื่อ ${stamp} · พิมพ์: Ctrl+P (A4)</p>
</main></body></html>
`;
}

const only = process.argv.slice(2);
for (const [src, dst, title, opt] of [
  ['THEORY_TH.md', 'THEORY_TH.html', 'ทฤษฎี NasaSat', {}],
  ['PLAYBOOK_TH.md', 'PLAYBOOK_TH.html', 'คู่มือหน้างาน NasaSat', {}],
  ['CHEATSHEET_TH.md', 'CHEATSHEET_TH.html', 'NasaSat cheat sheet', { cheat: true }],
  ['SUNSEEK_CHEATSHEET_TH.md', 'SUNSEEK_CHEATSHEET_TH.html', 'SunSeek โพยหน้างาน', { cheat: true, sop: true }],
]) {
  if (only.length && !only.some((a) => src.includes(a))) continue;
  const html = page(src, title, opt);
  fs.writeFileSync(path.join(here, dst), html);
  console.log(`wrote docs/${dst} (${(html.length / 1024).toFixed(0)} KB)`);
}
