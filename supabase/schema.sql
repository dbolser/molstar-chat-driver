-- Evaluator preview site — capture store.
-- Run this once in the Supabase SQL editor (or pipe it through `psql "$DB_URL"`).
--
-- RLS is ON with NO policies, so the anon/public role has no access at all. Only the Edge
-- Functions (which use the service-role key) read/write. You inspect the data via the Supabase
-- dashboard / SQL editor.
--
-- `evaluators` doubles as the INVITE ALLOWLIST: a token row must already exist (minted by
-- scripts/mint-invites.mjs) before `chat`/`capture` will do anything for it. Unknown tokens are
-- rejected, so the public Pages URL can't be used to burn model quota or pollute the capture
-- tables. `turns`/`feedback` always carry a known evaluator_token (hence NOT NULL).

create table if not exists evaluators (
  token       text primary key,
  name        text,
  revoked     boolean not null default false,  -- set true to instantly cut off a leaked link
  first_seen  timestamptz not null default now()
);
-- (idempotent for projects created before `revoked` existed)
alter table evaluators add column if not exists revoked boolean not null default false;

create table if not exists turns (
  id              uuid primary key default gen_random_uuid(),
  evaluator_token text not null,
  prompt          text not null,
  model           text,
  mvsj            text,        -- the MVS scene (null if none was produced)
  raw             text,        -- the model's raw reply / error text
  tier0           boolean,     -- did it produce a parseable scene?
  created_at      timestamptz not null default now()
);

create table if not exists feedback (
  id              uuid primary key default gen_random_uuid(),
  evaluator_token text not null,
  turn_id         uuid references turns (id) on delete set null,  -- the turn it refers to (null = general)
  rating          text,        -- optional quick rating
  comment         text,        -- free-text feedback
  created_at      timestamptz not null default now()
);

alter table evaluators enable row level security;
alter table turns      enable row level security;
alter table feedback   enable row level security;
-- (No policies on purpose → anon has zero access; service-role bypasses RLS.)

-- The Edge Functions (and the mint script) reach the data as `service_role`, which bypasses RLS
-- but still needs base table privileges. Grant exactly what they use; anon/authenticated get
-- nothing. (Supabase cloud usually grants service_role by default, but be explicit so this also
-- works on a fresh local stack and never silently 403s.)
grant select, insert, update, delete on evaluators, turns, feedback to service_role;

create index if not exists turns_evaluator_idx    on turns (evaluator_token, created_at);
create index if not exists feedback_evaluator_idx on feedback (evaluator_token, created_at);
