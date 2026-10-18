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
  plan: PlanInfo | null;
  subscription: SubscriptionInfo | null;
}
