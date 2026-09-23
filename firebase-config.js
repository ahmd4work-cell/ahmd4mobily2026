// ==========================================
// firebase-config.js - إعدادات سحابة Firebase
// ==========================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAnalytics, isSupported } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-analytics.js";
import { getFirestore, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// إعدادات مشروع Firebase الجديد (ahmd4mobily2026)
const firebaseConfig = {
  apiKey: "AIzaSyCSV4hHrE_EWOQ7Q4vThpI-7AqDNQh3idg",
  authDomain: "ahmd4mobily2026.firebaseapp.com",
  projectId: "ahmd4mobily2026",
  storageBucket: "ahmd4mobily2026.firebasestorage.app",
  messagingSenderId: "365833229927",
  appId: "1:365833229927:web:49661d5dbbe53295fae6c2",
  measurementId: "G-X3NGD09PLV"
};

// تهيئة تطبيق Firebase و Firestore
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// تهيئة Analytics بأمان دون تعطيل الكود
let analytics;
isSupported().then(supported => {
    if (supported) {
        analytics = getAnalytics(app);
    }
});

// دالة رفع البيانات إلى السحابة (Firestore)
window.cloudSync = async function(collectionName, docName, data) {
    try {
        const docRef = doc(db, collectionName, docName);
        await setDoc(docRef, { data: data }, { merge: true });
        console.log(`[Cloud] Synced ${collectionName}/${docName}`);
    } catch (error) {
        console.error("[Cloud] Error syncing data:", error);
    }
};

// دالة جلب البيانات من السحابة وحفظها في localStorage
window.cloudFetch = async function(collectionName, docName, localKey) {
    try {
        const docRef = doc(db, collectionName, docName);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            const cloudData = docSnap.data().data;
            localStorage.setItem(localKey, JSON.stringify(cloudData));
            console.log(`[Cloud] Fetched ${collectionName}/${docName}`);
        } else {
            console.log(`[Cloud] No document found at ${collectionName}/${docName}`);
        }
    } catch (error) {
        console.error("[Cloud] Error fetching data:", error);
    }
};

export { app, db, analytics };