# IT Governance Dashboard — AutoCorp

Interactive dashboard สำหรับทีม **COE&S — AutoCorp (ATC)** อ้างอิง **Marubeni Group ITGR Checklist FY2025 Ver.1** (96 ข้อ, 8 หมวด)

## 🚀 Deployment

Deploy เป็น static site บน [Vercel](https://vercel.com) — ไฟล์ entry คือ `index.html`

### วิธี Deploy

1. **Import Project** บน Vercel Dashboard → เลือก repo `kimprojecttpl/ITGR`
2. Framework Preset: **Other** (Static)
3. Build Command: *(เว้นว่าง)*
4. Output Directory: *(เว้นว่าง — ใช้ root)*
5. Deploy

Vercel จะตรวจพบ `index.html` ที่ root และ serve ทันที — ไม่ต้อง build

## 📁 Structure

```
.
├── index.html       # Dashboard หลัก (Tailwind CDN, Sarabun font)
├── vercel.json      # Vercel config — security headers, cleanUrls
├── .gitignore
└── README.md
```

## 🧩 Tech Stack

- HTML5 + Tailwind CSS (CDN)
- Google Fonts: Sarabun (TH)
- Vanilla JavaScript

## 🔒 Scope

ข้อมูลในแดชบอร์ดอ้างอิงเฉพาะ **ITGR Checklist FY2025** และเอกสารใน Google Drive *"IT Governance / IT DD 2025"* — ไม่อ้างอิงข้อมูลภายนอก
