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
