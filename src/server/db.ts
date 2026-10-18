import { createClient, type Client, type Row } from "@libsql/client";
import { randomUUID } from "node:crypto";

const globalForDb = globalThis as unknown as { __saldocertoDb?: Client };

/** Cliente Turso (libSQL). Usado SOMENTE no servidor. */
export function db(): Client {
  if (!globalForDb.__saldocertoDb) {
    const url = process.env.TURSO_DATABASE_URL;
    if (!url) throw new Error("TURSO_DATABASE_URL nao definido.");
    globalForDb.__saldocertoDb = createClient({
      url,
      authToken: process.env.TURSO_AUTH_TOKEN || undefined,
    });
  }
  return globalForDb.__saldocertoDb;
}

export function uuid(): string {
  return randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function addDaysIso(days: number, from: Date = new Date()): string {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

/** Soma meses no calendario UTC (31/01 + 1 mes cai no ultimo dia de fevereiro). */
export function addMonthsIso(months: number, from: Date = new Date()): string {
  const d = new Date(from.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d.toISOString();
}

export function str(row: Row, key: string): string {
  return String(row[key]);
}

export function strOrNull(row: Row, key: string): string | null {
  const v = row[key];
  return v === null || v === undefined ? null : String(v);
}

/** Violacao de UNIQUE no SQLite (equivale ao 23505 do Postgres). */
export function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; message?: string; cause?: { code?: string; message?: string } } | null;
  const text = `${e?.code ?? ""} ${e?.message ?? ""} ${e?.cause?.code ?? ""} ${e?.cause?.message ?? ""}`;
  return /SQLITE_CONSTRAINT(_UNIQUE|_PRIMARYKEY)?|UNIQUE constraint failed/i.test(text);
}
