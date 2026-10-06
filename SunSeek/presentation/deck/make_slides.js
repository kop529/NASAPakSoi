// writes deck/sNN.html from one template (same head, logo, scale script)
const fs = require('fs');
const D = 'C:/TYSC/SunSeek/presentation/deck/';
const page = (n, title, cls, body) => `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<title>NasaPakSoi · ${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Kanit:wght@500;600&family=IBM+Plex+Sans+Thai:wght@400;500&display=swap" rel="stylesheet">
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
const slides = [
  [11, 's11_tuning', 'ปรับ 2 ค่า', '', `  <div class="head">
    <div class="eyebrow">ผลบนแท่นจริง · 6 ต.ค. 2569</div>
    <h2>ปรับ 2 ค่าผ่านไร้สาย แล้ว<em>นิ่งทั้งนาที</em></h2>
  </div>
  <figure class="chart"><img src="../charts/c1_two_runs.png" alt="มุมจากเซนเซอร์แสง 0–60 วินาที: รอบ kd 1 เลยเป้าและค้าง รอบ kd 2 + HOLD เข้าเป้าใน 3.6 วินาทีแล้วนิ่ง"></figure>
  <div class="notes">
    <p><b>kd 1 → 2</b><br>เบรกแรงขึ้น เข้าเป้าใน 3.6 วิ ไม่เลยเป้า</p>
    <p><b>HOLD</b><br>ใกล้เป้าไม่เกิน 1.5° แล้วเลิกเตะ ปล่อยล้อหมุนคงที่</p>
    <p class="key"><b>57 วินาที</b> อยู่ใน −1.7° ถึง 0°</p>
    <p>ไม่ต้องอัปโค้ดใหม่ สั่ง <b>TEAM_SET</b> ผ่านบลูทูธ</p>
  </div>
  <div class="source">ข้อมูล: กล่องดำของยาน รอบ 20:13 และ 20:30</div>`],
  [12, 's12_filter_lag', 'ตัวกรองช้า', 'has-vs', `  <div class="head">
    <div class="eyebrow">สิ่งที่ไม่เป็นไปตามคาด</div>
    <h2>ตัวกรองที่ใส่ไว้ให้ค่านิ่ง ทำให้ยาน<em>เห็นช้าไป 90 มิลลิวินาที</em></h2>
  </div>
  <div class="vs">
    <div><span>คาดไว้</span>เฉลี่ยค่าแสง 10 ครั้ง มุมจะนิ่งขึ้น ตัวคุมทำงานดีขึ้น</div>
    <div class="found"><span>เจอจริง</span>ที่ 0.9 วิ gyro บอก −15.6° ตรงกับแสง −15.2° แต่ตัวคุมใช้ −18.9°</div>
  </div>
  <figure class="chart"><img src="../charts/c2_three_angles.png" alt="มุม 3 แบบในวินาทีแรก: เซนเซอร์แสง gyro และมุมประมาณที่ช้ากว่า"></figure>
  <div class="notes">
    <p><b>10 ค่า × 20 ms</b><br>ค่าเฉลี่ยตามหลังจริงราว 90 ms</p>
    <p>ตัวคุมเห็น error ใหญ่เกินจริง เท่ากับเบรกหายไปบางส่วน</p>
    <p class="key"><b>แก้:</b> เฉลี่ย 1 ค่า (team-4)<br>รอวัดผลบนแท่น</p>
  </div>
  <div class="source">ข้อมูล: กล่องดำ รอบ 20:13 · เส้นชมพู = อินทิเกรตอัตราหมุนจาก gyro อย่างเดียว</div>`],
  [13, 's13_kicks', 'เตะแล้วกระเด็น', '', `  <div class="head">
    <div class="eyebrow">สิ่งที่ไม่เป็นไปตามคาด</div>
    <h2>เตะตอนเกือบถึงเป้า = ยาน<em>กระเด็นเลยไปอีกฝั่ง</em></h2>
  </div>
  <figure class="chart" style="width:1120px;top:280px"><img src="../charts/c3_kicks.png" alt="มุมและค่า kick 15–45 วินาที: ทุกครั้งที่ kick ยานไถล 3–4.5 องศา"></figure>
  <div class="notes" style="left:1300px;width:508px">
    <p><b>kick</b> = ตัวคุมเพิ่มล้อทีเดียว 20% เมื่อยานนิ่งแต่ยังไม่ถึงเป้า</p>
    <p>แท่นฝืดแบบติด-หลุด<br>หลุดแล้วไถลไป <b>3–4.5°</b> ทุกครั้ง</p>
    <p class="key"><b>แก้:</b> ใกล้เป้าแล้วเลิกเตะ (HOLD, team-3) และห้ามเตะใน HOLD เลย (team-4)</p>
  </div>
  <div class="source">ข้อมูล: กล่องดำ รอบ 20:13 · จุดชมพู = ตอนที่ kick</div>`],
];
for (const [n, file, title, cls, body] of slides) { fs.writeFileSync(D + file + '.html', page(n, title, cls, body)); console.log(file); }
