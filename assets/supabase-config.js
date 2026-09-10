// การตั้งค่าฐานข้อมูลกลาง (Supabase) — โปรเจกต์ "tukai" ใน organization "SRC garage"
// - ปล่อยเป็น null → แอพเก็บข้อมูลในเครื่องของแต่ละคน (ไม่แชร์กัน)
// - ใส่ค่า        → ทุกคนที่เปิดลิงก์เห็นข้อมูลและรูปชุดเดียวกัน
// publishable key เปิดเผยได้ตามที่ Supabase ระบุ (สิทธิ์จริงคุมด้วย Row Level Security ในฐานข้อมูล)
// ดู/เปลี่ยนค่าได้ที่ Supabase Dashboard → Project Settings → API Keys
window.TUKAI_SUPABASE = {
  url: "https://pgqyhgcqygpcaacsfuhs.supabase.co",
  anonKey: "sb_publishable_rWLx7W5daJt5KkieUnZNqA_R2Fsvj2a",
};
