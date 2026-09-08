-- ITGR Dashboard — Supabase schema
-- Run once against a new Supabase project (SQL editor or `supabase db push`).
-- Idempotent: safe to re-run.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- users: PIN-based accounts, 3-tier RBAC
-- ---------------------------------------------------------------------------
create table if not exists users (
  id           uuid primary key default gen_random_uuid(),
  display_name text not null,
  role         text not null check (role in ('admin', 'read_write', 'read_only')),
  pin_hash     text not null,       -- HMAC-SHA256(pin, PIN_PEPPER), hex — see lib/pin.js
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Fast O(1) PIN lookup at login without scanning + per-row compare.
create unique index if not exists users_pin_hash_key on users (pin_hash);

-- ---------------------------------------------------------------------------
-- checklist_items: the 96 ITGR requirements (static master data)
-- ---------------------------------------------------------------------------
create table if not exists checklist_items (
  no           int primary key,
  cat_no       int not null,
  category     text not null,
  cat_short    text not null,
  cat_short_th text not null,
  name         text not null,
  content      text not null,
  standard     text,
  evidence     text,
  article      text,
  issue        text,
  risk         text,        -- 'Very High' | 'High' | 'Middle' | 'Low' | ''
  priority     text,        -- '◎' | '〇' | ''
  qtype        text
);

create index if not exists checklist_items_cat_no_idx on checklist_items (cat_no);

-- ---------------------------------------------------------------------------
-- item_status: mutable tracker state, one row per checklist item
-- ---------------------------------------------------------------------------
create table if not exists item_status (
  item_no    int primary key references checklist_items (no) on delete cascade,
  status     text not null default 'Not Started'
             check (status in ('Not Started', 'In Progress', 'Compliant', 'Partial', 'Not Applicable')),
  owner      text not null default '',
  note       text not null default '',
  updated_by uuid references users (id) on delete set null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- drive_folders / drive_files: Google Drive reference index
-- ---------------------------------------------------------------------------
create table if not exists drive_folders (
  id    int primary key,     -- mirrors legacy DRIVE[].n
  seq   int not null,
  title text not null,
  url   text not null
);

create table if not exists drive_files (
  id        bigint generated always as identity primary key,
  folder_id int not null references drive_folders (id) on delete cascade,
  seq       int not null,
  title     text not null,
  file_type text not null,   -- 'folder' | 'pdf' | 'xlsx' | 'gsheet'
  url       text not null
);

create index if not exists drive_files_folder_id_idx on drive_files (folder_id);

-- ---------------------------------------------------------------------------
-- appendices: the 5 ITGR checklist appendices.
-- Each appendix has a differently-shaped body (rule requirements table,
-- info-asset classification table, etc.) — kept as JSONB rather than
-- over-normalizing 5 one-off shapes into many tables.
-- ---------------------------------------------------------------------------
create table if not exists appendices (
  id           int primary key,   -- mirrors legacy APPX[].n
  seq          int not null,
  title        text not null,
  title_th     text not null,
  cat          int not null,      -- related checklist category no.
  cat_short    text not null,
  cat_short_th text not null,
  related_q    int[] not null default '{}',
  kind         text not null,     -- 'sections' | other appendix-specific kind
  data         jsonb not null
);

-- ---------------------------------------------------------------------------
-- audit_log: who changed what, when (append-only)
-- ---------------------------------------------------------------------------
create table if not exists audit_log (
  id         bigint generated always as identity primary key,
  user_id    uuid references users (id) on delete set null,
  item_no    int references checklist_items (no) on delete set null,
  field      text not null,        -- 'status' | 'owner' | 'note'
  old_value  text,
  new_value  text,
  created_at timestamptz not null default now()
);

create index if not exists audit_log_item_no_idx on audit_log (item_no);
create index if not exists audit_log_user_id_idx on audit_log (user_id);

-- ---------------------------------------------------------------------------
-- RLS: the BFF is the only client, using the service role key, which bypasses
-- RLS entirely. Enable + lock down RLS anyway so the anon/authenticated keys
-- (if ever exposed) grant zero direct access to this data.
-- ---------------------------------------------------------------------------
alter table users            enable row level security;
alter table checklist_items  enable row level security;
alter table item_status      enable row level security;
alter table drive_folders    enable row level security;
alter table drive_files      enable row level security;
alter table appendices       enable row level security;
alter table audit_log        enable row level security;
-- No policies are created: default-deny for anon/authenticated roles.
-- Only the service role (used exclusively server-side in /api/*) can read/write.

-- =============================================================================
-- v1.3: ClickUp task link + User -> Reviewer -> Approver approval workflow.
-- Appended (not editing the original CREATE TABLE statements above) per
-- CLAUDE.md's migration convention — safe to re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Roles: `read_write` is retired in favor of three workflow-stage roles.
-- Existing `read_write` accounts are remapped to `user` (the stakeholder's
-- explicit decision for this project's one existing `read_write` account,
-- "lead" — see PRD.md v1.3 for the reasoning); reassign reviewer/approver
-- accounts manually afterward via the Admin tab or scripts/create-user.mjs.
-- ---------------------------------------------------------------------------
alter table users drop constraint if exists users_role_check;
update users set role = 'user' where role = 'read_write';
alter table users add constraint users_role_check
  check (role in ('admin', 'user', 'reviewer', 'approver', 'read_only'));

-- ---------------------------------------------------------------------------
-- item_status: add ClickUp link + granular workflow state.
-- `status` keeps driving the existing Overview/radar/grade calculations
-- unchanged; `Not Applicable` is renamed to `Not Compliant` rather than
-- adding a sixth value (stakeholder decision, PRD.md v1.3 — the checklist
-- loses the ability to mark an item "doesn't apply to us" going forward).
-- ---------------------------------------------------------------------------
alter table item_status drop constraint if exists item_status_status_check;
update item_status set status = 'Not Compliant' where status = 'Not Applicable';
alter table item_status add constraint item_status_status_check
  check (status in ('Not Started', 'In Progress', 'Compliant', 'Partial', 'Not Compliant'));

alter table item_status add column if not exists clickup_url text not null default '';
alter table item_status add column if not exists workflow_state text not null default 'Not Started';
alter table item_status drop constraint if exists item_status_workflow_state_check;
alter table item_status add constraint item_status_workflow_state_check
  check (workflow_state in (
    'Not Started', 'In Progress', 'Pending Review', 'Pending Approval',
    'Rejected', 'Compliant', 'Complied with Condition', 'Not Compliant'
  ));

-- ---------------------------------------------------------------------------
-- item_evidence_files: files an Approver (or User, for future flexibility)
-- attaches to an item. Stored in Supabase Storage, private bucket — never a
-- public URL; the BFF hands out short-lived signed URLs on request.
-- ---------------------------------------------------------------------------
create table if not exists item_evidence_files (
  id           bigint generated always as identity primary key,
  item_no      int not null references checklist_items (no) on delete cascade,
  uploaded_by  uuid references users (id) on delete set null,
  storage_path text not null,     -- path within the 'evidence' Storage bucket
  file_name    text not null,
  content_type text,
  uploaded_at  timestamptz not null default now()
);

create index if not exists item_evidence_files_item_no_idx on item_evidence_files (item_no);

-- ---------------------------------------------------------------------------
-- item_workflow_events: append-only workflow audit trail + the comment
-- history a User sees when their submission is rejected. Kept separate from
-- `audit_log` (which stays focused on simple owner/note/clickup_url edits)
-- because the two event shapes (field diff vs. state transition + comment)
-- don't share a natural schema.
-- ---------------------------------------------------------------------------
create table if not exists item_workflow_events (
  id                bigint generated always as identity primary key,
  item_no           int not null references checklist_items (no) on delete cascade,
  actor_id          uuid references users (id) on delete set null,
  from_state        text,
  to_state          text not null,
  comment           text,
  evidence_file_id  bigint references item_evidence_files (id) on delete set null,
  created_at        timestamptz not null default now()
);

create index if not exists item_workflow_events_item_no_idx on item_workflow_events (item_no);

alter table item_evidence_files  enable row level security;
alter table item_workflow_events enable row level security;
-- Same default-deny posture as every other table — service role (BFF) only.

-- =============================================================================
-- v1.5: Thai translations for the checklist content, enabling the TH/EN
-- language toggle in the dashboard.
--
-- Appended (not editing the original CREATE TABLE above) per CLAUDE.md's
-- migration convention — safe to re-run.
--
-- Design note: the English columns stay the source of truth. `*_th` holds a
-- translation that may be empty; the UI falls back to the English column
-- whenever a `*_th` value is blank, so a partial translation never blanks out
-- the screen. `cat_short_th` already existed since v1.0 and is unchanged.
-- =============================================================================
alter table checklist_items add column if not exists category_th text not null default '';
alter table checklist_items add column if not exists name_th     text not null default '';
alter table checklist_items add column if not exists content_th  text not null default '';
alter table checklist_items add column if not exists standard_th text not null default '';
alter table checklist_items add column if not exists evidence_th text not null default '';
alter table checklist_items add column if not exists qtype_th    text not null default '';

-- ---------------------------------------------------------------------------
-- v1.5b: Thai translations for the Appendix 1-5 tables.
--
-- `data_th` mirrors `data` row-for-row and key-for-key; the client swaps the
-- whole array when Thai is active, so the shapes must stay identical. Values
-- that drive badge colours (level / type / edr / sysctrl) are deliberately
-- kept as the English key inside data_th, and the client renders a localized
-- label for them — translating the key itself would break the colour lookup.
--
-- `note` is new because the legacy `note` field on Appendix 2 was being
-- dropped at seed time and never reached the UI at all.
-- ---------------------------------------------------------------------------
alter table appendices add column if not exists note    text  not null default '';
alter table appendices add column if not exists note_th text  not null default '';
alter table appendices add column if not exists data_th jsonb not null default '[]'::jsonb;

-- =============================================================================
-- v1.6: External Read API (ITGR Query API v1) — see docs/PRD-external-api.md.
--
-- Bearer-token auth for /api/v1/*, completely separate from the PIN/session
-- login in lib/auth.js: different table, different secret (API_TOKEN_PEPPER,
-- never PIN_PEPPER), different cookie-free transport. No endpoint under
-- /api/v1/* can write — this migration backs a read-only surface by design.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- api_tokens: one row per issued external-API credential.
--
-- token_hash uses the same HMAC-SHA256(token, pepper) construction as
-- users.pin_hash (see lib/pin.js) for the same reason — an indexed O(1)
-- equality lookup without ever storing the credential itself. Decision D2
-- (2026-08-27): tokens do not expire by default; `expires_at` stays nullable
-- for the cases where a temporary token is wanted. Because nothing forces a
-- token to die on its own, `last_used_at` is load-bearing — it is the only
-- signal that lets an admin notice a forgotten, still-live credential.
-- ---------------------------------------------------------------------------
create table if not exists api_tokens (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,             -- "n8n morning brief", "LINE bot" — human label, not a secret
  token_hash   text not null,             -- HMAC-SHA256(token, API_TOKEN_PEPPER), hex — see lib/apiToken.js
  prefix       text not null,             -- first ~18 chars of the issued token, for admin-UI identification only
  scopes       text[] not null default '{items:read,summary:read}',
                                           -- valid values: items:read, summary:read, history:read (lib/apiToken.js)
                                           -- history:read is deliberately absent from the default (decision D3) —
                                           -- workflow comments can name people and issues plainly, so a token has
                                           -- to opt into reading them, not receive it for free.
  active       boolean not null default true,
  expires_at   timestamptz,               -- null = does not expire (decision D2)
  last_used_at timestamptz,
  created_by   uuid references users (id) on delete set null,
  created_at   timestamptz not null default now()
);

create unique index if not exists api_tokens_token_hash_key on api_tokens (token_hash);

-- ---------------------------------------------------------------------------
-- api_request_log: append-only audit trail for every /api/v1/* call,
-- including rejected ones (bad/expired/rate-limited token). Never stores the
-- token value itself — only the token_id it resolved to, if any.
--
-- Doubles as the storage for the per-token rate limit: a Vercel serverless
-- function has no memory shared across invocations, so "requests in the
-- last 60 seconds" is answered by counting rows here rather than an
-- in-process counter.
-- ---------------------------------------------------------------------------
create table if not exists api_request_log (
  id          bigint generated always as identity primary key,
  token_id    uuid references api_tokens (id) on delete set null,
  path        text not null,
  query       jsonb not null default '{}'::jsonb,
  status      int not null,
  duration_ms int,
  created_at  timestamptz not null default now()
);

create index if not exists api_request_log_token_created_idx on api_request_log (token_id, created_at desc);
create index if not exists api_request_log_created_idx on api_request_log (created_at desc);

alter table api_tokens      enable row level security;
alter table api_request_log enable row level security;
-- Same default-deny posture as every other table — service role (BFF) only.

-- =============================================================================
-- v1.7: FY2026 alignment.
--
-- The FY2026 workbook (Ver.1, 3 Apr 2026) ships two things FY2025 did not:
-- AutoCorp's completed self-assessment, and Marubeni's own scoring formulas.
-- Reconciling with them requires two changes here. Safe to re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 'Not Applicable' returns as a SIXTH status, distinct from 'Not Compliant'.
--
-- v1.3 repurposed 'Not Applicable' to mean 'Not Compliant' on the reasoning
-- that nothing needed a "doesn't apply to us" state. The FY2026 workbook uses
-- exactly that state for 8 requirements, and — decisively — Marubeni's scoring
-- sheet EXCLUDES them from the denominator rather than scoring them as
-- failures. Keeping them merged would understate AutoCorp against Marubeni's
-- own method, so N/A comes back alongside NC rather than replacing it again.
-- ---------------------------------------------------------------------------
alter table item_status drop constraint if exists item_status_status_check;
alter table item_status add constraint item_status_status_check
  check (status in ('Not Started', 'In Progress', 'Compliant', 'Partial',
                    'Not Compliant', 'Not Applicable'));

-- ---------------------------------------------------------------------------
-- The workbook's self-assessment, kept SEPARATE from workflow-driven `status`.
--
-- `status` may only reach a compliance verdict through User -> Reviewer ->
-- Approver (PRD goal 6). Importing the spreadsheet answers into `status`
-- directly would fabricate 45 approvals that no Approver ever gave. They live
-- in their own columns instead, so the dashboard can report the official
-- Marubeni score exactly as the auditor computes it, while `status` continues
-- to mean "what our own approval workflow has actually verified."
-- ---------------------------------------------------------------------------
alter table item_status add column if not exists self_assessment text;
alter table item_status drop constraint if exists item_status_self_assessment_check;
alter table item_status add constraint item_status_self_assessment_check
  check (self_assessment is null or self_assessment in ('〇', '×', '-'));

alter table item_status add column if not exists self_assessment_note text not null default '';

-- =============================================================================
-- v1.9 (PROPOSED — not a real Box connection yet): Box.com Remark Sync +
-- the `marubeni` role. See PRD.md § 13 for the full spec and § 13.7 for the
-- role. Safe to re-run.
--
-- This migration only adds columns/tables/roles the *application* can use
-- once a real Box Custom App exists (PRD.md § 13.6, § 9 — still an open,
-- blocking dependency outside this codebase). Running this SQL does not by
-- itself connect anything to Box.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- New role: `marubeni`. Not part of the internal preparer -> reviewer ->
-- approver chain (§ 4a) — represents an external Marubeni-side reviewer who
-- can view the dashboard, write the Remark in-app, and trigger a manual
-- Box sync. See PRD.md § 13.7 for the real scope-change tension this raises
-- against this project's original "internal tool only" framing — get an
-- explicit go-ahead before issuing a real `marubeni` account.
-- ---------------------------------------------------------------------------
alter table users drop constraint if exists users_role_check;
alter table users add constraint users_role_check
  check (role in ('admin', 'user', 'reviewer', 'approver', 'read_only', 'marubeni'));

-- ---------------------------------------------------------------------------
-- item_status: Box folder link + the synced/authored Remark. Deliberately
-- separate from `status`/`workflow_state` (never written by the Box sync —
-- decision D2, PRD.md § 13.2) and from `self_assessment_note` (a frozen
-- snapshot of the FY2026 workbook import, not a live sync target).
-- ---------------------------------------------------------------------------
alter table item_status add column if not exists box_url            text not null default '';
alter table item_status add column if not exists box_remark         text not null default '';
alter table item_status add column if not exists box_remark_by      text not null default '';
alter table item_status add column if not exists box_remark_at      timestamptz;
alter table item_status add column if not exists box_remark_source  text; -- 'box' | 'app', null until first remark
alter table item_status drop constraint if exists item_status_box_remark_source_check;
alter table item_status add constraint item_status_box_remark_source_check
  check (box_remark_source is null or box_remark_source in ('box', 'app'));
alter table item_status add column if not exists box_sync_file_id   text; -- which file in the folder is the active thread (pull bookkeeping)
alter table item_status add column if not exists box_last_comment_id text; -- dedupe + loop-prevention bookkeeping (pull)

-- ---------------------------------------------------------------------------
-- box_sync_log: append-only audit trail for every pull/push attempt,
-- automatic or manually triggered — mirrors api_request_log's role (v1.6).
-- `triggered_by` is set only for a manual "Sync to Box" (marubeni/admin);
-- null for the automatic push-on-status-change and the scheduled pull.
-- ---------------------------------------------------------------------------
create table if not exists box_sync_log (
  id            bigint generated always as identity primary key,
  item_no       int not null references checklist_items (no) on delete cascade,
  direction     text not null check (direction in ('pull', 'push')),
  box_file_id   text,
  box_comment_id text,
  remark_text   text,
  success       boolean not null,
  error         text,
  triggered_by  uuid references users (id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists box_sync_log_item_no_idx on box_sync_log (item_no, created_at desc);

alter table box_sync_log enable row level security;
-- Same default-deny posture as every other table — service role (BFF) only.
