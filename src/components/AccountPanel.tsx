"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { CHECKOUT_TOKEN_KEY, PLAN_SLUG, statusLabel } from "@/lib/billing-ui";
import { formatTimestampBR, toCurrency } from "@/lib/format";
import type { AuthUser, BillingMe } from "@/lib/types";
import { useToast } from "./Toast";

interface Props {
  user: AuthUser;
  billing: BillingMe | null;
  /** Confirmando pagamento depois do retorno do Mercado Pago. */
  checking: boolean;
  /** Com acesso, o usuario pode voltar para as despesas. */
  onBack?: () => void;
}

export default function AccountPanel({ user, billing, checking, onBack }: Props) {
  const toast = useToast();
  const [starting, setStarting] = useState(false);

  // startCheckout(): cria o checkout, guarda o token e manda o browser para o Checkout Pro.
  async function startCheckout() {
    if (starting) return;
    setStarting(true);
    try {
      const result = await api<{ init_point: string; checkout_token: string }>("/api/billing/create-checkout", {
        method: "POST",
        body: { plan_slug: PLAN_SLUG, payer_email: user.email },
      });
      localStorage.setItem(CHECKOUT_TOKEN_KEY, result.checkout_token);
      window.location.href = result.init_point;
    } catch (error) {
      toast(error instanceof ApiError ? error.message : "Nao foi possivel abrir o pagamento.", true);
      setStarting(false);
    }
  }

  const plan = billing?.plan ?? billing?.subscription?.plan ?? null;
  const sub = billing?.subscription ?? null;

  return (
    <section className="glass card account-card" aria-label="Conta">
      <div className="account-head">
        <div>
          <h2>Conta</h2>
          <p className="account-sub">{user.email}</p>
        </div>
        {onBack ? (
          <button className="btn-secondary" type="button" onClick={onBack}>
            Voltar para despesas
          </button>
        ) : null}
      </div>

      {!billing ? (
        <p className="account-sub">Carregando...</p>
      ) : (
        <>
          <dl className="account-rows">
            <div className="account-row">
              <dt>Plano</dt>
              <dd>{plan ? plan.name : "—"}</dd>
            </div>
            <div className="account-row">
              <dt>Preco</dt>
              <dd>{plan ? `R$ ${toCurrency(plan.price_brl)} / 30 dias` : "—"}</dd>
            </div>
            <div className="account-row">
              <dt>Status</dt>
              <dd className={billing.access ? "account-ok" : "account-off"}>{statusLabel(billing)}</dd>
            </div>
            {sub?.current_period_end ? (
              <div className="account-row">
                <dt>Vencimento</dt>
                <dd>{formatTimestampBR(sub.current_period_end)}</dd>
              </div>
            ) : null}
          </dl>

          {checking ? <p className="account-hint">Confirmando seu pagamento...</p> : null}

          <button
            className="btn-primary account-cta"
            type="button"
            onClick={startCheckout}
            disabled={starting || !plan}
          >
            {starting ? "Abrindo pagamento..." : "Liberar 30 dias"}
          </button>
          <p className="account-hint">
            Pagamento unico pelo Mercado Pago. Cada pagamento libera 30 dias, sem cobranca automatica.
          </p>
        </>
      )}
    </section>
  );
}
