-- Ontology-backed leadership actions (stable theme_id, audit trail).
create table if not exists leadership_actions (
  theme_id text primary key,
  title text not null,
  rationale text not null,
  confidence text not null,
  status text not null,
  evidence jsonb not null default '[]'::jsonb,
  evidence_count integer not null default 1,
  evidence_observation_ids jsonb not null default '[]'::jsonb,
  engine text not null,
  last_trigger_observation_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists leadership_action_audit (
  id text primary key,
  theme_id text not null,
  op text not null,
  trigger_observation_id text,
  engine text not null,
  detail text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists leadership_action_audit_theme_idx
  on leadership_action_audit (theme_id, created_at desc);

drop table if exists leadership_action_items;
drop table if exists leadership_action_snapshots;
