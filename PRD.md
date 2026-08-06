# PRD — IT Governance Dashboard (ITGR) — AutoCorp

**Owner:** COE&S — AutoCorp (ATC)
**Status:** Draft — target-state spec for Supabase + BFF + PIN auth migration
**Source:** Derived from current codebase (`index.html`) + explicit stakeholder direction

---

## 1. Problem Statement

The current ITGR Dashboard is a single static HTML file that tracks AutoCorp's compliance against the 96-item Marubeni Group ITGR Checklist FY2025. All tracker state (status, owner, note per checklist item) is written to **browser `localStorage`**, which means:

- Data is **per-device, per-browser** — nothing entered on one machine is visible to anyone else.
- There is **no audit trail** of who changed what, or when.
- There is **no access control** — anyone with the URL can view and edit everything; there is no way to grant a stakeholder read-only visibility without also giving them edit rights.
- Compliance data with real audit/legal weight (a Marubeni Group governance checklist) is sitting in a volatile client-side store that can be wiped by clearing browser data.

COE&S needs this to become a real shared, multi-user, access-controlled system before it can be relied on as the system of record for the FY2025 ITGR compliance effort.

## 2. Goals

1. All checklist data, reference data, and tracker state live in **Supabase (Postgres)** as the single source of truth — no data survives only in `localStorage` or only in the client bundle.
2. The frontend never talks to Supabase directly — all reads/writes go through a **BFF** (`/api/*` Vercel serverless functions) so the Supabase service key is never exposed to the browser.
3. Access is controlled by a **PIN login** with three enforced roles (`admin`, `read_write`, `read_only`), checked server-side on every mutating request — not just hidden in the UI.
4. Every status/owner/note change is attributable to a user and timestamped (basic audit log), replacing the current fully-anonymous edit model.
5. Existing dashboard functionality (Overview, Tracker, Category view, Reference index, Appendix view) is preserved with no loss of feature or content during the migration.

## 3. Non-Goals

- **Self-service signup / SSO / email login** — out of scope. PIN-only login was explicitly requested; this is an internal tool for a small, known set of COE&S/ATC staff, not a public-facing product.
- **Real-time multi-user collaboration (live cursors, conflict resolution UI)** — out of scope for v1. Last-write-wins is acceptable; concurrent edit conflicts are rare for a checklist tracker of this size.
- **Editing the checklist master content (the 96 requirement definitions) through the UI** — v1 ships with checklist/appendix/drive-index content seeded once from the current `index.html`. Admins can correct data directly in Supabase if needed; a full CMS-style editor for requirement text is a future consideration.
- **Mobile native app** — the dashboard remains a responsive web app, not a packaged mobile app.
- **Migrating away from Vercel hosting** — the BFF is built as Vercel serverless functions specifically to keep the existing deployment model; a framework migration (e.g., to Next.js) is not required for this PRD.

## 4. User Roles & Permissions

| Capability | `admin` | `read_write` | `read_only` |
|---|---|---|---|
| View Overview / Tracker / Category / Reference / Appendix tabs | ✅ | ✅ | ✅ |
| Update item status / owner / note | ✅ | ✅ | ❌ |
| Edit checklist master data (item text, risk, priority) | ✅ | ❌ | ❌ |
| Create / deactivate users, assign roles, reset PINs | ✅ | ❌ | ❌ |
| View audit log | ✅ | ❌ | ❌ |
| Export data | ✅ | ✅ | ✅ |

All permission checks are enforced in the BFF handler, not just in frontend rendering. Frontend role-based UI hiding is a UX convenience only.

## 5. User Stories

**As a read-only stakeholder (e.g., a department head reviewing progress),**
I want to log in with a PIN and view the dashboard without any edit controls visible,
so that I can check compliance status without risk of accidentally changing data.

**As a read/write user (e.g., a control owner updating their assigned items),**
I want to log in with my PIN and update the status, owner, and note of checklist items,
so that my progress is recorded and visible to the rest of the team.

**As an admin (e.g., the COE&S lead),**
I want to create new user PINs and assign roles,
so that I can onboard new team members without shared/generic credentials.

**As an admin,**
I want to see an audit log of who changed which item and when,
so that I can answer "who marked this compliant?" during an internal or Marubeni review.

**As any logged-in user,**
I want the Tracker, Category, Overview, Reference, and Appendix views to behave exactly as they do today,
so that the migration doesn't disrupt a workflow the team already relies on.

**As a user entering a wrong PIN,**
I want a clear error message without being told whether the PIN exists,
so that the login doesn't leak which PINs are valid.

## 6. Functional Requirements

### P0 — Must-Have

- **Auth**
  - PIN-entry login page (`login.html`); no username/email field.
  - PINs are hashed at rest (never stored or logged in plaintext).
  - Successful login issues a signed, httpOnly, secure session cookie (JWT) with a reasonable expiry (e.g., 8–12h) and the user's role embedded/verifiable server-side.
  - All `/api/*` endpoints (except `/api/auth/login`) require a valid session; mutating endpoints additionally require the appropriate role.
  - Logout clears the session cookie.
  - Generic "invalid PIN" error — no distinction between "PIN not found" and "PIN wrong" (there is no separate identifier, but the message must not help enumerate valid PINs via timing or content differences).
- **Data migration**
  - All 96 checklist items (`ITEMS`), the Google Drive reference index (`DRIVE`), and the 5 appendices (`APPX`) are migrated from the hardcoded JS constants into Supabase tables.
  - Existing tracker semantics (status ∈ {Not Started, In Progress, Compliant, Partial, Not Applicable}, owner free text, note free text) are preserved as a `item_status` table keyed by item number.
- **BFF**
  - `GET /api/items` — checklist items joined with current status/owner/note.
  - `PATCH /api/items/:no/status` — update status/owner/note (role: `admin`, `read_write`).
  - `GET /api/drive` — Google Drive reference index.
  - `GET /api/appendices` — appendix data.
  - `GET /api/me` — current session's user/role.
  - `POST /api/auth/login`, `POST /api/auth/logout`.
  - `admin`-only: `GET/POST /api/admin/users`, `PATCH/DELETE /api/admin/users/:id`, `GET /api/admin/audit-log`.
- **Frontend**
  - Existing tabs (Overview, Tracker, Category, Reference, Appendix) work against data fetched from the BFF instead of embedded constants.
  - Read-only users see no editable inputs on the Tracker tab (status/owner/note become plain text).
  - Unauthenticated visits to the dashboard redirect to the login page.
- **Audit**
  - Every status/owner/note change writes an `audit_log` row: user, item no, field, old value, new value, timestamp.

### P1 — Nice-to-Have

- Admin UI (in-dashboard, not just direct DB access) to create/deactivate users and reset PINs.
- Admin UI to view the audit log (filter by item/user/date).
- CSV export of the current tracker state.
- Rate limiting / lockout after repeated failed PIN attempts.

### P2 — Future Considerations

- In-UI editing of checklist master content (item text, risk, priority) with its own audit trail.
- Per-category or per-item assignment/notification (e.g., notify an owner when an item is assigned to them).
- SSO if AutoCorp later requires it for this tool.

## 7. Data Model (overview)

- `users` — id, display_name, role (`admin`|`read_write`|`read_only`), pin_hash, active, created_at.
- `checklist_items` — no (PK), cat_no, category, cat_short, cat_short_th, name, content, standard, evidence, article, issue, risk, priority, qtype.
- `item_status` — item_no (FK → checklist_items.no), status, owner, note, updated_by (FK → users.id), updated_at.
- `drive_folders` / `drive_files` — reference document index (folder → files, mirrors current `DRIVE` structure).
- `appendices` — id, seq, title, title_th, cat, cat_short, cat_short_th, related_q (int[]), kind, data (JSONB — preserves the current nested per-appendix structure without over-normalizing five differently-shaped appendices).
- `audit_log` — id, user_id, item_no, field, old_value, new_value, created_at.

Full DDL lives in `supabase/schema.sql`.

## 8. Success Metrics

**Leading (first 2–4 weeks post-launch):**
- 100% of active COE&S/ATC team members have a working PIN login (adoption).
- Zero reports of "my update disappeared" (localStorage data-loss class of bug eliminated).
- All tracker edits show a correct `updated_by` in the audit log (data integrity check, sampled).

**Lagging (end of FY2025 tracking cycle):**
- The dashboard is the system of record used in the actual Marubeni ITGR review, with a traceable audit log for every status change.
- No read-only stakeholder has been given edit credentials as a workaround (i.e., the 3-role model actually matched real usage needs).

## 9. Open Questions

- **PIN length/format and issuance process** (engineering/stakeholder): assumed 4–6 digit numeric PIN, issued by an admin out-of-band (e.g., verbally or via internal chat) rather than self-service. Needs confirmation.
- **Session expiry duration** (engineering): assumed 8–12h sliding/absolute expiry; not specified by stakeholder.
- **Who holds initial admin access** (stakeholder): the first admin user must be seeded manually (via `scripts/seed.mjs` or directly in Supabase) since there's no bootstrap flow — needs a named owner.
- **Retention of audit log** (stakeholder/legal): no retention/deletion policy specified; assumed indefinite retention for the FY2025 cycle.
- **Whether Reference (Drive links) and Appendix content can change over the FY2025 cycle** (stakeholder): if yes, P2 in-UI editing should be reprioritized to P0/P1.
- **Rate limiting on login** (engineering): P1 lockout-after-failed-attempts was assumed nice-to-have, not required for launch — confirm this is acceptable given PINs are shorter/weaker than passwords.

## 10. Timeline Considerations

- No hard external deadline specified by stakeholder; implicitly tied to the **FY2025 ITGR review cycle** — the migration should land before the checklist is actively used for that cycle's tracking, not mid-cycle.
- Dependency: a **Supabase project must be provisioned** (URL + service role key) and a **JWT signing secret** generated before the BFF can be deployed — these are external setup steps outside this codebase.
- Suggested phasing: (1) schema + data migration + read-only BFF endpoints, (2) PIN auth + role enforcement, (3) write endpoints + audit log, (4) admin user-management UI (P1).
