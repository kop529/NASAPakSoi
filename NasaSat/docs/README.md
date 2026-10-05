# เอกสารทฤษฎี + คู่มือหน้างาน (ชิ้นที่ ③)

| ไฟล์ | ใช้ทำอะไร | อ่าน/พิมพ์ |
|---|---|---|
| `THEORY_TH.md` → `THEORY_TH.html` / `.pdf` | ทฤษฎีทั้งหมด: เซนเซอร์ตัว V, LDR และวงจร, คาลิเบรต, งบความคลาด, ควบคุม, กล้อง, OBC/FDIR/COMM/EPS, ดาวเทียมจริง, คำถามกรรมการ + โครงสไลด์ | อ่านก่อนแข่ง ใช้ตอบกรรมการ |
| `PLAYBOOK_TH.md` → `PLAYBOOK_TH.html` / `.pdf` | แผนรายวัน 5–9 ต.ค., ข้อมูลที่ต้องเก็บ, คำถามถามผู้จัด, แผนบ่าย 8 ต.ค., แผนวันแข่ง, checklist, ผังแก้ปัญหา, ลูป AI, แบ่งหน้าที่ | พิมพ์ติดตัว |
| `CHEATSHEET_TH.md` → `CHEATSHEET_TH.html` / `.pdf` | คำสั่งและค่าสำคัญใน 1 หน้า | พิมพ์ 1 แผ่น วางข้างคีย์บอร์ด |
| `figures/` | กราฟและแผนภาพ (SVG) | ใช้ในเอกสารและสไลด์ได้ |
| `check_formulas.py` | ตรวจทุกสูตร/ตัวเลขในเอกสารแบบอิสระ (61 ข้อ) | `python docs/check_formulas.py` |

ไฟล์ HTML เปิดด้วย Chrome/Edge ได้แบบออฟไลน์ (กราฟฝังอยู่ในไฟล์) · PDF พร้อมพิมพ์ A4

## สร้างใหม่หลังแก้เนื้อหา (ทำจากโฟลเดอร์โปรเจกต์)
```
node docs/figures/figdata.js          (ข้อมูลกราฟ คำนวณด้วยโค้ดชุดเดียวกับเว็บ tool)
python docs/figures/make_figures.py   (กราฟ SVG + ตัวเลขสำคัญใน figures/numbers.json)
python docs/check_formulas.py         (ตรวจสูตร)
node docs/build_docs.js               (Markdown → HTML)
```
PDF: เปิด HTML ใน Chrome แล้ว Ctrl+P → Save as PDF (A4, ไม่ต้องมี header/footer)
