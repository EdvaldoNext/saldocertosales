import { createHmac, timingSafeEqual } from "node:crypto";
import { mercadoPagoBase } from "./env";

export class MercadoPagoError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** Chamada autenticada a API do Mercado Pago. O token fica so no servidor. */
export async function mpFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token) throw new MercadoPagoError("MERCADOPAGO_ACCESS_TOKEN nao definido.", 500);

  const response = await fetch(`${mercadoPagoBase()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    cache: "no-store",
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    throw new MercadoPagoError(`Mercado Pago respondeu ${response.status}: ${text.slice(0, 300)}`, response.status);
  }
  return body as T;
}

export interface MpPayment {
  id?: number | string;
  status?: string;
  external_reference?: string | null;
  preference_id?: string | null;
}

export async function getPayment(id: string): Promise<MpPayment> {
  return mpFetch<MpPayment>(`/v1/payments/${encodeURIComponent(id)}`);
}

/** Pagamentos da referencia externa, do mais novo para o mais antigo. */
export async function searchPaymentsByReference(token: string): Promise<MpPayment[]> {
  const qs = new URLSearchParams({ external_reference: token, sort: "date_created", criteria: "desc" });
  const result = await mpFetch<{ results?: MpPayment[] }>(`/v1/payments/search?${qs.toString()}`);
  return Array.isArray(result?.results) ? result.results : [];
}

/**
 * Valida x-signature (HMAC-SHA256 do manifest oficial) em tempo constante.
 * manifest: id:{data.id minusculo};request-id:{x-request-id};ts:{ts};
 */
export function verifyMpSignature(headers: Headers, dataId: string, secret: string): boolean {
  const xSignature = headers.get("x-signature");
  const xRequestId = headers.get("x-request-id");
  if (!xSignature || !xRequestId || !secret) return false;

  const parts: Record<string, string> = {};
  for (const piece of xSignature.split(",")) {
    const idx = piece.indexOf("=");
    if (idx === -1) continue;
    parts[piece.slice(0, idx).trim()] = piece.slice(idx + 1).trim();
  }
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return false;

  let id = dataId;
  if (/[a-zA-Z]/.test(id)) id = id.toLowerCase();

  const manifest = `id:${id};request-id:${xRequestId};ts:${ts};`;
  const expected = createHmac("sha256", secret).update(manifest).digest("hex");

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(v1, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
