# IT Governance Dashboard — AutoCorp

Interactive dashboard สำหรับทีม **COE&S — AutoCorp (ATC)** อ้างอิง **Marubeni Group ITGR Checklist FY2026 Ver.1** (96 ข้อ, 8 หมวด)

Static frontend + Vercel serverless BFF + Supabase, with PIN login and role-based access (`admin` / `user` / `reviewer` / `approver` / `read_only`) driving a User → Reviewer → Approver approval workflow. See [PRD.md](PRD.md) for the full spec and [CLAUDE.md](CLAUDE.md) for architecture/agent notes.

## 🚀 Setup & Deployment

### 1. Provision Supabase

1. Create a Supabase project.
2. Run [`supabase/schema.sql`](supabase/schema.sql) in the SQL editor (idempotent — safe to re-run).
3. Note the project URL and `service_role` key (Settings → API).

### 2. Configure environment variables

Copy [`.env.example`](.env.example) → `.env` for local scripts, and set the same variables in **Vercel → Project Settings → Environment Variables**:

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `JWT_SECRET`, `PIN_PEPPER` — generate each with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

### 3. Seed data + create the first admin

```bash
npm install
npm run seed                                                  # loads data/*.json into Supabase
npm run create-user -- "Your Name" 4821 admin                 # bootstrap the first admin PIN
```

### 4. Refresh from a new ITGR workbook (each fiscal year)

`data/items.json` and `data/assessment.json` are generated from the official Marubeni workbook. When a new FY release arrives:

```bash
npm run extract-xlsx -- "path/to/Marubeni_..._Checklist_English.xlsx"
npm run seed                                                  # upsert the refreshed requirements
npm run import-assessment                                     # dry run — shows what would change
npm run import-assessment -- --commit                         # write the self-assessment answers
```

Requires Python with `openpyxl` (`pip install openpyxl`). Item numbers are stable across releases, so tracker state, workflow history and the audit trail all survive a refresh. The self-assessment lands in its own `self_assessment` columns and never overwrites workflow-driven `status` — only the Reviewer/Approver flow sets a compliance verdict.

> `npm run extract-data` is the superseded one-off that scraped the original `index.html`; it is kept only for provenance.

### 5. Deploy on Vercel

1. **Import Project** บน Vercel Dashboard → เลือก repo `kimprojecttpl/ITGR`
2. Framework Preset: **Other** — no build command, no output directory (root serves `index.html`/`login.html`; `/api/*.js` is auto-detected as serverless functions)
3. Deploy

Unauthenticated visits to `index.html` redirect to `login.html`. Users sign in with a PIN issued by an admin (see Section 3).

## 📁 Structure

```
.
├── index.html          # Dashboard (fetches all data from /api/*)
├── login.html           # PIN login page
├── api/                  # Vercel serverless functions (BFF)
│   ├── auth/             # login, logout
│   ├── items/             # checklist items + status
│   ├── admin/              # user management, audit log (admin-only)
│   ├── drive.js / appendices.js / me.js
├── lib/                  # shared server-side helpers (auth, supabase, pin hashing)
├── supabase/schema.sql   # DB schema (checklist_items, item_status, users, audit_log, ...)
├── scripts/               # extract-xlsx, seed, create-user, import-assessment (CLI)
├── data/                  # checklist/drive/appendix/assessment data for seeding
├── vercel.json           # Vercel config — security headers, cleanUrls
├── PRD.md / CLAUDE.md
└── README.md
```

## 🧩 Tech Stack

- Frontend: HTML5 + Tailwind CSS (CDN), vanilla JavaScript, Sarabun (TH)
- BFF: Vercel serverless functions (Node, `@supabase/supabase-js`, `jsonwebtoken`)
- Database: Supabase (Postgres)
- Auth: PIN login, JWT session cookie, 5-role RBAC + approval workflow

## 🔒 Scope

ข้อมูลในแดชบอร์ดอ้างอิงเฉพาะ **ITGR Checklist FY2026** และเอกสารใน Google Drive *"IT Governance / IT DD 2025"* — ไม่อ้างอิงข้อมูลภายนอก
