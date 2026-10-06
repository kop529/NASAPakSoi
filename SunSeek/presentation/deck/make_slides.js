// writes deck/sNN.html from one template (same head, logo, scale script)
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
  [8, 's08_three_turns', 'หมุน 3 รอบ', 'has-vs', `  <div class="head">
    <div class="eyebrow">สิ่งที่ไม่เป็นไปตามคาด · 6 ต.ค. 15:36</div>
    <h2>เป้าห่างแค่ 18° แต่ยาน<em>หมุนไปเกือบ 3 รอบ</em>ก่อนเข้าเป้า</h2>
  </div>
  <div class="vs">
    <div><span>คาดไว้</span>เริ่มที่ −18° ล้อหมุนนิดเดียว หันเข้าเป้าในไม่กี่วินาที</div>
    <div class="found"><span>เจอจริง</span>ล้อถูกสั่ง −40% ค้าง 6 วิ ยานหมุนไปราว 1,000° แล้วค่อยกลับมาเข้าเป้า</div>
  </div>
  <figure class="chart" style="width:960px"><img src="../charts/c6_three_turns.png" alt="มุมที่ยานหมุนสะสมจาก log 15:36 ลงไปเกือบ −1080 องศา ขณะคำสั่งล้อค้างที่ −40%"></figure>
  <div class="notes" style="left:1150px;width:658px">
    <p><b>เบาะแส:</b> ยานหมุน 200 °/วิ แต่เบรก (kd) ไม่ทำงาน → error ที่ตัวคุมเห็นต้องใหญ่กว่า 18° มาก</p>
    <p><b>สาเหตุ:</b> มุมประมาณในโค้ดผู้จัดจำทุกรอบที่ยานเคยหมุนตอนเราทดสอบ (เกินไป 3 × 360°)</p>
    <p class="key"><b>แก้:</b> คิด error ทางสั้น ±180° + ตั้งมุมใหม่ตอนเข้า AUTO (team-3) ยืนยันบนแท่นแล้ว</p>
  </div>
  <div class="source">ข้อมูล: log ของ GS 15:36 · GS ประทับเวลาเป็นวินาที ตัวเลขสะสมคลาดได้ ~6%</div>`],
  [10, 's10_black_box', 'กล่องดำ', '', `  <div class="head">
    <div class="eyebrow">เครื่องมือที่ทีมสร้าง</div>
    <h2>เราให้ยาน<em>จดกล่องดำเอง</em> แล้วเปิดดูทีหลัง</h2>
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
  <p class="logcap">ข้อความจริงจากบอร์ด รอบ 20:30 · 25 แถว/วิ · 96 วิ · เก็บใน RAM · ดึงด้วย <b>TEAM_CDUMP</b></p>
  <table class="found-table">
    <tr><th>เห็นในกล่องดำ</th><th>นำไปสู่</th></tr>
    <tr><td>เข้า AUTO แล้วมุมประมาณ = มุมแสง</td><td>ยืนยันว่าแก้บั๊ก 3 รอบได้จริง</td></tr>
    <tr><td>เตะใกล้เป้าแล้วไถล 3–4.5°</td><td>HOLD + ห้ามเตะใน HOLD</td></tr>
    <tr><td>มุมประมาณช้ากว่า gyro 3.7°</td><td>ตัวกรอง 10 ค่า → 1 ค่า</td></tr>
    <tr><td>แถวห่าง 40 ms แต่บางครั้ง 97 ms</td><td>ลูปถูก Serial บล็อก → ใส่บัฟเฟอร์</td></tr>
    <tr><td>gyro ลอย 0.12 °/วิ ตอนยานนิ่ง</td><td>ตั้งศูนย์ gyro ก่อนทุกภารกิจ</td></tr>
  </table>
  <div class="source">log ของ GS มีแค่มุมกับคำสั่งล้อ — ค่าที่ตัวคุม "คิด" อยู่ในกล่องดำเท่านั้น</div>`],
];
for (const [n, file, title, cls, body] of slides) { fs.writeFileSync(D + file + '.html', page(n, title, cls, body)); console.log(file); }
