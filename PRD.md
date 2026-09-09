# PRD — IT Governance Dashboard (ITGR) — AutoCorp

**Owner:** COE&S — AutoCorp (ATC)
**Version:** 1.8
**Status:** v1.0–v1.8 all shipped, migrated, and verified live in production (`https://itgrmrbn.vercel.app`). No open deploy gates as of this revision. § 13 covers v1.9 (Remark import from the Marubeni checklist workbook), shipped 2026-09-09 — one-way, upload-based, with no Box API or credentials anywhere in it.
**Source:** Derived from current codebase (`index.html`, `/api/*`), explicit stakeholder direction, and the **Marubeni ITGR Checklist FY2026 Ver.1** workbook (updated 3 Apr 2026). Re-verified against `source/Marubeni_Group_IT_Governance_Rules_Checklist_English.xlsx` on 2026-09-08 — re-running `scripts/extract-xlsx.py` against that exact file reproduces `data/items.json` and `data/assessment.json` byte-for-byte, confirming the repo, the production database, and the source workbook all agree.

## Version History

| Version | Date | Summary |
|---|---|---|
| 1.0 | 2026-08-06 | Initial target-state spec: migrate checklist/reference/tracker data from `localStorage` to Supabase, add a Vercel serverless BFF mediating all data access, add PIN login with 3-tier RBAC (`admin` / `read_write` / `read_only`) and a basic audit log. Shipped and tagged **Baseline 1.0** (`v1.0.0`). |
| 1.1 | 2026-08-10 | Add a category-level **Compliance Radar Chart** to the Overview tab — one axis per ITGR category (8 total), plotting each category's existing progress % with an A–E letter grade overlay. No new data model or API changes; computed client-side from data already served by `/api/items`. Shipped. |
| 1.2 | 2026-08-10 | Add an **Overall Grade** (single A–E grade combining all 8 categories) and a **Priority / Top Priority status breakdown**, so a reviewer can see compliance posture for the highest-risk items (◎ Top Priority, 〇 Priority) without cross-referencing the Tracker tab. Same grading scale and data source as v1.1 — no new data model or API changes. Shipped. |
| 1.3 | 2026-08-10 | Add a **ClickUp task link** field per item; add a **User → Reviewer → Approver approval workflow** (submit for approval, reviewer OK/reject with comment, approver decision of Compliant / Complied with Condition / Not Compliant with required evidence/exception note); extend the audit trail to cover every workflow action. Shipped — schema migration applied, roles reassigned (`lead`→`user`, plus new `reviewer`/`approver`/`read_only` accounts). |
| 1.4 | 2026-08-10 | Close the v1.3 "no reopen flow" gap (previously a stated Non-Goal): once an item reaches a terminal decision (Compliant / Complied with Condition / Not Compliant), Owner and Evidence become locked; a new **"Request for Approval"** action reopens the item (back to `In Progress`) so the User can edit and walk it through Review → Approval again. The **ClickUp Task link stays editable at all times**, regardless of workflow state — it's a reference to external work, not compliance evidence, so it was never meant to be gated by the approval lock. |
| 1.5 | 2026-08-24 | **TH/EN language toggle** with Thai translations of the checklist content (`*_th` columns, `data/items-th.json`). English stays the source of truth; the UI falls back to English wherever a translation is blank, and flags Thai as unreviewed machine translation. *(Authored outside this PRD's revision history — recorded here for completeness.)* |
| 1.5b | 2026-08-25 | Thai translations for the Appendix 1–5 tables (`data/appendices-th.json`). *(Authored outside this PRD's revision history.)* |
| 1.6 | 2026-08-27 | **External Read API** (`/api/v1/*`): bearer-token, read-only access for external systems (n8n, LINE bot, Claude, etc.), with scoped tokens (`items:read` / `summary:read` / `history:read`), per-token rate limiting, and a request audit log. Fully specified in § 12 below (condensed from the original standalone [docs/PRD-external-api.md](docs/PRD-external-api.md), which remains as the deeper acceptance-criteria reference). Migration applied and live-verified in production 2026-08-27. |
| 1.7 | 2026-09-03 | **FY2026 alignment.** Refresh the 96 requirements from the FY2026 Ver.1 workbook (10 revised; structure, categories and risk ratings unchanged). Restore **`Not Applicable`** as a sixth status — reversing part of the v1.3 merge, because FY2026 uses it for 8 requirements and Marubeni's scoring *excludes* them from the denominator rather than failing them. Add the **Marubeni Official Assessment** panel: the risk-weighted A–E score computed exactly as the auditor computes it (Very High 7 / High 5 / Middle 3 / Low 0), from an imported self-assessment held in new `self_assessment` columns kept deliberately separate from workflow-driven `status`. Migration applied and self-assessment data (96/96 items) imported into production 2026-09-08. |
| 1.7b | 2026-09-08 | **Self-assessment on the External Read API.** v1.7's `self_assessment`/`self_assessment_note` reached the dashboard and the internal `/api/items` endpoint, but not `/api/v1/*` — a token could validate `status=Not Applicable` (it shares the same enum source) but couldn't actually read the self-assessment answer. `GET /api/v1/items` and `GET /api/v1/items/{no}` now return both fields; `GET /api/v1/meta` documents `self_assessment_marks` and a new `self_assessment` filter so an external caller discovers the field the same way it discovers everything else — by reading `/meta`, not by someone hand-writing an integration. |
| 1.9 | 2026-09-08 (drafted) · 2026-09-09 (scope settled, shipped) | **Remark import from the checklist workbook.** The workbook's **"Remarks Column"** (the same column `scripts/extract-xlsx.py` reads at seed time into `self_assessment_note`) is mirrored per item into a read-only `box_remark`, so a reviewer's note in that spreadsheet reaches the dashboard without anyone re-typing it. Adds a `marubeni` role for the external Marubeni-side reviewer, whose one action is running the import. Never writes `status`/`workflow_state` — only User → Reviewer → Approver may set a compliance verdict (§ Goal 6). **One-way by necessity: the workbook lives in Marubeni's Box and reaches AutoCorp as a read-only shared link, so there is no write-back, no Box API, no Box Custom App and no stored credentials.** Refreshing is a one-click **Sync** that fetches the shared link the way a browser does, with file upload as the fallback; a 💬 row marker and a Remark filter make it visible which items carry one (§ 13). Two earlier drafts (per-item Box folders, then two-way sync) were corrected before shipping; the second reached production as schema only. |

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
- ~~**(v1.3) Reopening an already-decided item**~~ — **superseded by v1.4** (§ Functional Requirements: "Request for Approval" reopen action). No longer a non-goal.
- **(v1.4) Reopen preserves full prior history, not a fresh start** — reopening does not delete or hide the prior decision's `item_workflow_events`/evidence; it appends new events on top. A "diff view" comparing what changed between decision rounds is out of scope for v1.4.
- **(v1.4) Locking Owner/Evidence during Pending Review / Pending Approval** — v1.4 only locks the 3 terminal states per the stakeholder's explicit request. Whether mid-review edits should also be blocked is a separate, not-yet-requested question (see § Recommendations).

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

| Capability | `admin` | `user` | `reviewer` | `approver` | `read_only` | `marubeni` *(v1.9)* |
|---|---|---|---|---|---|---|
| View all tabs | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Edit item's Owner / Evidence(note) / ClickUp Task link | ✅ | ✅ (own/assigned items) | ❌ | ❌ | ❌ | ❌ |
| Click "Submit for Approval" | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Review a submitted item: OK (→ Approver) or Reject (→ back to User) with comment | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Make the final decision: Compliant / Complied with Condition / Not Compliant, with comment + evidence | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Edit checklist master data, manage users, view audit log | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **(v1.9)** Sync/import the Remarks column from Marubeni's checklist workbook | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |

`admin` can act in any workflow stage (break-glass / cover for absence), everyone else is scoped to exactly one stage. This mirrors segregation-of-duties expectations for a compliance sign-off process — the preparer, reviewer, and approver should not default to the same person. **`marubeni`** is a different kind of exception, not a workflow stage — it represents an external Marubeni-side reviewer who is not part of AutoCorp's internal preparer→reviewer→approver chain at all; see § 13.7 for the full rationale, including a real tension it raises against this PRD's own stated non-goals.

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

**As a User whose item was already approved but needs a correction (v1.4)**,
I want to click "Request for Approval" to reopen it for editing,
so that I can fix the Evidence and send it through Review → Approval again, instead of the record being permanently frozen or needing an admin to hand-edit the database.

**As a User at any point in the workflow (v1.4)**,
I want to update the ClickUp task link even while an item is locked, in review, or already approved,
so that the link to the remediation work stays current without needing to reopen the whole compliance record just to fix a URL.

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
  - **(v1.3)** `POST /api/items/:no/submit` (role: `user`, `admin`) · `POST /api/items/:no/review` `{decision, comment}` (role: `reviewer`, `admin`) · `POST /api/items/:no/approve` `{decision, comment, evidence_file_ids}` (role: `approver`, `admin`) · `POST /api/items/:no/evidence` (file upload → Supabase Storage, returns file id) · `GET /api/items/:no/history` (workflow events + comments for one item) · `GET /api/evidence/:id` (short-lived signed download URL).
  - **(v1.4)** `POST /api/items/:no/reopen` (role: `user`, `admin`) — only valid from a terminal `workflow_state`; moves the item back to `In Progress` so it can be edited and resubmitted.
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
- **Reopen for Edit / "Request for Approval" (v1.4)**
  - Once an item's `workflow_state` is one of the 3 terminal states (`Compliant`, `Complied with Condition`, `Not Compliant`), **Owner and Evidence(note) become read-only** for `user` (and stay editable for `admin`, consistent with admin's break-glass override elsewhere in the workflow).
  - A new **"Request for Approval"** button appears (role: `user`, `admin`) only when `workflow_state` is one of those 3 terminal states. Clicking it:
    - Transitions `workflow_state` → `In Progress`.
    - Transitions `status` → `In Progress` (the item stops counting as Compliant/Partial in the Overview KPIs, radar, and grade panels the moment it's reopened — it shouldn't keep getting credit for a decision that's actively being revised).
    - Writes an `item_workflow_events` row (from-state = the prior terminal state, to-state = `In Progress`, actor = the User).
    - No comment is required to reopen (matches the existing "Submit for Approval" action, which also doesn't require one) — evidence of *why* it was reopened lives in whatever the User then changes and submits.
  - After reopening, the item behaves exactly like any other `In Progress` item: Owner/Evidence are editable again, and the existing **"Submit for Approval"** → Reviewer → Approver flow applies unchanged — a reopened item goes through the full flow again, not a shortcut back to its old decision.
  - **ClickUp Task link is exempt from this lock** — editable by `user`/`admin` regardless of `workflow_state` (terminal, mid-review, or otherwise). It's a reference to external remediation work, not compliance evidence, so gating it behind the approval workflow was never the intent.
  - The BFF must reject a direct `owner`/`note` edit via the existing `PATCH /api/items/:no` when `workflow_state` is terminal (403, "reopen via Request for Approval first"), while continuing to accept `clickup_url` edits unconditionally on that same endpoint.
- **FY2026 Alignment (v1.7)**
  - **Master data** is refreshed from the FY2026 Ver.1 workbook. Item numbers, categories, category membership and risk ratings are unchanged, so tracker state, workflow history and audit trail all survive the refresh untouched. Ten requirements have revised text (No. 11, 26, 27, 48, 49, 50, 55, 66, 69, 81); No. 66 is promoted to Priority 〇.
  - Extraction moves from the one-off `scripts/extract-data.mjs` (which scraped the legacy `index.html`) to **`scripts/extract-xlsx.py`**, which reads the official workbook directly, so a future FY update is a re-run rather than a re-scrape. The bilingual short category labels (`catShort` / `catShortTh`) are UI copy, not workbook content, and are carried forward.
  - **`Not Applicable` returns as a sixth status**, distinct from `Not Compliant`. `progressPct()` now drops N/A items from the denominator entirely; `Not Compliant` stays in the denominator with zero credit.
  - **Self-assessment is stored separately from `status`.** The workbook's answers (〇 / × / −) and per-item remarks import into `item_status.self_assessment` and `.self_assessment_note`. They must **not** be written into `status`: only the User → Reviewer → Approver workflow may set a compliance verdict (§ Goal 6), and importing 45 answers as `Compliant` would fabricate approvals nobody gave.
  - **Marubeni Official Assessment panel** on the Overview tab reports the risk-weighted score exactly as the workbook's *Assessment Calculation* sheet computes it: numerator = Σ risk weight of 〇 items, denominator = Σ risk weight of 〇 and × items, N/A excluded from both; per-category grade at the existing 80/60/40/20 thresholds; overall = mean of the eight category scores (A=5, B=4, C=3, D=2, E=0) cut at 4.4 / 3.4 / 2.4 / 1.4. Verified to reproduce the workbook's own cached figures for all 8 categories, the 45/88 totals, and the overall C.
  - The panel is hidden entirely when no self-assessment has been imported, so the dashboard degrades cleanly to its v1.4 behaviour.
  - `GET /api/items` tolerates the v1.7 columns being absent, so the frontend/BFF can deploy before the migration is applied without taking the dashboard down.

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
- ~~**(v1.3)** Reopen flow for already-decided items~~ — shipped in v1.4.
- **(v1.3)** Deeper ClickUp API integration (task status sync, auto-creating tasks from the dashboard).
- **(v1.3)** SLA/due-date tracking with an overdue flag once an item enters `Pending Review`/`Pending Approval`.
- **(v1.4)** Locking Owner/Evidence during `Pending Review`/`Pending Approval` too, not just after a terminal decision (see § Non-Goals).
- **(v1.4)** A "what changed since last approval" diff view when an item is reopened and resubmitted.
- ~~**(Proposed, v1.9)** Box.com Remark Sync~~ — shipped 2026-09-09 as a one-way **Remark import** (§ 13): the checklist workbook is uploaded by hand and its "Remarks Column" mirrored per item, plus a `marubeni` role for the external reviewer.

## 7. Data Model (overview)

- `users` — id, display_name, role (`admin`|`read_write`|`read_only`), pin_hash, active, created_at.
- `checklist_items` — no (PK), cat_no, category, cat_short, cat_short_th, name, content, standard, evidence, article, issue, risk, priority, qtype.
- `item_status` — item_no (FK → checklist_items.no), status, owner, note, updated_by (FK → users.id), updated_at.
- `drive_folders` / `drive_files` — reference document index (folder → files, mirrors current `DRIVE` structure).
- `appendices` — id, seq, title, title_th, cat, cat_short, cat_short_th, related_q (int[]), kind, data (JSONB — preserves the current nested per-appendix structure without over-normalizing five differently-shaped appendices).
- `audit_log` — id, user_id, item_no, field, old_value, new_value, created_at.

Full DDL lives in `supabase/schema.sql`.

### v1.7 additions

- `item_status.status` check constraint gains a sixth value, `Not Applicable` (alongside `Not Compliant`, which v1.3 introduced).
- `item_status.self_assessment` (text, nullable, one of `〇` / `×` / `-`) and `item_status.self_assessment_note` (text) — the workbook's recorded answer and remarks, never written by the approval workflow.

### v1.9 additions (see § 13)

- `box_checklist_source` (singleton — `id = 1` check) — `box_url`, `updated_by`, `updated_at`. A **bookmark**, not a connection: the Box shared link for the master checklist workbook, so whoever runs the import knows where to download the current copy. Nothing in the app calls Box.
- `item_status.box_remark` / `.box_remark_at` — the workbook's Remarks-column text for this item, and when it last changed. Written only by the import; read-only everywhere else, so there is no author to record. Kept separate from `self_assessment_note`, which is frozen at seed time and feeds the official Marubeni score — collapsing them would quietly change what that score means.
- `remark_import_log` (append-only) — id, file_name, items_updated, success, error, imported_by, created_at. One row per import run, not per item.
- `users.role` check constraint gains a sixth value, `marubeni` (§ 4a, § 13.7) — a role outside the internal preparer→reviewer→approver chain, scoped to viewing + running the import.
- *Superseded:* an earlier two-way draft of this migration reached production and also created `box_remark_by`, `box_remark_source` and `box_sync_log`. All three are unused under the one-way design; `supabase/schema.sql` ends with a commented-out, optional cleanup that drops them.

### v1.6 additions (External Read API — see § 12)

- `api_tokens` — id (uuid PK), name, token_hash (unique, HMAC-SHA256 keyed with its own `API_TOKEN_PEPPER` — never `PIN_PEPPER`), prefix (display-only), scopes (`text[]`, default `{items:read,summary:read}`), active, expires_at (nullable — tokens do not expire by default), last_used_at, created_by (FK → users), created_at.
- `api_request_log` — id, token_id (FK → api_tokens, `on delete set null`), path, query (jsonb), status, duration_ms, created_at. Append-only; doubles as the storage for the per-token rate limit (a Vercel serverless function has no memory shared across invocations, so "requests in the last 60 seconds" is answered by counting rows here).

### v1.3 additions

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
- **(v1.6, leading)** Time from issuing a new API token to a successful first call, measured against a real integration (not a synthetic test) — target ≤ 10 minutes using only what `/api/v1/meta` self-documents. Zero requests with a valid token but insufficient permission return `200` instead of `403` (checked via `api_request_log`, sampled weekly for the first month).
- **(v1.6, lagging)** Number of times someone opens the dashboard purely to check status (not to edit anything) — should drop materially once at least one automation (Morning Brief, an n8n flow) is consuming `/api/v1/summary` regularly.

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
- ~~**Does Approver-level "Not Compliant" need a new status value**~~ — **RESOLVED (2026-08-10, stakeholder):** no new value — `Not Applicable` is renamed/repurposed to `Not Compliant` instead. Stakeholder was shown the concrete tradeoff (1 existing production item currently marked `Not Applicable` will be reinterpreted as `Not Compliant`, and the system loses the ability to mark an item "doesn't apply to us" going forward) and confirmed this is acceptable. **Revisited in v1.7:** the FY2026 workbook uses N/A for 8 requirements and scores it differently from a failure, so N/A was restored as a sixth status. `Not Compliant` is unaffected and remains exactly as decided here.
- **Rejection routing** (stakeholder, v1.3, non-blocking): assumed both Reviewer-reject and Approver-reject go straight back to the User (skip re-review), not back one step (Approver→Reviewer). Confirm this matches expectations.
- **Does reopening reset `status` to `In Progress` immediately** (stakeholder, v1.4, non-blocking): assumed yes — an item stops counting as Compliant/Partial in the Overview/radar/grade the instant it's reopened, not just after resubmission. The alternative (keep showing the old status until a new decision lands) would let the dashboard overstate compliance while evidence is actively being revised, which seems worse — but flagging in case COE&S wants the old status to persist until the new decision replaces it.
- **(v1.6, non-blocking)** Is 60 requests/minute per token enough for batch automation (e.g. an n8n flow that walks all 96 items)? — assumed yes pending real usage; revisit after the first month.
- **(v1.6, non-blocking)** How long should `api_request_log` rows be retained? — no policy set yet; 90 days proposed but not confirmed.
- **(v1.6, non-blocking)** Should `GET /api/v1/openapi.json` (auto-import into n8n/Custom GPT/Claude as a tool, no hand-written integration) and per-token IP allowlisting move from P1 to P0? — both remain unbuilt; IP allowlisting gained importance once token expiry was decided against (D2 in § 12.7) since it becomes the second line of defense if a token leaks.
- **(v1.9, non-blocking)** `self_assessment_note` (frozen at seed time) and `box_remark` (refreshed on every import) both originate from the same Remarks Column — deliberate (§ 13.5), but confirm it reads clearly to an actual auditor rather than looking like one field shown twice with different values.
- **(v1.9, non-blocking)** Sync depends on Marubeni leaving downloads enabled on the shared link. If they tighten it, Sync fails with a clear message and everyone falls back to upload — degraded, not broken — but nobody finds out until someone presses the button. Worth deciding whether that silent-until-clicked failure mode is acceptable (§ 13.10).
- **(v1.9, non-blocking)** How often does Marubeni actually update the workbook? Now that Sync is one click, cadence only matters for deciding whether it's ever worth scheduling — currently a deliberate non-goal (§ 13.8).
- **(v1.9, non-blocking)** Retention of `remark_import_log` — no policy set; likely the same answer as `api_request_log`'s open retention question above.
- **(v1.9, blocking before real accounts are issued)** The `marubeni` role (§ 13.7, decision D3) gives an external Marubeni-side person a real ITGR login for the first time — this revisits § 3's "internal tool only" framing and § 12.3's parked "direct access for Marubeni or other external parties." Needs an explicit go-ahead from whoever owns AutoCorp/Marubeni's data-access policy, not just an engineering decision, before any real `marubeni` account is created.
- **(v1.9, non-blocking)** Should `marubeni` see internal workflow/reviewer comments (`item_workflow_events`)? Proposed default is no (mirrors the External API's `history:read` opt-in scope, D3 in § 12.7) — confirm this matches what Marubeni actually needs to do their review.

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
2. ~~NC needs to be a real, visible status, not folded into an existing one~~ — **resolved in v1.7.** The v1.3 decision merged `Not Applicable` into `Not Compliant`; the caveat recorded here at the time was that COE&S might later need to mark a requirement "doesn't apply to us." The FY2026 workbook did exactly that for 8 requirements, and Marubeni's scoring excludes them from the denominator rather than failing them — so v1.7 restores `Not Applicable` as a sixth status alongside `Not Compliant`, and both now exist.
3. **Per-category Reviewer/Approver assignment** (P2 above) — worth revisiting once you know your real headcount for these roles. A single global Reviewer across all 8 categories/96 items is a plausible bottleneck for a small COE&S team.
4. **SLA/aging on Pending Review / Pending Approval** — even a simple "days since submission" column in the Tracker (no need for full notifications) makes stalled items visible without building a notification system first.
5. **Comment/history thread visible to the User**, not just the latest rejection reason (P1 above) — important once an item bounces back and forth more than once; losing earlier context makes rework slower, not faster.
6. **Evidence file versioning, not overwriting** — if a User re-uploads evidence after a rejection, keep the prior file(s) linked to the prior workflow event rather than replacing them. Matters for audit defensibility (a reviewer/auditor should be able to see what evidence existed at each decision point, not just the latest).
7. **Exportable decision packet** (PDF or structured export) per item or per category — the actual Marubeni submission will likely want a clean summary of final decisions + evidence references, not a live dashboard link. Worth scoping once the workflow itself is stable.
8. **A distinct read-only "external auditor" experience** — if Marubeni or an external auditor ever needs direct access instead of a report handoff, today's `read_only` role already covers "can't edit," but consider whether they should see the full workflow history/comments or only final decisions. *(Proposed, v1.9, 2026-09-08): the stakeholder has since asked for exactly this — a `marubeni` role, see § 13.7 — with view access plus two narrow write actions (Remark, manual Box sync). Not yet built; the workflow-history-visibility question raised here is answered as "no, by default" in § 13.7's design, still open to confirm.)*
9. **Basic concurrency guard on workflow actions** — e.g., if a Reviewer and an Approver somehow act on the same item near-simultaneously (unlikely but possible once items move faster through a formal queue), the BFF should check the item's current `workflow_state` before applying a transition and reject stale actions with a clear "this item already moved" error, rather than silently applying an action against a state that no longer exists.

## 12. External Read API (v1.6–v1.7b)

*Condensed from the original standalone [docs/PRD-external-api.md](docs/PRD-external-api.md), written 2026-08-27 — that document carries the full acceptance-criteria checklist per requirement and is kept as the deeper reference. This section makes the dashboard's PRD complete on its own without requiring a second document to describe a shipped, live feature.*

### 12.1 Problem Statement

Before v1.6, ITGR compliance data was reachable exactly one way: open the dashboard, log in with a PIN. The session cookie is `httpOnly` + `sameSite: strict` ([lib/auth.js](lib/auth.js)) by design — it cannot be used from outside a browser tab at all, let alone from an external system. Questions answerable in three seconds with an API — *"which categories are still red?"*, *"how many items are waiting on my approval?"*, *"which Very High-risk items haven't started?"* — required opening the dashboard, filtering by hand, reading, every time. None of it could feed a daily brief or an automation.

### 12.2 Goals

| # | Goal | Measured by |
|---|---|---|
| G1 | An external system can ask about status without a human opening the dashboard | ≥ 90% of a fixed 20-question test set answerable in ≤ 2 API calls |
| G2 | A new integration is running within minutes, not a support ticket | Issue a token → first successful call in ≤ 10 minutes, using only what the API documents about itself |
| G3 | The new surface never weakens the existing system | A leaked token is revoked instantly and **cannot write a single field**, ever |
| G4 | Every external call is auditable after the fact | 100% of `/api/v1/*` requests produce a row in `api_request_log` — token, path, status, timing |

### 12.3 Non-Goals

| Not doing | Why |
|---|---|
| Writing/editing data through the API | v1 is read-only by design — writing would require deciding "who does the AI act as," which collides with the User → Reviewer → Approver segregation-of-duties model (§ Goal 6) |
| Driving the workflow (submit/review/approve) through the API | Same reason, more acute — an approval must always trace to a real accountable person |
| Serving evidence files through the API | Files already live in a private Storage bucket behind short-lived signed URLs gated on the PIN session; exposing them via a longer-lived bearer token would be a real leak surface |
| Natural-language query parsing on the server | Deliberately pushed to the caller — the external LLM (Claude, GPT, whatever the caller already has) does this using `/api/v1/meta`, so ITGR never holds an LLM API key or a hosting bill for one |
| Outbound webhooks | Opposite direction from what was asked; would need its own retry/dedup/secret-rotation design (parked as P2, § 12.6) |
| Direct access for Marubeni or other external parties | v1 is scoped to the stakeholder's own tools (n8n, LINE bot, Claude); opening it further needs per-token category scoping, mandatory expiry, and a data-use agreement that don't exist yet |

### 12.4 Authentication & Security Model

- **Bearer token, fully separate from the dashboard's PIN session** — different table (`api_tokens` vs `users`), different transport (`Authorization: Bearer <token>` header vs. httpOnly cookie), different secret (`API_TOKEN_PEPPER` vs. `PIN_PEPPER`/`JWT_SECRET`). Neither credential works against the other's endpoints, so rotating one can never invalidate the other.
- Token format: `itgr_live_<random>`, hashed at rest with the same HMAC-SHA256-with-pepper construction as PIN hashing ([lib/pin.js](lib/pin.js)) — an indexed O(1) lookup without ever storing the credential itself. The raw value is shown **exactly once**, at creation, in the Admin tab.
- **No CORS headers are ever set** on `/api/v1/*` responses — a token cannot be used by JavaScript running in someone else's browser tab, only from a server/script/automation tool.
- **Scoped tokens** — `items:read`, `summary:read` (both granted by default), `history:read` (opt-in only; workflow comments can name people and describe unresolved issues plainly, so a token has to explicitly ask to read them — decision D3, § 12.7).
- **Tokens do not expire by default** (decision D2, § 12.7) — revocation is the control instead. This trades one risk for another: a leaked token that nobody revokes stays live indefinitely. The Admin tab's token table therefore *must* surface `last_used_at` prominently so a forgotten, still-live credential is visible, not just theoretically revocable.
- **Rate limit:** 60 requests/minute per token, enforced by counting rows in `api_request_log` (a Vercel serverless function shares no memory across invocations, so this can't be an in-process counter) — `429` with `Retry-After` on breach.
- **Every request is logged before the response is sent, not after** — see § 12.8 for why this ordering is load-bearing, not stylistic.

### 12.5 Endpoints

| Method | Path | Scope required | Purpose |
|---|---|---|---|
| GET | `/api/v1/meta` | any valid token | Self-describing discovery document: every category/status/risk/workflow-state/self-assessment value, every filter with its type, and 9 worked `{question_th, question_en, request}` examples. This is what lets an external LLM translate "หมวดไหนยังแดงอยู่บ้าง" into a correct query without ITGR running any NL model of its own. Cacheable 1h. |
| GET | `/api/v1/items` | `items:read` | Search/filter the 96 requirements. Filters: `cat`, `risk`, `priority`, `status`, `workflow_state`, `self_assessment` *(v1.7b)*, `owner` (partial match), `article` (partial match), `q` (full-text, both languages regardless of `lang`), `updated_since`, `lang` (`th`\|`en`, default `th`), `limit` (default 25, max 100 — over-limit is clamped, not rejected), `offset`. Response always carries `total` + `has_more`. |
| GET | `/api/v1/items/{no}` | `items:read` | One requirement, same shape as an `/items` row. `404 item_not_found` for an out-of-range number, not `500`. |
| GET | `/api/v1/items/{no}/history` | `items:read` **+** `history:read` | Workflow timeline (from/to state, comment, actor, timestamp) and evidence file names — **file names only, no signed URL, no download path**, matching the "no evidence export" non-goal. |
| GET | `/api/v1/summary` | `summary:read` | Overall % + grade, per-category breakdown, counts by status/risk/workflow-state, and `very_high_risk_not_started` — computed with the *exact same* `progressPct()`/`gradeFor()` logic the dashboard's own Overview tab uses, so the two can never disagree. Accepts `?cat=` to scope to one category. |

Every error response shares one shape — `{ "error": { "code": "...", "message": "...", ...context } }` — with a machine-readable `code` (`missing_token`, `invalid_token`, `token_expired`, `insufficient_scope`, `invalid_filter`, `invalid_item_no`, `item_not_found`, `rate_limited`, `internal_error`) so a caller can branch on `code` instead of parsing prose, and every `invalid_filter` includes `allowed_values` so a caller can self-correct without a second round trip to documentation.

### 12.6 Roadmap

**Shipped (P0, v1.6–v1.7b):** everything in § 12.4–12.5, plus token issuance/revocation/rename/rescoping from the Admin tab, and a full documentation page ([api-docs.html](api-docs.html), linked from the Admin tab) covering quickstart, every endpoint, integration guides for n8n/Claude/Custom GPT/LINE, and an FAQ.

**Not yet built (P1):**
- `GET /api/v1/openapi.json` — an OpenAPI 3.1 document so n8n/Custom GPT/Claude can auto-import this API as a tool instead of a hand-written integration. This is the piece that would make the "10 minutes to first call" goal (G2) reliably true rather than best-case.
- Per-token IP allowlisting — gained importance after D2 (§ 12.7): with tokens that don't expire on their own, this becomes the second line of defense if one leaks.
- `X-Request-Id` on every response, for cross-system troubleshooting.
- `updated_since` as a true delta feed ("what changed since yesterday"), for a daily-brief-style consumer.

**Deliberately deferred (P2):** outbound webhooks on status change; an MCP server wrapping this API for direct Claude tool use; a write scope (`items:write`) for owner/note/ClickUp updates — blocked on deciding whose identity a write acts under; per-category token scoping, for the day an external auditor needs direct (not report-handoff) access.

### 12.7 Key Decisions

| # | Question | Decision | Consequence |
|---|---|---|---|
| D1 | Is `owner` (a real person's name) something the API must mask? | No — export it as-is | Simpler `/items` response; no separate scope or redaction logic |
| D2 | Should tokens expire by default? | No — revocation is the control | `last_used_at` becomes load-bearing (§ 12.4); IP allowlisting (P1) gains urgency as a second safety net |
| D3 | Should workflow comments (`/items/{no}/history`) be readable under the default scope? | No — separate `history:read`, opt-in | A token issued for a status dashboard never incidentally exposes what a Reviewer said about someone's evidence |

### 12.8 A Deployment Lesson Worth Recording

The first production deployment of this API (2026-08-27) logged requests in a `try/finally` block **around** the JSON response — i.e., the audit-log write was `await`-ed only *after* `res.status(200).json(...)` had already been sent. Live testing immediately after deploy showed only 1 of 9 real requests actually produced an `api_request_log` row, including a `403` that should have been logged. Vercel's Node.js runtime does not reliably keep a function invocation alive for work that starts only after the response has been flushed to the client — a gap invisible to any offline/local test, since a plain Node process has no equivalent teardown behavior.

The fix (shipped same day, hotfix PR): **log first, then respond.** Every `/api/v1/*` exit point — success and every error — now writes its `api_request_log` row before calling `res.json()`, so the insert always completes while the function is unambiguously still executing. Verified by firing 9 varied requests (200/400/401/403/404) at production after the fix: 9/9 logged. This is recorded here specifically so nobody "cleans up" the ordering in `lib/apiAuth.js`'s `respond()`/`respondError()` later without knowing why it's like that.

## 13. Remark Import from the Checklist Workbook (v1.9)

*Requested 2026-09-08 ("ปรับ prd เพิ่ม ให้สามารถ config path สำหรับเชื่อม box.com เพื่อดึง Status ที่ได้รับ comment กลับมา รวมถึง สามารถ sync status กลับ box.com ได้ด้วย"), scope settled 2026-09-09.*

*This section took two corrections to get right, both worth recording because each one removed work rather than adding it:*

1. *The first draft modeled it as **Box comment threads** on a per-item Box folder. Wrong — clarified as "ผมต้องการ comment ใน file excel ที่ share ใน box.com ครับ ไม่ใช่ comment ของ push/pull … จริงๆ Comment ที่ว่า คือ เนื้อหาใน Cell ที่ผมสร้าง 1 column เอาไว้ สำหรับเป็น Remark แต่ละแถว." It is a **spreadsheet cell**, in **one** workbook, not a discussion thread on 96 folders.*
2. *The second draft was two-way (read + write back via the Box API). Dropped once it emerged that **the workbook lives in Marubeni's Box** and reaches AutoCorp as a read-only shared link — writing to it would need Marubeni to grant Editor collaboration, and would mean the audited party's system editing the auditor's own control document. The stakeholder's call: "ไม่ต้อง update กลับ เอาแค่ ถึง update มาพอ."*

3. *The third correction was mine, not a requirement change: "Sync" was reporting `HTTP 403` against a link Box itself marks `can_download: true`. Two wrong assumptions about how Box serves shared links, both fixed in § 13.4.*

*What shipped is the smallest thing that delivers the actual need. It **does** fetch the file on one click — but through the ordinary anonymous download a browser uses, not the Box API, so there is still no Box app, no OAuth and no stored credential anywhere in it.*

### 13.1 Problem Statement

The master ITGR checklist workbook has a **"Remarks Column (Reasons for the Check Results, etc.)"** — column T in the FY2026 layout — where a free-text note per requirement explains the check result. `scripts/extract-xlsx.py` already reads that column once, at seed time, into `self_assessment_note`. But Marubeni keeps editing the live copy in their own Box, and none of those edits reach the dashboard: someone has to open the spreadsheet and read it, or re-type notes by hand.

### 13.2 Decisions

| # | Question | Decision | Why it matters |
|---|---|---|---|
| D1 | Per-item Box folder, or one file? | **One workbook for the whole checklist** (2026-09-09) | 96 items live in one spreadsheet. Configuration is one setting, not 96 link fields. |
| D2 | What is "the comment"? | **The literal cell value in the Remarks Column, per row** — not a Box comment thread | Box has no per-row comments; a cell value is exactly what was being described. |
| D3 | Does an imported Remark affect compliance `status`? | **No.** Informational only, never a write to `status`/`workflow_state` | Mirrors the v1.7 self-assessment separation (§ 6): only User → Reviewer → Approver may set a verdict (§ Goal 6). A spreadsheet anyone can edit must never become a backdoor around that. |
| D4 | Does the reviewer get an ITGR login? | **Yes — a new `marubeni` role** (§ 13.7) | So the Marubeni-side reviewer can see status and refresh the Remarks themselves. A real scope change — see the tension named in § 13.7. |
| D5 | Two-way, or read-only? | **Read-only** (2026-09-09) | Decisive fact: the file is **Marubeni's**, shared to us read-only. Writing back needs them to grant Editor collaboration — and raises whether the audited party should be editing the auditor's control document at all. Dropping it removed every remaining blocker at once (see § 13.9). |
| D6 | How does the file reach ITGR? | **One-click Sync from the shared link, with upload as fallback** (2026-09-09) | Originally decided as upload-only, on the assumption that fetching meant the Box API and therefore an OAuth flow and stored tokens. It doesn't: a shared link with downloads enabled can be fetched anonymously, exactly as a browser does. So Sync costs nothing the upload design was avoiding, and the file picker stays as the fallback for the day Marubeni turns downloads off. |
| D7 | Where does Sync live? | **Under the Marubeni assessment panel on Overview**, not the Tracker (2026-09-09) | That score and these Remarks come out of the same workbook, so "refresh it" belongs next to the number it refreshes. The admin-only link setting stays in the Admin tab. |
| D8 | Two panels for the workbook's data, or one? | **One** (2026-09-09) | The v1.7 self-assessment panel and the v1.9 Remark panel read as duplicates *because they were* — both showed the same spreadsheet column, one frozen at seed time, one live. Now a single panel: the mark plus the Remark text. Checked first: 58 items had each field and **0** had the seed note without the live one, so nothing was lost. |

### 13.3 Goals

| # | Goal |
|---|---|
| G1 | What a reviewer writes in the workbook's Remarks column shows up per item in the dashboard, without anyone re-typing it |
| G2 | The import can never become a backdoor around the approval workflow (D3) |
| G3 | Nothing is ever written back to Marubeni's file, by any code path |
| G4 | No credentials, no third-party app authorization, nothing to expire or rotate |
| G5 | Refreshing is one click, and still works by upload if Marubeni ever restricts the link |

### 13.4 How it works

`POST /api/import-remarks` takes the workbook either way — fetched from the configured link, or uploaded — and applies it through the same code path. `lib/checklistRemarks.js` does the parsing and the fetching.

**Getting the file (`fetchSharedWorkbook`).** Two things about Box cost real time to find, and both look like bugs in our own code:

- `/shared/static/<hash>.xlsx` — the "direct link" form, and the obvious guess — returns **403 for an ordinary shared link even when downloads are allowed**. The route that works needs the file's numeric id, which appears only in the share page's HTML. So the fetch is two steps: read the page, extract the id, then request `index.php?rm=box_download_shared_file`.
- **Box serves `404` to requests with no browser `User-Agent`**, which is indistinguishable from a dead link. This is why an earlier session concluded the stakeholder's real link was a placeholder — it was live the whole time.

The URL is pinned to `https://app.box.com` and must match a shared-link shape. It comes from an admin-editable setting, so fetching it server-side would otherwise be an SSRF hole; rejection of other hosts, plain `http`, and `169.254.169.254` is covered by a test.

**Reading it (`parseChecklistRemarks`).** Verified against the real workbook:

- **The column is located by header text**, never a fixed letter — `findRemarksColumn()` scans header row 8 for `/remarks column/i`. Matches `scripts/extract-xlsx.py`'s own caution about the layout drifting between FY workbooks.
- **Rows are matched by item number** (column A, from row 10 — the same `FIRST_DATA_ROW`), not by position, so a reordered sheet can't silently misattribute a remark.
- **Rich-text cells are flattened properly.** A naive `String(cell.value)` on a styled cell yields `"[object Object]"` — a real trap, since it fails silently and looks like data.
- **Only changed rows are written**, so `box_remark_at` means "when this text last changed", not "when someone last ran an import".
- **Rows in the file that aren't known items are reported back**, not silently dropped.
- A non-workbook file fails with a clear message, and the failure is logged to `remark_import_log` like any other run.

**Proven end-to-end**, not just in unit tests: a Sync against Marubeni's live link fetched 136KB, parsed 96/96 rows, and applied the one remark Marubeni had edited since AutoCorp's seed copy; the next Sync reported 0 changed.

### 13.5 Data Model

See § 7 "v1.9 additions". In short: `box_checklist_source` (a bookmark to where the file lives), `item_status.box_remark`/`.box_remark_at` (the mirrored cell), and `remark_import_log` (one row per import run).

### 13.6 Functional Requirements

- A **Sync control under the Marubeni assessment panel** on the Overview tab (D7), visible to `marubeni`/`admin` only: a one-click **Sync** button, a link through to the workbook in Box, and a result line reporting items updated / unchanged / unknown. The **file picker is hidden** behind "or upload the file" and is revealed automatically when a Sync fails, so a Box refusal never leaves anyone stuck.
- An **Admin card** holding the Box link itself (`box_checklist_source`) — readable by `marubeni`/`admin`, writable by `admin` only (D7).
- A **single "from Marubeni's checklist workbook" panel** on each expanded item (D8): the self-assessment mark plus the Remark text, read-only for every role, visually distinct from the sanctioned Evidence/note field so nobody mistakes it for an approved compliance statement. The live Remark is preferred; the seed-time note is the fallback.
- On the Tracker, a **💬 marker** on any row that has a Remark and a **Remark filter** (has one / doesn't yet), so 58-of-96 is visible at a glance instead of one row at a time. Both hide entirely until at least one Remark exists, so a fresh dashboard shows no control that can only return nothing.
- Every import writes a `remark_import_log` row, success or failure — the same "every automated action is auditable" posture as `audit_log` and `api_request_log`.
- All of it degrades gracefully if the migration hasn't run: reads fall back a tier (the v1.7 pattern) and the import returns a clean `501` naming the missing migration.

### 13.7 The `marubeni` Role

A sixth value in the `users.role` check constraint, alongside `admin`/`user`/`reviewer`/`approver`/`read_only` (§ 4a). It represents an external Marubeni-side reviewer and is deliberately **not** part of the internal preparer → reviewer → approver chain:

| Capability | `marubeni` | Why |
|---|---|---|
| View all tabs | ✅ | Same baseline as `read_only` |
| Edit Owner / Evidence / ClickUp / trigger workflow actions | ❌ | Not part of AutoCorp's internal workflow (§ 4a) |
| View workflow history / internal reviewer comments | ❌ by default | Mirrors the External API's D3 decision (§ 12.7): internal review comments name people and discuss unresolved issues plainly |
| Run the Remark sync/import | ✅ | The role's one action |

**A tension worth naming, not silently resolving:** § 3 frames ITGR as "an internal tool for a small, known set of COE&S/ATC staff, not a public-facing product," and § 12.3 parked "direct access for Marubeni or other external parties" pending a data-use agreement that doesn't exist yet. A real `marubeni` login is exactly that access — a deliberate scope change, not a natural extension of `read_only`. It is also what § 11's Recommendation 8 anticipated. Worth an explicit go-ahead before any real account is issued (§ 9).

### 13.8 Non-Goals

| Not doing | Why |
|---|---|
| Writing anything back to Marubeni's workbook | D5 — we hold a read-only shared link, and the audited party editing the auditor's control document is a governance question nobody asked for |
| Any Box API integration, Box Custom App, or stored Box credentials | Sync fetches the shared link the way a browser does (§ 13.4). Nothing authenticates to Box, so there is no app to authorize and no token to rotate. |
| Scheduled/automatic syncing | Sync is a button someone presses. A cron job would need the workbook to change often enough to be worth watching — it doesn't, and nobody has asked to be told the moment it does. |
| Writing `status`/`workflow_state` from an imported Remark | D3 — would bypass the approval workflow's segregation of duties |
| Editing the Remark inside ITGR | It would be overwritten by the next import, and would create a second version of the truth against a file we don't own |
| Importing any column other than the Remarks Column | The Check Column (self-assessment 〇/×/−) stays a seed-time import: it feeds the official Marubeni score, and moving it under a routine import would change what that number means |

### 13.9 What Dropping the Write-Back Removed

Recorded because it is the clearest example in this project of scope reduction being the engineering win. Going one-way retired, in one decision: the Box Custom App and its enterprise admin authorization; asking Marubeni for Editor collaboration; storing and rotating Box credentials; the download → modify → re-upload race that could clobber someone's concurrent edit; the append-vs-overwrite question about a cell holding someone else's text; and the governance question of an audited party writing into the auditor's file. **Every open blocker on this feature was closed by removing a capability, not by building one.** The one-click Sync that arrived afterwards (D6) is the postscript: once the write-back was gone, fetching turned out to need none of the machinery that had made fetching look expensive in the first place.

### 13.10 Open Questions

See § 9 (tagged `(v1.9)`). The one blocking item left is not technical: confirming the `marubeni` external-access decision (§ 13.7) with whoever owns AutoCorp/Marubeni's data-access policy, before a real account is issued.

One risk is worth watching rather than solving now: **Sync depends on Marubeni leaving downloads enabled on that shared link.** If they tighten it, Sync starts failing with a clear message and everyone falls back to upload — degraded, not broken — but nobody is notified until someone presses the button.
