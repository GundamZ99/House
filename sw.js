// sw.js
// รวม 2 หน้าที่ไว้ใน service worker ตัวเดียว เพื่อป้องกันปัญหา "scope ชนกัน"
// (ถ้าจดทะเบียน sw.js และ firebase-messaging-sw.js แยกกันที่ scope เดียวกัน
//  ตัวที่จดทะเบียนทีหลังจะแทนที่ตัวก่อนหน้า ทำให้ push notification เงียบหายไปโดยไม่มี error)
//   1) Offline cache สำหรับ app shell
//   2) รับ Firebase Cloud Messaging ตอนแอปอยู่เบื้องหลัง/ปิดอยู่

const CACHE_NAME = 'house-app-cache-v2';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // ปล่อยให้ Firestore/Firebase SDK จัดการ offline persistence ของตัวเอง ไม่ต้อง cache ทับ
  if (url.includes('firestore.googleapis.com') || url.includes('firebaseinstallations')) {
    return;
  }

  // Cache API รองรับเฉพาะ request scheme http/https เท่านั้น
  // request ที่มาจาก browser extension (เช่น chrome-extension://, moz-extension://)
  // ต้องข้ามไปเลย ไม่งั้น cache.put() จะ throw TypeError
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (event.request.method === 'GET' && networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME)
              .then((cache) => cache.put(event.request, clone))
              .catch((err) => console.warn('Cache put failed:', err));
          }
          return networkResponse;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});

/* ==================== Firebase Cloud Messaging (background) ==================== */
try {
  importScripts('https://www.gstatic.com/firebasejs/10.13.1/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/10.13.1/firebase-messaging-compat.js');

  // ต้องเป็นค่าเดียวกันเป๊ะกับ firebaseConfig ใน index.html
  firebase.initializeApp({
    apiKey: "AIzaSyAQHPqbAkKJUVlWVtkv_yaN42a6yrLvdp4",
    authDomain: "house-ce16d.firebaseapp.com",
    projectId: "house-ce16d",
    storageBucket: "house-ce16d.firebasestorage.app",
    messagingSenderId: "201070312334",
    appId: "1:201070312334:web:ac3e455128333e9b5502df"
  });

  const messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
    const title = payload.notification?.title || payload.data?.title || 'House';
    const body = payload.notification?.body || payload.data?.body || '';
    const options = {
      body,
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      data: payload.data || {},
      tag: payload.data?.tag || 'house-notification'
    };
    self.registration.showNotification(title, options);
  });
} catch (err) {
  console.warn('FCM setup in service worker failed:', err);
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('./index.html');
    })
  );
});
