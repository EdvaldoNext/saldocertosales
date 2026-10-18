import type { Client, Row } from "@libsql/client";
import { str, strOrNull } from "./db";

/** Periodo liberado apos cada pagamento approved (nao ha cobranca automatica). */
export const PERIOD_DAYS = 30;
/** Validade da sessao de checkout. */
export const CHECKOUT_SESSION_DAYS = 7;

/** Aceita tanto o Client quanto uma Transaction do libSQL. */
export type Executor = { execute: Client["execute"] };

export interface CheckoutSessionRow {
  id: string;
  token: string;
  plan_id: string;
  preference_id: string | null;
  status: "pending" | "paid" | "expired" | "linked";
  user_id: string | null;
  subscription_id: string | null;
}

export interface SubscriptionRow {
  id: string;
  user_id: string | null;
  status: string;
  preference_id: string | null;
}

function toSession(row: Row): CheckoutSessionRow {
  return {
    id: str(row, "id"),
    token: str(row, "token"),
    plan_id: str(row, "plan_id"),
    preference_id: strOrNull(row, "preference_id"),
    status: str(row, "status") as CheckoutSessionRow["status"],
    user_id: strOrNull(row, "user_id"),
    subscription_id: strOrNull(row, "subscription_id"),
  };
}

function toSubscription(row: Row): SubscriptionRow {
  return {
    id: str(row, "id"),
    user_id: strOrNull(row, "user_id"),
    status: str(row, "status"),
    preference_id: strOrNull(row, "preference_id"),
  };
}

const SESSION_COLS = "id, token, plan_id, preference_id, status, user_id, subscription_id";
const SUB_COLS = "id, user_id, status, preference_id";

export async function findSessionByToken(ex: Executor, token: string): Promise<CheckoutSessionRow | null> {
  const r = await ex.execute({ sql: `SELECT ${SESSION_COLS} FROM checkout_sessions WHERE token = ?`, args: [token] });
  return r.rows[0] ? toSession(r.rows[0]) : null;
}

export async function findSessionByPreference(ex: Executor, preferenceId: string): Promise<CheckoutSessionRow | null> {
  const r = await ex.execute({
    sql: `SELECT ${SESSION_COLS} FROM checkout_sessions WHERE preference_id = ? ORDER BY created_at DESC LIMIT 1`,
    args: [preferenceId],
  });
  return r.rows[0] ? toSession(r.rows[0]) : null;
}

export async function findSubscriptionById(ex: Executor, id: string): Promise<SubscriptionRow | null> {
  const r = await ex.execute({ sql: `SELECT ${SUB_COLS} FROM subscriptions WHERE id = ?`, args: [id] });
  return r.rows[0] ? toSubscription(r.rows[0]) : null;
}

export async function findOpenSubscriptionByUser(ex: Executor, userId: string): Promise<SubscriptionRow | null> {
  const r = await ex.execute({
    sql: `SELECT ${SUB_COLS} FROM subscriptions
          WHERE user_id = ? AND status IN ('pending', 'active', 'past_due')
          ORDER BY created_at DESC LIMIT 1`,
    args: [userId],
  });
  return r.rows[0] ? toSubscription(r.rows[0]) : null;
}

export async function findSubscriptionByPreference(ex: Executor, preferenceId: string): Promise<SubscriptionRow | null> {
  const r = await ex.execute({
    sql: `SELECT ${SUB_COLS} FROM subscriptions WHERE preference_id = ? ORDER BY created_at DESC LIMIT 1`,
    args: [preferenceId],
  });
  return r.rows[0] ? toSubscription(r.rows[0]) : null;
}

const OPEN = new Set(["pending", "active", "past_due"]);

/** Ordem do webhook: subscription_id da sessao -> user_id com status aberto -> preference_id. */
export async function findSubscriptionForSession(
  ex: Executor,
  session: CheckoutSessionRow,
  paymentPreferenceId?: string | null,
): Promise<SubscriptionRow | null> {
  const byId = session.subscription_id ? await findSubscriptionById(ex, session.subscription_id) : null;
  if (byId && OPEN.has(byId.status)) return byId;

  const byUser = session.user_id ? await findOpenSubscriptionByUser(ex, session.user_id) : null;
  if (byUser) return byUser;

  // Assinatura da sessao que nao esta mais aberta (cancelada/expirada) e o usuario nao tem outra: reabre.
  if (byId) return byId;

  const pref = session.preference_id || paymentPreferenceId;
  return pref ? findSubscriptionByPreference(ex, pref) : null;
}
