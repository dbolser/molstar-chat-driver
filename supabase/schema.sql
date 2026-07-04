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

-- Atomic daily usage counters for the chat abuse/cost caps (per-token + optional global), keyed
-- by UTC day. Kept separate from `turns` so the cap is a single atomic reservation — counting
-- rows would be read-then-act and let a burst of concurrent requests overshoot the cap.
create table if not exists usage_counters (
  scope text not null,                 -- 'token:<token>' or 'global'
  day   date not null,                 -- UTC day bucket (auto-resets daily)
  n     integer not null default 0,
  primary key (scope, day)
);
alter table usage_counters enable row level security;  -- no policies → anon has no access
grant select, insert, update, delete on usage_counters to service_role;

-- Atomically reserve one call against the per-token (and optional global) daily cap. Returns
-- true and increments the counter(s) if allowed; false (no increment) once a cap is reached.
-- p_global_cap <= 0 disables the global check. The INSERT … ON CONFLICT … WHERE row lock makes
-- concurrent callers serialize on the bucket row, so bursts cannot exceed the cap.
create or replace function rate_take(p_token text, p_token_cap int, p_global_cap int)
returns boolean
language plpgsql
as $$
declare
  d date := timezone('utc', now())::date;
  took boolean;
begin
  if p_token_cap < 1 then return false; end if;
  insert into usage_counters (scope, day, n) values ('token:' || p_token, d, 1)
    on conflict (scope, day) do update set n = usage_counters.n + 1
      where usage_counters.n < p_token_cap
    returning true into took;
  if took is null then return false; end if;            -- per-token cap reached

  if p_global_cap > 0 then
    insert into usage_counters (scope, day, n) values ('global', d, 1)
      on conflict (scope, day) do update set n = usage_counters.n + 1
        where usage_counters.n < p_global_cap
      returning true into took;
    if took is null then                                -- global cap reached: refund token slot
      update usage_counters set n = n - 1 where scope = 'token:' || p_token and day = d;
      return false;
    end if;
  end if;

  return true;
end;
$$;
