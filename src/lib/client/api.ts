"use client";

import { FriendlyError, friendlyError, logError } from "./errors";

/**
 * Thrown for every failed request. `message` is always written for a person;
 * the technical text lives on `friendly.detail`.
 */
export class ApiError extends FriendlyError {
  constructor(public status: number, code: string, message: string, public extra?: Record<string, unknown>) {
    super(friendlyError(new Error(message), { status }), status);
    this.name = "ApiError";
    this.code = code || this.friendly.code;
  }
}

export type TokenGetter = () => Promise<string | null>;

/** JSON fetch against our own API with the Privy access token. */
export async function apiFetch<T>(getToken: TokenGetter | null, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    const token = getToken ? await getToken() : null;
    res = await fetch(path, {
      method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
      headers: { ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
  } catch (e) {
    // The request never reached us: offline, blocked, or the connection dropped.
    const err = new ApiError(0, "NETWORK", (e as Error)?.message || "Failed to fetch");
    logError(path, err.friendly);
    throw err;
  }
  const json = (await res.json().catch(() => null)) as { data?: T; error?: { code: string; message: string } & Record<string, unknown> } | null;
  if (!res.ok || !json || json.error) {
    const err = new ApiError(res.status, json?.error?.code ?? "HTTP", json?.error?.message ?? `Request failed (${res.status})`, json?.error);
    if (res.status >= 500 || !json) logError(path, err.friendly, { status: res.status });
    throw err;
  }
  return json.data as T;
}
