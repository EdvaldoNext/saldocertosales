import type { Row } from "@libsql/client";
import { normalizeCategory } from "@/lib/categories";
import { isValidISODate } from "@/lib/dates";
import type { Expense } from "@/lib/types";
import { db } from "./db";

export function rowToExpense(row: Row): Expense {
  return {
    id: String(row.id),
    descricao: String(row.descricao),
    valor: Number(row.valor),
    data: String(row.data),
    pago: Number(row.pago) === 1,
    categoria: String(row.categoria),
    recorrente: Number(row.recorrente) === 1,
  };
}

/** Despesas do usuario (SEMPRE filtradas pelo user_id da sessao) no intervalo de datas. */
export async function listExpenses(userId: string, start: string, end: string): Promise<Expense[]> {
  const result = await db().execute({
    sql: `SELECT id, descricao, valor, data, pago, categoria, recorrente
          FROM despesas
          WHERE user_id = ? AND data >= ? AND data <= ?
          ORDER BY data ASC, created_at ASC`,
    args: [userId, start, end],
  });
  return result.rows.map(rowToExpense);
}

export async function getExpense(userId: string, id: string): Promise<Expense | null> {
  const result = await db().execute({
    sql: `SELECT id, descricao, valor, data, pago, categoria, recorrente
          FROM despesas WHERE id = ? AND user_id = ?`,
    args: [id, userId],
  });
  return result.rows[0] ? rowToExpense(result.rows[0]) : null;
}

export const MAX_DESCRICAO = 200;
export const MAX_CATEGORIA = 40;
export const MAX_VALOR = 1_000_000_000;

export function parseValor(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(",", ".")) : NaN;
  if (!Number.isFinite(n) || n <= 0 || n > MAX_VALOR) return null;
  return Math.round(n * 100) / 100;
}

export function parseDescricao(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return v && v.length <= MAX_DESCRICAO ? v : null;
}

export function parseCategoria(value: unknown): string | null {
  const v = normalizeCategory(value);
  return v && v.length <= MAX_CATEGORIA ? v : null;
}

export function parseData(value: unknown): string | null {
  return isValidISODate(value) ? value : null;
}

/** Mes/ano da query ou do corpo. */
export function parsePeriod(monthRaw: unknown, yearRaw: unknown): { month: number; year: number } | null {
  const month = Number(monthRaw);
  const year = Number(yearRaw);
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  if (!Number.isInteger(year) || year < 1970 || year > 2200) return null;
  return { month, year };
}
