import type { Row } from "@libsql/client";
import type { NextResponse } from "next/server";
import type { AuthUser, BillingMe, PlanInfo, SubscriptionInfo, SubscriptionStatus } from "@/lib/types";
import { db, str, strOrNull } from "./db";
import { isAdminEmail } from "./env";
import { fail } from "./http";

/** Tolerancia depois do vencimento: 3 dias SO quando o status e past_due. Em active e zero. */
export const PAST_DUE_GRACE_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_PLAN_SLUG = "basic_monthly";

interface OpenSubscriptionRow {
  id: string;
  status: SubscriptionStatus;
  current_period_end: string | null;
  plan: PlanInfo | null;
}

/** Assinatura aberta (pending, active ou past_due) mais recente do usuario. */
export async function getOpenSubscription(userId: string): Promise<OpenSubscriptionRow | null> {
  const result = await db().execute({
    sql: `SELECT s.id, s.status, s.current_period_end, p.slug, p.name, p.price_brl, p.billing_interval
          FROM subscriptions s
          LEFT JOIN plans p ON p.id = s.plan_id
          WHERE s.user_id = ? AND s.status IN ('pending', 'active', 'past_due')
          ORDER BY s.created_at DESC
          LIMIT 1`,
    args: [userId],
  });
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: str(row, "id"),
    status: str(row, "status") as SubscriptionStatus,
    current_period_end: strOrNull(row, "current_period_end"),
    plan: row.slug
      ? {
          slug: str(row, "slug"),
          name: str(row, "name"),
          price_brl: Number(row.price_brl),
          billing_interval: str(row, "billing_interval") === "year" ? "year" : "month",
        }
      : null,
  };
}

/** Fim do acesso: fim do periodo + tolerancia (3 dias so em past_due). Null se nao ha periodo. */
export function accessEndsAt(status: SubscriptionStatus, currentPeriodEnd: string | null): number | null {
  if (!currentPeriodEnd) return null;
  const end = Date.parse(currentPeriodEnd);
  if (Number.isNaN(end)) return null;
  return status === "past_due" ? end + PAST_DUE_GRACE_DAYS * DAY_MS : end;
}

/** Regra pura de acesso de uma assinatura (sem admin). */
export function subscriptionGrantsAccess(
  sub: { status: SubscriptionStatus; current_period_end: string | null } | null,
  now = Date.now(),
): boolean {
  if (!sub) return false;
  if (sub.status !== "active" && sub.status !== "past_due") return false;
  const until = accessEndsAt(sub.status, sub.current_period_end);
  return until !== null && until > now;
}

type ActivePlan = PlanInfo & { id: string; billing_interval: "month" | "year" };

function toActivePlan(row: Row): ActivePlan | null {
  const price = Number(row.price_brl);
  if (!Number.isFinite(price) || price <= 0) return null;
  return {
    id: str(row, "id"),
    slug: str(row, "slug"),
    name: str(row, "name"),
    price_brl: price,
    billing_interval: str(row, "billing_interval") === "year" ? "year" : "month",
  };
}

/** Plano ativo com preco > 0 (ou null). O preco SEMPRE vem do banco. */
export async function getActivePlan(slug: string): Promise<ActivePlan | null> {
  const result = await db().execute({
    sql: "SELECT id, slug, name, price_brl, billing_interval FROM plans WHERE slug = ? AND active = 1",
    args: [slug],
  });
  const row = result.rows[0];
  return row ? toActivePlan(row) : null;
}

/** Planos pagos ativos. Mensal primeiro, anual depois. */
export async function listActivePlans(): Promise<ActivePlan[]> {
  const result = await db().execute(
    `SELECT id, slug, name, price_brl, billing_interval
     FROM plans
     WHERE active = 1 AND price_brl > 0
     ORDER BY CASE billing_interval WHEN 'year' THEN 1 ELSE 0 END, price_brl`,
  );
  return result.rows.flatMap((row) => {
    const plan = toActivePlan(row);
    return plan ? [plan] : [];
  });
}

export async function isSubscriptionActive(user: AuthUser): Promise<boolean> {
  if (isAdminEmail(user.email)) return true;
  const sub = await getOpenSubscription(user.id);
  return subscriptionGrantsAccess(sub);
}

/** Trava das rotas de despesa: devolve a resposta 402 se nao ha acesso, senao null. */
export async function subscriptionGuard(user: AuthUser): Promise<NextResponse | null> {
  if (await isSubscriptionActive(user)) return null;
  return fail(402, "subscription_required");
}

/** Corpo de GET /api/billing/me. */
export async function buildBillingMe(user: AuthUser): Promise<BillingMe> {
  const isAdmin = isAdminEmail(user.email);
  const [sub, plans] = await Promise.all([getOpenSubscription(user.id), listActivePlans()]);
  const access = isAdmin || subscriptionGrantsAccess(sub);
  const monthly = plans.find((p) => p.slug === DEFAULT_PLAN_SLUG) ?? null;

  let subscription: SubscriptionInfo | null = null;
  if (sub) {
    const until = accessEndsAt(sub.status, sub.current_period_end);
    subscription = {
      status: sub.status,
      current_period_end: sub.current_period_end,
      access_until: until === null ? null : new Date(until).toISOString(),
      plan: sub.plan,
    };
  }

  return {
    access,
    isAdmin,
    plan: monthly ? { slug: monthly.slug, name: monthly.name, price_brl: monthly.price_brl } : null,
    plans: plans.map(({ slug, name, price_brl, billing_interval }) => ({ slug, name, price_brl, billing_interval })),
    subscription,
  };
}
