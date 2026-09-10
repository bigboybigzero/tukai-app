// การตั้งค่าฐานข้อมูลกลาง (Firebase)
// - ปล่อยเป็น null  → แอพเก็บข้อมูลในเครื่องของแต่ละคน (ไม่แชร์กัน)
// - ใส่ค่า config   → ทุกคนที่เปิดลิงก์เห็นข้อมูลและรูปชุดเดียวกัน
// เอาค่ามาจาก Firebase Console → ไอคอนฟันเฟือง → Project settings → เลื่อนลงหา "Your apps" → SDK setup and configuration → Config
window.TUKAI_FIREBASE = null;

/* ตัวอย่างค่าที่ต้องวางแทน null (ก๊อปทั้งก้อนจาก Firebase มาวางได้เลย):
window.TUKAI_FIREBASE = {
  apiKey: "AIza....",
  authDomain: "tukai-xxxx.firebaseapp.com",
  projectId: "tukai-xxxx",
  storageBucket: "tukai-xxxx.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef"
};
*/
