-- Evaluator preview site — capture store.
-- Run this once in the Supabase SQL editor (or via `supabase db push`).
--
-- RLS is ON with NO policies, so the anon/public role has no access at all. Only the Edge
-- Functions (which use the service-role key) read/write. You inspect the data via the Supabase
-- dashboard / SQL editor. Tokens are stored as plain text (no FKs) to keep capture order-free
-- and robust — a turn can be recorded before the evaluator ever submits a name.

create table if not exists evaluators (
  token       text primary key,
  name        text,
  first_seen  timestamptz not null default now()
);

create table if not exists turns (
  id              uuid primary key default gen_random_uuid(),
  evaluator_token text,
  prompt          text not null,
  model           text,
  mvsj            text,        -- the MVS scene (null if none was produced)
  raw             text,        -- the model's raw reply / error text
  tier0           boolean,     -- did it produce a parseable scene?
  created_at      timestamptz not null default now()
);

create table if not exists feedback (
  id              uuid primary key default gen_random_uuid(),
  evaluator_token text,
  turn_id         uuid,        -- the turn the feedback refers to (may be null = general)
  rating          text,        -- optional quick rating
  comment         text,        -- free-text feedback
  created_at      timestamptz not null default now()
);

alter table evaluators enable row level security;
alter table turns      enable row level security;
alter table feedback   enable row level security;
-- (No policies on purpose → anon has zero access; service-role bypasses RLS.)

create index if not exists turns_evaluator_idx    on turns (evaluator_token, created_at);
create index if not exists feedback_evaluator_idx on feedback (evaluator_token, created_at);
