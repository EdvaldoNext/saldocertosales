import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";
import type { AuthUser } from "@/lib/types";
import { isProduction, jwtSecret } from "./env";
import { db, nowIso, str, uuid } from "./db";
import { fail } from "./http";
import type { NextResponse } from "next/server";

export const SESSION_COOKIE = "saldocerto_session";
export const SESSION_DAYS = 30;
const SESSION_SECONDS = SESSION_DAYS * 24 * 60 * 60;
/** Renova o token no uso se ele tem mais que isso (evita regravar a cada request). */
const RENEW_AFTER_SECONDS = 7 * 24 * 60 * 60;

export const MIN_PASSWORD_LENGTH = 8;

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// ---------- senha ----------

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

let dummyHash: string | null = null;
/** Hash descartavel para gastar o mesmo tempo quando o e-mail nao existe (nao vaza existencia da conta). */
export async function burnPasswordCheck(password: string): Promise<void> {
  if (!dummyHash) dummyHash = bcrypt.hashSync("saldocerto-dummy-password", 10);
  await bcrypt.compare(password, dummyHash);
}

// ---------- token / sessao ----------

async function signToken(userId: string, sessionId: string): Promise<{ token: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000);
  const token = await new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(jwtSecret());
  return { token, expiresAt };
}

/** Cria a linha em `sessions` e devolve o JWT assinado. */
export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const sessionId = uuid();
  const { token, expiresAt } = await signToken(userId, sessionId);
  await db().execute({
    sql: "INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
    args: [sessionId, userId, sha256Hex(token), expiresAt.toISOString(), nowIso()],
  });
  return { token, expiresAt };
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: isProduction(),
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: isProduction(),
    maxAge: 0,
  });
}

export interface Session {
  user: AuthUser;
  sessionId: string;
  token: string;
  issuedAt: number; // epoch seconds
  viaBearer: boolean;
}

async function readToken(req: Request, allowBearer: boolean): Promise<{ token: string; viaBearer: boolean } | null> {
  if (allowBearer) {
    const header = req.headers.get("authorization") || "";
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (match) return { token: match[1].trim(), viaBearer: true };
  }
  const jar = await cookies();
  const value = jar.get(SESSION_COOKIE)?.value;
  return value ? { token: value, viaBearer: false } : null;
}

/** Valida JWT + linha em `sessions` (hash do token e expiracao). Null se invalida. */
export async function getSession(req: Request, opts: { allowBearer?: boolean } = {}): Promise<Session | null> {
  const found = await readToken(req, Boolean(opts.allowBearer));
  if (!found) return null;

  let sub: string;
  let sid: string;
  let iat: number;
  try {
    const { payload } = await jwtVerify(found.token, jwtSecret(), { algorithms: ["HS256"] });
    sub = String(payload.sub || "");
    sid = String(payload.sid || "");
    iat = Number(payload.iat || 0);
    if (!sub || !sid) return null;
  } catch {
    return null;
  }

  const result = await db().execute({
    sql: `SELECT s.id AS sid, s.user_id, s.token_hash, s.expires_at, u.email
          FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.id = ?`,
    args: [sid],
  });
  const row = result.rows[0];
  if (!row) return null;
  if (str(row, "user_id") !== sub) return null;
  if (str(row, "token_hash") !== sha256Hex(found.token)) return null;
  if (Date.parse(str(row, "expires_at")) <= Date.now()) {
    await db().execute({ sql: "DELETE FROM sessions WHERE id = ?", args: [sid] });
    return null;
  }

  return {
    user: { id: sub, email: str(row, "email") },
    sessionId: sid,
    token: found.token,
    issuedAt: iat,
    viaBearer: found.viaBearer,
  };
}

/**
 * Renovacao no uso: se o token tem mais de 7 dias, emite outro (mais 30 dias) e grava o novo hash.
 * Compare-and-swap no hash antigo para nao brigar com requests concorrentes.
 */
export async function renewSessionIfNeeded(session: Session): Promise<void> {
  if (session.viaBearer) return;
  const age = Math.floor(Date.now() / 1000) - session.issuedAt;
  if (age < RENEW_AFTER_SECONDS) return;

  const { token, expiresAt } = await signToken(session.user.id, session.sessionId);
  const result = await db().execute({
    sql: "UPDATE sessions SET token_hash = ?, expires_at = ? WHERE id = ? AND token_hash = ?",
    args: [sha256Hex(token), expiresAt.toISOString(), session.sessionId, sha256Hex(session.token)],
  });
  if (result.rowsAffected > 0) await setSessionCookie(token, expiresAt);
}

export async function destroySession(sessionId: string): Promise<void> {
  await db().execute({ sql: "DELETE FROM sessions WHERE id = ?", args: [sessionId] });
}

export async function destroyUserSessions(userId: string): Promise<void> {
  await db().execute({ sql: "DELETE FROM sessions WHERE user_id = ?", args: [userId] });
}

/** Uso: const auth = await requireSession(req); if (auth instanceof Response) return auth; */
export async function requireSession(
  req: Request,
  opts: { allowBearer?: boolean } = {},
): Promise<Session | NextResponse> {
  const session = await getSession(req, opts);
  if (!session) return fail(401, "unauthorized");
  return session;
}
