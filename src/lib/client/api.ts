"use client";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public extra?: Record<string, unknown>) {
    super(message);
  }
}

export type TokenGetter = () => Promise<string | null>;

/** JSON fetch against our own API with the Privy access token. */
export async function apiFetch<T>(getToken: TokenGetter | null, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = getToken ? await getToken() : null;
  const res = await fetch(path, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    headers: { ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const json = (await res.json().catch(() => null)) as { data?: T; error?: { code: string; message: string } & Record<string, unknown> } | null;
  if (!res.ok || !json || json.error) {
    throw new ApiError(res.status, json?.error?.code ?? "HTTP", json?.error?.message ?? `Request failed (${res.status})`, json?.error);
  }
  return json.data as T;
}
