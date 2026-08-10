# PRD — IT Governance Dashboard (ITGR) — AutoCorp

**Owner:** COE&S — AutoCorp (ATC)
**Version:** 1.3
**Status:** v1.0, v1.1, v1.2 shipped and verified on Vercel — this revision **specs** the v1.3 addition (not yet implemented; see § Timeline Considerations)
**Source:** Derived from current codebase (`index.html`) + explicit stakeholder direction

## Version History

| Version | Date | Summary |
|---|---|---|
| 1.0 | 2026-08-06 | Initial target-state spec: migrate checklist/reference/tracker data from `localStorage` to Supabase, add a Vercel serverless BFF mediating all data access, add PIN login with 3-tier RBAC (`admin` / `read_write` / `read_only`) and a basic audit log. Shipped and tagged **Baseline 1.0** (`v1.0.0`). |
| 1.1 | 2026-08-10 | Add a category-level **Compliance Radar Chart** to the Overview tab — one axis per ITGR category (8 total), plotting each category's existing progress % with an A–E letter grade overlay. No new data model or API changes; computed client-side from data already served by `/api/items`. Shipped. |
| 1.2 | 2026-08-10 | Add an **Overall Grade** (single A–E grade combining all 8 categories) and a **Priority / Top Priority status breakdown**, so a reviewer can see compliance posture for the highest-risk items (◎ Top Priority, 〇 Priority) without cross-referencing the Tracker tab. Same grading scale and data source as v1.1 — no new data model or API changes. Shipped. |
| 1.3 | 2026-08-10 | Add a **ClickUp task link** field per item; add a **User → Reviewer → Approver approval workflow** (submit for approval, reviewer OK/reject with comment, approver decision of Compliant / Complied with Condition / Not Compliant with required evidence/exception note); extend the audit trail to cover every workflow action. This is the first v-next revision requiring new roles, new tables, and new BFF endpoints — **spec only in this revision**, pending stakeholder sign-off on the open questions below before implementation. |

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
6. **(v1.3)** No checklist item is marked with a final compliance decision (Compliant / Complied with Condition / Not Compliant) without going through a separate Reviewer and Approver — the person who prepared the evidence is never the person who signs off on it.
7. **(v1.3)** Every remediation task tracked in ClickUp is one click away from the ITGR requirement it supports, so COE&S doesn't maintain a second manual mapping between the checklist and the ClickUp board.

## 3. Non-Goals

- **Self-service signup / SSO / email login** — out of scope. PIN-only login was explicitly requested; this is an internal tool for a small, known set of COE&S/ATC staff, not a public-facing product.
- **Real-time multi-user collaboration (live cursors, conflict resolution UI)** — out of scope for v1. Last-write-wins is acceptable; concurrent edit conflicts are rare for a checklist tracker of this size.
- **Editing the checklist master content (the 96 requirement definitions) through the UI** — v1 ships with checklist/appendix/drive-index content seeded once from the current `index.html`. Admins can correct data directly in Supabase if needed; a full CMS-style editor for requirement text is a future consideration.
- **Mobile native app** — the dashboard remains a responsive web app, not a packaged mobile app.
- **Migrating away from Vercel hosting** — the BFF is built as Vercel serverless functions specifically to keep the existing deployment model; a framework migration (e.g., to Next.js) is not required for this PRD.
- **(v1.3) Deep ClickUp API integration** — v1.3 is a plain URL field the user pastes in and clicks to open ClickUp in a new tab. Auto-creating ClickUp tasks from the dashboard, or syncing ClickUp task status back into the checklist, is a future consideration (see § Recommendations).
- **(v1.3) Multi-reviewer / multi-approver or parallel sign-off per item** — v1.3 is a single Reviewer then a single Approver per item, not a committee/quorum flow.
- **(v1.3) Per-category workflow role assignment** — v1.3 treats "Reviewer" and "Approver" as global roles (a Reviewer can review any of the 96 items, not just ones in categories assigned to them). Scoping reviewers/approvers to specific categories is flagged as an open question, not committed as in-scope.
- **(v1.3) Automated notifications (email/Slack/Teams)** — v1.3 surfaces pending-action counts in-app only; push notifications are a P1/P2 follow-up (see § Recommendations).
- **(v1.3) Reopening an already-decided item (Compliant / Complied with Condition / Not Compliant)** — v1.3 has no "reopen" flow; once an Approver decides, changing it requires direct admin/DB intervention. A proper reopen-with-history flow is a future consideration.

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

### 4a. Workflow Roles (v1.3)

v1.3 introduces a **per-item approval workflow** (User → Reviewer → Approver) that sits on top of, and changes, the existing role model. The `read_write` tier — previously "can update tracker state" — is split into three workflow-specific roles that each act at a different stage of the same item:

| Capability | `admin` | `user` | `reviewer` | `approver` | `read_only` |
|---|---|---|---|---|---|
| View all tabs | ✅ | ✅ | ✅ | ✅ | ✅ |
| Edit item's Owner / Evidence(note) / ClickUp Task link | ✅ | ✅ (own/assigned items) | ❌ | ❌ | ❌ |
| Click "Submit for Approval" | ✅ | ✅ | ❌ | ❌ | ❌ |
| Review a submitted item: OK (→ Approver) or Reject (→ back to User) with comment | ✅ | ❌ | ✅ | ❌ | ❌ |
| Make the final decision: Compliant / Complied with Condition / Not Compliant, with comment + evidence | ✅ | ❌ | ❌ | ✅ | ❌ |
| Edit checklist master data, manage users, view audit log | ✅ | ❌ | ❌ | ❌ | ❌ |

`admin` can act in any workflow stage (break-glass / cover for absence), everyone else is scoped to exactly one stage. This mirrors segregation-of-duties expectations for a compliance sign-off process — the preparer, reviewer, and approver should not default to the same person.

**Migration note — decided (2026-08-10):** existing production users hold `admin` / `read_write` / `read_only` roles today (real accounts: `admin`, `lead`, `reviewer` — note "reviewer" is currently just a display name, not yet a role). `read_only` maps cleanly to the new model unchanged. The `lead` account (currently `read_write`) becomes **`user`**. This leaves the real system with **no `reviewer` and no `approver` account yet** — at least one of each must be created (via the Admin tab or `scripts/create-user.mjs`) before the workflow is usable end-to-end; `admin` can temporarily cover both stages if needed, but that defeats segregation-of-duties and should only be a short-term bridge.

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

**As a COE&S lead reviewing overall posture (v1.1),**
I want to see all 8 ITGR categories plotted on a single radar/spider chart with a letter grade per category,
so that I can spot weak categories at a glance without reading 8 separate progress bars or opening the Tracker.

**As a COE&S lead reporting status upward (v1.2),**
I want a single overall A–E grade combining all 8 categories,
so that I can give a one-word/one-letter answer to "how are we doing overall" without averaging 8 numbers myself.

**As a COE&S lead prioritizing remediation work (v1.2),**
I want to see the compliance status specifically for Top Priority (◎) and Priority (〇) items, separate from standard items,
so that I can tell whether the highest-risk requirements are on track even if the overall grade looks fine.

**As a User preparing evidence for an item (v1.3),**
I want to paste a ClickUp task link into the item alongside the Owner and Evidence note, and click it to jump straight to that task,
so that I don't have to search ClickUp for the remediation work tied to this requirement.

**As a User who has finished preparing an item (v1.3),**
I want to click "Submit for Approval" to send it to my Reviewer,
so that my work moves into the formal sign-off process instead of just sitting in "In Progress" indefinitely.

**As a Reviewer (v1.3),**
I want to see items waiting on me, and OK or Reject each one with a comment,
so that I can either pass good work to the Approver or send bad work back to the User with clear feedback on what to fix.

**As a User whose submission was rejected (v1.3),**
I want to see the Reviewer's or Approver's comment on my item,
so that I know exactly what to fix before resubmitting.

**As an Approver (v1.3),**
I want to mark a reviewed item Compliant, Complied with Condition (with required evidence/exception note), or Not Compliant,
so that the final compliance decision for that requirement is recorded with the reasoning behind it.

**As an admin or Marubeni-facing reviewer (v1.3),**
I want every submit / review / approve / reject action logged with who, what, and when,
so that the full decision trail for a requirement is reconstructable during an actual audit, not just the final status.

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
  - **(v1.3, proposed)** `POST /api/items/:no/submit` (role: `user`, `admin`) · `POST /api/items/:no/review` `{decision, comment}` (role: `reviewer`, `admin`) · `POST /api/items/:no/approve` `{decision, comment, evidence_file_ids}` (role: `approver`, `admin`) · `POST /api/items/:no/evidence` (file upload → Supabase Storage, returns file id) · `GET /api/items/:no/history` (workflow events + comments for one item).
- **Frontend**
  - Existing tabs (Overview, Tracker, Category, Reference, Appendix) work against data fetched from the BFF instead of embedded constants.
  - Read-only users see no editable inputs on the Tracker tab (status/owner/note become plain text).
  - Unauthenticated visits to the dashboard redirect to the login page.
- **Audit**
  - Every status/owner/note change writes an `audit_log` row: user, item no, field, old value, new value, timestamp.
- **Category Compliance Radar (v1.1)**
  - Overview tab shows a radar/spider chart with exactly 8 axes, one per ITGR category, alongside the existing "Progress by Category" bars (additive, not a replacement).
  - Each axis plots the category's progress % — the same metric already computed by `progressPct()` for the category bars and Category-tab cards (Compliant = full credit, Partial = half credit, Not Applicable = full credit, Not Started/In Progress = no credit), so the radar and the existing bars can never disagree.
  - Each category additionally shows a letter grade derived from that same percentage:
    - **A**: ≥ 80%
    - **B**: ≥ 60% and < 80%
    - **C**: ≥ 40% and < 60%
    - **D**: ≥ 20% and < 40%
    - **E**: < 20%
  - Grade thresholds are boundary-inclusive on the lower bound (e.g., exactly 80% is an A, exactly 60% is a B) — no gap or overlap between bands.
  - Grade is shown per-axis on the chart (label or color) and available on hover/tap for the numeric %.
  - Computed entirely client-side from data already returned by `GET /api/items` — no schema or BFF changes required.
- **Overall Grade & Priority Status (v1.2)**
  - Overview tab shows one **overall grade** (A–E) computed from the same overall progress % already shown in the "Overall Progress" KPI (i.e. across all 96 items, all 8 categories combined) — same A/B/C/D/E thresholds as the per-category radar (§ Category Compliance Radar above).
  - Overview tab shows two priority-tier panels, computed the same way as the per-category breakdown but filtered by `priority`:
    - **Top Priority (◎)**: progress %, grade, and a status-count breakdown (Not Started / In Progress / Compliant / Partial / Not Applicable).
    - **Priority (〇)**: same breakdown.
  - Items with no priority marker (`priority === ""`, the majority of the checklist) are intentionally excluded from these two panels — they're already covered by the overall grade and the per-category radar.
  - If a tier has zero items (not expected given current data, but must not crash), render an empty state instead of a divide-by-zero or blank panel.
  - Computed entirely client-side from data already returned by `GET /api/items` — no schema or BFF changes required.
- **ClickUp Task Link (v1.3)**
  - Tracker row's expanded detail gets a third editable field alongside Owner and Evidence(note): **Task** — a text input for a ClickUp task URL, saved on change like the existing fields.
  - A saved link renders as a clickable button/icon that opens the ClickUp task in a new tab (`target="_blank"`); empty = no button shown.
  - Basic format validation (must look like a URL) before saving; does not need to verify the link is a real/reachable ClickUp task (no ClickUp API call).
  - Editable by `user` and `admin` only (same as Owner/Evidence) — not editable by `reviewer`/`approver`/`read_only`.
- **Approval Workflow (v1.3)**
  - Each checklist item has a `workflow_state`, separate from (but driving) the existing display `status`:
    - `Not Started` / `In Progress` — User is preparing the item (unchanged from today; not yet submitted).
    - `Pending Review` — User clicked Submit for Approval; waiting on a Reviewer.
    - `Pending Approval` — Reviewer clicked OK; waiting on an Approver.
    - `Rejected` — Reviewer or Approver rejected; back with the User, rejection comment visible.
    - `Compliant` / `Complied with Condition` / `Not Compliant` — Approver's final decision (terminal states for v1.3; no reopen flow, see § Non-Goals).
  - **Submit for Approval**: visible to `user`/`admin` on items in `Not Started`, `In Progress`, or `Rejected`. Requires **both Owner and Evidence(note) to be filled in** (decided 2026-08-10 — ClickUp Task link is not required to submit). Transitions to `Pending Review`.
  - **Reviewer action**: visible to `reviewer`/`admin` on items in `Pending Review`. Two choices:
    - **OK** → `Pending Approval`. Comment optional.
    - **Reject** → `Rejected`, back to User. Comment **required** (the User needs to know what to fix).
  - **Approver action**: visible to `approver`/`admin` on items in `Pending Approval`. Three choices:
    - **Compliant** → terminal state `Compliant`. Comment optional.
    - **Complied with Condition** → terminal state `Complied with Condition` (counted as **Partial** for all existing progress %/grade calculations — no changes needed to `progressPct()`/`gradeFor()`). Requires **at least one of** an attached evidence document **or** an exception comment (decided 2026-08-10 — not both mandatory).
    - **Not Compliant (NC)** → terminal state `Not Compliant`. Comment optional but recommended.
    - Approver can also **Reject** back to the User (e.g., evidence insufficient to decide at all) — same as a Reviewer reject, comment required.
  - **Status mapping — decided (2026-08-10):** the existing `status` field/enum (used by the Overview KPIs, radar chart, and grade panels from § v1.1/v1.2) is extended by **repurposing `Not Applicable` to mean `Not Compliant`**, rather than adding a sixth status value. `Compliant` maps straight through; `Complied with Condition` maps to `Partial`. This is a deliberate, confirmed decision despite the semantic shift: "Not Applicable" as a distinct concept ("this requirement doesn't apply to us") is retired from the system going forward. **Data migration impact:** as of this spec, exactly **1 production item** is currently marked `Not Applicable` under the old meaning — that row is reinterpreted as `Not Compliant` when this ships; whoever owns that item should be told its displayed meaning changed, not just its label.
  - Every workflow transition writes a row capturing: item no, actor, from-state, to-state, comment (if any), evidence file reference (if any), timestamp — this is both the audit trail (§ next) and the comment history the User sees on a rejected item.
- **Evidence Attachments (v1.3)**
  - Approver's "Complied with Condition" decision (and optionally any decision) can attach one or more evidence files, stored in Supabase Storage (private bucket, not public) and served to authorized users via short-lived signed URLs from the BFF — never a public file URL.
  - Accepted file types/size limits are an implementation detail to define (e.g., PDF/DOCX/XLSX/PNG/JPG, capped at a reasonable size like 10–20MB) — not user-specified, flagged for engineering to set sensible defaults.
- **Extended Audit Log (v1.3)**
  - Every workflow action (submit, review OK/reject, approve/complied-with-condition/NC/reject) is captured in the audit trail with actor, item, from-state, to-state, comment, and timestamp — extending the existing `audit_log` pattern already used for status/owner/note edits (§ v1.0), not a separate/parallel logging system.
  - Admin's existing audit log view (P1 from v1.0) should be extended to show workflow events, not just field edits, once built.

### P1 — Nice-to-Have

- Admin UI (in-dashboard, not just direct DB access) to create/deactivate users and reset PINs.
- Admin UI to view the audit log (filter by item/user/date).
- CSV export of the current tracker state.
- Rate limiting / lockout after repeated failed PIN attempts.
- **(v1.3)** In-app "items waiting on you" counter/badge for Reviewers and Approvers (no external notifications yet).
- **(v1.3)** Bulk submit-for-approval (User selects multiple ready items at once instead of one at a time).
- **(v1.3)** Per-item comment thread view showing the full history (not just the latest rejection reason), so context survives multiple resubmit/reject cycles.

### P2 — Future Considerations

- In-UI editing of checklist master content (item text, risk, priority) with its own audit trail.
- Per-category or per-item assignment/notification (e.g., notify an owner when an item is assigned to them).
- SSO if AutoCorp later requires it for this tool.
- **(v1.3)** Email/Slack/Teams notifications on submit/reject/approve.
- **(v1.3)** Per-category Reviewer/Approver assignment instead of global workflow roles.
- **(v1.3)** Reopen flow for already-decided items, preserving prior decision history.
- **(v1.3)** Deeper ClickUp API integration (task status sync, auto-creating tasks from the dashboard).
- **(v1.3)** SLA/due-date tracking with an overdue flag once an item enters `Pending Review`/`Pending Approval`.

## 7. Data Model (overview)

- `users` — id, display_name, role (`admin`|`read_write`|`read_only`), pin_hash, active, created_at.
- `checklist_items` — no (PK), cat_no, category, cat_short, cat_short_th, name, content, standard, evidence, article, issue, risk, priority, qtype.
- `item_status` — item_no (FK → checklist_items.no), status, owner, note, updated_by (FK → users.id), updated_at.
- `drive_folders` / `drive_files` — reference document index (folder → files, mirrors current `DRIVE` structure).
- `appendices` — id, seq, title, title_th, cat, cat_short, cat_short_th, related_q (int[]), kind, data (JSONB — preserves the current nested per-appendix structure without over-normalizing five differently-shaped appendices).
- `audit_log` — id, user_id, item_no, field, old_value, new_value, created_at.

Full DDL lives in `supabase/schema.sql`.

### v1.3 additions (proposed — not yet in `schema.sql`)

- `users.role` check constraint extended to `admin` | `user` | `reviewer` | `approver` | `read_only` (replaces `read_write`; requires the migration decision in § 4a).
- `item_status` gains: `clickup_url` (text, nullable), `workflow_state` (text, default `Not Started`, the states from § Functional Requirements). The existing `status` check constraint's `Not Applicable` value is **renamed to `Not Compliant`** (decided 2026-08-10 — not adding a sixth value); the 1 existing row using the old value is migrated to the new one as part of this change, and `index.html`'s `STATUSES`/`STATUS_TH`/`STATUS_COLOR`/`STATUS_BG` constants are updated to match (label becomes "ไม่ผ่าน / Not Compliant").
- `item_workflow_events` (new, append-only) — id, item_no (FK), actor_id (FK → users), from_state, to_state, comment, evidence_file_id (FK, nullable), created_at. This is both the workflow audit trail and the comment history shown to the User; the existing `audit_log` table stays focused on simple field edits (owner/note/clickup_url) as it does today, rather than overloading one table with two different event shapes.
- `item_evidence_files` (new) — id, item_no (FK), uploaded_by (FK → users), storage_path (Supabase Storage, private bucket), file_name, content_type, uploaded_at.

## 8. Success Metrics

**Leading (first 2–4 weeks post-launch):**
- 100% of active COE&S/ATC team members have a working PIN login (adoption).
- Zero reports of "my update disappeared" (localStorage data-loss class of bug eliminated).
- All tracker edits show a correct `updated_by` in the audit log (data integrity check, sampled).

**Lagging (end of FY2025 tracking cycle):**
- The dashboard is the system of record used in the actual Marubeni ITGR review, with a traceable audit log for every status change.
- No read-only stakeholder has been given edit credentials as a workaround (i.e., the 3-role model actually matched real usage needs).
- **(v1.3, leading)** 100% of newly-submitted items go through a Reviewer and Approver before reaching a terminal state (zero items marked Compliant/NC by direct DB edit outside the workflow, sampled from `item_workflow_events`).
- **(v1.3, leading)** Median time from "Submit for Approval" to a terminal decision, measured in the first month, to establish a baseline turnaround-time expectation.
- **(v1.3, lagging)** % of submissions rejected at least once before final approval — a high rate signals the User-facing guidance/required-fields bar is too loose (worth revisiting § P0 "minimum bar to submit").

## 9. Open Questions

- **PIN length/format and issuance process** (engineering/stakeholder): assumed 4–6 digit numeric PIN, issued by an admin out-of-band (e.g., verbally or via internal chat) rather than self-service. Needs confirmation.
- **Session expiry duration** (engineering): assumed 8–12h sliding/absolute expiry; not specified by stakeholder.
- **Who holds initial admin access** (stakeholder): the first admin user must be seeded manually (via `scripts/seed.mjs` or directly in Supabase) since there's no bootstrap flow — needs a named owner.
- **Retention of audit log** (stakeholder/legal): no retention/deletion policy specified; assumed indefinite retention for the FY2025 cycle.
- **Whether Reference (Drive links) and Appendix content can change over the FY2025 cycle** (stakeholder): if yes, P2 in-UI editing should be reprioritized to P0/P1.
- **Rate limiting on login** (engineering): P1 lockout-after-failed-attempts was assumed nice-to-have, not required for launch — confirm this is acceptable given PINs are shorter/weaker than passwords.
- **Should the A–E grade also appear on the Category tab cards and in Print/PDF export** (stakeholder, v1.1): assumed Overview-only for v1.1 since that's the only surface explicitly requested; extending it elsewhere is a small follow-up if wanted.
- ~~**How do existing `read_write` users map to `user`/`reviewer`/`approver`**~~ — **RESOLVED (2026-08-10, stakeholder):** `lead` → `user`. No `reviewer`/`approver` account exists yet in production; must be created before the workflow is usable (§ 4a).
- **Can one person hold more than one workflow role** (e.g. Reviewer for some items, Approver for others) (stakeholder, v1.3, blocking): assumed each `reviewer`/`approver` acts globally across all 96 items for v1.3; if COE&S is small enough that the same 2-3 people must cover both roles, that's fine functionally (the system doesn't block a Reviewer and Approver from being different sessions of the same human) but the *role assignment* still needs to be explicit per user, not implicit.
- **Should Reviewer/Approver be scoped to specific categories** (stakeholder, v1.3, non-blocking): flagged as P2 (§ Non-Goals) — confirm whether a single global Reviewer/Approver is realistic for 96 items or whether this becomes a bottleneck quickly.
- ~~**Minimum required fields to allow "Submit for Approval"**~~ — **RESOLVED (2026-08-10, stakeholder):** Owner + Evidence(note) both required; ClickUp Task link optional.
- ~~**"Complied with Condition" evidence requirement — AND or OR**~~ — **RESOLVED (2026-08-10, stakeholder):** at least one of evidence file or comment (OR, not AND).
- ~~**Does Approver-level "Not Compliant" need a new status value**~~ — **RESOLVED (2026-08-10, stakeholder):** no new value — `Not Applicable` is renamed/repurposed to `Not Compliant` instead. Stakeholder was shown the concrete tradeoff (1 existing production item currently marked `Not Applicable` will be reinterpreted as `Not Compliant`, and the system loses the ability to mark an item "doesn't apply to us" going forward) and confirmed this is acceptable.
- **Rejection routing** (stakeholder, v1.3, non-blocking): assumed both Reviewer-reject and Approver-reject go straight back to the User (skip re-review), not back one step (Approver→Reviewer). Confirm this matches expectations.

## 10. Timeline Considerations

- No hard external deadline specified by stakeholder; implicitly tied to the **FY2025 ITGR review cycle** — the migration should land before the checklist is actively used for that cycle's tracking, not mid-cycle.
- Dependency: a **Supabase project must be provisioned** (URL + service role key) and a **JWT signing secret** generated before the BFF can be deployed — these are external setup steps outside this codebase.
- Suggested phasing: (1) schema + data migration + read-only BFF endpoints, (2) PIN auth + role enforcement, (3) write endpoints + audit log, (4) admin user-management UI (P1).
- **(v1.3)** This is a larger, partially-breaking change (new roles replace `read_write`; existing production users need explicit reassignment — § 4a) and should not ship in one shot. Recommended phasing once the blocking open questions are answered:
  1. **Schema + roles**: add the new columns/tables, extend the role enum, reassign existing `read_write` users to `user`/`reviewer`/`approver` per stakeholder decision. No UI change yet — existing Tracker keeps working exactly as today.
  2. **ClickUp Task link** (small, additive, low-risk — ships independently of the workflow, same pattern as v1.1/v1.2).
  3. **Submit → Review → Approve happy path**, no evidence upload yet (Approver decisions other than "Complied with Condition" don't need file storage).
  4. **Evidence attachments** (Supabase Storage + signed URLs) — the one piece with real new infra, worth isolating so it doesn't block the rest of the workflow from shipping.
  5. **Extended audit log UI** for admins to review workflow history (P1, can trail the above).
- No hard external deadline given for v1.3; same implicit tie to the FY2025 review cycle as v1.0 — but given the scope, recommend starting phase 1 well before the cycle's crunch period, not mid-review.

## 11. Recommendations for Consideration

*Requested by the stakeholder ("มีอะไรที่ควรทำในระบบนี้อีก แนะนำที") — not yet scoped into any P0/P1/P2 above except where noted. Ordered roughly by expected impact-to-effort.*

1. **In-app "waiting on you" indicator** for Reviewers/Approvers (P1 above). Without this, a workflow depends on people remembering to check the Tracker — the single biggest real-world risk to a review/approval system stalling out. Even a simple badge/count is far higher-value than most other additions here.
2. ~~NC needs to be a real, visible status, not folded into an existing one~~ — **overridden by stakeholder decision:** `Not Applicable` is repurposed to mean `Not Compliant` instead (§ Open Questions). Worth a periodic sanity check once real usage grows: if COE&S later does need to mark a requirement "doesn't apply to us" (a legitimate ITGR checklist concept, distinct from failing it), that concept currently has nowhere to live in the system.
3. **Per-category Reviewer/Approver assignment** (P2 above) — worth revisiting once you know your real headcount for these roles. A single global Reviewer across all 8 categories/96 items is a plausible bottleneck for a small COE&S team.
4. **SLA/aging on Pending Review / Pending Approval** — even a simple "days since submission" column in the Tracker (no need for full notifications) makes stalled items visible without building a notification system first.
5. **Comment/history thread visible to the User**, not just the latest rejection reason (P1 above) — important once an item bounces back and forth more than once; losing earlier context makes rework slower, not faster.
6. **Evidence file versioning, not overwriting** — if a User re-uploads evidence after a rejection, keep the prior file(s) linked to the prior workflow event rather than replacing them. Matters for audit defensibility (a reviewer/auditor should be able to see what evidence existed at each decision point, not just the latest).
7. **Exportable decision packet** (PDF or structured export) per item or per category — the actual Marubeni submission will likely want a clean summary of final decisions + evidence references, not a live dashboard link. Worth scoping once the workflow itself is stable.
8. **A distinct read-only "external auditor" experience** — if Marubeni or an external auditor ever needs direct access instead of a report handoff, today's `read_only` role already covers "can't edit," but consider whether they should see the full workflow history/comments or only final decisions.
9. **Basic concurrency guard on workflow actions** — e.g., if a Reviewer and an Approver somehow act on the same item near-simultaneously (unlikely but possible once items move faster through a formal queue), the BFF should check the item's current `workflow_state` before applying a transition and reject stale actions with a clear "this item already moved" error, rather than silently applying an action against a state that no longer exists.
