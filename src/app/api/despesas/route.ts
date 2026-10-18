import { getDateRange, getPreviousPeriod } from "@/lib/dates";
import { subscriptionGuard } from "@/server/access";
import { db, nowIso, uuid } from "@/server/db";
import {
  getExpense,
  listExpenses,
  parseCategoria,
  parseData,
  parseDescricao,
  parsePeriod,
  parseValor,
} from "@/server/despesas";
import { fail, json, readJson } from "@/server/http";
import { requireSession } from "@/server/session";

/** GET /api/despesas?month=1-12&year=YYYY -> { expenses, previousExpenses } */
export async function GET(req: Request) {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const blocked = await subscriptionGuard(auth.user);
  if (blocked) return blocked;

  const url = new URL(req.url);
  const period = parsePeriod(url.searchParams.get("month"), url.searchParams.get("year"));
  if (!period) return fail(400, "invalid_period");

  const current = getDateRange(period.month, period.year);
  const prev = getPreviousPeriod(period.month, period.year);
  const previous = getDateRange(prev.month, prev.year);

  const [expenses, previousExpenses] = await Promise.all([
    listExpenses(auth.user.id, current.start, current.end),
    listExpenses(auth.user.id, previous.start, previous.end),
  ]);
  return json({ expenses, previousExpenses });
}

/** POST /api/despesas -> cria. `pago` e forcado para 0; user_id vem sempre da sessao. */
export async function POST(req: Request) {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const blocked = await subscriptionGuard(auth.user);
  if (blocked) return blocked;

  const body = await readJson(req);
  if (!body) return fail(400, "invalid_body");

  const descricao = parseDescricao(body.descricao);
  const valor = parseValor(body.valor);
  const data = parseData(body.data);
  const categoria = parseCategoria(body.categoria);
  const recorrente = body.recorrente === true || body.recorrente === 1 ? 1 : 0;

  if (!descricao || valor === null || !data || !categoria) {
    return fail(400, "invalid_expense", "Preencha os campos obrigatorios corretamente.");
  }

  const id = uuid();
  await db().execute({
    sql: `INSERT INTO despesas (id, user_id, descricao, valor, data, pago, categoria, recorrente, created_at)
          VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    args: [id, auth.user.id, descricao, valor, data, categoria, recorrente, nowIso()],
  });

  const expense = await getExpense(auth.user.id, id);
  return json({ expense }, 201);
}
