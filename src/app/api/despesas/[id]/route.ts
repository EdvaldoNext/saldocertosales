import type { InValue } from "@libsql/client";
import { subscriptionGuard } from "@/server/access";
import { db } from "@/server/db";
import {
  getExpense,
  parseCategoria,
  parseData,
  parseDescricao,
  parseValor,
} from "@/server/despesas";
import { fail, json, readJson } from "@/server/http";
import { requireSession } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH /api/despesas/:id -> atualiza so os campos enviados, e so se a despesa e do usuario. */
export async function PATCH(req: Request, ctx: Ctx) {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const blocked = await subscriptionGuard(auth.user);
  if (blocked) return blocked;

  const { id } = await ctx.params;
  const body = await readJson(req);
  if (!body) return fail(400, "invalid_body");

  const sets: string[] = [];
  const args: InValue[] = [];

  if ("descricao" in body) {
    const v = parseDescricao(body.descricao);
    if (!v) return fail(400, "invalid_expense", "Descricao invalida.");
    sets.push("descricao = ?");
    args.push(v);
  }
  if ("valor" in body) {
    const v = parseValor(body.valor);
    if (v === null) return fail(400, "invalid_expense", "Valor invalido.");
    sets.push("valor = ?");
    args.push(v);
  }
  if ("data" in body) {
    const v = parseData(body.data);
    if (!v) return fail(400, "invalid_expense", "Data invalida.");
    sets.push("data = ?");
    args.push(v);
  }
  if ("categoria" in body) {
    const v = parseCategoria(body.categoria);
    if (!v) return fail(400, "invalid_expense", "Categoria invalida.");
    sets.push("categoria = ?");
    args.push(v);
  }
  if ("recorrente" in body) {
    if (typeof body.recorrente !== "boolean") return fail(400, "invalid_expense", "Recorrente invalido.");
    sets.push("recorrente = ?");
    args.push(body.recorrente ? 1 : 0);
  }
  if ("pago" in body) {
    if (typeof body.pago !== "boolean") return fail(400, "invalid_expense", "Pago invalido.");
    sets.push("pago = ?");
    args.push(body.pago ? 1 : 0);
  }
  if (sets.length === 0) return fail(400, "nothing_to_update");

  const result = await db().execute({
    sql: `UPDATE despesas SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`,
    args: [...args, id, auth.user.id],
  });
  if (result.rowsAffected === 0) return fail(404, "not_found");

  const expense = await getExpense(auth.user.id, id);
  return json({ expense });
}

/** DELETE /api/despesas/:id */
export async function DELETE(req: Request, ctx: Ctx) {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const blocked = await subscriptionGuard(auth.user);
  if (blocked) return blocked;

  const { id } = await ctx.params;
  const result = await db().execute({
    sql: "DELETE FROM despesas WHERE id = ? AND user_id = ?",
    args: [id, auth.user.id],
  });
  if (result.rowsAffected === 0) return fail(404, "not_found");
  return json({ ok: true });
}
