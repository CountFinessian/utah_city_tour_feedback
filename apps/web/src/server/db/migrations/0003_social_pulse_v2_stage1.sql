-- Social Pulse v2 stage 1. Additive and backward-compatible.
-- Do not CHECK-constrain monitoring_state or relevance_status: existing rows
-- keep activity_state (NEW|GROWING|ACTIVE|DORMANT|RESURGENT) and relevance_status
-- (unclassified|relevant|irrelevant|needs_review).
--
-- monitoring_state, when set by a later stage, is time since last meaningful
-- activity (spec), not post age:
--   NEW | HOT | WARM | COOLING | QUIET | DORMANT | LONG_DORMANT
-- RESURGENCE is a behavior that sets HOT. It is not a stored state.
-- stored_total is top-level comments plus replies (research name: stored_comment_total).

-- Dedupe before the unique comment index. Keep the classified row, then the
-- earliest first_seen_at, then the lowest id.
with ranked as (
  select id,
         row_number() over (
           partition by platform, platform_comment_id
           order by (sentiment is not null) desc, first_seen_at asc, id asc
         ) as rn
  from social_comments
)
delete from social_comments
where id in (select id from ranked where rn > 1);

alter table social_posts add column if not exists is_official_source boolean not null default false;
alter table social_posts add column if not exists relevance_model text;
alter table social_posts add column if not exists relevance_checked_at timestamptz;
alter table social_posts add column if not exists transcript_provider text;
alter table social_posts add column if not exists transcript_fetched_at timestamptz;
alter table social_posts add column if not exists monitoring_state text;
alter table social_posts add column if not exists next_comment_check_at timestamptz;
alter table social_posts add column if not exists last_comment_check_at timestamptz;
alter table social_posts add column if not exists last_platform_comment_count integer;
alter table social_posts add column if not exists last_new_comment_at timestamptz;
alter table social_posts add column if not exists last_activity_at timestamptz;
alter table social_posts add column if not exists newest_comment_created_at timestamptz;
alter table social_posts add column if not exists newest_comment_id text;
alter table social_posts add column if not exists comment_harvest_cursor jsonb;
alter table social_posts add column if not exists first_full_crawl_completed_at timestamptz;
alter table social_posts add column if not exists stored_total integer;
alter table social_posts add column if not exists dropped_low_signal_count integer not null default 0;
alter table social_posts add column if not exists consecutive_unchanged_checks integer not null default 0;

create index if not exists idx_social_posts_next_comment_check
  on social_posts (next_comment_check_at);

alter table social_comments add column if not exists intent text;
alter table social_comments add column if not exists relevance text;
alter table social_comments add column if not exists signal_score real;
alter table social_comments add column if not exists classification_version integer;
alter table social_comments add column if not exists classified_at timestamptz;
alter table social_comments add column if not exists is_leadership_signal boolean not null default false;
alter table social_comments add column if not exists reply_count_at_last_check integer;
alter table social_comments add column if not exists replies_checked_at timestamptz;
alter table social_comments add column if not exists dropped boolean not null default false;
alter table social_comments add column if not exists drop_reason text;

create unique index if not exists idx_social_comments_platform_comment
  on social_comments (platform, platform_comment_id);

alter table social_metric_snapshots add column if not exists source text;

create table if not exists official_accounts (
  platform text not null,
  handle text not null,
  display_name text,
  profile_url text,
  notes text,
  created_at timestamptz not null default now(),
  primary key (platform, handle)
);

insert into official_accounts (platform, handle, display_name, profile_url, notes) values
  ('tiktok', 'utahcityutah', 'Utah City', 'https://www.tiktok.com/@utahcityutah', 'Official. Posts are not content. Comments are harvested.'),
  ('instagram', 'utahcityutah', 'Utah City', 'https://www.instagram.com/utahcityutah/', 'Official. Posts are not content. Comments are harvested.'),
  ('youtube', 'UtahCity', 'Utah City', 'https://www.youtube.com/@UtahCity', 'Official. Posts are not content. Comments are harvested.'),
  ('x', 'utahcityutah', 'Utah City', 'https://x.com/utahcityutah', 'Official. Posts are not content. Comments are harvested.'),
  ('facebook', 'utahcityutah', 'Utah City', 'https://www.facebook.com/utahcityutah', 'Official. Posts are not content. Comments are harvested.'),
  ('linkedin', 'utah-city', 'Utah City', 'https://www.linkedin.com/company/utah-city', 'Official company page. Posts are not content. Comments are harvested.')
on conflict (platform, handle) do nothing;

create table if not exists social_pipeline_events (
  id text primary key,
  post_id text,
  platform text,
  platform_content_id text,
  stage text not null,
  decision text not null,
  reason text,
  cost_micro bigint not null default 0,
  at timestamptz not null default now(),
  detail jsonb
);

create index if not exists idx_social_pipeline_events_post
  on social_pipeline_events (post_id, at desc);
create index if not exists idx_social_pipeline_events_at
  on social_pipeline_events (at desc);
