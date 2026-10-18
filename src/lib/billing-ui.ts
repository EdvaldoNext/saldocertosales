import type { BillingMe } from "./types";
import { formatTimestampBR } from "./format";

export const CHECKOUT_TOKEN_KEY = "saldocerto_checkout_token";
export const PLAN_SLUG = "basic_monthly";

/** Texto do periodo liberado por um pagamento unico. */
export function periodLabel(interval: string | null | undefined): string {
  return interval === "year" ? "12 meses" : "30 dias";
}

/** Acesso concedido sem vencimento (fim do periodo no ano 9000 ou depois). */
export function isIndefinitePeriod(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return false;
  return new Date(time).getUTCFullYear() >= 9000;
}

/** Texto de status mostrado ao usuario no painel Conta. */
export function statusLabel(billing: BillingMe | null, now = Date.now()): string {
  if (!billing) return "";
  const sub = billing.subscription;
  if (!sub) return billing.isAdmin ? "Acesso de administrador" : "Sem acesso";

  switch (sub.status) {
    case "pending":
      return "Aguardando pagamento";
    case "active": {
      if (isIndefinitePeriod(sub.current_period_end) || isIndefinitePeriod(sub.access_until)) return "Pago";
      const until = sub.access_until ? Date.parse(sub.access_until) : NaN;
      if (Number.isNaN(until) || until <= now) return "Acesso encerrado";
      return `Acesso ate ${formatTimestampBR(sub.access_until as string)}`;
    }
    case "past_due": {
      const until = sub.access_until ? Date.parse(sub.access_until) : NaN;
      if (Number.isNaN(until) || until <= now) return "Acesso encerrado";
      return `Acesso em tolerancia ate ${formatTimestampBR(sub.access_until as string)}`;
    }
    default:
      return "Sem acesso";
  }
}
