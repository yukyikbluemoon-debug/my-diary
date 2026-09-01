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

## ตั้งค่า Google Drive Sync

ต้องสร้าง OAuth Client ID ของตัวเองใน Google Cloud Console (ฟรี) แล้วนำมาใส่ใน `js/drive-config.js` — ดูขั้นตอนละเอียดจากที่ Claude แนะนำไว้ตอนคุยกัน หรือสรุปสั้นๆ ดังนี้:

1. https://console.cloud.google.com/ → สร้างโปรเจกต์ใหม่
2. เปิดใช้งาน **Google Drive API** (APIs & Services → Library)
3. ตั้งค่า **OAuth consent screen** แบบ External, เพิ่มตัวเองเป็น Test user, เพิ่ม scope `.../auth/drive.file`
4. สร้าง **OAuth client ID** ประเภท Web application, ใส่ Authorized JavaScript origin เป็น URL ของเว็บนี้ (เช่น `https://<username>.github.io`)
5. คัดลอก Client ID มาวางแทนที่ `PASTE_YOUR_CLIENT_ID_HERE...` ใน `js/drive-config.js`
6. Push ขึ้น GitHub อีกครั้ง

แอปจะเก็บข้อมูลไดอารี่เป็นไฟล์เดียวชื่อ `diary-data.json` ใน Google Drive ของคุณเอง (มองเห็นเฉพาะไฟล์ที่แอปนี้สร้างเท่านั้น เพราะขอสิทธิ์แบบ `drive.file`) กดปุ่ม "ซิงค์ตอนนี้" ในหน้าตั้งค่าเพื่อรวมข้อมูลระหว่างเครื่อง

## โครงสร้างไฟล์

```
index.html        หน้าหลัก
css/style.css      ธีม/สไตล์
js/app.js          ตรรกะหลักของแอป (CRUD, ปฏิทิน, ตัวกรอง)
js/db.js           ชั้นเก็บข้อมูล (localStorage)
js/crypto.js        เข้ารหัส/ถอดรหัสบันทึกส่วนตัว (Web Crypto API)
js/drive-config.js  ใส่ Google OAuth Client ID ของคุณตรงนี้
js/drive-sync.js    ซิงค์ข้อมูลกับ Google Drive (กดปุ่มเอง)
manifest.json      PWA manifest
sw.js              Service worker (ใช้งานออฟไลน์)
icons/             ไอคอนแอป
```
