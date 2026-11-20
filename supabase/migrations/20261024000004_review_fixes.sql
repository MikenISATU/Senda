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
