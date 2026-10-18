import { buildImportedDate, getDateRange, getPreviousPeriod } from "@/lib/dates";
import { subscriptionGuard } from "@/server/access";
import { db, nowIso, uuid } from "@/server/db";
import { listExpenses, parsePeriod } from "@/server/despesas";
import { fail, json, readJson } from "@/server/http";
import { requireSession } from "@/server/session";

/**
 * POST /api/despesas/import-recorrentes { month, year } (mes DESTINO)
 * Copia as recorrentes do mes anterior (mesmo dia, limitado ao fim do mes; pago = 0).
 * Se o mes destino ja tem itens: 409 (evita duplicar por clique duplo).
 */
export async function POST(req: Request) {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const blocked = await subscriptionGuard(auth.user);
  if (blocked) return blocked;

  const body = await readJson(req);
  if (!body) return fail(400, "invalid_body");
  const period = parsePeriod(body.month, body.year);
  if (!period) return fail(400, "invalid_period");

  const target = getDateRange(period.month, period.year);
  const prev = getPreviousPeriod(period.month, period.year);
  const prevRange = getDateRange(prev.month, prev.year);
  const userId = auth.user.id;

  // Checagem + insercao na mesma transacao de escrita: dois cliques simultaneos nao duplicam.
  const tx = await db().transaction("write");
  try {
    const existing = await tx.execute({
      sql: "SELECT COUNT(*) AS n FROM despesas WHERE user_id = ? AND data >= ? AND data <= ?",
      args: [userId, target.start, target.end],
    });
    if (Number(existing.rows[0]?.n) > 0) {
      await tx.rollback();
      return fail(409, "month_not_empty", "Este mes ja tem despesas.");
    }

    const source = await tx.execute({
      sql: `SELECT descricao, valor, data, categoria FROM despesas
            WHERE user_id = ? AND recorrente = 1 AND data >= ? AND data <= ?
            ORDER BY data ASC, created_at ASC`,
      args: [userId, prevRange.start, prevRange.end],
    });
    if (source.rows.length === 0) {
      await tx.rollback();
      return fail(404, "no_recurring", "Nenhuma despesa recorrente no mes anterior.");
    }

    const createdAt = nowIso();
    const ids: string[] = [];
    for (const row of source.rows) {
      const day = Number(String(row.data).split("-")[2] || 1);
      const id = uuid();
      ids.push(id);
      await tx.execute({
        sql: `INSERT INTO despesas (id, user_id, descricao, valor, data, pago, categoria, recorrente, created_at)
              VALUES (?, ?, ?, ?, ?, 0, ?, 1, ?)`,
        args: [
          id,
          userId,
          String(row.descricao),
          Number(row.valor),
          buildImportedDate(day, period.month, period.year),
          String(row.categoria),
          createdAt,
        ],
      });
    }
    await tx.commit();
  } catch (error) {
    await tx.rollback().catch(() => {});
    throw error;
  } finally {
    tx.close();
  }

  const expenses = await listExpenses(userId, target.start, target.end);
  return json({ imported: expenses.length, expenses }, 201);
}
