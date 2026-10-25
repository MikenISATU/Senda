-- SENDA: run this whole file ONCE in Supabase > SQL Editor > New query > Run.
-- It is the files in supabase/migrations/ combined, in order.
-- Creates 33 tables, functions, Row Level Security, storage buckets and realtime.

-- ===== migrations/20261024000001_schema.sql =====
-- Senda schema. Run in Supabase SQL editor (in order) or with `supabase db push`.
-- Money columns are numeric(30,7): exact decimal, 7 places = Stellar stroops.

create extension if not exists citext;
create extension if not exists pgcrypto;

-- ───────────────────────────── identity ─────────────────────────────

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  username citext unique check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text check (char_length(display_name) <= 50),
  bio text check (char_length(bio) <= 280),
  avatar_url text,
  role text not null default 'user' check (role in ('user', 'admin', 'mediator')),
  is_banned boolean not null default false,
  follower_count integer not null default 0,
  following_count integer not null default 0,
  onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Private identity mapping. Never exposed to clients.
create table public.profile_private (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  privy_user_id text not null unique,
  email text,
  created_at timestamptz not null default now()
);

create table public.linked_wallets (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  address text not null check (address ~ '^G[A-Z2-7]{55}$'),
  chain text not null default 'stellar',
  network text not null check (network in ('testnet', 'mainnet')),
  privy_wallet_id text,
  is_primary boolean not null default true,
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (address, network)
);
create unique index linked_wallets_one_primary on public.linked_wallets (profile_id, network) where is_primary;

create table public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  followee_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index follows_followee on public.follows (followee_id);

-- ───────────────────────────── social ─────────────────────────────

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null default '' check (char_length(body) <= 2000),
  repost_of uuid references public.posts(id) on delete set null,
  is_premium boolean not null default false,
  status text not null default 'active' check (status in ('active', 'hidden', 'removed')),
  like_count integer not null default 0,
  comment_count integer not null default 0,
  repost_count integer not null default 0,
  tip_total_usdc numeric(30,7) not null default 0,
  created_at timestamptz not null default now()
);
create index posts_author_created on public.posts (author_id, created_at desc);
create index posts_created on public.posts (created_at desc) where status = 'active';

-- Premium body is split out so RLS can restrict it to the author and buyers.
create table public.post_premium_content (
  post_id uuid primary key references public.posts(id) on delete cascade,
  body text not null default '' check (char_length(body) <= 20000)
);

create table public.post_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  bucket text not null check (bucket in ('public-media', 'premium-media')),
  storage_path text not null,
  mime text not null,
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 26214400),
  is_premium boolean not null default false,
  created_at timestamptz not null default now()
);
create index post_media_post on public.post_media (post_id);

create table public.likes (
  post_id uuid not null references public.posts(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, profile_id)
);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  status text not null default 'active' check (status in ('active', 'removed')),
  created_at timestamptz not null default now()
);
create index comments_post on public.comments (post_id, created_at);

-- ─────────────────────────── commerce ───────────────────────────

create table public.products (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null unique references public.posts(id) on delete cascade,
  seller_id uuid not null references public.profiles(id) on delete cascade,
  price numeric(30,7) not null check (price > 0),
  asset text not null check (asset in ('XLM', 'USDC')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  buyer_id uuid not null references public.profiles(id) on delete restrict,
  seller_id uuid not null references public.profiles(id) on delete restrict,
  intent_id uuid not null unique,
  amount numeric(30,7) not null,
  fee numeric(30,7) not null,
  asset text not null,
  tx_hash text unique,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'failed')),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);
create unique index purchases_one_confirmed on public.purchases (product_id, buyer_id) where status = 'confirmed';

create table public.entitlements (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  purchase_id uuid not null references public.purchases(id),
  granted_at timestamptz not null default now(),
  unique (profile_id, product_id)
);

create table public.tips (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references public.profiles(id),
  to_id uuid not null references public.profiles(id),
  post_id uuid references public.posts(id) on delete set null,
  intent_id uuid not null unique,
  amount numeric(30,7) not null,
  fee numeric(30,7) not null,
  asset text not null,
  tx_hash text unique,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'failed')),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);
create index tips_to on public.tips (to_id, created_at desc);

-- ───────────────────────────── jobs ─────────────────────────────

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles(id),
  freelancer_id uuid references public.profiles(id),
  title text not null check (char_length(title) between 4 and 120),
  description text not null check (char_length(description) between 10 and 5000),
  role text check (char_length(role) <= 60),
  budget numeric(30,7) not null check (budget > 0),
  asset text not null check (asset in ('XLM', 'USDC')),
  deadline timestamptz not null,
  status text not null default 'DRAFT' check (status in (
    'DRAFT', 'OFFERED', 'ACCEPTED', 'AWAITING_FUNDING', 'FUNDED', 'IN_PROGRESS', 'PROOF_SUBMITTED',
    'REVISION_REQUESTED', 'APPROVED', 'DISPUTED', 'PAID', 'REFUNDED', 'RESOLVED', 'CANCELLED')),
  agreed_amount numeric(30,7),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index jobs_status_created on public.jobs (status, created_at desc);

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  freelancer_id uuid not null references public.profiles(id),
  note text not null check (char_length(note) between 1 and 2000),
  proposed_amount numeric(30,7) check (proposed_amount > 0),
  status text not null default 'pending' check (status in ('pending', 'shortlisted', 'declined', 'withdrawn')),
  created_at timestamptz not null default now(),
  unique (job_id, freelancer_id)
);

create table public.job_offers (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  freelancer_id uuid not null references public.profiles(id),
  amount numeric(30,7) not null check (amount > 0),
  asset text not null check (asset in ('XLM', 'USDC')),
  deadline timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'withdrawn')),
  created_at timestamptz not null default now(),
  responded_at timestamptz
);
create unique index job_offers_one_pending on public.job_offers (job_id) where status = 'pending';

-- Cache of on-chain escrow state. The contract is the money authority.
create table public.escrows (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references public.jobs(id),
  contract_id text not null,
  escrow_key text not null unique check (escrow_key ~ '^[0-9a-f]{64}$'),
  client_address text not null,
  freelancer_address text not null,
  token_contract text not null,
  asset text not null,
  amount numeric(30,7) not null,
  onchain_status text,
  onchain jsonb,
  fund_tx text,
  last_tx text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now()
);

-- ───────────────────────────── chat ─────────────────────────────

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('dm', 'job')),
  job_id uuid unique references public.jobs(id) on delete cascade,
  dm_key text unique,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz,
  primary key (conversation_id, profile_id)
);
create index conversation_members_profile on public.conversation_members (profile_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid references public.profiles(id),
  kind text not null default 'text' check (kind in ('text', 'proof', 'system')),
  body text not null default '' check (char_length(body) <= 4000),
  created_at timestamptz not null default now()
);
create index messages_conv_created on public.messages (conversation_id, created_at);

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id uuid references public.messages(id) on delete set null,
  uploader_id uuid not null references public.profiles(id),
  storage_path text not null unique,
  file_name text not null,
  mime text not null,
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 26214400),
  sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  is_evidence boolean not null default false,
  created_at timestamptz not null default now()
);

-- ───────────────────────── transactions ─────────────────────────

-- Every money movement starts as a server-built intent. The server stores the
-- exact transaction body; the user's wallet signs that hash; the server only
-- submits a signature that verifies against the stored hash.
create table public.tx_intents (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id),
  kind text not null check (kind in (
    'payment', 'tip', 'purchase', 'trustline', 'escrow_fund', 'escrow_action',
    'earn_supply', 'earn_withdraw', 'paiflow_deposit')),
  provider text not null default 'stellar' check (provider in ('stellar', 'soroban', 'paiflow')),
  network text not null,
  source_address text not null,
  tx_hash text not null unique,
  xdr text not null,
  payload jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  status text not null default 'prepared' check (status in ('prepared', 'submitted', 'confirmed', 'failed', 'expired')),
  result jsonb,
  error text,
  idempotency_key text,
  expires_at timestamptz not null,
  submitted_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, idempotency_key)
);
create index tx_intents_status on public.tx_intents (status, created_at);
create index tx_intents_profile on public.tx_intents (profile_id, created_at desc);

-- Indexed on-chain activity per wallet (payments in and out).
create table public.transfers (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id),
  direction text not null check (direction in ('in', 'out')),
  counterparty text,
  asset text not null,
  amount numeric(30,7) not null,
  tx_hash text not null,
  op_id text not null,
  kind text not null default 'payment',
  memo text,
  ledger_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (profile_id, op_id)
);
create index transfers_profile_time on public.transfers (profile_id, ledger_at desc);

create table public.ledger_events (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('horizon', 'soroban', 'paiflow')),
  event_id text not null,
  contract_id text,
  tx_hash text,
  ledger integer,
  topic text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (source, event_id)
);

create table public.workflow_runs (
  id uuid primary key default gen_random_uuid(),
  workflow_key text not null check (workflow_key in ('SEND', 'RECEIVE', 'TIP', 'POST_PURCHASE', 'JOB_FUND', 'FEE_SWEEP')),
  provider text not null check (provider in ('stellar', 'soroban', 'paiflow')),
  intent_id uuid references public.tx_intents(id),
  deployment_id text,
  request_id text,
  status text not null default 'started',
  tx_hash text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.sync_cursors (
  key text primary key,
  cursor text not null,
  updated_at timestamptz not null default now()
);

-- ───────────────────────────── earn ─────────────────────────────

create table public.earn_positions (
  profile_id uuid not null references public.profiles(id),
  pool_id text not null,
  asset_contract text not null,
  net_deposited numeric(30,7) not null default 0,
  opted_in_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (profile_id, pool_id, asset_contract)
);

create table public.earn_rate_snapshots (
  id bigserial primary key,
  pool_id text not null,
  asset_contract text not null,
  b_rate numeric(40,0) not null,
  taken_at timestamptz not null default now()
);
create index earn_rate_snapshots_lookup on public.earn_rate_snapshots (pool_id, asset_contract, taken_at desc);

-- ──────────────────────────── faucet ────────────────────────────

create table public.faucet_claims (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id),
  address text not null,
  kind text not null check (kind in ('signup', 'repeat')),
  asset text not null check (asset in ('XLM', 'USDC')),
  amount numeric(30,7) not null,
  idempotency_key text not null unique,
  ip_hash text,
  tx_hash text,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'failed')),
  error text,
  created_at timestamptz not null default now()
);
create index faucet_claims_profile on public.faucet_claims (profile_id, created_at desc);
create index faucet_claims_day on public.faucet_claims (created_at);

-- ───────────────────── notifications / safety ─────────────────────

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  actor_id uuid references public.profiles(id) on delete set null,
  entity_type text,
  entity_id text,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_profile on public.notifications (profile_id, created_at desc);

create table public.audit_logs (
  id bigserial primary key,
  actor_id uuid references public.profiles(id),
  action text not null,
  entity_type text,
  entity_id text,
  data jsonb not null default '{}'::jsonb,
  ip_hash text,
  created_at timestamptz not null default now()
);

create table public.moderation_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id),
  entity_type text not null check (entity_type in ('post', 'comment', 'profile', 'message', 'job')),
  entity_id text not null,
  reason text not null check (char_length(reason) between 3 and 500),
  status text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (reporter_id, entity_type, entity_id)
);

create table public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (key, window_start)
);

-- ===== migrations/20261024000002_functions.sql =====
-- Helper functions, counters and atomic state transitions.

-- Profile id carried in the Senda-minted JWT (`sub`). Null for anon.
create or replace function public.current_profile_id() returns uuid
language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
create trigger jobs_touch before update on public.jobs for each row execute function public.touch_updated_at();
create trigger tx_intents_touch before update on public.tx_intents for each row execute function public.touch_updated_at();
create trigger workflow_runs_touch before update on public.workflow_runs for each row execute function public.touch_updated_at();

-- Counters
create or replace function public.likes_counter() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then update posts set like_count = like_count + 1 where id = new.post_id;
  else update posts set like_count = greatest(like_count - 1, 0) where id = old.post_id; end if;
  return null;
end $$;
create trigger likes_count after insert or delete on public.likes for each row execute function public.likes_counter();

create or replace function public.comments_counter() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then update posts set comment_count = comment_count + 1 where id = new.post_id;
  else update posts set comment_count = greatest(comment_count - 1, 0) where id = old.post_id; end if;
  return null;
end $$;
create trigger comments_count after insert or delete on public.comments for each row execute function public.comments_counter();

create or replace function public.reposts_counter() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.repost_of is not null then update posts set repost_count = repost_count + 1 where id = new.repost_of;
  elsif tg_op = 'DELETE' and old.repost_of is not null then update posts set repost_count = greatest(repost_count - 1, 0) where id = old.repost_of; end if;
  return null;
end $$;
create trigger reposts_count after insert or delete on public.posts for each row execute function public.reposts_counter();

create or replace function public.follows_counter() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update profiles set follower_count = follower_count + 1 where id = new.followee_id;
    update profiles set following_count = following_count + 1 where id = new.follower_id;
  else
    update profiles set follower_count = greatest(follower_count - 1, 0) where id = old.followee_id;
    update profiles set following_count = greatest(following_count - 1, 0) where id = old.follower_id;
  end if;
  return null;
end $$;
create trigger follows_count after insert or delete on public.follows for each row execute function public.follows_counter();

create or replace function public.messages_bump() returns trigger language plpgsql security definer set search_path = public as $$
begin
  update conversations set last_message_at = new.created_at where id = new.conversation_id;
  return null;
end $$;
create trigger messages_bump after insert on public.messages for each row execute function public.messages_bump();

-- Fixed-window rate limiter usable from serverless functions.
-- Returns true when the call is allowed.
create or replace function public.rate_limit_hit(p_key text, p_window_seconds integer, p_max integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  n integer;
begin
  insert into rate_limits (key, window_start, hits) values (p_key, w, 1)
  on conflict (key, window_start) do update set hits = rate_limits.hits + 1
  returning hits into n;
  return n <= p_max;
end $$;

-- Atomic, idempotent confirmation of a purchase. Grants the entitlement
-- exactly once, no matter how many times the reconciler or client retries.
create or replace function public.confirm_purchase(p_intent_id uuid, p_tx_hash text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  p purchases%rowtype;
begin
  update purchases set status = 'confirmed', tx_hash = p_tx_hash, confirmed_at = now()
  where intent_id = p_intent_id and status = 'pending'
  returning * into p;
  if not found then
    select * into p from purchases where intent_id = p_intent_id;
    return p.id; -- already confirmed (or unknown): no second grant
  end if;
  insert into entitlements (profile_id, product_id, purchase_id)
  values (p.buyer_id, p.product_id, p.id)
  on conflict (profile_id, product_id) do nothing;
  insert into notifications (profile_id, type, actor_id, entity_type, entity_id, body)
  values (p.seller_id, 'sale', p.buyer_id, 'product', p.product_id::text, 'Someone bought your premium post');
  return p.id;
end $$;

create or replace function public.confirm_tip(p_intent_id uuid, p_tx_hash text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  t tips%rowtype;
begin
  update tips set status = 'confirmed', tx_hash = p_tx_hash, confirmed_at = now()
  where intent_id = p_intent_id and status = 'pending'
  returning * into t;
  if not found then
    return null;
  end if;
  if t.post_id is not null and t.asset = 'USDC' then
    update posts set tip_total_usdc = tip_total_usdc + t.amount where id = t.post_id;
  end if;
  insert into notifications (profile_id, type, actor_id, entity_type, entity_id, body)
  values (t.to_id, 'tip', t.from_id, case when t.post_id is not null then 'post' else 'profile' end,
          coalesce(t.post_id::text, t.to_id::text),
          'You received a ' || t.amount::text || ' ' || t.asset || ' tip');
  return t.id;
end $$;

-- Count of faucet units sent today (for the daily treasury cap).
create or replace function public.faucet_sent_today(p_asset text) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0) from faucet_claims
  where asset = p_asset and status in ('pending', 'confirmed') and created_at >= date_trunc('day', now())
$$;

revoke all on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
revoke all on function public.confirm_purchase(uuid, text) from public, anon, authenticated;
revoke all on function public.confirm_tip(uuid, text) from public, anon, authenticated;
revoke all on function public.faucet_sent_today(text) from public, anon, authenticated;

-- ===== migrations/20261024000003_rls.sql =====
-- Row Level Security.
-- Model: all writes go through the Senda server (service role, after Privy
-- verification). Clients may READ with a short-lived Senda-minted JWT whose
-- `sub` is their profile id; these policies decide what they can see.
-- The anon key alone can only see public social content.

alter table public.profiles enable row level security;
alter table public.profile_private enable row level security;
alter table public.linked_wallets enable row level security;
alter table public.follows enable row level security;
alter table public.posts enable row level security;
alter table public.post_premium_content enable row level security;
alter table public.post_media enable row level security;
alter table public.likes enable row level security;
alter table public.comments enable row level security;
alter table public.products enable row level security;
alter table public.purchases enable row level security;
alter table public.entitlements enable row level security;
alter table public.tips enable row level security;
alter table public.jobs enable row level security;
alter table public.applications enable row level security;
alter table public.job_offers enable row level security;
alter table public.escrows enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.attachments enable row level security;
alter table public.tx_intents enable row level security;
alter table public.transfers enable row level security;
alter table public.ledger_events enable row level security;
alter table public.workflow_runs enable row level security;
alter table public.sync_cursors enable row level security;
alter table public.earn_positions enable row level security;
alter table public.earn_rate_snapshots enable row level security;
alter table public.faucet_claims enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;
alter table public.moderation_reports enable row level security;
alter table public.rate_limits enable row level security;

-- No client writes anywhere: revoke DML from client roles (service role bypasses RLS).
revoke insert, update, delete on all tables in schema public from anon, authenticated;

-- Membership helper (security definer avoids recursive RLS on members table).
create or replace function public.is_member(p_conversation uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from conversation_members where conversation_id = p_conversation and profile_id = public.current_profile_id())
$$;

create or replace function public.has_entitlement(p_post uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from products pr join entitlements e on e.product_id = pr.id
    where pr.post_id = p_post and e.profile_id = public.current_profile_id()
  ) or exists (select 1 from posts where id = p_post and author_id = public.current_profile_id())
$$;

-- Public social graph
create policy profiles_read on public.profiles for select using (not is_banned or id = public.current_profile_id());
create policy wallets_read on public.linked_wallets for select using (true); -- public addresses only
create policy follows_read on public.follows for select using (true);
create policy posts_read on public.posts for select using (status = 'active' or author_id = public.current_profile_id());
create policy post_media_public_read on public.post_media for select using (not is_premium or public.has_entitlement(post_id));
create policy premium_read on public.post_premium_content for select using (public.has_entitlement(post_id));
create policy likes_read on public.likes for select using (true);
create policy comments_read on public.comments for select using (status = 'active');
create policy products_read on public.products for select using (true);

-- Private: only the people involved
create policy purchases_read on public.purchases for select using (buyer_id = public.current_profile_id() or seller_id = public.current_profile_id());
create policy entitlements_read on public.entitlements for select using (profile_id = public.current_profile_id());
create policy tips_read on public.tips for select using (from_id = public.current_profile_id() or to_id = public.current_profile_id());

create policy jobs_read on public.jobs for select using (
  status = 'DRAFT' or client_id = public.current_profile_id() or freelancer_id = public.current_profile_id());
create policy applications_read on public.applications for select using (
  freelancer_id = public.current_profile_id()
  or exists (select 1 from public.jobs j where j.id = job_id and j.client_id = public.current_profile_id()));
create policy offers_read on public.job_offers for select using (
  freelancer_id = public.current_profile_id()
  or exists (select 1 from public.jobs j where j.id = job_id and j.client_id = public.current_profile_id()));
create policy escrows_read on public.escrows for select using (
  exists (select 1 from public.jobs j where j.id = job_id
          and (j.client_id = public.current_profile_id() or j.freelancer_id = public.current_profile_id())));

create policy conversations_read on public.conversations for select using (public.is_member(id));
create policy members_read on public.conversation_members for select using (public.is_member(conversation_id));
create policy messages_read on public.messages for select using (public.is_member(conversation_id));
create policy attachments_read on public.attachments for select using (public.is_member(conversation_id));

create policy intents_read on public.tx_intents for select using (profile_id = public.current_profile_id());
create policy transfers_read on public.transfers for select using (profile_id = public.current_profile_id());
create policy earn_read on public.earn_positions for select using (profile_id = public.current_profile_id());
create policy earn_rates_read on public.earn_rate_snapshots for select using (true);
create policy faucet_read on public.faucet_claims for select using (profile_id = public.current_profile_id());
create policy notifications_read on public.notifications for select using (profile_id = public.current_profile_id());
create policy reports_read on public.moderation_reports for select using (reporter_id = public.current_profile_id());

-- profile_private, ledger_events, workflow_runs, sync_cursors, audit_logs, rate_limits:
-- RLS enabled with NO policies => invisible to anon/authenticated. Server only.

-- Hide sensitive tx fields from clients even for their own rows.
revoke select (xdr) on public.tx_intents from anon, authenticated;

-- Realtime for chat and notifications (RLS applies to realtime too).
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.notifications;

-- ───────────────────────────── storage ─────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('public-media', 'public-media', true, 26214400, array['image/png','image/jpeg','image/webp','image/gif','video/mp4']),
  ('premium-media', 'premium-media', false, 26214400, array['image/png','image/jpeg','image/webp','image/gif','video/mp4','application/pdf','application/zip']),
  ('chat-attachments', 'chat-attachments', false, 26214400, null),
  ('avatars', 'avatars', true, 2097152, array['image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;
-- No storage.objects policies for clients: uploads use server-issued signed
-- upload URLs, and private reads use short-lived server-issued signed URLs
-- after the server checks membership / entitlement.

-- ===== migrations/20261024000004_review_fixes.sql =====
-- Fixes from the independent security review.

-- 1. Confirmation side effects run once per intent (guarded claim).
alter table public.tx_intents add column if not exists effects_applied_at timestamptz;

-- 2. A second paid purchase of an already-owned post is recorded as a duplicate
--    (needs a manual refund) instead of failing forever.
alter table public.purchases drop constraint if exists purchases_status_check;
alter table public.purchases add constraint purchases_status_check check (status in ('pending', 'confirmed', 'failed', 'duplicate'));

create or replace function public.confirm_purchase(p_intent_id uuid, p_tx_hash text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  p purchases%rowtype;
begin
  -- 'failed' is accepted too: a payment marked failed during indexer lag can still land.
  begin
    update purchases set status = 'confirmed', tx_hash = p_tx_hash, confirmed_at = now()
    where intent_id = p_intent_id and status in ('pending', 'failed')
    returning * into p;
  exception when unique_violation then
    update purchases set status = 'duplicate', tx_hash = p_tx_hash, confirmed_at = now()
    where intent_id = p_intent_id returning * into p;
    insert into audit_logs (actor_id, action, entity_type, entity_id, data)
    values (p.buyer_id, 'purchase.duplicate_needs_refund', 'purchase', p.id::text, jsonb_build_object('tx', p_tx_hash, 'amount', p.amount, 'asset', p.asset));
    insert into notifications (profile_id, type, entity_type, entity_id, body)
    values (p.buyer_id, 'purchase_duplicate', 'product', p.product_id::text, 'You paid twice for a post you already own. Support has been notified to refund you.');
    return p.id;
  end;
  if not found then
    select * into p from purchases where intent_id = p_intent_id;
    return p.id;
  end if;
  insert into entitlements (profile_id, product_id, purchase_id)
  values (p.buyer_id, p.product_id, p.id)
  on conflict (profile_id, product_id) do nothing;
  insert into notifications (profile_id, type, actor_id, entity_type, entity_id, body)
  values (p.seller_id, 'sale', p.buyer_id, 'product', p.product_id::text, 'Someone bought your premium post');
  return p.id;
end $$;

create or replace function public.confirm_tip(p_intent_id uuid, p_tx_hash text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  t tips%rowtype;
begin
  update tips set status = 'confirmed', tx_hash = p_tx_hash, confirmed_at = now()
  where intent_id = p_intent_id and status in ('pending', 'failed')
  returning * into t;
  if not found then
    return null;
  end if;
  if t.post_id is not null and t.asset = 'USDC' then
    update posts set tip_total_usdc = tip_total_usdc + t.amount where id = t.post_id;
  end if;
  insert into notifications (profile_id, type, actor_id, entity_type, entity_id, body)
  values (t.to_id, 'tip', t.from_id, case when t.post_id is not null then 'post' else 'profile' end,
          coalesce(t.post_id::text, t.to_id::text), 'You received a ' || t.amount::text || ' ' || t.asset || ' tip');
  return t.id;
end $$;

revoke all on function public.confirm_purchase(uuid, text) from public, anon, authenticated;
revoke all on function public.confirm_tip(uuid, text) from public, anon, authenticated;

-- 3. Column-level privacy. A column REVOKE does not override a table GRANT, so
--    revoke the table and grant only safe columns.
revoke select on public.tx_intents from anon, authenticated;
grant select (id, profile_id, kind, provider, network, source_address, tx_hash, summary, status, error, created_at, updated_at, confirmed_at)
  on public.tx_intents to authenticated;

revoke select on public.linked_wallets from anon, authenticated;
grant select (profile_id, address, network, is_primary) on public.linked_wallets to anon, authenticated;


-- ===== migrations/20261025000005_payment_requests.sql =====
-- 0005: payment requests in chat ("Request money").
-- A request is a chat message (kind 'request') plus a row here. The payer pays
-- with an ordinary signed payment; the request flips to 'paid' only after the
-- payment is confirmed on the ledger (see effects.ts, intent kind 'payment').

alter table public.messages drop constraint if exists messages_kind_check;
alter table public.messages add constraint messages_kind_check check (kind in ('text', 'proof', 'system', 'request'));

create table if not exists public.payment_requests (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id uuid unique references public.messages(id) on delete set null,
  requester_id uuid not null references public.profiles(id),
  payer_id uuid not null references public.profiles(id),
  asset text not null check (asset in ('XLM', 'USDC')),
  amount numeric(20, 7) not null check (amount > 0),
  note text not null default '' check (char_length(note) <= 140),
  status text not null default 'open' check (status in ('open', 'paid', 'declined', 'cancelled')),
  intent_id uuid references public.tx_intents(id),
  tx_hash text,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  check (requester_id <> payer_id)
);
create index if not exists payment_requests_conv on public.payment_requests (conversation_id, created_at);
create index if not exists payment_requests_payer_open on public.payment_requests (payer_id) where status = 'open';

-- Server-only table: all reads and writes go through the API (service role).
alter table public.payment_requests enable row level security;
revoke all on public.payment_requests from anon, authenticated;


-- ===== migrations/20261025000006_request_workflow.sql =====
-- 0006: track chat request payments separately and repair workflow statuses.

alter table public.workflow_runs drop constraint if exists workflow_runs_workflow_key_check;
alter table public.workflow_runs add constraint workflow_runs_workflow_key_check
  check (workflow_key in ('SEND', 'RECEIVE', 'REQUEST', 'TIP', 'POST_PURCHASE', 'JOB_FUND', 'FEE_SWEEP'));

-- Requests created before this migration were recorded as generic SEND runs.
update public.workflow_runs wr
set workflow_key = 'REQUEST', updated_at = now()
from public.tx_intents ti
where wr.intent_id = ti.id
  and wr.workflow_key = 'SEND'
  and ti.kind = 'payment'
  and ti.payload ? 'requestId';

-- Older TIP, POST_PURCHASE and JOB_FUND runs were linked to an intent but their
-- final status was not copied back. Reconcile them from the authoritative
-- transaction intent without changing any payment or entitlement.
update public.workflow_runs wr
set status = ti.status,
    tx_hash = case when ti.status in ('submitted', 'confirmed', 'failed') then ti.tx_hash else wr.tx_hash end,
    updated_at = now()
from public.tx_intents ti
where wr.intent_id = ti.id
  and (wr.status is distinct from ti.status
       or (ti.status in ('submitted', 'confirmed', 'failed') and wr.tx_hash is distinct from ti.tx_hash));
