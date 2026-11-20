import "server-only";
import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import { AmountError } from "@/lib/stellar/amount";
import { TxBuildError } from "@/lib/stellar/tx";
import { ConfigError, env } from "./env";
import { DbError, db } from "./supabase";

export class HttpError extends Error {
  constructor(public status: number, message: string, public code = "ERROR", public extra?: Record<string, unknown>) {
    super(message);
  }
}

export const bad = (msg: string, code = "VALIDATION") => new HttpError(422, msg, code);
export const forbidden = (msg = "Not allowed") => new HttpError(403, msg, "FORBIDDEN");
export const notFound = (msg = "Not found") => new HttpError(404, msg, "NOT_FOUND");
export const conflict = (msg: string) => new HttpError(409, msg, "CONFLICT");

export function ok(data: unknown, init?: ResponseInit) {
  return NextResponse.json({ data }, { ...init, headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) } });
}

function errorResponse(e: unknown) {
  if (e instanceof HttpError) return NextResponse.json({ error: { code: e.code, message: e.message, ...e.extra } }, { status: e.status });
  if (e instanceof ZodError) return NextResponse.json({ error: { code: "VALIDATION", message: e.issues[0]?.message ?? "Invalid input" } }, { status: 422 });
  if (e instanceof AmountError) return NextResponse.json({ error: { code: "VALIDATION", message: e.message } }, { status: 422 });
  if (e instanceof TxBuildError) return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: 422 });
  if (e instanceof ConfigError) return NextResponse.json({ error: { code: "NOT_CONFIGURED", message: e.message, missing: e.missing } }, { status: 503 });
  if (e instanceof DbError) {
    if (e.code === "23505") return NextResponse.json({ error: { code: "CONFLICT", message: "Already exists." } }, { status: 409 });
    console.error("[db]", e.code, e.message);
    return NextResponse.json({ error: { code: "DB", message: "Database error." } }, { status: 500 });
  }
  console.error("[api]", e);
  return NextResponse.json({ error: { code: "INTERNAL", message: "Something went wrong." } }, { status: 500 });
}

type Handler<C> = (req: NextRequest, ctx: C) => Promise<Response>;

/**
 * Wraps a route: uniform errors, and same-origin enforcement for state-changing
 * requests (defense in depth on top of bearer-token auth, which is CSRF-immune).
 */
export function route<C>(h: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) assertSameOrigin(req);
      return await h(req, ctx);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

function assertSameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (!origin) return; // non-browser clients (cron, curl) carry no Origin; they still need auth
  const allowed = new Set([new URL(env().NEXT_PUBLIC_APP_URL).origin, req.nextUrl.origin]);
  if (!allowed.has(origin)) throw forbidden("Cross-origin request blocked");
}

export async function body<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  const text = await req.text();
  if (text.length > 200_000) throw bad("Request too large");
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw bad("Invalid JSON");
  }
  return schema.parse(json);
}

export function clientIp(req: NextRequest) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

export function ipHash(req: NextRequest) {
  return createHash("sha256").update(`${env().IP_HASH_SALT ?? "senda"}:${clientIp(req)}`).digest("hex").slice(0, 32);
}

/** Fixed-window limiter backed by Postgres (works across serverless instances). */
export async function rateLimit(key: string, max: number, windowSeconds: number) {
  const { data, error } = await db().rpc("rate_limit_hit", { p_key: key, p_window_seconds: windowSeconds, p_max: max });
  if (error) {
    console.error("[ratelimit]", error.message);
    return; // fail open on limiter outage; money paths have their own DB constraints
  }
  if (data === false) throw new HttpError(429, "Too many requests. Please slow down.", "RATE_LIMITED");
}

export async function audit(actorId: string | null, action: string, entityType: string | null, entityId: string | null, data: Record<string, unknown> = {}, ip?: string) {
  await db().from("audit_logs").insert({ actor_id: actorId, action, entity_type: entityType, entity_id: entityId, data, ip_hash: ip ?? null });
}
