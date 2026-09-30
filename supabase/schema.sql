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
  session_id      text,        -- groups the turns of one scene conversation (multi-turn refinement)
  prompt          text not null,
  model           text,
  mvsj            text,        -- the MVS scene (null if none was produced)
  raw             text,        -- the model's raw reply / error text
  tier0           boolean,     -- did it produce a parseable scene?
  repaired        boolean,     -- did the scene only parse after a JSON self-repair retry?
  lint            jsonb,       -- what the server-side scene lint changed (null = untouched)
  rendered        boolean,     -- did Mol* render it? (reported back by the site after the turn)
  render_error    text,        -- Mol*'s reason when it did not
  client          text,        -- site build stamp ("0.2.1+abc1234") that produced the turn
  server          text,        -- chat function version
  created_at      timestamptz not null default now()
);
-- (idempotent for projects created before these columns existed)
alter table turns add column if not exists session_id text;
alter table turns add column if not exists repaired boolean;
alter table turns add column if not exists lint jsonb;
alter table turns add column if not exists rendered boolean;
alter table turns add column if not exists render_error text;
alter table turns add column if not exists client text;   -- site build stamp ("0.2.1+abc1234")
alter table turns add column if not exists server text;   -- chat function version

create table if not exists feedback (
  id              uuid primary key default gen_random_uuid(),
  evaluator_token text not null,
  turn_id         uuid references turns (id) on delete set null,  -- the turn it refers to (null = general)
  rating          text,        -- optional quick rating
  comment         text,        -- free-text feedback
  screenshot      text,        -- path in the `shots` storage bucket: what the viewer showed
  created_at      timestamptz not null default now()
);
alter table feedback add column if not exists screenshot text;

-- Screenshots taken with feedback. Private bucket: read them via the dashboard or a signed URL;
-- only the `capture` function (service role) writes.
insert into storage.buckets (id, name, public) values ('shots', 'shots', false)
  on conflict (id) do nothing;

-- Waitlist: people who reach the public URL WITHOUT an invite token and ask for access. Unlike
-- everything above this is NOT gated on an invite (it's the front door), so the `waitlist` Edge
-- Function is the only writer and it validates + length-caps input. `email` is unique so a repeat
-- submit is an idempotent no-op (ON CONFLICT DO NOTHING) rather than a duplicate row.
create table if not exists waitlist (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique,
  name        text,
  note        text,        -- optional free text ("what are you hoping to do?")
  source      text,        -- coarse provenance (e.g. the page referrer) for triage
  created_at  timestamptz not null default now()
);
alter table waitlist enable row level security;  -- no policies → anon has no direct access
grant select, insert, update, delete on waitlist to service_role;

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
create index if not exists turns_session_idx      on turns (session_id, created_at);
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
