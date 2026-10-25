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
