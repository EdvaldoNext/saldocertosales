"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { CHECKOUT_TOKEN_KEY, isIndefinitePeriod, periodLabel, statusLabel } from "@/lib/billing-ui";
import { formatTimestampBR, toCurrency } from "@/lib/format";
import type { AuthUser, BillingMe, PlanInfo } from "@/lib/types";
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
  const [startingSlug, setStartingSlug] = useState<string | null>(null);

  // startCheckout(): cria o checkout do plano escolhido e manda o browser para o Checkout Pro.
  async function startCheckout(plan: PlanInfo) {
    if (startingSlug) return;
    setStartingSlug(plan.slug);
    try {
      const result = await api<{ init_point: string; checkout_token: string }>("/api/billing/create-checkout", {
        method: "POST",
        body: { plan_slug: plan.slug, payer_email: user.email },
      });
      localStorage.setItem(CHECKOUT_TOKEN_KEY, result.checkout_token);
      window.location.href = result.init_point;
    } catch (error) {
      toast(error instanceof ApiError ? error.message : "Nao foi possivel abrir o pagamento.", true);
      setStartingSlug(null);
    }
  }

  const sub = billing?.subscription ?? null;
  const currentPlan = sub?.plan ?? null;
  const offers = billing?.plans?.length ? billing.plans : billing?.plan ? [billing.plan] : [];
  const indefinite = isIndefinitePeriod(sub?.current_period_end) || isIndefinitePeriod(sub?.access_until);
  const currentPrice = currentPlan
    ? indefinite
      ? `R$ ${toCurrency(currentPlan.price_brl)}`
      : `R$ ${toCurrency(currentPlan.price_brl)} / ${periodLabel(currentPlan.billing_interval)}`
    : "—";

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
              <dd>{currentPlan ? currentPlan.name : "—"}</dd>
            </div>
            <div className="account-row">
              <dt>Preco</dt>
              <dd>{currentPrice}</dd>
            </div>
            <div className="account-row">
              <dt>Status</dt>
              <dd className={billing.access ? "account-ok" : "account-off"}>{statusLabel(billing)}</dd>
            </div>
            {sub?.current_period_end ? (
              <div className="account-row">
                <dt>Vencimento</dt>
                <dd>{indefinite ? "Tempo indeterminado" : formatTimestampBR(sub.current_period_end)}</dd>
              </div>
            ) : null}
          </dl>

          {checking ? <p className="account-hint">Confirmando seu pagamento...</p> : null}

          {indefinite ? null : (
            <>
              <div className="account-actions">
                {offers.map((offer) => (
                  <button
                    key={offer.slug}
                    className="btn-primary account-cta"
                    type="button"
                    onClick={() => startCheckout(offer)}
                    disabled={startingSlug !== null}
                  >
                    {startingSlug === offer.slug
                      ? "Abrindo pagamento..."
                      : `Pagar ${offer.name} · R$ ${toCurrency(offer.price_brl)} / ${periodLabel(offer.billing_interval)}`}
                  </button>
                ))}
              </div>
              <p className="account-hint">
                Pagamento unico pelo Mercado Pago. O mensal libera 30 dias e o anual libera 12 meses, sem cobranca
                automatica.
              </p>
            </>
          )}
        </>
      )}
    </section>
  );
}
