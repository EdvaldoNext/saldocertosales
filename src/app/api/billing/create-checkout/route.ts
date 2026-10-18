import { getActivePlan } from "@/server/access";
import { addDaysIso, db, nowIso, uuid } from "@/server/db";
import { appUrl } from "@/server/env";
import { asString, fail, isValidEmail, json, normalizeEmail, readJson } from "@/server/http";
import { CHECKOUT_SESSION_DAYS, findOpenSubscriptionByUser } from "@/server/billing";
import { mpFetch } from "@/server/mercadopago";
import { requireSession } from "@/server/session";

interface MpPreference {
  id?: string;
  init_point?: string;
  sandbox_init_point?: string;
}

/** POST /api/billing/create-checkout { plan_slug, payer_email } -> { init_point, checkout_token, preference_id } */
export async function POST(req: Request) {
  const auth = await requireSession(req, { allowBearer: true });
  if (auth instanceof Response) return auth;
  const user = auth.user;

  const body = await readJson(req);
  if (!body) return fail(400, "invalid_body");

  // 1. Plano inexistente, inativo ou gratuito: 400, sem chamar o Mercado Pago.
  const plan = await getActivePlan(asString(body.plan_slug).trim());
  if (!plan) return fail(400, "invalid_plan", "Plano indisponivel.");

  // 2. E-mail: o do corpo, senao o da conta.
  const payerEmail = normalizeEmail(body.payer_email) || user.email;
  if (!payerEmail || !isValidEmail(payerEmail)) {
    return fail(400, "email_required", "Informe um email para o pagamento.");
  }

  // 3. external_reference = checkoutToken.
  const checkoutToken = uuid();
  const base = appUrl();
  const backUrl = `${base}/?checkout=${checkoutToken}&tab=conta`;

  // 4. Preference. unit_price vem SEMPRE de plans.price_brl (nunca do cliente).
  const preferenceBody: Record<string, unknown> = {
    items: [
      {
        id: plan.slug,
        title: `SaldoCerto — ${plan.name} (30 dias)`,
        description: "Acesso por 30 dias",
        quantity: 1,
        currency_id: "BRL",
        unit_price: plan.price_brl,
      },
    ],
    payer: { email: payerEmail },
    external_reference: checkoutToken,
    back_urls: { success: backUrl, failure: backUrl, pending: backUrl },
    notification_url: `${base}/api/billing/mercadopago-webhook`,
    statement_descriptor: "SALDOCERTO",
    metadata: { checkout_token: checkoutToken, plan_slug: plan.slug, user_id: user.id },
    payment_methods: { installments: 1 },
  };
  // O Mercado Pago recusa auto_return com back_urls que nao sao HTTPS (ex.: http://localhost em dev).
  if (base.startsWith("https://")) preferenceBody.auto_return = "approved";

  let preference: MpPreference;
  try {
    preference = await mpFetch<MpPreference>("/checkout/preferences", {
      method: "POST",
      body: JSON.stringify(preferenceBody),
    });
  } catch (error) {
    console.error("[create-checkout] falha ao criar preference:", error);
    return fail(502, "mercadopago_error", "Nao foi possivel abrir o pagamento agora. Tente novamente.");
  }

  // 5. Sem init_point (em teste, sandbox_init_point): aborta e nao grava nada.
  const initPoint = preference.init_point || preference.sandbox_init_point;
  const preferenceId = preference.id;
  if (!initPoint || !preferenceId) {
    console.error("[create-checkout] resposta sem init_point/id:", preference);
    return fail(502, "mercadopago_error", "Nao foi possivel abrir o pagamento agora. Tente novamente.");
  }

  // 6-8. Sessao + assinatura aberta (atualiza a existente, nunca cria segunda) na mesma transacao.
  const now = nowIso();
  const sessionId = uuid();
  const tx = await db().transaction("write");
  try {
    await tx.execute({
      sql: `INSERT INTO checkout_sessions
              (id, token, plan_id, payer_email, preference_id, status, user_id, expires_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
      args: [
        sessionId,
        checkoutToken,
        plan.id,
        payerEmail,
        preferenceId,
        user.id,
        addDaysIso(CHECKOUT_SESSION_DAYS),
        now,
        now,
      ],
    });

    const open = await findOpenSubscriptionByUser(tx, user.id);
    let subscriptionId: string;
    if (open) {
      subscriptionId = open.id;
      if (open.status === "pending") {
        await tx.execute({
          sql: `UPDATE subscriptions
                SET plan_id = ?, status = 'pending', preference_id = ?, checkout_session_id = ?,
                    current_period_end = NULL, updated_at = ?
                WHERE id = ?`,
          args: [plan.id, preferenceId, sessionId, now, open.id],
        });
      } else {
        // Renovacao antecipada: quem ja esta active/past_due NAO perde o acesso ao abrir um novo checkout.
        // So registra a nova preference; o proximo `approved` redefine o fim do periodo.
        await tx.execute({
          sql: `UPDATE subscriptions
                SET plan_id = ?, preference_id = ?, checkout_session_id = ?, updated_at = ?
                WHERE id = ?`,
          args: [plan.id, preferenceId, sessionId, now, open.id],
        });
      }
    } else {
      subscriptionId = uuid();
      await tx.execute({
        sql: `INSERT INTO subscriptions
                (id, user_id, plan_id, status, preference_id, checkout_session_id, current_period_end, created_at, updated_at)
              VALUES (?, ?, ?, 'pending', ?, ?, NULL, ?, ?)`,
        args: [subscriptionId, user.id, plan.id, preferenceId, sessionId, now, now],
      });
    }

    // 8. Liga a sessao a assinatura.
    await tx.execute({
      sql: "UPDATE checkout_sessions SET subscription_id = ?, updated_at = ? WHERE id = ?",
      args: [subscriptionId, now, sessionId],
    });
    await tx.commit();
  } catch (error) {
    await tx.rollback().catch(() => {});
    console.error("[create-checkout] falha ao gravar sessao/assinatura:", error);
    return fail(500, "internal_error");
  } finally {
    tx.close();
  }

  // 9.
  return json({ init_point: initPoint, checkout_token: checkoutToken, preference_id: preferenceId });
}
