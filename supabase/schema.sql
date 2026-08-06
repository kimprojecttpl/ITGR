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
