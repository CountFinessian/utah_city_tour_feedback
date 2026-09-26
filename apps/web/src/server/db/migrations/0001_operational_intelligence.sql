-- Utah City Operational Intelligence production schema foundation.
-- The current app still uses the legacy observations table for compatibility;
-- these tables define the durable model the next phases should migrate into.

create table if not exists organizations (
  id text primary key,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists properties (
  id text primary key,
  organization_id text not null references organizations(id),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists users (
  id text primary key,
  organization_id text not null references organizations(id),
  email text not null,
  name text,
  role text not null,
  created_at timestamptz not null default now()
);

create table if not exists interactions (
  id text primary key,
  organization_id text not null references organizations(id),
  property_id text references properties(id),
  captured_by_user_id text references users(id),
  type text not null,
  journey_stage text not null,
  source text not null,
  status text not null,
  consent_state text not null default 'unknown',
  captured_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists transcript_artifacts (
  id text primary key,
  interaction_id text not null references interactions(id) on delete cascade,
  raw_text text not null,
  normalized_text text,
  audio_url text,
  language text not null default 'en',
  provider text,
  confidence jsonb,
  created_at timestamptz not null default now()
);

create table if not exists entities (
  id text primary key,
  organization_id text not null references organizations(id),
  type text not null,
  label text not null,
  canonical_key text,
  attributes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists observations_v2 (
  id text primary key,
  interaction_id text not null references interactions(id) on delete cascade,
  summary text not null,
  extraction_version text not null,
  model_label text,
  confidence jsonb,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists signals (
  id text primary key,
  interaction_id text not null references interactions(id) on delete cascade,
  type text not null,
  label text not null,
  value jsonb not null,
  journey_stage text,
  entity_ids text[] not null default '{}',
  evidence jsonb not null default '[]'::jsonb,
  confidence jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists operational_events (
  id text primary key,
  interaction_id text references interactions(id) on delete set null,
  entity_ids text[] not null default '{}',
  occurred_at timestamptz not null,
  journey_stage text not null,
  type text not null,
  summary text not null,
  evidence jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists follow_up_tasks (
  id text primary key,
  source_interaction_id text not null references interactions(id) on delete cascade,
  owner_user_id text references users(id),
  title text not null,
  status text not null,
  due_at timestamptz,
  evidence jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists recommendations (
  id text primary key,
  organization_id text not null references organizations(id),
  category text not null,
  title text not null,
  rationale text not null,
  expected_impact text,
  status text not null,
  confidence jsonb not null,
  evidence jsonb not null default '[]'::jsonb,
  owner_user_id text references users(id),
  created_at timestamptz not null default now()
);

create table if not exists metric_snapshots (
  id text primary key,
  organization_id text not null references organizations(id),
  property_id text references properties(id),
  metric_key text not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  value numeric not null,
  dimensions jsonb not null default '{}'::jsonb,
  confidence jsonb,
  created_at timestamptz not null default now()
);

create table if not exists executive_reports (
  id text primary key,
  organization_id text not null references organizations(id),
  property_id text references properties(id),
  period_start timestamptz not null,
  period_end timestamptz not null,
  title text not null,
  narrative text not null,
  recommendation_ids text[] not null default '{}',
  evidence jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists ai_runs (
  id text primary key,
  organization_id text references organizations(id),
  interaction_id text references interactions(id) on delete set null,
  task text not null,
  model_label text,
  prompt_version text,
  input_hash text,
  output jsonb,
  confidence jsonb,
  status text not null,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists interactions_org_stage_idx on interactions (organization_id, journey_stage, captured_at desc);
create index if not exists transcript_artifacts_interaction_idx on transcript_artifacts (interaction_id);
create index if not exists entities_org_type_idx on entities (organization_id, type);
create index if not exists signals_interaction_type_idx on signals (interaction_id, type);
create index if not exists signals_stage_idx on signals (journey_stage, created_at desc);
create index if not exists metric_snapshots_key_period_idx on metric_snapshots (metric_key, period_start, period_end);
