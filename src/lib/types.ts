export interface AuthUser {
  id: string;
  email: string;
}

export interface Expense {
  id: string;
  descricao: string;
  valor: number;
  data: string; // YYYY-MM-DD
  pago: boolean;
  categoria: string;
  recorrente: boolean;
}

export interface PlanInfo {
  slug: string;
  name: string;
  price_brl: number;
  /** month = 30 dias, year = 12 meses. Ausente em respostas antigas. */
  billing_interval?: "month" | "year";
}

export type SubscriptionStatus = "pending" | "active" | "past_due" | "canceled" | "expired";

export interface SubscriptionInfo {
  status: SubscriptionStatus;
  current_period_end: string | null;
  /** Fim real do acesso (fim do periodo + tolerancia quando past_due). */
  access_until: string | null;
  plan: PlanInfo | null;
}

export interface BillingMe {
  access: boolean;
  isAdmin: boolean;
  /** Plano mensal padrao. Mantido para quem le so um plano. */
  plan: PlanInfo | null;
  /** Planos ativos que o usuario pode pagar. */
  plans: PlanInfo[];
  subscription: SubscriptionInfo | null;
}
