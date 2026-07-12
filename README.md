# House — แอปบ้านของเรา

แอป PWA มือถือ-first สำหรับสมาชิก 3 คนในบ้าน จัดการรายรับรายจ่ายส่วนตัว, ของใช้ส่วนกลาง,
รายจ่ายร่วม, สรุปรายเดือน และแจ้งเตือนผ่านมือถือ

## 1) Architecture

```
[Browser / Mobile PWA]
   index.html  (UI + Auth + Firestore listeners, ทุก logic ฝั่ง client)
   sw.js                     -> service worker ตัวเดียว ทำ 2 หน้าที่:
                                 (1) cache app shell แบบ offline-first
                                 (2) รับ Firebase push ตอนแอปปิด/อยู่เบื้องหลัง
                                 (รวมเป็นไฟล์เดียวโดยตั้งใจ เพื่อไม่ให้ service worker
                                  สองตัวแย่ง scope เดียวกันจนตัวหนึ่งถูกแทนที่แบบเงียบๆ)
        |
        | Firebase SDK (Auth / Firestore / Messaging)
        v
[Firebase]
   Firebase Auth        -> Anonymous sign-in ผูกกับโปรไฟล์ users/{uid}
   Cloud Firestore      -> ข้อมูลทั้งหมด (private แยกตาม uid, shared ให้ทุกคนอ่าน/เขียนได้)
   Cloud Functions      -> งาน scheduled (23:59 สรุปรายวัน, วันที่ 16 เตือน Netflix,
                            เที่ยงคืนรีเซ็ตของที่ "ซื้อแล้ว") และ fan-out push แจ้งเตือนทุกเครื่อง
   Cloud Messaging(FCM) -> ส่ง Push Notification ไปมือถือทุกคน
   Hosting: GitHub Pages -> โฮสต์ index.html/manifest/sw (ฟรี, ไม่ต้องใช้ Firebase Hosting)
```

ทำไม client เขียน Firestore ตรง ๆ ได้: กฎ Security Rules (`firestore.rules`) จำกัดสิทธิ์
ตาม uid สำหรับข้อมูลส่วนตัว และเปิดอ่าน/เขียนให้ผู้ล็อกอินทุกคน (สมาชิกบ้าน) สำหรับข้อมูลส่วนกลาง
ส่วนการ "ส่ง push ไปทุกเครื่อง" ทำไม่ได้จาก client (ต้องใช้ FCM Admin SDK) จึงให้ client
เขียนคำขอลง collection `notifications` แล้วให้ Cloud Function `onNewNotification` เป็นคนส่งจริง

## 2) Folder Structure

```
house-app/
├── index.html                  # แอปหลักทั้งหมด (HTML+CSS+JS)
├── manifest.json                # PWA manifest
├── sw.js                        # Service worker เดียว: offline cache + FCM background
├── firestore.rules              # Security rules
├── firestore.indexes.json       # Composite indexes ที่ query ในแอปต้องใช้
├── firebase.json                # ให้ `firebase deploy` รู้จัก rules/indexes/functions
├── icons/
│   ├── icon-192.png             # (ต้องเพิ่มเอง)
│   └── icon-512.png             # (ต้องเพิ่มเอง)
└── functions/
    ├── index.js                 # Cloud Functions (scheduled jobs + push fan-out)
    └── package.json
```

## 3) Firestore Schema

```
users/{uid}
  name: string
  createdAt: timestamp

privateFinance/{uid}/wallets/{walletId}
  name: string
  balance: number
  createdAt: timestamp

privateFinance/{uid}/transactions/{txnId}
  type: "income" | "expense"
  detail: string
  amount: number
  walletId: string
  dateKey: "YYYY-MM-DD"
  monthKey: "YYYY-MM"
  createdAt: timestamp

privateFinance/{uid}/dailySummary/{dateKey}
  income: number
  expense: number
  balance: number

privateFinance/{uid}/monthlySummary/{monthKey}
  income: number
  expense: number

categories/{categoryId}          (shared)
  name: string
  createdAt: timestamp

items/{itemId}                   (shared)
  name: string
  categoryId: string
  status: "มีอยู่" | "ใกล้หมด" | "หมดแล้ว" | "ซื้อแล้ว"
  purchasedBy?: string
  purchasedAt?: "YYYY-MM-DD"

itemHistory/{historyId}          (shared, append-only)
  itemId, itemName, changedBy, fromStatus, toStatus, dateKey, createdAt

sharedExpenses/{expenseId}       (shared)
  title: string
  mode: "split" | "collective"
  # split:
  perPerson: number
  members: [{ name, amount, status, paidDate }]
  # collective:
  status: "จ่ายแล้ว" | "ยังไม่จ่าย"
  paidBy, paidDate

fcmTokens/{uid}
  token: string, name: string, updatedAt

notifications/{docId}            (เขียนเพื่อ trigger Cloud Function ส่ง push)
  title, body, createdBy, target, createdAt
```

หมายเหตุ: `monthlySummary` ใช้ monthKey เป็น id ของเอกสาร ทำให้เดือนใหม่ = เอกสารใหม่โดยอัตโนมัติ
เอกสารเดือนเก่าจะไม่ถูกลบหรือรีเซ็ตเลย ตรงตามกฎ "ห้ามลบ ห้ามรีเซ็ตข้อมูลย้อนหลัง"

## 4) Firebase Configuration

1. สร้างโปรเจกต์ที่ https://console.firebase.google.com
2. เปิดใช้งาน **Authentication > Sign-in method > Anonymous**
3. สร้าง **Firestore Database** (production mode)
4. เปิดใช้งาน **Cloud Messaging** และสร้าง **Web Push certificate (VAPID key)**
   ที่ Project Settings > Cloud Messaging > Web configuration
5. คัดลอกค่า config จาก Project Settings > General > Your apps > Web app
6. แก้ไขค่าใน `index.html` (บล็อก `firebaseConfig` และ `VAPID_KEY`)
   และใน `sw.js` (บล็อก `firebase.initializeApp` — ต้องเป็นค่าเดียวกันเป๊ะกับใน `index.html`)

## 5) Firestore Security Rules & Indexes

ดูไฟล์ `firestore.rules` และ `firestore.indexes.json` (มี 2 composite index ที่จำเป็น
สำหรับ query ประวัติของใช้และรายการธุรกรรมรายวัน) — deploy พร้อมกันด้วย:
```bash
firebase deploy --only firestore
```
ถ้าไม่ deploy indexes ไว้ล่วงหน้า แอปจะยังใช้งานได้ปกติเกือบทั้งหมด ยกเว้น 2 จุดที่ต้องใช้ index
(หน้า "รายการล่าสุด" ของการเงิน และ "ประวัติ" ของแต่ละของใช้) จะขึ้นข้อความแจ้งว่าโหลดไม่สำเร็จ
พร้อมลิงก์สร้าง index อัตโนมัติใน Firestore Console ผ่าน browser console (F12)

## 6) PWA Setup

- `manifest.json` กำหนด `display: standalone`, ไอคอน 192/512
- สร้างโฟลเดอร์ `icons/` แล้วใส่ไฟล์ `icon-192.png` และ `icon-512.png` (พื้นหลังทึบ ไม่โปร่งใส เพื่อรองรับ maskable)
- `sw.js` cache หน้า index.html/manifest ไว้ใช้งานออฟไลน์ (ปล่อยให้ Firestore SDK จัดการ
  offline cache ของข้อมูลเอง ผ่าน `enablePersistence`)

## 7) Notification Setup

1. ผู้ใช้เปิดแอปครั้งแรก แอปจะขอ permission แจ้งเตือนอัตโนมัติ (`Notification.requestPermission`)
2. ได้ token แล้วบันทึกที่ `fcmTokens/{uid}`
3. Deploy Cloud Functions (`functions/index.js`) เพื่อให้ระบบ scheduled และ fan-out ทำงานจริง:
   ```bash
   cd functions
   npm install
   firebase deploy --only functions
   ```
4. ฟังก์ชันที่ deploy แล้ว:
   - `onNewNotification` — ส่ง push ทุกเครื่องเมื่อมีการเพิ่ม/เปลี่ยนของ หรือรายจ่ายร่วม
   - `dailyPersonalSummary` — 23:59 ทุกวัน ส่งสรุปรายวันส่วนตัวให้เจ้าของเครื่องเท่านั้น
   - `netflixReminder` — ทุกวันที่ 16 เวลา 09:00 ส่งเตือนทุกเครื่อง
   - `autoRevertPurchasedItems` — 00:05 ทุกวัน รีเซ็ตของที่ "ซื้อแล้ว" เกิน 1 วันกลับเป็น "มีอยู่"

   > หมายเหตุ: Cloud Functions แบบ scheduled ต้องใช้ Firebase แผน **Blaze (pay-as-you-go)**
   > (มี free tier เพียงพอสำหรับใช้งานในบ้าน 3 คน)

## 8) วิธี Deploy บน GitHub Pages

```bash
# 1) สร้าง repo และ push โค้ดทั้งหมด (index.html, manifest.json, sw.js, icons/)
git init
git add .
git commit -m "House app initial commit"
git branch -M main
git remote add origin https://github.com/<your-username>/house-app.git
git push -u origin main

# 2) เปิด GitHub > Settings > Pages > Source: Deploy from branch "main" / "/ (root)"
# 3) รอสักครู่ จะได้ URL เช่น https://<your-username>.github.io/house-app/
```

**สำคัญ:** ใน Firebase Console > Authentication > Settings > Authorized domains
ต้องเพิ่มโดเมน `<your-username>.github.io` ด้วย ไม่งั้น Anonymous sign-in จะถูกบล็อก

## 9) วิธีติดตั้งบนมือถือ (Add to Home Screen)

- **Android (Chrome):** เปิด URL > เมนู ⋮ > "ติดตั้งแอป" หรือ "เพิ่มลงหน้าจอหลัก"
- **iPhone (Safari):** เปิด URL > ปุ่มแชร์ 📤 > "เพิ่มไปยังหน้าจอโฮม"
  (iOS รองรับ push notification ผ่าน PWA ตั้งแต่ iOS 16.4+ และต้องเพิ่มลงหน้าจอโฮมก่อนถึงจะขอ permission ได้)

## 10) วิธีทดสอบระบบ

| ระบบ | วิธีทดสอบ |
|---|---|
| Identity | เปิดแอปในเบราว์เซอร์ไม่ระบุตัวตน/inprivate ตั้งชื่อใหม่ ควรเห็นชื่อค้างที่ header |
| Wallet | สร้าง wallet ครบ 6 ใบ ลองสร้างที่ 7 ต้องขึ้นแจ้งเตือน "สร้างได้สูงสุด 6 ใบ" |
| รายรับ/รายจ่าย | บันทึกรายรับ 20000 เข้าธนาคาร แล้วดูยอด wallet และสรุปรายวันอัปเดตทันที |
| สรุปรายวัน/เดือน | เปลี่ยนวันที่ใน date picker ย้อนหลัง ควรเห็นข้อมูลของวันนั้น |
| ของใช้ | เพิ่มหมวดหมู่ > เพิ่มของ > เปลี่ยนสถานะเป็น "หมดแล้ว" > "ซื้อแล้ว" แล้วดู itemHistory และ push แจ้งเตือน |
| Auto-revert | ตั้ง `purchasedAt` ของ item เป็นเมื่อวานใน Firestore Console แล้วรีโหลดแอป ควรกลับเป็น "มีอยู่" อัตโนมัติ (หรือรอ Cloud Function เที่ยงคืน) |
| รายจ่ายร่วม (split) | สร้าง Netflix 88/คน กด "จ่ายแล้ว" ทีละคน ตรวจดูสถานะรายบุคคล |
| รายจ่ายร่วม (collective) | สร้างค่าซักผ้า กดจ่ายแล้ว ตรวจว่าเก็บชื่อคนจ่าย+วันที่ |
| สรุปรวมรายเดือน | เข้าแท็บ "สรุป" เลือกเดือน ตรวจว่ารวมข้อมูลทั้ง 3 ระบบ |
| แจ้งเตือน | เปิดแอป 2 เครื่อง (หรือ 2 browser profile) เปลี่ยนสถานะของในเครื่องหนึ่ง อีกเครื่องต้องได้รับ push (ต้อง deploy Cloud Functions ก่อน) |
| Offline | เปิด DevTools > Network > Offline แล้ว reload — แอปควรยังเปิดได้ (จาก cache) |

## หมายเหตุสำคัญที่ยังต้องทำต่อ (production-ready checklist)

- [ ] ใส่ค่า `firebaseConfig` และ `VAPID_KEY` จริงใน `index.html` และ `firebase.initializeApp` ใน `sw.js`
- [ ] Deploy `firestore.indexes.json` (`firebase deploy --only firestore`)
- [ ] เพิ่มไอคอนจริงใน `icons/icon-192.png`, `icons/icon-512.png`
- [ ] Deploy `firestore.rules` และ `functions/`
- [ ] อัปเกรดโปรเจกต์เป็นแผน Blaze เพื่อใช้ Scheduled Cloud Functions
- [ ] ทดสอบบนอุปกรณ์จริงทั้ง Android และ iOS ก่อนใช้งานจริงทั้ง 3 คน
