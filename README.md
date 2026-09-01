# my-diary

ไดอารี่ส่วนตัว — เว็บแอปแบบ local-first เขียนได้หลายรอบต่อวัน รองรับโหมดบันทึกส่วนตัวแบบเข้ารหัส (AES-256-GCM), แนบรูปภาพ (บีบอัดอัตโนมัติ), ค้นหา/กรองตามแท็กและเดือน, ปฏิทินดูภาพรวม, และสำรอง/กู้คืนข้อมูลเป็นไฟล์ JSON

ใช้งานได้ทั้งบนคอมพิวเตอร์และมือถือ ผ่านเบราว์เซอร์ปกติ หรือติดตั้งเป็นแอป (Add to Home Screen) เพราะเป็น PWA

## เก็บข้อมูลไว้ที่ไหน

ข้อมูลทั้งหมดเก็บอยู่ใน **localStorage ของเบราว์เซอร์** บนเครื่องที่เปิดใช้งานเท่านั้น ไม่มีการส่งข้อมูลไปที่ไหน โค้ดใน repo นี้ไม่มีเนื้อหาไดอารี่ของใครทั้งสิ้น — ไฟล์สำรอง (`diary-backup-*.json`, `diary-entry-*.json`) ถูกกันไว้ใน `.gitignore` ไม่ให้หลุดขึ้น repo โดยไม่ตั้งใจ

## เปิดใช้งานผ่าน GitHub Pages

1. Push โค้ดนี้ขึ้น repository บน GitHub (repo ชื่อ `my-diary`)
2. ไปที่ repo → **Settings → Pages**
3. ใต้ "Build and deployment" เลือก Source: **Deploy from a branch**
4. เลือก branch `main` และโฟลเดอร์ `/ (root)` แล้วกด **Save**
5. รอสักครู่ GitHub จะให้ URL ประมาณ `https://<username>.github.io/my-diary/`
6. เปิด URL นั้นบนมือถือ/คอมพิวเตอร์ แล้วกด "Add to Home Screen" (มือถือ) หรือติดตั้งผ่านไอคอนติดตั้งในแถบที่อยู่ (คอมพิวเตอร์) เพื่อใช้งานแบบแอป

## โครงสร้างไฟล์

```
index.html        หน้าหลัก
css/style.css      ธีม/สไตล์
js/app.js          ตรรกะหลักของแอป (CRUD, ปฏิทิน, ตัวกรอง)
js/db.js           ชั้นเก็บข้อมูล (localStorage)
js/crypto.js        เข้ารหัส/ถอดรหัสบันทึกส่วนตัว (Web Crypto API)
manifest.json      PWA manifest
sw.js              Service worker (ใช้งานออฟไลน์)
icons/             ไอคอนแอป
```
