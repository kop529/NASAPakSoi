// writes deck/<name>.html from one template (same head, logo, scale script). cover.html and team.html are hand-written (own copy of the tokens).
// Render previews: deck/render_previews.sh (headless Edge, 1920x1080) -> deck/<name>_preview.png
const fs = require('fs');
const D = 'C:/TYSC/SunSeek/presentation/deck/';
const page = (n, title, cls, body) => `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<title>NasaPakSoi · ${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Kanit:wght@500;600&family=IBM+Plex+Sans+Thai:wght@400;500&family=IBM+Plex+Mono:wght@400&display=swap" rel="stylesheet">
<link rel="stylesheet" href="base.css">
</head>
<body>
<section class="slide ${cls}">
  <img class="logo" src="img/tysc_logo_lime.png" alt="Thailand Young Satellite Challenge">
${body}
  <div class="page">${String(n).padStart(2, '0')}</div>
</section>
<script>
  const s = document.querySelector('.slide');
  const fit = () => { s.style.transform = \`scale(\${Math.min(innerWidth / 1920, innerHeight / 1080)})\`; };
  addEventListener('resize', fit); fit();
</script>
</body>
</html>
`;

// ---------- small SVG helpers ----------
const LIME = '#A9B92A', BLUE = '#4F8FE8', PINK = '#D0689C', MUTED = '#A3AA9C', LINE = '#3A4236', SURF = '#20261D', BG = '#0A0C09';
const rad = (d) => d * Math.PI / 180;
const P = (cx, cy, r, a) => [cx + r * Math.cos(rad(a)), cy + r * Math.sin(rad(a))];
// arc from angle a0 to a1 (degrees, SVG convention: clockwise on screen = increasing angle)
const arc = (cx, cy, r, a0, a1) => {
  const [x0, y0] = P(cx, cy, r, a0), [x1, y1] = P(cx, cy, r, a1);
  return `M${x0.toFixed(1)},${y0.toFixed(1)}A${r},${r} 0 ${Math.abs(a1 - a0) > 180 ? 1 : 0} ${a1 > a0 ? 1 : 0} ${x1.toFixed(1)},${y1.toFixed(1)}`;
};
const marker = (id, color) => `<marker id="${id}" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3.6" markerHeight="3.6" orient="auto"><path d="M0,0L10,5L0,10z" fill="${color}"/></marker>`;

// ---------- p3 vehicle: callouts drawn on the real photo (1920x1080 photo shown at 1040 px wide, top-left 112,318) ----------
const PH = (x, y) => [112 + x * 1040 / 1920, 318 + y * 1040 / 1920];
const callouts = (() => {
  const items = [
    { at: PH(885, 245), ly: 444 },   // black 3D print: one of the four LDRs (upper right)
    { at: PH(1130, 525), ly: 594 },  // green PCB with the SunSeek silkscreen
    { at: PH(985, 705), ly: 724 },   // wheel disc with the hex nuts
  ];
  let s = `<svg class="callouts" viewBox="0 0 1920 1080">`;
  for (const { at: [x, y], ly } of items) {
    const pts = `${x.toFixed(1)},${y.toFixed(1)} ${(x + 40).toFixed(1)},${ly} 1236,${ly}`;
    s += `<polyline points="${pts}" fill="none" stroke="#000" stroke-opacity=".55" stroke-width="7" stroke-linejoin="round"/>`;
    s += `<polyline points="${pts}" fill="none" stroke="${LIME}" stroke-width="3" stroke-linejoin="round"/>`;
    s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="9" fill="${LIME}" stroke="${BG}" stroke-width="3"/>`;
  }
  return s + '</svg>';
})();

// ---------- p4 physics diagram ----------
const physicsSvg = (() => {
  const panels = [
    { ox: 0, n: '1', title: 'ล้อเร่งขึ้น', rot: -14, w: [-70, 170, 8], b: [38, -38, 8], bl: 'ยาน', sub: ['ยานหมุนสวนทิศล้อ'] },
    { ox: 578, n: '2', title: 'ล้อหมุนคงที่', rot: -28, w: [-70, 170, 4], b: [38, -38, 5], bl: 'ยาน หมุนต่อ', sub: ['ไม่มีแรงบิด ยานหมุนต่อด้วยความเร็วเดิม', 'บนแท่นจริง แรงเสียดทานค่อย ๆ หน่วงให้ช้าลง'] },
    { ox: 1156, n: '3', title: 'ล้อไหลจนหยุด', rot: -22, w: [-70, 40, 4], b: [-38, 38, 8], bl: 'ยาน', sub: ['ล้อคืนโมเมนตัม ยานถูกดันตามทิศล้อ', 'บนแท่น ยานที่หยุดแล้วจึงหมุนกลับ'] },
  ];
  let s = `<svg class="svgfig" style="top:296px" width="1696" height="582" viewBox="0 0 1696 582"><defs>${marker('aL', LIME)}${marker('aB', BLUE)}</defs>`;
  for (const p of panels) {
    s += `<g transform="translate(${p.ox},0)">`;
    s += `<text class="k" x="270" y="32" text-anchor="middle" font-size="34"><tspan fill="${LIME}">${p.n}</tspan>  ${p.title}</text>`;
    s += `<g transform="translate(270,138)">`;
    s += `<rect x="-75" y="-75" width="150" height="150" fill="none" stroke="${LINE}" stroke-width="2" stroke-dasharray="7 6"/>`;           // start orientation
    s += `<g transform="rotate(${p.rot})"><rect x="-75" y="-75" width="150" height="150" fill="${SURF}" stroke="#4A5345" stroke-width="3"/>`;
    s += `<rect x="-28" y="-83" width="56" height="12" rx="2" fill="#F1F3EE"/>`;                                                       // front face (sun sensor)
    s += `<circle r="42" fill="#141812" stroke="${LIME}" stroke-width="3"/></g>`;
    s += `<text class="k" x="0" y="9" text-anchor="middle" font-size="26" style="fill:${LIME}">ล้อ</text>`;
    s += `<path d="${arc(0, 0, 62, p.w[0], p.w[1])}" fill="none" stroke="${LIME}" stroke-width="${p.w[2]}" marker-end="url(#aL)"/>`;
    if (p.b) s += `<path d="${arc(0, 0, 124, p.b[0], p.b[1])}" fill="none" stroke="${BLUE}" stroke-width="${p.b[2]}" marker-end="url(#aB)"/>`;
    s += `<text class="k" x="146" y="9" font-size="26" style="fill:${BLUE}">${p.bl}</text>`;
    s += `</g>`;
    s += `<text x="270" y="284" text-anchor="middle" font-size="26">${p.sub[0]}</text>`;
    if (p.sub[1]) s += `<text class="m" x="270" y="314" text-anchor="middle" font-size="22">${p.sub[1]}</text>`;
    s += `</g>`;
  }
  // wheel speed + torque on the body, same time axis as the three panels (schematic, not measured)
  s += `<g transform="translate(0,-4)">`;
  const dec = []; for (let x = 1156; x <= 1696; x += 20) dec.push(`${x},${(400 - 60 * Math.exp(-(x - 1156) / 150)).toFixed(1)}`);
  s += `<line x1="559" y1="346" x2="559" y2="566" stroke="${LINE}" stroke-dasharray="4 6"/><line x1="1137" y1="346" x2="1137" y2="566" stroke="${LINE}" stroke-dasharray="4 6"/>`;
  s += `<text class="m" x="0" y="352" font-size="22">ความเร็วล้อ</text>`;
  s += `<line x1="0" y1="400" x2="1696" y2="400" stroke="${LINE}"/>`;
  s += `<path d="M0,400 L540,340 L1156,340 L${dec.join(' L')}" fill="none" stroke="${LIME}" stroke-width="5" stroke-linejoin="round"/>`;
  s += `<text class="m" x="0" y="452" font-size="22">แรงบิดที่ยานได้รับ</text>`;
  s += `<line x1="0" y1="500" x2="1696" y2="500" stroke="${LINE}" stroke-width="2"/>`;
  s += `<rect x="0" y="500" width="540" height="14" fill="${BLUE}"/>`;
  const tq = []; for (let x = 1156; x <= 1696; x += 20) tq.push(`${x},${(500 - 50.4 * Math.exp(-(x - 1156) / 150)).toFixed(1)}`);
  s += `<path d="M1156,500 L${tq.join(' L')} L1696,500 Z" fill="${BLUE}"/>`;
  s += `<text class="k" x="270" y="544" text-anchor="middle" font-size="26" style="fill:${BLUE}">ทวนทิศล้อ</text>`;
  s += `<text class="k" x="848" y="530" text-anchor="middle" font-size="26" style="fill:${MUTED}">0</text>`;
  s += `<text class="k" x="1426" y="544" text-anchor="middle" font-size="26" style="fill:${BLUE}">ตามทิศล้อ</text>`;
  s += `<text class="m" x="848" y="572" text-anchor="middle" font-size="22">พื้นที่ช่วง 1 เท่ากับช่วง 3 เพราะโมเมนตัมที่ล้อยืมไปตอนเร่ง ถูกคืนตอนไหลหยุด</text>`;
  return s + '</g></svg>';
})();

// ---------- B3: pass / fail tiles ----------
const tiles = (fail, total) => {
  let s = `<svg width="662" height="74" viewBox="0 0 662 74">`;
  for (let i = 0; i < total; i++) {
    const x = i * 86, bad = i < fail;
    if (bad) s += `<rect x="${x + 1.5}" y="1.5" width="71" height="71" fill="none" stroke="${PINK}" stroke-width="3"/><path d="M${x + 20},20 L${x + 54},54 M${x + 54},20 L${x + 20},54" stroke="${PINK}" stroke-width="6" stroke-linecap="round"/>`;
    else s += `<rect x="${x}" y="0" width="74" height="74" fill="${LIME}"/><path d="M${x + 18},38 L${x + 32},52 L${x + 57},23" fill="none" stroke="${BG}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  return s + '</svg>';
};

// ---------- B6: two CPU cores, STOP arriving between "compute" and "write wheel" ----------
const stopSvg = (() => {
  const box = (x, y, w, h, t, st) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${st === 'lime' ? '#262E1B' : SURF}" stroke="${st === 'lime' ? LIME : st === 'pink' ? PINK : '#4A5345'}" stroke-width="2.5"${st === 'dash' ? ' stroke-dasharray="8 6"' : ''}/>`
    + `<text class="k" x="${x + w / 2}" y="${y + h / 2 + 9}" text-anchor="middle" font-size="25">${t}</text>`;
  let s = `<svg class="svgfig" style="top:430px" width="1696" height="520" viewBox="0 0 1696 520"><defs>${marker('aP', PINK)}${marker('aL', LIME)}</defs>`;
  // scene A: today's code
  s += `<text class="k" x="0" y="26" font-size="30" style="fill:${PINK}">แบบเดิม</text>`;
  s += `<text class="m" x="0" y="92" font-size="23">core 0 (บลูทูธ)</text><text class="m" x="0" y="172" font-size="23">core 1 (ลูปคุม)</text>`;
  s += box(250, 150, 190, 56, 'อ่านเซนเซอร์') + box(450, 150, 190, 56, 'คำนวณ') + box(760, 150, 300, 56, 'สั่งล้อ (คำสั่งเดิม)', 'pink') + box(1070, 150, 190, 56, 'รอบถัดไป', 'dash');
  s += box(680, 64, 330, 56, 'STOP → ล้อ 0 → ตอบ ACK', 'lime');
  s += `<line x1="700" y1="120" x2="700" y2="150" stroke="${PINK}" stroke-width="3" marker-end="url(#aP)"/>`;
  s += `<text x="1290" y="176" font-size="25" style="fill:${PINK}">ลูปเขียนทับ → ล้อยังหมุน</text><text class="m" x="1290" y="206" font-size="23">GS เห็น ACK,STOP แล้ว</text>`;
  s += `<line x1="700" y1="160" x2="700" y2="226" stroke="${PINK}" stroke-width="2" stroke-dasharray="5 5"/>`;
  s += `<text class="m" x="700" y="252" text-anchor="middle" font-size="22">STOP มาถึงตรงนี้ (หลังคำนวณ ก่อนสั่งล้อ)</text>`;
  // scene B: team-5
  const o = 290;
  s += `<line x1="0" y1="${o - 14}" x2="1696" y2="${o - 14}" stroke="${LINE}"/>`;
  s += `<text class="k" x="0" y="${o + 26}" font-size="30" style="fill:${LIME}">แบบที่แก้แล้ว</text>`;
  s += `<text class="m" x="0" y="${o + 92}" font-size="23">core 0 (บลูทูธ)</text><text class="m" x="0" y="${o + 172}" font-size="23">core 1 (ลูปคุม)</text>`;
  s += box(250, o + 150, 190, 56, 'อ่านเซนเซอร์') + box(450, o + 150, 190, 56, 'คำนวณ') + box(650, o + 150, 190, 56, 'สั่งล้อ') + box(850, o + 150, 410, 56, 'หยิบคิว → STOP → ล้อ 0', 'lime');
  s += box(680, o + 64, 270, 56, 'STOP → ใส่คิว', 'lime');
  s += `<path d="M810,${o + 120} L810,${o + 136} L1000,${o + 136} L1000,${o + 150}" fill="none" stroke="${LIME}" stroke-width="3" marker-end="url(#aL)"/>`;
  s += `<text x="1290" y="${o + 176}" font-size="25" style="fill:${LIME}">ลูปเป็นคนสั่งล้อคนเดียว</text><text class="m" x="1290" y="${o + 206}" font-size="23">หยุดภายในรอบถัดไป</text>`;
  return s + '</svg>';
})();

// ---------- B8: capture error before / after (simulation), horizontal bars ----------
const capSvg = (() => {
  const rows = [['เป้า 1', 2.95, 1.49], ['เป้า 2', 2.92, 0.42], ['เป้า 3', 2.60, 0.28]];
  const k = 200, x0 = 110;   // px per degree, left margin
  let s = `<svg class="svgfig res" style="left:112px;top:640px" width="800" height="350" viewBox="0 0 800 350">`;
  s += `<text class="m" x="0" y="26" font-size="23">error ตอนกดชัตเตอร์ (องศา)</text>`;
  rows.forEach(([name, a, b], i) => {
    const y = 52 + i * 92;
    s += `<text class="k" x="0" y="${y + 40}" font-size="26">${name}</text>`;
    s += `<rect x="${x0}" y="${y}" width="${a * k}" height="32" fill="#4A5345"/><text x="${x0 + a * k - 12}" y="${y + 25}" font-size="24" text-anchor="end">${a.toFixed(2)}</text>`;
    s += `<rect x="${x0}" y="${y + 38}" width="${b * k}" height="32" fill="${LIME}"/><text x="${x0 + b * k + 12}" y="${y + 63}" font-size="24" style="fill:${LIME}">${b.toFixed(2)}</text>`;
  });
  s += `<line x1="${x0 + 3 * k}" y1="40" x2="${x0 + 3 * k}" y2="322" stroke="${PINK}" stroke-width="3" stroke-dasharray="8 6"/>`;
  s += `<text x="${x0 + 3 * k - 10}" y="314" text-anchor="end" font-size="22" style="fill:${PINK}">ขอบระยะคลาด 3°</text>`;
  s += `<rect x="${x0}" y="330" width="18" height="12" fill="#4A5345"/><text class="m" x="${x0 + 26}" y="342" font-size="21">ก่อนแก้</text><rect x="${x0 + 130}" y="330" width="18" height="12" fill="${LIME}"/><text x="${x0 + 156}" y="342" font-size="21" style="fill:${LIME}">หลังแก้</text>`;
  return s + '</svg>';
})();

const wifiSvg = (() => {
  // 2.4 GHz scan at the hotel, 7 Oct 22:40 (netsh): strongest network per channel; each channel is ~20 MHz wide, 5 MHz apart
  const ch = { 1: [['กล้องเรา', 96, 'us'], ['กล้องอีกทีม', 78, 'cam'], ['Wi-Fi โรงแรม', 75, ''], ['SciusCMU', 57, '']], 6: [['Wi-Fi โรงแรม', 80, '']], 11: [['Wi-Fi โรงแรม', 67, '']] };
  const x = (c) => 130 + (c - 1) * 58, base = 330;
  let s = `<svg class="svgfig" style="left:112px;top:300px" width="900" height="420" viewBox="0 0 900 420">`;
  s += `<text class="m" x="0" y="24" font-size="22">ช่อง Wi-Fi 2.4 GHz ที่ห้องพัก ความสูง = ความแรงสัญญาณ ความกว้าง = ช่วงความถี่ที่ใช้</text>`;
  for (let c = 1; c <= 13; c++) s += `<text class="m" x="${x(c)}" y="${base + 32}" font-size="22" text-anchor="middle">${c}</text>`;
  s += `<line x1="40" y1="${base}" x2="900" y2="${base}" stroke="#2C3328" stroke-width="2"/>`;
  for (const [c, nets] of Object.entries(ch)) nets.forEach(([name, p, k], i) => {
    // our camera before: primary channel 1 but 40 MHz wide (phone analyzer: channels 1-5)
    const h = p * 2.2, cx = k === 'us' ? x(3) : x(+c), w = k === 'us' ? 124 : 62;
    const col = k === 'us' ? LIME : k === 'cam' ? PINK : '#4A5345';
    s += `<path d="M${cx - w} ${base} Q${cx} ${base - 2 * h} ${cx + w} ${base}" fill="${col}" fill-opacity="${k === 'us' ? 0.25 : k ? 0.55 : 0.35}" stroke="${col}" stroke-width="2"/>`;
  });
  s += `<text x="${x(2) + 20}" y="60" font-size="22" style="fill:${LIME}">กล้องเรา (เดิม) ช่อง 1 กว้าง 40 MHz</text>`;
  s += `<text x="${x(2) + 20}" y="88" font-size="22" style="fill:${PINK}">กล้องอีกทีม 78%</text>`;
  s += `<text class="m" x="${x(2) + 20}" y="116" font-size="22">+ Wi-Fi โรงแรมและอื่น ๆ</text>`;
  // our camera now: channel 11, 20 MHz (laptop scan 89 %)
  s += `<path d="M${x(11) - 62} ${base} Q${x(11)} ${base - 2 * 89 * 2.2} ${x(11) + 62} ${base}" fill="none" stroke="${LIME}" stroke-width="4" stroke-dasharray="10 7"/>`;
  s += `<text x="${x(11)}" y="${base - 89 * 2.2 - 16}" font-size="22" text-anchor="middle" style="fill:${LIME}">กล้องเรา (ใหม่) ช่อง 11</text>`;
  s += `<text class="m" x="0" y="${base + 70}" font-size="20">แต่ละช่องกว้าง ~20 MHz แต่ห่างกันแค่ 5 MHz ช่องที่ติดกันจึงทับกัน</text>`;
  return s + '</svg>';
})();

const slides = [
  // ---------------- main pages ----------------
  [3, 'vehicle', 'ยานของเรา', '', `  <div class="head">
    <div class="eyebrow">ยานของเรา</div>
    <h2>ยานต้องหันเข้าหาหลอดไฟเอง ด้วย<em>ล้อหมุนล้อเดียว</em></h2>
  </div>
  <div class="task">
    <div><span>ภารกิจ 1</span>หันเข้าหาหลอดไฟ แล้วค้างให้นิ่ง</div>
    <div><span>ภารกิจ 2</span>หันไปตามมุมที่กำหนด แล้วถ่ายภาพ</div>
  </div>
  <figure class="vphoto"><img src="img/sat_20261006.jpg" alt="ยานของทีมบนแท่นหมุน เห็นด้านหน้า: ชิ้นงานพิมพ์ 3 มิติสีดำมี LDR 4 ตัว บอร์ด SunSeek สีเขียว และล้อด้านล่าง"></figure>
${callouts}
  <div class="part" style="top:425px"><b>เซนเซอร์แสง</b><span>ชิ้นงานพิมพ์ 3 มิติสีดำของผู้จัด ติดหน้ายาน มี LDR 4 ตัว ซ้าย 2 ขวา 2</span></div>
  <div class="part" style="top:575px"><b>บอร์ด SunSeek</b><span>ESP32-S3 อยู่บนบอร์ดนี้ เฟิร์มแวร์ที่เราแก้ก็รันที่นี่</span></div>
  <div class="part" style="top:705px"><b>ล้อปฏิกิริยา</b><span>มอเตอร์ DC + วงเหล็กถ่วง เป็นสิ่งเดียวที่ทำให้ยานหมุน</span></div>
  <div class="absent"><b>ไม่เห็นในภาพนี้:</b> กล้อง ESP32-CAM ติดด้านซ้ายของยาน ห่างจากเซนเซอร์แสงราว 90° ส่งภาพทาง Wi-Fi ช่อง 11 เพราะช่อง 1 ที่กล้องทุกทีมใช้แน่น ใต้กล้องมี IMU GY-89 สีฟ้าบนบอร์ดขนมปัง แบตเตอรี่ และสวิตช์ไฟ</div>
  <div class="source">ภาพถ่ายจริง 6 ต.ค. 2569</div>`],

  [4, 'physics', 'ฟิสิกส์', '', `  <div class="head">
    <div class="eyebrow">ฟิสิกส์ที่ใช้</div>
    <h2>ล้อเร่งไปทางหนึ่ง ยาน<em>หมุนสวนไปอีกทาง</em></h2>
  </div>
  <div class="eq"><div class="f">I<sub>ยาน</sub> · ω<sub>ยาน</sub> + I<sub>ล้อ</sub> · ω<sub>ล้อ</sub> = ค่าคงที่</div><div class="why">ใช้ได้เมื่อไม่มีแรงบิดจากภายนอก (แรงเสียดทานของแท่นนับเป็นแรงภายนอก)<br>ยานเริ่มจากนิ่ง ผลรวมจึงเป็น 0</div></div>
${physicsSvg}
  <div class="chips">
    <div><b>±10 %</b>คำสั่งที่ล้อเริ่มหมุน</div>
    <div><b>20–80 %</b>ความเร็วเกือบเป็นเส้นตรงตามคำสั่ง</div>
    <div><b>~6 วินาที</b>ปล่อยไหลจาก 30 % จนล้อหยุด</div>
    <div><b>&gt; 25 %</b>ที่แท่นเริ่มขยับ แล้วลื่นมาก</div>
  </div>
  <div class="source">ตัวเลขในกล่องวัดจากบอร์ดจริงวันที่ 5–6 ต.ค. ส่วนกราฟเป็นภาพอธิบาย แถบขาวบนยานคือด้านหน้า</div>`],

  [5, 'ours', 'สิ่งที่เราสร้าง', '', `  <div class="head">
    <div class="eyebrow">สิ่งที่เราสร้างเอง</div>
    <h2>ของที่ผู้จัดให้มา กับ<em>ที่เราเพิ่มเอง</em></h2>
  </div>
  <div class="legend"><i class="g"></i>โค้ดผู้จัด <i class="l"></i>ทีมทำเอง</div>
  <div class="pipe">
      <div class="stage"><div class="adds"><span>โมเดล LDR + ตารางแก้ค่า</span><span>เข็มทิศที่ calibrate แล้วใช้จริง</span></div><div class="box">เซนเซอร์แสง<br>gyro และเข็มทิศ</div></div>
      <div class="stage"><div class="adds"><span>ตั้งมุมใหม่ตอนเข้า AUTO</span><span>เห็นเร็วขึ้น 90 ms</span></div><div class="box">มุมของยาน</div></div>
      <div class="stage"><div class="adds"><span>HOLD ใกล้เป้าแล้วนิ่ง</span><span>เตะล้อเมื่อยานค้าง</span></div><div class="box">ตัวคุม</div></div>
      <div class="stage"><div class="adds"><span>ชดเชยช่วงที่ล้อไม่หมุน</span><span>จำกัดอัตราเปลี่ยน ไม่กระชาก</span></div><div class="box">ล้อปฏิกิริยา</div></div>
      <div class="stage"><div class="adds"><span>จูนไร้สาย TEAM_SET</span><span>กล่องดำ 96 วิ</span></div><div class="box">บลูทูธ ↔ GS</div></div>
  </div>
  <div class="tools">
    <div><b>เว็บ NasaSat Lab</b>คาลิเบรต จูน และดึงกล่องดำ ผ่านบลูทูธจากเบราว์เซอร์</div>
    <div><b>ตัวจำลองบนคอม</b>รันโค้ดเฟิร์มแวร์ตัวจริง ลองได้ก่อนอัปลงบอร์ด</div>
  </div>
  <div class="source">แก้และเพิ่มรวม 32 เรื่อง (ภาคผนวก B2) และยังใช้ GS ของผู้จัดสั่งงานได้เหมือนเดิม</div>`],

  [6, 'turns', 'หมุน 3 รอบ', 'has-vs', `  <div class="head">
    <div class="eyebrow">6 ต.ค. 15:36</div>
    <h2>เป้าห่างแค่ 18° แต่ยาน<em>หมุนไปเกือบ 3 รอบ</em>ก่อนเข้าเป้า</h2>
  </div>
  <div class="vs">
    <div><span>คาดไว้</span>เริ่มที่ −18° ล้อหมุนนิดเดียว หันเข้าเป้าในไม่กี่วินาที</div>
    <div class="found"><span>เจอจริง</span>ล้อถูกสั่ง −40% ค้าง 6 วิ ยานหมุนไปราว 1,000° แล้วค่อยกลับมาเข้าเป้า</div>
  </div>
  <figure class="chart" style="width:960px"><img src="../charts/c6_three_turns.png" alt="มุมที่ยานหมุนสะสมจาก log 15:36 ลงไปเกือบ −1080 องศา ขณะคำสั่งล้อค้างที่ −40%"></figure>
  <div class="notes" style="left:1150px;width:658px">
    <p>ยานหมุน 200 °/วิ แต่ตัวคุมไม่เบรกเลย แปลว่า error ที่ตัวคุมเห็นต้องใหญ่กว่า 18° มาก</p>
    <p><b>สาเหตุ:</b> โค้ดผู้จัดเก็บมุมสะสมไว้ทุกรอบ ก่อนหน้านั้นเราหมุนยานเล่นหลายรอบ ค่านี้จึงเกินมา 3 × 360°</p>
    <p class="key"><b>แก้:</b> คิด error ทางที่สั้นกว่า (ไม่เกิน ±180°) และตั้งมุมใหม่ทุกครั้งที่เข้า AUTO ลองบนแท่นแล้ว ยานหมุนถูกทาง</p>
  </div>
  <div class="source">ข้อมูลจาก log ของ GS เวลา 15:36 (GS บันทึกเวลาเป็นวินาที ตัวเลขสะสมจึงคลาดได้ราว 6%)</div>`],

  [7, 'blackbox', 'กล่องดำ', '', `  <div class="head">
    <div class="eyebrow">เครื่องมือที่ทีมสร้าง</div>
    <h2>ให้ยานจด<em>กล่องดำ</em>ของตัวเอง แล้วดึงมาดูทีหลัง</h2>
  </div>
  <pre class="log">TM,TEAM_CR_AUTO,ON,TGT,0.00,EST,45.10,ANG,45.10,
  LIT,1,ERR,-45.10,KP,4,KD,2,KI,1,…,SYNC,1
TM,TEAM_CR_HEAD,N,2400,DIV,2,
  COLS,i;t;tgt;ang;est;err;gz;u;I;K;rw;fl
TM,TEAM_CR,0,1450216,0.0,45.1,45.1,-45.1,0.0,-181.3,-0.9,0.0,-2,17
TM,TEAM_CR,1,1450266,0.0,45.2,45.1,-45.1,0.2,-181.8,-0.9,0.0,-27,17
TM,TEAM_CR,2,1450306,0.0,45.2,45.1,-45.1,0.2,-181.7,-0.9,0.0,-47,17
⋮
TM,TEAM_CR,2399,1556608,0.0,-2.5,-4.9,4.9,0.4,33.9,15.3,0.0,34,1
EVT,TEAM_CDUMP,END,2400</pre>
  <p class="logcap">ข้อความจริงจากบอร์ดรอบ 20:30 บันทึก 25 แถวต่อวินาที นาน 96 วินาที แล้วดึงออกมาด้วยคำสั่ง <b>TEAM_CDUMP</b></p>
  <table class="found-table">
    <tr><th>เห็นในกล่องดำ</th><th>นำไปสู่</th></tr>
    <tr><td>เข้า AUTO แล้วมุมประมาณ = มุมแสง</td><td>ยืนยันว่าแก้บั๊ก 3 รอบได้จริง</td></tr>
    <tr><td>เตะใกล้เป้าแล้วไถล 3–4.5°</td><td>HOLD + ห้ามเตะใน HOLD</td></tr>
    <tr><td>มุมประมาณช้ากว่า gyro 3.7°</td><td>ตัวกรอง 10 ค่า → 1 ค่า</td></tr>
    <tr><td>แถวห่าง 40 ms แต่บางครั้ง 97 ms</td><td>ลูปถูก Serial บล็อก → ใส่บัฟเฟอร์</td></tr>
    <tr><td>gyro ลอย 0.12 °/วิ ตอนยานนิ่ง</td><td>ตั้งศูนย์ gyro ก่อนทุกภารกิจ</td></tr>
  </table>
  <div class="source">log ของ GS มีแค่มุมกับคำสั่งล้อ ค่าที่ตัวคุม "คิด" มีอยู่ในกล่องดำเท่านั้น</div>`],

  [8, 'filter', 'ตัวกรองช้า', '', `  <div class="head">
    <div class="eyebrow">กล่องดำรอบ 20:13</div>
    <h2>ตัวกรองที่ใส่ไว้ให้ค่านิ่ง ทำให้ยาน<em>เห็นช้าไป 90 มิลลิวินาที</em></h2>
  </div>
  <figure class="chart" style="width:1160px"><img src="../charts/c2_three_angles.png" alt="มุม 3 แบบในวินาทีแรก: เซนเซอร์แสง gyro และมุมประมาณที่ช้ากว่า"></figure>
  <div class="notes">
    <p>ที่ 0.9 วินาที gyro บอก −15.6° ตรงกับแสง −15.2° แต่ตัวคุมใช้ <b>−18.9°</b></p>
    <p>ตัวกรองเฉลี่ย 10 ค่า ค่าละ 20 ms จึงตามหลังของจริงราว 90 ms ตัวคุมเห็น error ใหญ่เกินจริง เบรกจึงหายไปบางส่วน</p>
    <p class="key"><b>แก้:</b> เหลือ 1 ค่า ลองบนแท่น 1 รอบ ตอนค้างที่เป้านิ่งขึ้น ส่วนตอนหมุนเข้าเป้ายังไม่เห็นต่างชัด</p>
  </div>
  <div class="source">เส้นชมพูคือมุมที่ได้จาก gyro อย่างเดียว</div>`],

  [9, 'compass', 'เข็มทิศ', 'has-vs', `  <div class="head">
    <div class="eyebrow">ที่เจอในโค้ดผู้จัด</div>
    <h2>เข็มทิศเบี้ยวได้ถึง 55° เพราะค่าที่ calibrate <em>ไม่เคยถูกใช้</em></h2>
  </div>
  <div class="vs">
    <div><span>คาดไว้</span>สั่ง MAG_CAL หมุนยาน 1 รอบ แล้วเข็มทิศจะตรง</div>
    <div class="found"><span>เจอจริง</span>คำสั่งแค่รายงานค่า แล้วให้ไปแก้โค้ดเอง ค่าในโค้ดเป็น 0 ตลอด</div>
  </div>
  <figure class="chart" style="width:560px"><img src="../charts/c7_compass.png" alt="ค่าแม่เหล็ก x y ตอนยานหมุน 3 รอบ เป็นวงกลมรอบจุด (28, 20) ไม่ใช่รอบ (0, 0)"></figure>
  <div class="notes" style="left:760px;width:1048px">
    <p>ยานหมุน 3 รอบ (15:36) ค่าแม่เหล็กควรวนรอบ (0, 0) แต่วนรอบ <b>(28, 20) µT</b> ห่างศูนย์ 34 µT โค้ดจึงคิดมุมผิดได้ถึง <b>55°</b></p>
    <p>ล้อหมุนหรือหยุด วงแทบไม่ขยับ (~1 µT) ชดเชยด้วยค่าคงที่ครั้งเดียวก็พอ</p>
    <p class="key"><b>แก้:</b> ให้ MAG_CAL เอาค่ากลางที่วัดได้ไปใช้จริง และบันทึกด้วย TEAM_SAVE ในตัวจำลองมุมคลาดลดจาก 84° เหลือ 0°</p>
    <p>บนแท่นวันที่ 7 ยังคลาดมาก ต้อง calibrate ใหม่ในห้องแข่ง</p>
  </div>
  <div class="source">ข้อมูลจาก log ของ GS เวลา 15:36 จำนวน 198 จุด เส้นประคือวงกลมที่ fit ได้ รัศมี 42 µT</div>`],

  [10, 'tuning', 'ปรับ 2 ค่า', '', `  <div class="head">
    <div class="eyebrow">ผลบนแท่นจริง 6 ต.ค.</div>
    <h2>เพิ่ม kd และเปิด HOLD แล้ว ยาน<em>นิ่งอยู่ที่เป้า 57 วินาที</em></h2>
  </div>
  <figure class="chart"><img src="../charts/c1_two_runs.png" alt="มุมจากเซนเซอร์แสง 0–60 วินาที: รอบ kd 1 เลยเป้าและค้าง รอบ kd 2 + HOLD เข้าเป้าใน 3.6 วินาทีแล้วนิ่ง"></figure>
  <div class="notes">
    <p><b>kd 1 → 2</b><br>เบรกแรงขึ้น เข้าเป้าใน 3.6 วิ ไม่เลยเป้า</p>
    <p><b>HOLD</b><br>เมื่อใกล้เป้าไม่เกิน 1.5° เลิกเตะ ปล่อยล้อหมุนคงที่</p>
    <p class="key"><b>57 วินาที</b> อยู่ในช่วง −1.7° ถึง 0°</p>
    <p>ปรับผ่านบลูทูธด้วยคำสั่ง <b>TEAM_SET</b> ไม่ต้องอัปโค้ดใหม่</p>
  </div>
  <div class="source">ข้อมูลจากกล่องดำรอบ 20:13 และ 20:30</div>`],

  [11, 'lessons', 'บทเรียน', '', `  <div class="head">
    <div class="eyebrow">สรุป</div>
    <h2>ถ้าเริ่มใหม่ <em>จะทำ 3 อย่างนี้ตั้งแต่วันแรก</em></h2>
  </div>
  <div class="team-ph">[รูปทีมหน้าแท่น]</div>
  <p class="team-cap">ทีมนาซ่าหน้าปากซอย โรงเรียนชลราษฎรอำรุง จ.ชลบุรี</p>
  <div class="lessons">
    <div class="lesson"><i>1</i><div><b>ใส่กล่องดำในยานก่อนเริ่มจูน</b><span>log ของ GS มีแค่มุมกับคำสั่งล้อ สิ่งที่เราเจอตั้งแต่วันที่ 6 เกือบทั้งหมดมาจากกล่องดำ</span></div></div>
    <div class="lesson"><i>2</i><div><b>ทดสอบในตัวจำลองแบบที่เราใช้ยานจริง</b><span>บั๊กหมุน 3 รอบไม่โผล่ในตัวจำลอง จนเราใส่การหน่วงของบลูทูธ และหมุนยานเล่นก่อนกด AUTO แบบที่ทำจริง</span></div></div>
    <div class="lesson"><i>3</i><div><b>เจอตัวเลขขัดกัน ให้ดูข้อมูลดิบก่อนเดา</b><span>ยานหมุน 200 °/วิ แต่ตัวคุมไม่เบรก ทั้งที่เป้าห่างแค่ 18° พอดูข้อมูลดิบถึงเห็นว่ามุมที่ยานคิดเกินไป 3 รอบ</span></div></div>
  </div>
  <div class="thanks">
    <h3>ขอบคุณ</h3>
    <div><small>ผู้จัดงาน</small><span class="real">TYSC 2026</span></div>
    <div><small>ครูที่ปรึกษา</small><span class="fill">[ชื่ออาจารย์ที่ปรึกษา]</span></div>
    <div><small>พี่เลี้ยง / วิทยากร / ผู้ช่วยเหลือ</small><span class="fill">[ชื่อ-หน่วยงานที่ต้องการขอบคุณ]</span></div>
  </div>
  <div class="bye">ยินดีตอบคำถาม</div>`],

  // ---------------- appendix ----------------
  ['B1', 'kicks', 'เตะแล้วกระเด็น', '', `  <div class="head">
    <div class="eyebrow">ภาคผนวก</div>
    <h2>เตะล้อตอนยานเกือบถึงเป้า ยาน<em>ไถลเลยไปอีกฝั่ง</em></h2>
  </div>
  <figure class="chart" style="width:1120px;top:280px"><img src="../charts/c3_kicks.png" alt="มุมและค่า kick 15–45 วินาที: ทุกครั้งที่ kick ยานไถล 3–4.5 องศา"></figure>
  <div class="notes" style="left:1300px;width:508px">
    <p><b>kick</b> = ตัวคุมเพิ่มล้อทีเดียว 20% เมื่อยานนิ่งแต่ยังไม่ถึงเป้า</p>
    <p>แท่นฝืดแบบติด-หลุด<br>พอหลุดแล้วยานไถลไป <b>3–4.5°</b> ทุกครั้ง</p>
    <p class="key"><b>แก้:</b> พอใกล้เป้าให้เข้าโหมด HOLD และห้ามเตะล้อระหว่าง HOLD</p>
  </div>
  <div class="source">ข้อมูลจากกล่องดำรอบ 20:13 จุดชมพูคือตอนที่เตะล้อ</div>`],

  ['B2', 'fixes', 'แก้ 32 เรื่อง', '', `  <div class="head">
    <div class="eyebrow">ภาคผนวก</div>
    <h2>32 เรื่องที่แก้ในโค้ดผู้จัด จัดตามหน้าที่</h2>
  </div>
  <div class="fixlist">
    <section><h3>เซนเซอร์และการวัด</h3><ul>
      <li>อ่านแสงครั้งเดียว <i>→</i> เฉลี่ยในหน้าต่าง 20 ms</li>
      <li>มุม = 90 × ผลต่างแสง <i>→</i> โมเดล LDR + ตารางแก้ค่า</li>
      <li>ไม่รู้ว่าแสงจ้าเกินหรือมืด <i>→</i> ธงบอกสถานะ</li>
      <li>gyro bias ฝังโค้ด, ตั้งศูนย์บล็อก 3 วิ <i>→</i> TEAM_GYRO_ZERO</li>
      <li>GYRO_Z ส่ง 2 ความหมาย <i>→</i> ส่งค่าเดียว</li>
      <li>ตัวกรอง 10 ค่าช้า 90 ms <i>→</i> 1 ค่า</li>
    </ul></section>
    <section><h3>ตัวคุม</h3><ul>
      <li>สั่งต่ำกว่า deadzone ของล้อ <i>→</i> ชดเชย</li>
      <li>ล้อกระโดด +100 → −100 ทันที <i>→</i> จำกัดอัตราเปลี่ยน</li>
      <li>แท่นฝืดแล้วค้าง <i>→</i> เตะช่วย</li>
      <li>ไม่เห็นหลอดก็ไล่ค่าขยะ <i>→</i> ค้นหาหลอด</li>
      <li>หลุดไฟแล้วมุมเป็นขยะ <i>→</i> นับมุมด้วย gyro</li>
      <li>เปลี่ยนเป้าใน AUTO ไม่ได้ <i>→</i> เปลี่ยนได้ ล้อไม่หยุด</li>
      <li>มุมประมาณจำทุกรอบ <i>→</i> error ทางสั้น + ตั้งมุมใหม่</li>
      <li>I สะสมตอนล้อเต็มเพดาน <i>→</i> anti-windup</li>
      <li>เต็มเพดาน + ฝืด = ค้าง <i>→</i> ผ่อนล้อแล้วกระชาก</li>
      <li>เตะใกล้เป้าแล้วไถล <i>→</i> ห้ามเตะใน HOLD</li>
    </ul></section>
    <section><h3>ใช้งานในสนาม</h3><ul>
      <li>ค่าจูนฝังโค้ด <i>→</i> TEAM_SET / TEAM_SAVE</li>
      <li>ข้อมูลส่งออกน้อย <i>→</i> สตรีม 20 Hz</li>
      <li>RW_CMD, GYRO_OFFSET, MAG_CAL เรียกไม่ได้ <i>→</i> ต่อคำสั่ง</li>
      <li>มองไม่เห็นข้างในตัวคุม <i>→</i> กล่องดำ</li>
      <li>v3.0 ออกกลางงาน <i>→</i> รวมโค้ด 3 ทาง</li>
      <li>TEAM_SAVE ระหว่าง AUTO <i>→</i> ห้าม</li>
      <li>เซฟลง flash พลาดแต่ตอบ ACK <i>→</i> ตอบ ERR</li>
    </ul></section>
    <section><h3>กล้องและการสื่อสาร</h3><ul>
      <li>ข้อความไดรเวอร์กล้องท่วม BLE <i>→</i> กรองทิ้ง</li>
      <li>GS รอ STREAM_URL ที่กล้องไม่ส่ง <i>→</i> ส่งให้</li>
      <li>ทุกทีมชื่อ Wi-Fi กล้องเดียวกัน <i>→</i> ใส่ชื่อทีม</li>
      <li>เช็ค SD แค่ตอนเปิด <i>→</i> mount ใหม่ตอนถ่าย</li>
      <li>กล้องห่างเซนเซอร์ 90° <i>→</i> ตั้งมุมชดเชย</li>
      <li>STOP จากบลูทูธถูกลูปเขียนทับ <i>→</i> เช็คโหมดก่อนสั่งล้อ</li>
      <li>Serial ไม่มีบัฟเฟอร์ส่ง <i>→</i> 4 KB</li>
      <li>บรรทัดยาวเกินที่ BLE ส่งได้ <i>→</i> ตัดที่ 160</li>
    </ul></section>
  </div>
  <div class="source">นับถึงเฟิร์มแวร์ที่อัปขึ้นบอร์ดเช้าวันที่ 7 ต.ค.</div>`],

  ['B3', 'fuzz', 'จำลองไม่เจอบั๊ก', '', `  <div class="head">
    <div class="eyebrow">ภาคผนวก <span class="sim">จำลอง</span></div>
    <h2>ตัวจำลองเดิม<em>หาบั๊ก 3 รอบไม่เจอ</em> เพราะทดสอบแต่กรณีง่าย</h2>
  </div>
  <table class="gap-table">
    <tr><th>ที่ขาดไป</th><th>ของจริง</th><th>ตัวจำลองเดิม</th></tr>
    <tr><td>จังหวะเวลา</td><td>GS ต่อทาง BLE ทุกบรรทัดที่ตอบหน่วง 3 ms มุมประมาณจึงไม่ถูกรีเซ็ต</td><td>ไม่มี BLE เข้า AUTO กับรอบคุมแรกใน ms เดียวกัน โค้ดผู้จัดจึงรีเซ็ตมุมให้เอง</td></tr>
    <tr><td>ประวัติก่อนกด AUTO</td><td>ทีมหมุนเล่น เตะล้อ หลายรอบก่อนกด</td><td>ทุกเทสต์เริ่มจากเปิดเครื่องใหม่ ยานนิ่ง</td></tr>
    <tr><td>ฟิสิกส์แท่น</td><td>ยานหมุนได้ ~230 °/s ที่ล้อ 40%</td><td>ยานไม่เคยเกิน ~30 °/s</td></tr>
  </table>
  <div class="fuzz">
    <div class="row bad"><h4>โค้ดผู้จัด <em>พัง 4 จาก 8</em></h4>${tiles(4, 8)}<p>หมุนเกินไป 439–1533°</p></div>
    <div class="row good"><h4>โค้ดของเรา <em>ผ่าน 8 จาก 8</em></h4>${tiles(0, 8)}<p>หมุนไม่เกิน 43° จบใน 3°</p></div>
    <p class="how">เทสต์ใหม่: สุ่มสิ่งที่ทำกับยานก่อนกด AUTO 8 แบบ เช่น ผลักด้วยมือ หรือเตะล้อ แล้ววางยานห่างหลอด 10–45° สั่งผ่านบลูทูธ และตั้งค่าแท่นให้ตรงกับ log จริง</p>
  </div>
  <div class="source">ผลจากตัวจำลองที่รันโค้ดเฟิร์มแวร์ตัวจริง</div>`],

  ['B4', 'loop', 'รอบคุมช้า', '', `  <div class="head">
    <div class="eyebrow">ภาคผนวก</div>
    <h2>รอบคุมที่ตั้งไว้ 40 ms แต่บางรอบ<em>ช้าถึง 97 ms</em></h2>
  </div>
  <figure class="chart" style="width:960px"><img src="../charts/c4_loop_spacing.png" alt="ฮิสโทแกรมระยะห่างระหว่างแถวของกล่องดำ 2 รอบ ส่วนใหญ่อยู่ที่ 40 ms มีหางยาวถึง 97 ms"></figure>
  <div class="notes" style="left:1150px;width:658px">
    <p>ราว 63% ห่าง 40 ms ตามที่ตั้ง บางรอบช้าถึง <b>97 ms</b></p>
    <p><b>สาเหตุ</b><br>Serial ไม่มีบัฟเฟอร์ส่ง รอ 3 ms ทุกบรรทัดที่ส่งทางบลูทูธ บลูทูธหลุดแล้วหยุด 200 ms และการเขียน flash ตอน TEAM_SAVE</p>
    <p>ถ้าค้างเกิน 250 ms ตัวประมาณมุมจะรีเซ็ตเป็นค่าแสงดิบ</p>
    <p class="key"><b>แก้:</b> ใส่บัฟเฟอร์ส่ง 4 KB และห้าม TEAM_SAVE ระหว่าง AUTO บนแท่นวันที่ 7 รอบที่ช้าสุดลดจาก 97 เหลือ 55 ms</p>
  </div>
  <div class="source">ข้อมูลจากกล่องดำรอบ 20:13 และ 20:30 วันที่ 6 ต.ค. แถบเทาคือช่วง 38–42 ms</div>`],

  ['B5', 'drift', 'gyro ลอย', '', `  <div class="head">
    <div class="eyebrow">ภาคผนวก</div>
    <h2>ยานอยู่นิ่ง 56 วินาที แต่ gyro<em>นับว่าหมุนไป 4.7°</em></h2>
  </div>
  <figure class="chart" style="width:1080px"><img src="../charts/c5_gyro_drift.png" alt="มุมจากเซนเซอร์แสงกับมุมจาก gyro อย่างเดียว ตอนยานนิ่งใน HOLD 56 วินาที gyro ลอยไป +4.7 องศา"></figure>
  <div class="notes" style="left:1250px;width:558px">
    <p>เซนเซอร์แสงบอกว่ายานอยู่ที่ −2.0° แต่มุมจาก gyro อย่างเดียวลอยไป +4.7° (ราว 0.12 °/วิ) และลอยไม่เป็นเส้นตรง</p>
    <p>ภารกิจ 2 ถ้าเป้าเลยมุมที่เซนเซอร์แสงเห็น ยานต้องใช้ gyro อย่างเดียว ถ้าไม่ตั้งศูนย์จะคลาดราว 3° ต่อ 30 วินาที</p>
    <p class="key"><b>แก้:</b> ตั้งศูนย์ gyro (TEAM_GYRO_ZERO) ก่อนทุกภารกิจ</p>
  </div>
  <div class="source">ข้อมูลจากกล่องดำรอบ 20:30 ตอนยานนิ่งอยู่ใน HOLD เส้น gyro เริ่มจากค่าเดียวกับเซนเซอร์แสง</div>`],

  ['B6', 'stop', 'STOP ถูกทับ', 'has-vs', `  <div class="head">
    <div class="eyebrow">ภาคผนวก จากการอ่านโค้ด</div>
    <h2>กด STOP แล้วได้ ACK แต่ล้ออาจ<em>ยังหมุนอยู่</em></h2>
  </div>
  <div class="vs">
    <div><span>ที่ควรเป็น</span>ส่ง STOP ผ่านบลูทูธ ล้อหยุดทันที</div>
    <div class="found"><span>โค้ดเดิม</span>STOP รันบน core 0 ขนานกับลูปคุมบน core 1 ถ้ามาตอนลูปคำนวณเสร็จแต่ยังไม่สั่งล้อ ลูปจะเขียนทับ</div>
  </div>
${stopSvg}
  <div class="source">น่าจะเกิดราว 0.1% ต่อครั้ง (คิดจากเวลาที่โค้ดใช้ ยังไม่เคยเจอจริง) แก้แล้วในเฟิร์มแวร์ที่อยู่บนบอร์ดตอนนี้</div>`],

  ['B7', 'web', 'เว็บ NasaSat Lab', '', `  <div class="head">
    <div class="eyebrow">ภาคผนวก</div>
    <h2>เว็บ NasaSat Lab ที่เราเขียนไว้ใช้<em>ตอนหน้างาน</em></h2>
  </div>
  <div class="win" aria-label="แผนภาพหน้าของเว็บ NasaSat Lab">
    <div class="bar"><i></i><i></i><i></i>NasaSat Lab<span>ภาพจำลองหน้าเว็บ</span></div>
    <nav>
      <h5>ลำดับวันแข่ง</h5>
      <div class="on">1 เชื่อมต่อ</div><div>2 ฮาร์ดแวร์</div><div class="on">3 คาลิเบรต</div><div>4 ภารกิจ 1</div><div>5 ภารกิจ 2</div>
      <h5>เครื่องมือ</h5>
      <div>ค่าสด</div><div>จูนค่า</div><div>บันทึกผล</div><div class="on">จูน ADCS (SunSeek)</div>
    </nav>
    <div class="cards">
      <div class="card"><b>เชื่อมต่อ</b>ต่อบอร์ดด้วยบลูทูธ ไม่ใช้สาย USB เพราะสายทำให้ผลเพี้ยน</div>
      <div class="card"><b>คาลิเบรต</b>หมุนยานด้วยมือ ใช้ gyro เป็นมุมอ้างอิง ไม่ต้องมีขีดมุม แล้ว fit ให้</div>
      <div class="card"><b>จูน ADCS</b>สั่งเป้าแล้ววัดผลเป็นตัวเลข: ถึงเป้ากี่วิ เลยเป้าเท่าไร ล้อชนเพดานนานแค่ไหน</div>
      <div class="card"><b>ดึงกล่องดำ</b>ปุ่ม "ดึงรอบล่าสุดจากบอร์ด" แล้วพล็อตกราฟ</div>
      <div class="card"><b>อ่าน log ของ GS</b>เปิดไฟล์ CSV ย้อนหลัง เช่น log 15:36 บอกว่ายานออกตัวผิดทาง เข้า ±2° ที่ 21 วินาที เลยเป้า 7.3°</div>
      <div class="card"><b>ตรวจทิศ</b>เช็คเครื่องหมายของ gyro และของคำสั่งล้อ ก่อนเปิด AUTO</div>
    </div>
  </div>
  <div class="source">ต่อยอดจากเว็บที่ทำไว้ตอนรอบภูมิภาค ส่วนการต่อบลูทูธยังไม่ได้ลองกับบอร์ดจริง</div>`],

  ['B8', 'mission2', 'ภารกิจ 2', 'has-vs', `  <div class="head">
    <div class="eyebrow">ภาคผนวก <span class="sim">ผลจากตัวจำลอง ยังไม่ได้ลองบนแท่นจริง</span></div>
    <h2>ภารกิจ 2: อ่านโปรแกรม GS แล้ว<em>เขียนโหมดภารกิจเอง</em></h2>
  </div>
  <div class="vs">
    <div><span>GS ส่งมา</span><code class="mono">PREPARE</code> (12+ บรรทัด)<br><code class="mono">MISSION_TARGET</code> (4 ค่า), <code class="mono">START_MISSION</code>, <code class="mono">ABORT</code></div>
    <div class="found"><span>เฟิร์มแวร์ผู้จัด v3.0</span>ใช้ไม่ได้ 5 จุด: อ่านเป้าได้แค่ 3 ค่า (ตอบ ERR ทุกเป้า), ชื่อคำสั่งไม่ตรง, ไม่ถ่ายรูป, ไม่ไปเป้าถัดไป และไม่เข้า AUTO เอง</div>
  </div>
  <div class="flow">
    <div class="stp"><div class="box">หมุนไปที่เป้า</div><small>อยู่ใน AUTO ตลอด</small></div>
    <div class="stp"><div class="box">ค้างในระยะคลาดจนครบเวลา</div></div>
    <div class="stp"><div class="box new">รอให้นิ่ง<br>|error| ≤ 1.5°<br>|rate| ≤ 3°/s</div><small>รอไม่เกิน 4 วินาที ถ้ายังไม่นิ่งก็ถ่ายเลย</small></div>
    <div class="stp"><div class="box">CAPTURE แล้วรอรูป</div><small>กล้องพลาดลองใหม่ 3 ครั้ง</small></div>
    <div class="stp"><div class="box">ไปเป้าถัดไป</div><small>กด STOP หรือ ABORT ได้ทุกเมื่อ</small></div>
  </div>
${capSvg}
  <div class="mnotes">
    <p><b>ที่เจอในตัวจำลอง:</b> HOLD เริ่มทำงานตอนยานยังหมุน ~4°/s ยานจึงไหลเลยไป ~3° แล้วถ่ายรูปตรงขอบระยะคลาดพอดี</p>
    <p class="key"><b>แก้:</b> รอให้นิ่งก่อนกดชัตเตอร์ โดยไม่เปลี่ยนตัวคุมที่ลองบนแท่นแล้ว error ตอนถ่ายลดจาก 2.95 / 2.92 / 2.60° เหลือ 1.49 / 0.42 / 0.28°</p>
    <p>ในตัวจำลองใส่กล้องปลอมไว้ด้วย 3 เป้าจบใน 12.8 วินาที ได้ครบ 3 รูป</p>
    <p><b>เป้าที่เลยมุมที่เซนเซอร์แสงเห็น:</b> ใช้ gyro นับมุมต่อ แล้วสุ่มทดสอบ 5,000 ภารกิจ เจอปัญหาเพิ่ม 4 เรื่อง แก้แล้วผ่านครบทุกรอบ</p>
  </div>
  <div class="source">ตัวเลขทั้งหมดในหน้านี้มาจากตัวจำลอง</div>`],
  ['B9', 'camwifi', 'Wi-Fi กล้อง', '', `  <div class="head">
    <div class="eyebrow">ภาคผนวก ลองที่ห้องพัก คืนวันที่ 7</div>
    <h2>Live View หลุดบ่อย กล้องไม่ได้ดับ แต่<em>ช่อง Wi-Fi แน่น</em></h2>
  </div>
${wifiSvg}
  <div class="notes" style="left:1080px;width:728px">
    <p><b>อาการ:</b> ช่วง 22:15–22:38 ที่ลองเปิด Live View อยู่ Wi-Fi กล้องหลุด 4 ครั้ง Windows บันทึกว่า "disconnected by the driver"</p>
    <p><b>ไม่ใช่กล้องดับ:</b> ถ้ากล้องรีบูตจะส่งบรรทัด BOOT มาทางสายถึงบอร์ด แต่ไม่มีเลย และหลังหลุดยังเห็นสัญญาณกล้อง 96%</p>
    <p><b>ที่เจอ:</b> กล้อง ESP32-CAM ทุกตัวเปิด Wi-Fi ที่ช่อง 1 เป็นค่าเริ่มต้น และแอปในมือถือเห็นว่ากว้าง 40 MHz คลุมช่อง 1–5 ทับทั้งกล้องอีกทีมและ Wi-Fi โรงแรม วิดีโอจึงหลุดก่อน วันแข่งกล้องทุกทีมจะเป็นแบบนี้เหมือนกัน</p>
    <p><b>เจอเพิ่ม:</b> ระหว่างสตรีม เว็บของกล้องรับได้ทีละงาน GS จึงดึงรูปไม่ได้ ตอนกด START เฟิร์มแวร์เราสั่งปิดสตรีมก่อน</p>
    <p class="key"><b>แก้แล้ว:</b> ย้ายกล้องไปช่อง 11 และบังคับกว้าง 20 MHz ช่อง 11 เป็นกลุ่มที่สัญญาณอ่อนสุด และอยู่ช่องเดียวกันพอดีจึงผลัดกันส่ง ไม่ทับกันครึ่ง ๆ ช่อง 13 ว่างกว่า แต่การ์ด Wi-Fi ของโน้ตบุ๊กมองไม่เห็นช่อง 12–13</p>
  </div>
  <div class="source">สแกนด้วย netsh ตอน 22:40 และแอปในมือถือ 22:45 แสดงเฉพาะ Wi-Fi ที่แรงสุดของแต่ละชื่อ แฟลชช่อง 11 ตอน 22:55 ยังไม่ได้วัดว่าหลุดน้อยลงไหม</div>`],
];
for (const [n, file, title, cls, body] of slides) { fs.writeFileSync(D + file + '.html', page(n, title, cls, body)); console.log(file); }
