// Variaveis de ambiente lidas SO no servidor. Nenhuma tem prefixo NEXT_PUBLIC_.

export function appUrl(): string {
  return (process.env.APP_URL || "http://localhost:3000").trim().replace(/\/+$/, "");
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export function isDevelopment(): boolean {
  return process.env.NODE_ENV === "development";
}

export function jwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("JWT_SECRET ausente ou curto demais. Defina um segredo longo e aleatorio no .env.local.");
  }
  return new TextEncoder().encode(secret);
}

/** E-mails (minusculos) que ignoram a trava de assinatura. Vazio = ninguem e admin. */
export function adminEmails(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS || "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isAdminEmail(email: string): boolean {
  return adminEmails().has(email.trim().toLowerCase());
}

export function mercadoPagoBase(): string {
  return (process.env.MERCADOPAGO_API_URL || "https://api.mercadopago.com").replace(/\/+$/, "");
}
