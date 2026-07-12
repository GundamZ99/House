/**
 * Cloud Functions สำหรับ House App
 * ติดตั้ง: cd functions && npm install firebase-admin firebase-functions
 * Deploy:  firebase deploy --only functions
 */
const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();
const messaging = admin.messaging();

async function getAllTokens(excludeUid) {
  const snap = await db.collection('fcmTokens').get();
  const tokens = [];
  snap.forEach(doc => {
    if (excludeUid && doc.id === excludeUid) return;
    const t = doc.data().token;
    if (t) tokens.push(t);
  });
  return tokens;
}

async function sendToTokens(tokens, title, body, data = {}) {
  if (tokens.length === 0) return;
  await messaging.sendEachForMulticast({
    tokens,
    notification: { title, body },
    data
  });
}

/* ---------- 1) แจ้งเตือนของใช้ในบ้าน / รายจ่ายร่วม: ส่งทุกเครื่องเมื่อมีการเขียน "notifications" ---------- */
exports.onNewNotification = functions.firestore
  .document('notifications/{docId}')
  .onCreate(async (snap) => {
    const n = snap.data();
    const tokens = await getAllTokens();
    await sendToTokens(tokens, n.title, n.body, { tag: n.title });
  });

/* ---------- 2) แจ้งเตือนรายวันรายรับรายจ่ายส่วนตัว เวลา 23:59 (Asia/Bangkok) ---------- */
exports.dailyPersonalSummary = functions.pubsub
  .schedule('59 23 * * *')
  .timeZone('Asia/Bangkok')
  .onRun(async () => {
    const todayKey = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }); // YYYY-MM-DD
    const usersSnap = await db.collection('users').get();

    for (const userDoc of usersSnap.docs) {
      const uid = userDoc.id;
      const dayRef = db.collection('privateFinance').doc(uid)
        .collection('dailySummary').doc(todayKey);
      const daySnap = await dayRef.get();
      const d = daySnap.exists ? daySnap.data() : { income: 0, expense: 0 };
      const tokenSnap = await db.collection('fcmTokens').doc(uid).get();
      if (!tokenSnap.exists) continue;
      const token = tokenSnap.data().token;
      const body = `รายรับ ${d.income || 0} / รายจ่าย ${d.expense || 0} / คงเหลือ ${(d.income || 0) - (d.expense || 0)}`;
      await sendToTokens([token], 'สรุปรายรับรายจ่ายวันนี้ของคุณ', body);
    }
  });

/* ---------- 3) แจ้งเตือน Netflix ทุกวันที่ 16 ของเดือน ---------- */
exports.netflixReminder = functions.pubsub
  .schedule('0 9 16 * *')
  .timeZone('Asia/Bangkok')
  .onRun(async () => {
    const tokens = await getAllTokens();
    await sendToTokens(tokens, 'Netflix', 'พรุ่งนี้อย่าลืมจ่ายค่า NETFLIX นะจ๊ะ');
  });

/* ---------- 4) รีเซ็ตสถานะ "ซื้อแล้ว" -> "มีอยู่" หลังผ่านไป 1 วัน (เที่ยงคืนทุกวัน) ---------- */
exports.autoRevertPurchasedItems = functions.pubsub
  .schedule('5 0 * * *')
  .timeZone('Asia/Bangkok')
  .onRun(async () => {
    const todayKey = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
    const snap = await db.collection('items').where('status', '==', 'ซื้อแล้ว').get();
    const batch = db.batch();
    snap.forEach(doc => {
      const d = doc.data();
      if (d.purchasedAt && d.purchasedAt < todayKey) {
        batch.update(doc.ref, { status: 'มีอยู่' });
      }
    });
    await batch.commit();
  });

/* ---------- 5) ปิดรอบเดือน (เก็บ snapshot สรุปรายเดือนของแต่ละคน ไม่ลบของเก่า) ---------- */
exports.monthEndArchive = functions.pubsub
  .schedule('55 23 28-31 * *')
  .timeZone('Asia/Bangkok')
  .onRun(async () => {
    const now = new Date();
    const bkkNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
    const tomorrow = new Date(bkkNow); tomorrow.setDate(bkkNow.getDate() + 1);
    if (tomorrow.getMonth() === bkkNow.getMonth()) return; // ไม่ใช่วันสุดท้ายของเดือน ข้าม
    // ข้อมูล monthlySummary ของเดือนนี้ถูกสะสมไว้แล้วแบบ realtime และไม่ถูกลบ/รีเซ็ต
    // เดือนถัดไปจะเริ่มเอกสารใหม่โดยอัตโนมัติจาก monthKey ที่เปลี่ยนไป (ไม่ต้องทำอะไรเพิ่ม)
    functions.logger.log('Month-end reached, historical monthlySummary docs are preserved automatically.');
  });
