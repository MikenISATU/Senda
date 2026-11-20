import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { citext } from "@electric-sql/pglite/contrib/citext";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const A = "00000000-0000-0000-0000-000000000001";
const B = "00000000-0000-0000-0000-000000000002";

async function freshDb() {
  const db = new PGlite({ extensions: { citext, pgcrypto } });
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create or replace function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create publication supabase_realtime;
    grant usage on schema auth to anon, authenticated; grant execute on function auth.jwt() to anon, authenticated;
    -- Supabase default privileges: new public tables are granted to client roles.
    grant usage on schema public to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;`);
  for (const f of readdirSync("supabase/migrations").sort()) await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
  return db;
}

describe("supabase migrations", () => {
  it("apply cleanly and grant a purchase entitlement exactly once", async () => {
    const db = await freshDb();
    await db.exec(`
      insert into profiles (id, username) values ('${A}','alice'),('${B}','bob');
      insert into posts (id, author_id, body, is_premium) values ('00000000-0000-0000-0000-0000000000a1','${A}','teaser',true);
      insert into post_premium_content (post_id, body) values ('00000000-0000-0000-0000-0000000000a1','secret');
      insert into products (id, post_id, seller_id, price, asset) values ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000a1','${A}',5,'USDC');
      insert into purchases (product_id, buyer_id, seller_id, intent_id, amount, fee, asset) values ('00000000-0000-0000-0000-0000000000b1','${B}','${A}','00000000-0000-0000-0000-0000000000c1',5,0.125,'USDC');`);
    for (let i = 0; i < 3; i++) await db.query(`select confirm_purchase('00000000-0000-0000-0000-0000000000c1','hash')`);
    expect((await db.query<{ n: number }>("select count(*)::int n from entitlements")).rows[0].n).toBe(1);
    expect((await db.query<{ n: number }>("select count(*)::int n from notifications")).rows[0].n).toBe(1);
    await db.exec(`update posts set status = 'removed' where id = '00000000-0000-0000-0000-0000000000a1'`);

    // RLS: a buyer keeps purchased content after creator removal; a stranger
    // cannot read it; nobody reads private identity; no client writes.
    await db.exec(`set role authenticated; select set_config('request.jwt.claims', '{"sub":"${B}"}', false);`);
    expect((await db.query<{ n: number }>("select count(*)::int n from post_premium_content")).rows[0].n).toBe(1);
    expect((await db.query<{ n: number }>("select count(*)::int n from profile_private")).rows[0].n).toBe(0);
    await db.exec(`select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000009"}', false);`);
    expect((await db.query<{ n: number }>("select count(*)::int n from post_premium_content")).rows[0].n).toBe(0);
    expect((await db.query<{ n: number }>("select count(*)::int n from entitlements")).rows[0].n).toBe(0);
    await expect(db.exec(`insert into likes values ('00000000-0000-0000-0000-0000000000a1','${B}')`)).rejects.toThrow(/permission denied/);
  });

  it("payment requests: request messages allowed, clients cannot read or write requests", async () => {
    const db = await freshDb();
    await db.exec(`insert into profiles (id, username) values ('${A}','alice'),('${B}','bob');
      insert into conversations (id, kind, dm_key) values ('00000000-0000-0000-0000-0000000000e1','dm','k');
      insert into messages (id, conversation_id, sender_id, kind, body) values ('00000000-0000-0000-0000-0000000000e2','00000000-0000-0000-0000-0000000000e1','${A}','request','lunch');
      insert into payment_requests (conversation_id, message_id, requester_id, payer_id, asset, amount) values ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000e2','${A}','${B}','USDC',12.5);`);
    await expect(db.exec(`insert into payment_requests (conversation_id, requester_id, payer_id, asset, amount) values ('00000000-0000-0000-0000-0000000000e1','${A}','${A}','USDC',1)`)).rejects.toThrow();
    await expect(db.exec(`insert into payment_requests (conversation_id, requester_id, payer_id, asset, amount) values ('00000000-0000-0000-0000-0000000000e1','${A}','${B}','USDC',0)`)).rejects.toThrow();
    await db.exec(`set role authenticated; select set_config('request.jwt.claims', '{"sub":"${B}"}', false);`);
    await expect(db.query("select * from payment_requests")).rejects.toThrow(/permission denied/);
  });

  it("tracks message request payments as their own workflow", async () => {
    const db = await freshDb();
    await db.exec(`insert into workflow_runs (workflow_key, provider, status) values ('REQUEST', 'stellar', 'prepared')`);
    expect((await db.query<{ workflow_key: string }>("select workflow_key from workflow_runs")).rows[0].workflow_key).toBe("REQUEST");
    await expect(db.exec(`insert into workflow_runs (workflow_key, provider) values ('UNKNOWN', 'stellar')`)).rejects.toThrow();
  });

  it("tips confirm once and rate limiter counts per window", async () => {
    const db = await freshDb();
    await db.exec(`insert into profiles (id, username) values ('${A}','alice'),('${B}','bob');
      insert into tips (from_id, to_id, intent_id, amount, fee, asset) values ('${B}','${A}','00000000-0000-0000-0000-0000000000d1',1,0.025,'USDC');`);
    const first = await db.query<{ id: string | null }>(`select confirm_tip('00000000-0000-0000-0000-0000000000d1','h') id`);
    const second = await db.query<{ id: string | null }>(`select confirm_tip('00000000-0000-0000-0000-0000000000d1','h') id`);
    expect(first.rows[0].id).not.toBeNull();
    expect(second.rows[0].id).toBeNull();
    const r = await db.query<{ a: boolean; b: boolean; c: boolean }>("select rate_limit_hit('k',60,2) a, rate_limit_hit('k',60,2) b, rate_limit_hit('k',60,2) c");
    expect(r.rows[0]).toEqual({ a: true, b: true, c: false });
  });
});

describe("review fixes", () => {
  it("hides tx XDR and Privy wallet ids from clients", async () => {
    const db = await freshDb();
    await db.exec(`insert into profiles (id, username) values ('${A}','alice');
      insert into linked_wallets (profile_id, address, network, privy_wallet_id) values ('${A}','GCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYOJR','testnet','pw_1');
      insert into tx_intents (profile_id, kind, network, source_address, tx_hash, xdr, expires_at) values ('${A}','payment','testnet','G','h1','SECRETXDR', now());`);
    await db.exec(`set role authenticated; select set_config('request.jwt.claims', '{"sub":"${A}"}', false);`);
    expect((await db.query<{ status: string }>("select status from tx_intents")).rows[0].status).toBe("prepared");
    await expect(db.query("select xdr from tx_intents")).rejects.toThrow(/permission denied/);
    expect((await db.query<{ address: string }>("select address from linked_wallets")).rows).toHaveLength(1);
    await expect(db.query("select privy_wallet_id from linked_wallets")).rejects.toThrow(/permission denied/);
  });

  it("records a second paid purchase as a duplicate instead of failing forever", async () => {
    const db = await freshDb();
    await db.exec(`
      insert into profiles (id, username) values ('${A}','alice'),('${B}','bob');
      insert into posts (id, author_id, body, is_premium) values ('00000000-0000-0000-0000-0000000000a1','${A}','t',true);
      insert into products (id, post_id, seller_id, price, asset) values ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000a1','${A}',5,'USDC');
      insert into purchases (product_id, buyer_id, seller_id, intent_id, amount, fee, asset) values
        ('00000000-0000-0000-0000-0000000000b1','${B}','${A}','00000000-0000-0000-0000-0000000000c1',5,0,'USDC'),
        ('00000000-0000-0000-0000-0000000000b1','${B}','${A}','00000000-0000-0000-0000-0000000000c2',5,0,'USDC');`);
    await db.query(`select confirm_purchase('00000000-0000-0000-0000-0000000000c1','h1')`);
    await db.query(`select confirm_purchase('00000000-0000-0000-0000-0000000000c2','h2')`);
    const st = await db.query<{ status: string }>("select status from purchases order by intent_id");
    expect(st.rows.map((r) => r.status)).toEqual(["confirmed", "duplicate"]);
    expect((await db.query<{ n: number }>("select count(*)::int n from entitlements")).rows[0].n).toBe(1);
  });

  it("confirms a purchase that was marked failed during indexer lag", async () => {
    const db = await freshDb();
    await db.exec(`
      insert into profiles (id, username) values ('${A}','alice'),('${B}','bob');
      insert into posts (id, author_id, body, is_premium) values ('00000000-0000-0000-0000-0000000000a1','${A}','t',true);
      insert into products (id, post_id, seller_id, price, asset) values ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000a1','${A}',5,'USDC');
      insert into purchases (product_id, buyer_id, seller_id, intent_id, amount, fee, asset, status) values
        ('00000000-0000-0000-0000-0000000000b1','${B}','${A}','00000000-0000-0000-0000-0000000000c1',5,0,'USDC','failed');`);
    await db.query(`select confirm_purchase('00000000-0000-0000-0000-0000000000c1','h1')`);
    expect((await db.query<{ n: number }>("select count(*)::int n from entitlements")).rows[0].n).toBe(1);
  });
});
