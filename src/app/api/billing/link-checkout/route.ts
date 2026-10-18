import { db, isUniqueViolation, nowIso, str, strOrNull } from "@/server/db";
import {
  findSessionByToken,
  findSubscriptionById,
  findSubscriptionByPreference,
  periodEndForPlan,
  type SubscriptionRow,
} from "@/server/billing";
import { asString, fail, json, readJson } from "@/server/http";
import { searchPaymentsByReference } from "@/server/mercadopago";
import { requireSession } from "@/server/session";

/** POST /api/billing/link-checkout { checkout_token } -> liga a sessao paga a conta logada. */
export async function POST(req: Request) {
  // Sem usuario: 401.
  const auth = await requireSession(req, { allowBearer: true });
  if (auth instanceof Response) return auth;
  const user = auth.user;

  const body = await readJson(req);
  if (!body) return fail(400, "invalid_body");
  const checkoutToken = asString(body.checkout_token).trim();
  if (!checkoutToken) return fail(400, "invalid_token");

  // 1. Sessao pelo token.
  const session = await findSessionByToken(db(), checkoutToken);
  if (!session) return fail(404, "checkout_not_found");
  if (session.status === "expired") return fail(410, "checkout_expired");
  if (session.user_id && session.user_id !== user.id) return fail(409, "checkout_belongs_to_other_account");
  if (session.status === "linked") return json({ ok: true, already_linked: true });

  // 2. Assinatura por subscription_id ou por preference_id.
  let sub: SubscriptionRow | null = session.subscription_id
    ? await findSubscriptionById(db(), session.subscription_id)
    : null;
  if (!sub && session.preference_id) sub = await findSubscriptionByPreference(db(), session.preference_id);
  if (!sub) return fail(404, "subscription_not_found");

  // 3. Assinatura de outra conta: 409.
  if (sub.user_id && sub.user_id !== user.id) return fail(409, "checkout_belongs_to_other_account");

  // 4. Pago = sessao ja paid, ou ha pagamento approved na busca por external_reference.
  let paid = session.status === "paid";
  if (!paid) {
    try {
      const payments = await searchPaymentsByReference(checkoutToken);
      paid = payments.some((p) => {
        if (p.status !== "approved") return false;
        // Se o resultado traz preference_id, precisa ser o da sessao.
        if (p.preference_id && session.preference_id && String(p.preference_id) !== session.preference_id) return false;
        return true;
      });
    } catch (error) {
      console.error("[link-checkout] falha na busca de pagamentos:", error);
    }
  }

  // 5-6. Atualiza assinatura e sessao.
  const now = nowIso();
  const tx = await db().transaction("write");
  try {
    const current = await tx.execute({
      sql: "SELECT status, current_period_end FROM subscriptions WHERE id = ?",
      args: [sub.id],
    });
    const currentStatus = str(current.rows[0], "status");
    const currentEnd = strOrNull(current.rows[0], "current_period_end");

    // Se o webhook ja ativou esta mesma sessao, mantem o periodo (evita deslocar o fim).
    const alreadyActivatedByWebhook = session.status === "paid" && currentStatus === "active" && Boolean(currentEnd);

    if (paid && !alreadyActivatedByWebhook) {
      await tx.execute({
        sql: `UPDATE subscriptions
              SET user_id = ?, checkout_session_id = ?, status = 'active',
                  current_period_end = CASE
                    WHEN current_period_end >= '9000-01-01' THEN current_period_end
                    ELSE ?
                  END,
                  canceled_at = NULL, updated_at = ?
              WHERE id = ?`,
        args: [user.id, session.id, await periodEndForPlan(tx, session.plan_id), now, sub.id],
      });
    } else {
      await tx.execute({
        sql: "UPDATE subscriptions SET user_id = ?, checkout_session_id = ?, updated_at = ? WHERE id = ?",
        args: [user.id, session.id, now, sub.id],
      });
    }

    await tx.execute({
      sql: "UPDATE checkout_sessions SET user_id = ?, status = ?, subscription_id = ?, updated_at = ? WHERE id = ?",
      args: [user.id, paid ? "linked" : session.status, sub.id, now, session.id],
    });
    await tx.commit();
  } catch (error) {
    await tx.rollback().catch(() => {});
    if (isUniqueViolation(error)) return fail(409, "subscription_conflict");
    console.error("[link-checkout] falha ao vincular:", error);
    return fail(500, "internal_error");
  } finally {
    tx.close();
  }

  return json({ ok: true, subscription_id: sub.id, paid });
}
