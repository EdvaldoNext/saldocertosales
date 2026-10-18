import { addDaysIso, db, isUniqueViolation, nowIso, uuid } from "@/server/db";
import {
  findSessionByPreference,
  findSessionByToken,
  findSubscriptionForSession,
  PERIOD_DAYS,
  type CheckoutSessionRow,
} from "@/server/billing";
import { fail, json } from "@/server/http";
import { getPayment, verifyMpSignature, type MpPayment } from "@/server/mercadopago";

/** Webhook publico do Mercado Pago (topico `payment`). Quem decide o acesso e a API do MP, nao o body. */
export async function POST(req: Request) {
  // 1. Body cru (a assinatura usa esses bytes).
  const raw = await req.text();

  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[webhook] MERCADOPAGO_WEBHOOK_SECRET nao definido.");
    return fail(500, "webhook_not_configured");
  }

  let parsed: Record<string, unknown> = {};
  let bodyIsJson = false;
  try {
    const value = raw ? JSON.parse(raw) : {};
    if (value && typeof value === "object" && !Array.isArray(value)) {
      parsed = value as Record<string, unknown>;
      bodyIsJson = true;
    }
  } catch {
    bodyIsJson = false;
  }

  const url = new URL(req.url);
  const bodyData = (parsed.data && typeof parsed.data === "object" ? parsed.data : {}) as Record<string, unknown>;
  const dataId = String(url.searchParams.get("data.id") ?? bodyData.id ?? "").trim();

  // 2. x-signature invalida: 401 e nao ativa nada.
  if (!verifyMpSignature(req.headers, dataId, secret)) {
    return fail(401, "invalid_signature");
  }

  const topic = String(parsed.type ?? parsed.topic ?? url.searchParams.get("type") ?? url.searchParams.get("topic") ?? "");
  const action = String(parsed.action ?? "");
  const isPayment = topic === "payment" || action.startsWith("payment.");

  // 3. Grava o evento antes de ativar. mp_event_id UNIQUE: duplicata -> sucesso e para.
  const eventId = dataId || req.headers.get("x-request-id") || "";
  if (!eventId) return fail(400, "missing_event_id");
  const dbEventRowId = uuid();
  try {
    await db().execute({
      sql: "INSERT INTO billing_events (id, mp_event_id, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?)",
      args: [
        dbEventRowId,
        eventId,
        topic || action || "unknown",
        bodyIsJson ? raw : JSON.stringify({ raw: raw.slice(0, 2000) }),
        nowIso(),
      ],
    });
  } catch (error) {
    if (isUniqueViolation(error)) return json({ ok: true, duplicate: true });
    console.error("[webhook] falha ao gravar evento:", error);
    return fail(500, "internal_error");
  }

  const release = () =>
    db()
      .execute({ sql: "DELETE FROM billing_events WHERE id = ?", args: [dbEventRowId] })
      .catch((e) => console.error("[webhook] falha ao liberar evento:", e));

  // 4. So segue se for payment com data.id. O resto do body nao decide acesso.
  if (!isPayment || !dataId) return json({ ok: true, ignored: true });

  try {
    // 5-6. Confirma na API. So `approved` libera.
    const payment = await getPayment(dataId);
    if (payment.status !== "approved") {
      // pending / in_process / rejected nao mudam o acesso. Libera o evento para que uma
      // notificacao posterior do mesmo pagamento (ja approved) nao seja descartada como duplicata.
      await release();
      return json({ ok: true, ignored: true, payment_status: payment.status ?? null });
    }

    const result = await activateApprovedPayment(payment);
    if (!result.activated) console.warn("[webhook] pagamento approved sem sessao de checkout:", dataId);
    // 9. Resposta.
    return json({ ok: true });
  } catch (error) {
    // Falha transitoria (ex.: API do MP fora): libera o evento e pede retry ao Mercado Pago.
    console.error("[webhook] falha ao processar pagamento:", error);
    await release();
    return fail(500, "internal_error");
  }
}

async function activateApprovedPayment(payment: MpPayment): Promise<{ activated: boolean }> {
  const reference = payment.external_reference ? String(payment.external_reference) : "";
  const preferenceId = payment.preference_id ? String(payment.preference_id) : "";

  const now = nowIso();
  const tx = await db().transaction("write");
  try {
    // 7. Sessao por external_reference (token) e, em seguida, por preference_id.
    let session: CheckoutSessionRow | null = reference ? await findSessionByToken(tx, reference) : null;
    if (!session && preferenceId) session = await findSessionByPreference(tx, preferenceId);
    if (!session) {
      await tx.rollback();
      return { activated: false };
    }

    // Sessao -> paid (se ja foi vinculada a conta, continua linked).
    await tx.execute({
      sql: `UPDATE checkout_sessions
            SET status = CASE WHEN status = 'linked' THEN 'linked' ELSE 'paid' END, updated_at = ?
            WHERE id = ?`,
      args: [now, session.id],
    });

    // 8. Assinatura -> active, fim = agora + 30 dias (NAO soma sobre o fim anterior).
    const periodEnd = addDaysIso(PERIOD_DAYS);
    const sub = await findSubscriptionForSession(tx, session, preferenceId);
    if (sub) {
      await tx.execute({
        sql: `UPDATE subscriptions
              SET status = 'active', current_period_end = ?, checkout_session_id = ?, canceled_at = NULL, updated_at = ?
              WHERE id = ?`,
        args: [periodEnd, session.id, now, sub.id],
      });
      await tx.execute({
        sql: "UPDATE checkout_sessions SET subscription_id = ? WHERE id = ? AND subscription_id IS NULL",
        args: [sub.id, session.id],
      });
    } else if (session.user_id) {
      // Defesa: sessao paga de um usuario que ficou sem assinatura aberta.
      const subId = uuid();
      await tx.execute({
        sql: `INSERT INTO subscriptions
                (id, user_id, plan_id, status, preference_id, checkout_session_id, current_period_end, created_at, updated_at)
              VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
        args: [subId, session.user_id, session.plan_id, session.preference_id, session.id, periodEnd, now, now],
      });
      await tx.execute({
        sql: "UPDATE checkout_sessions SET subscription_id = ? WHERE id = ?",
        args: [subId, session.id],
      });
    }
    await tx.commit();
    return { activated: true };
  } catch (error) {
    await tx.rollback().catch(() => {});
    throw error;
  } finally {
    tx.close();
  }
}
