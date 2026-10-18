import { NextResponse } from "next/server";

export function json(body: unknown, status = 200, headers?: Record<string, string>): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

export function fail(status: number, error: string, message?: string): NextResponse {
  return json(message ? { error, message } : { error }, status);
}

/** Le o corpo JSON. Devolve objeto ou null se invalido. */
export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function normalizeEmail(value: unknown): string {
  return asString(value).trim().toLowerCase();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return email.length <= 254 && EMAIL_RE.test(email);
}
