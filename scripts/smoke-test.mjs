// Teste de fumaça ponta a ponta (API real + Mercado Pago simulado).
//
// Como rodar (NUNCA contra o banco de producao):
//   1. $env:TURSO_DATABASE_URL='file:./test.db'; $env:MERCADOPAGO_API_URL='http://127.0.0.1:4010'; $env:ADMIN_EMAILS='admin@test.com'
//   2. npm run migrate ; npm run build ; npm start        (em um terminal)
//   3. node --env-file=.env.local scripts/smoke-test.mjs   (em outro, com as MESMAS variaveis acima)
import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import http from "node:http";
import { createClient } from "@libsql/client";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const WEBHOOK_SECRET = process.env.MERCADOPAGO_WEBHOOK_SECRET;
const DB_URL = process.env.TURSO_DATABASE_URL;
if (!DB_URL?.startsWith("file:")) throw new Error("Use um banco de teste file: (nunca o de producao).");
if (!WEBHOOK_SECRET) throw new Error("MERCADOPAGO_WEBHOOK_SECRET ausente (use --env-file=.env.local).");

const db = createClient({ url: DB_URL });
// Estado conhecido do plano (uma execucao abortada antes poderia ter deixado preco/ativo alterados).
await db.execute("UPDATE plans SET active=1, price_brl=9.9 WHERE slug='basic_monthly'");

// ---------- Mercado Pago simulado ----------
const mp = { preferences: [], payments: new Map(), searchResults: new Map(), calls: 0, authOk: true };
const mpServer = http.createServer((req, res) => {
  mp.calls += 1;
  if (req.headers.authorization !== `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}`) mp.authOk = false;
  const url = new URL(req.url, "http://x");
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const send = (status, obj) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    if (req.method === "POST" && url.pathname === "/checkout/preferences") {
      const pref = JSON.parse(body);
      const id = `pref-${mp.preferences.length + 1}`;
      mp.preferences.push({ id, body: pref });
      return send(201, { id, init_point: `https://mp.test/pay/${id}`, sandbox_init_point: `https://sandbox.mp.test/${id}` });
    }
    if (req.method === "GET" && url.pathname.startsWith("/v1/payments/search")) {
      const ref = url.searchParams.get("external_reference");
      return send(200, { results: mp.searchResults.get(ref) || [] });
    }
    const m = url.pathname.match(/^\/v1\/payments\/(.+)$/);
    if (req.method === "GET" && m) {
      const p = mp.payments.get(decodeURIComponent(m[1]));
      return p ? send(200, p) : send(404, { message: "not found" });
    }
    send(404, {});
  });
});
const mpUrl = new URL(process.env.MERCADOPAGO_API_URL || "");
if (!["127.0.0.1", "localhost"].includes(mpUrl.hostname)) {
  throw new Error("MERCADOPAGO_API_URL deve apontar para o mock local (ex.: http://127.0.0.1:4915).");
}
await new Promise((r) => mpServer.listen(Number(mpUrl.port), "127.0.0.1", r));

// ---------- helpers ----------
class Client {
  cookie = "";
  async req(method, path, body, headers = {}) {
    const res = await fetch(BASE + path, {
      method,
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(this.cookie ? { cookie: this.cookie } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      redirect: "manual",
    });
    const set = res.headers.getSetCookie?.() || [];
    for (const line of set) {
      const [pair] = line.split(";");
      const [k, v] = pair.split("=");
      if (k === "saldocerto_session") this.cookie = v ? `${k}=${v}` : "";
    }
    let json = null;
    try {
      json = await res.json();
    } catch {}
    return { status: res.status, json, setCookie: set };
  }
  get = (p, h) => this.req("GET", p, undefined, h);
  post = (p, b, h) => this.req("POST", p, b ?? {}, h);
  patch = (p, b) => this.req("PATCH", p, b);
  del = (p) => this.req("DELETE", p);
}

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`FAIL  ${name}\n      ${e.message}`);
    process.exitCode = 1;
  }
}

const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const run = randomUUID().slice(0, 8);
const emailA = `a-${run}@test.com`;
const emailB = `b-${run}@test.com`;
const emailC = `c-${run}@test.com`;
const PASS = "senha-super-123";

function signedWebhook(dataId, { secret = WEBHOOK_SECRET, topic = "payment" } = {}) {
  const requestId = randomUUID();
  const ts = String(Date.now());
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const v1 = createHmac("sha256", secret).update(manifest).digest("hex");
  return {
    headers: { "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": requestId },
    body: { type: topic, action: "payment.updated", data: { id: dataId } },
  };
}

const sub = async (email) =>
  (await db.execute({ sql: "SELECT s.* FROM subscriptions s JOIN users u ON u.id=s.user_id WHERE u.email=?", args: [email] })).rows;
const daysFromNow = (iso) => (Date.parse(iso) - Date.now()) / 86400000;
const monthYear = () => ({ month: 2, year: 2026 });

const A = new Client();
const B = new Client();
const C = new Client();
const ADMIN = new Client();
let tokenA;
let paymentA;

console.log(`SaldoCerto smoke test -> ${BASE}`);

// ---------- AUTH ----------
await test("signup entra direto na sessao (cookie HttpOnly, SameSite=Lax, Path=/)", async () => {
  const r = await A.post("/api/auth/signup", { email: ` ${emailA.toUpperCase()} `, password: PASS });
  assert.equal(r.status, 201);
  assert.equal(r.json.user.email, emailA);
  const c = r.setCookie.join(";").toLowerCase();
  assert.match(c, /saldocerto_session=/);
  assert.match(c, /httponly/);
  assert.match(c, /samesite=lax/);
  assert.match(c, /path=\//);
  assert.match(c, /secure/); // next start roda em production
});
await test("signup duplicado -> 409 com a mensagem exata", async () => {
  const r = await new Client().post("/api/auth/signup", { email: emailA, password: PASS });
  assert.equal(r.status, 409);
  assert.equal(r.json.message, "Este email ja existe. Entre com a senha ou recupere a senha.");
});
await test("senha curta -> 400", async () => {
  const r = await new Client().post("/api/auth/signup", { email: `x-${run}@test.com`, password: "1234567" });
  assert.equal(r.status, 400);
});
await test("login ruim nao revela se o email existe (mesma resposta)", async () => {
  const wrongPass = await new Client().post("/api/auth/login", { email: emailA, password: "errada-errada" });
  const noUser = await new Client().post("/api/auth/login", { email: `nope-${run}@test.com`, password: "errada-errada" });
  assert.equal(wrongPass.status, 401);
  assert.equal(noUser.status, 401);
  assert.deepEqual(wrongPass.json, noUser.json);
  assert.equal(wrongPass.json.message, "Email ou senha incorretos. Se preciso, use Esqueci minha senha.");
});
await test("me: logado devolve usuario, deslogado devolve null", async () => {
  assert.equal((await A.get("/api/auth/me")).json.user.email, emailA);
  assert.equal((await new Client().get("/api/auth/me")).json.user, null);
});
await test("sessao grava SO o hash do token e o JWT tem sub/sid/exp", async () => {
  const jwt = A.cookie.split("=")[1];
  const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
  assert.ok(payload.sub && payload.sid && payload.exp);
  const row = (await db.execute({ sql: "SELECT token_hash FROM sessions WHERE id=?", args: [payload.sid] })).rows[0];
  assert.equal(row.token_hash, sha256(jwt));
  assert.ok(daysFromNow(new Date(payload.exp * 1000).toISOString()) > 29);
});

// ---------- TRAVA 402 / BILLING ME ----------
await test("sem assinatura: despesas -> 402 subscription_required (GET/POST/PATCH/DELETE/import)", async () => {
  for (const r of [
    await A.get("/api/despesas?month=2&year=2026"),
    await A.post("/api/despesas", { descricao: "x", valor: 1, data: "2026-02-01", categoria: "casa" }),
    await A.patch("/api/despesas/abc", { pago: true }),
    await A.del("/api/despesas/abc"),
    await A.post("/api/despesas/import-recorrentes", { month: 2, year: 2026 }),
  ]) {
    assert.equal(r.status, 402);
    assert.deepEqual(r.json, { error: "subscription_required" });
  }
});
await test("despesas sem login -> 401", async () => {
  assert.equal((await new Client().get("/api/despesas?month=2&year=2026")).status, 401);
});
await test("billing/me funciona sem acesso e traz o preco do banco", async () => {
  const r = await A.get("/api/billing/me");
  assert.equal(r.status, 200);
  assert.equal(r.json.access, false);
  assert.equal(r.json.isAdmin, false);
  assert.deepEqual(r.json.plan, { slug: "basic_monthly", name: "Mensal", price_brl: 9.9 });
  assert.equal(r.json.subscription, null);
});
await test("Bearer vale nas rotas de billing, mas nao nas de despesa", async () => {
  const jwt = A.cookie.split("=")[1];
  const r = await new Client().get("/api/billing/me", { Authorization: `Bearer ${jwt}` });
  assert.equal(r.status, 200);
  const d = await new Client().get("/api/despesas?month=2&year=2026", { Authorization: `Bearer ${jwt}` });
  assert.equal(d.status, 401);
});

// ---------- CREATE CHECKOUT ----------
await test("plano inexistente/inativo/gratuito -> 400 e NAO chama o Mercado Pago", async () => {
  const before = mp.calls;
  assert.equal((await A.post("/api/billing/create-checkout", { plan_slug: "nao_existe", payer_email: emailA })).status, 400);
  await db.execute("UPDATE plans SET active=0 WHERE slug='basic_monthly'");
  assert.equal((await A.post("/api/billing/create-checkout", { plan_slug: "basic_monthly", payer_email: emailA })).status, 400);
  await db.execute("UPDATE plans SET active=1, price_brl=0 WHERE slug='basic_monthly'");
  assert.equal((await A.post("/api/billing/create-checkout", { plan_slug: "basic_monthly", payer_email: emailA })).status, 400);
  await db.execute("UPDATE plans SET price_brl=9.9 WHERE slug='basic_monthly'");
  assert.equal(mp.calls, before);
});
await test("create-checkout sem login -> 401", async () => {
  assert.equal((await new Client().post("/api/billing/create-checkout", { plan_slug: "basic_monthly" })).status, 401);
});
await test("preference: unit_price do banco, external_reference = token, campos da ficha", async () => {
  // O cliente nao manda preco; mesmo que tente, e ignorado.
  const r = await A.post("/api/billing/create-checkout", { plan_slug: "basic_monthly", payer_email: emailA, unit_price: 0.01, price: 0.01 });
  assert.equal(r.status, 200);
  tokenA = r.json.checkout_token;
  assert.match(r.json.init_point, /^https:\/\/mp\.test\/pay\//);
  assert.ok(r.json.preference_id);
  const pref = mp.preferences.at(-1).body;
  assert.equal(pref.items[0].unit_price, 9.9);
  assert.equal(pref.items[0].title, "SaldoCerto — Mensal (30 dias)");
  assert.equal(pref.items[0].description, "Acesso por 30 dias");
  assert.equal(pref.items[0].currency_id, "BRL");
  assert.equal(pref.external_reference, tokenA);
  assert.equal(pref.statement_descriptor, "SALDOCERTO");
  assert.equal(pref.payment_methods.installments, 1);
  assert.equal(pref.notification_url, `${process.env.APP_URL}/api/billing/mercadopago-webhook`);
  const back = `${process.env.APP_URL}/?checkout=${tokenA}&tab=conta`;
  assert.deepEqual(pref.back_urls, { success: back, failure: back, pending: back });
  assert.equal(pref.metadata.checkout_token, tokenA);
  assert.equal(pref.metadata.plan_slug, "basic_monthly");
  assert.ok(pref.metadata.user_id);
  assert.equal(mp.authOk, true);
});
await test("mudar o preco na tabela plans muda o unit_price (sem hardcode)", async () => {
  await db.execute("UPDATE plans SET price_brl=12.5 WHERE slug='basic_monthly'");
  const r = await A.post("/api/billing/create-checkout", { plan_slug: "basic_monthly", payer_email: emailA });
  assert.equal(r.status, 200);
  tokenA = r.json.checkout_token;
  assert.equal(mp.preferences.at(-1).body.unit_price ?? mp.preferences.at(-1).body.items[0].unit_price, 12.5);
  await db.execute("UPDATE plans SET price_brl=9.9 WHERE slug='basic_monthly'");
});
await test("checkout cria 1 sessao pending (expira em ~7 dias) e UMA assinatura pending; segue sem acesso", async () => {
  const subs = await sub(emailA);
  assert.equal(subs.length, 1);
  assert.equal(subs[0].status, "pending");
  assert.equal(subs[0].current_period_end, null);
  const s = (await db.execute({ sql: "SELECT * FROM checkout_sessions WHERE token=?", args: [tokenA] })).rows[0];
  assert.equal(s.status, "pending");
  assert.equal(s.subscription_id, subs[0].id);
  const d = daysFromNow(s.expires_at);
  assert.ok(d > 6.9 && d < 7.1);
  const me = (await A.get("/api/billing/me")).json;
  assert.equal(me.access, false);
  assert.equal(me.subscription.status, "pending");
  assert.equal((await A.get("/api/despesas?month=2&year=2026")).status, 402);
});

// ---------- WEBHOOK ----------
await test("webhook com assinatura invalida -> 401 e nao ativa", async () => {
  mp.payments.set(`pay-${run}-1`, { id: `pay-${run}-1`, status: "approved", external_reference: tokenA });
  const w = signedWebhook(`pay-${run}-1`, { secret: "segredo-errado" });
  const r = await new Client().post("/api/billing/mercadopago-webhook", w.body, w.headers);
  assert.equal(r.status, 401);
  assert.equal((await A.get("/api/billing/me")).json.access, false);
  const none = await new Client().post("/api/billing/mercadopago-webhook", { type: "payment", data: { id: `pay-${run}-1` } });
  assert.equal(none.status, 401);
});
await test("pagamento pending/in_process/rejected nao muda o acesso", async () => {
  for (const [i, status] of ["pending", "in_process", "rejected"].entries()) {
    const id = `pay-${run}-np-${i}`;
    mp.payments.set(id, { id, status, external_reference: tokenA });
    const w = signedWebhook(id);
    const r = await new Client().post("/api/billing/mercadopago-webhook", w.body, w.headers);
    assert.equal(r.status, 200);
  }
  assert.equal((await A.get("/api/billing/me")).json.access, false);
});
await test("approved -> sessao paid, assinatura active, fim = agora + 30 dias", async () => {
  paymentA = `pay-${run}-1`;
  const w = signedWebhook(paymentA);
  const r = await new Client().post("/api/billing/mercadopago-webhook", w.body, w.headers);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true });
  const s = (await db.execute({ sql: "SELECT status FROM checkout_sessions WHERE token=?", args: [tokenA] })).rows[0];
  assert.equal(s.status, "paid");
  const subs = await sub(emailA);
  assert.equal(subs.length, 1);
  assert.equal(subs[0].status, "active");
  const d = daysFromNow(subs[0].current_period_end);
  assert.ok(d > 29.99 && d < 30.01, `periodo=${d}`);
  const ev = (await db.execute({ sql: "SELECT payload FROM billing_events WHERE mp_event_id=?", args: [paymentA] })).rows[0];
  assert.equal(JSON.parse(ev.payload).data.id, paymentA);
  const me = (await A.get("/api/billing/me")).json;
  assert.equal(me.access, true);
  assert.equal(me.subscription.status, "active");
});
await test("webhook duplicado -> {ok:true, duplicate:true} e NAO estende o periodo", async () => {
  const before = (await sub(emailA))[0].current_period_end;
  await new Promise((r) => setTimeout(r, 1100));
  const w = signedWebhook(paymentA);
  const r = await new Client().post("/api/billing/mercadopago-webhook", w.body, w.headers);
  assert.deepEqual(r.json, { ok: true, duplicate: true });
  assert.equal((await sub(emailA))[0].current_period_end, before);
});
await test("topico que nao e payment e ignorado (nao decide acesso)", async () => {
  const w = signedWebhook(`order-${run}`, { topic: "merchant_order" });
  const r = await new Client().post("/api/billing/mercadopago-webhook", { ...w.body, action: "merchant_order.updated" }, w.headers);
  assert.equal(r.status, 200);
});
await test("com acesso: criar/listar/editar/excluir despesa", async () => {
  const bad = await A.post("/api/despesas", { descricao: "", valor: 10, data: "2026-02-10", categoria: "casa" });
  assert.equal(bad.status, 400);
  assert.equal((await A.post("/api/despesas", { descricao: "x", valor: 0, data: "2026-02-10", categoria: "casa" })).status, 400);
  assert.equal((await A.post("/api/despesas", { descricao: "x", valor: 5, data: "2026-02-30", categoria: "casa" })).status, 400);
  const c = await A.post("/api/despesas", { descricao: "Aluguel", valor: 1000, data: "2026-02-05", categoria: "Casa", pago: true, recorrente: true });
  assert.equal(c.status, 201);
  assert.equal(c.json.expense.pago, false, "pago deve nascer false");
  assert.equal(c.json.expense.categoria, "casa");
  assert.equal(c.json.expense.recorrente, true);
  const id = c.json.expense.id;
  const list = await A.get("/api/despesas?month=2&year=2026");
  assert.equal(list.json.expenses.length, 1);
  assert.deepEqual(list.json.previousExpenses, []);
  const p1 = await A.patch(`/api/despesas/${id}`, { pago: true });
  assert.equal(p1.json.expense.pago, true);
  const p2 = await A.patch(`/api/despesas/${id}`, { descricao: "Aluguel jan", valor: 1100.5, data: "2026-02-06", categoria: "contas", recorrente: false });
  assert.equal(p2.json.expense.pago, true, "editar preserva pago");
  assert.equal(p2.json.expense.valor, 1100.5);
  assert.equal(p2.json.expense.categoria, "contas");
  assert.equal((await A.patch(`/api/despesas/${id}`, {})).status, 400);
  assert.equal((await A.del(`/api/despesas/${id}`)).json.ok, true);
  assert.equal((await A.get("/api/despesas?month=2&year=2026")).json.expenses.length, 0);
});

// ---------- ISOLAMENTO ENTRE USUARIOS ----------
let expA;
await test("usuario B nao le nem altera despesa do usuario A", async () => {
  expA = (await A.post("/api/despesas", { descricao: "Segredo do A", valor: 77, data: "2026-02-10", categoria: "lazer" })).json.expense;
  assert.equal((await B.post("/api/auth/signup", { email: emailB, password: PASS })).status, 201);
  // B sem assinatura: 402
  assert.equal((await B.get("/api/despesas?month=2&year=2026")).status, 402);
  // Da a B uma assinatura valida para testar isolamento por user_id.
  const idB = (await db.execute({ sql: "SELECT id FROM users WHERE email=?", args: [emailB] })).rows[0].id;
  await db.execute({
    sql: "INSERT INTO subscriptions (id,user_id,plan_id,status,current_period_end) VALUES (?,?,?,?,?)",
    args: [randomUUID(), idB, "11111111-1111-4111-8111-111111111111", "active", new Date(Date.now() + 5 * 86400000).toISOString()],
  });
  const list = await B.get("/api/despesas?month=2&year=2026");
  assert.equal(list.status, 200);
  assert.equal(list.json.expenses.length, 0);
  assert.equal((await B.patch(`/api/despesas/${expA.id}`, { descricao: "hack", pago: true })).status, 404);
  assert.equal((await B.del(`/api/despesas/${expA.id}`)).status, 404);
  // user_id no corpo e ignorado.
  const mine = await B.post("/api/despesas", { descricao: "do B", valor: 5, data: "2026-02-11", categoria: "casa", user_id: "outro" });
  const row = (await db.execute({ sql: "SELECT user_id FROM despesas WHERE id=?", args: [mine.json.expense.id] })).rows[0];
  assert.equal(row.user_id, idB);
  const still = (await A.get("/api/despesas?month=2&year=2026")).json.expenses;
  assert.equal(still.length, 1);
  assert.equal(still[0].descricao, "Segredo do A");
  assert.equal(still[0].pago, false);
});

// ---------- IMPORTAR GASTOS FIXOS ----------
await test("importar fixos: mantem dia (limite de fim de mes), pago=0, so recorrentes, 409 no segundo clique", async () => {
  const { month, year } = monthYear(); // destino: fevereiro/2026; origem: janeiro
  const jan31 = await A.post("/api/despesas", { descricao: "Internet", valor: 100, data: "2026-01-31", categoria: "contas", recorrente: true });
  await A.patch(`/api/despesas/${jan31.json.expense.id}`, { pago: true });
  await A.post("/api/despesas", { descricao: "Avulsa", valor: 10, data: "2026-01-15", categoria: "outros", recorrente: false });
  // fevereiro de A ja tem item ("Segredo do A") -> 409
  assert.equal((await A.post("/api/despesas/import-recorrentes", { month, year })).status, 409);
  // marco/2026 esta vazio e fevereiro nao tem recorrente: nada a importar
  assert.equal((await A.post("/api/despesas/import-recorrentes", { month: 3, year: 2026 })).status, 404);
  // Abril/2026 vazio, origem marco com recorrente dia 31 -> 30
  await A.post("/api/despesas", { descricao: "Plano", valor: 50, data: "2026-03-31", categoria: "saude", recorrente: true });
  const r = await A.post("/api/despesas/import-recorrentes", { month: 4, year: 2026 });
  assert.equal(r.status, 201);
  assert.equal(r.json.imported, 1);
  assert.equal(r.json.expenses[0].data, "2026-04-30");
  assert.equal(r.json.expenses[0].pago, false);
  assert.equal(r.json.expenses[0].recorrente, true);
  assert.equal(r.json.expenses[0].categoria, "saude");
  assert.equal((await A.post("/api/despesas/import-recorrentes", { month: 4, year: 2026 })).status, 409);
  // 31/jan -> fevereiro (28 em 2026), pagando o dia certo: limpa fev e importa
  await db.execute({ sql: "DELETE FROM despesas WHERE user_id=(SELECT id FROM users WHERE email=?) AND data LIKE '2026-02-%'", args: [emailA] });
  const feb = await A.post("/api/despesas/import-recorrentes", { month, year });
  assert.equal(feb.status, 201);
  assert.equal(feb.json.imported, 1, "so a recorrente de janeiro, nao a avulsa");
  assert.equal(feb.json.expenses[0].data, "2026-02-28");
  assert.equal(feb.json.expenses[0].pago, false, "importacao zera pago");
});
await test("listagem devolve mes anterior (dez do ano anterior para janeiro)", async () => {
  await A.post("/api/despesas", { descricao: "Dez", valor: 9, data: "2025-12-31", categoria: "casa" });
  const r = await A.get("/api/despesas?month=1&year=2026");
  assert.ok(r.json.previousExpenses.some((e) => e.descricao === "Dez"));
  assert.equal((await A.get("/api/despesas?month=13&year=2026")).status, 400);
});

// ---------- LINK CHECKOUT ----------
await test("link-checkout: sem login 401; token inexistente 404; conta de outro usuario 409", async () => {
  assert.equal((await new Client().post("/api/billing/link-checkout", { checkout_token: tokenA })).status, 401);
  assert.equal((await A.post("/api/billing/link-checkout", { checkout_token: randomUUID() })).status, 404);
  assert.equal((await B.post("/api/billing/link-checkout", { checkout_token: tokenA })).status, 409);
});
await test("link-checkout do dono ja pago/ativado: ok sem deslocar o periodo", async () => {
  const before = (await sub(emailA))[0].current_period_end;
  const r = await A.post("/api/billing/link-checkout", { checkout_token: tokenA });
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.ok(r.json.subscription_id);
  assert.equal((await sub(emailA))[0].current_period_end, before);
  const again = await A.post("/api/billing/link-checkout", { checkout_token: tokenA });
  assert.deepEqual(again.json, { ok: true, already_linked: true });
});
await test("voltar do MP sem webhook: link-checkout confirma via busca approved e libera", async () => {
  assert.equal((await C.post("/api/auth/signup", { email: emailC, password: PASS })).status, 201);
  const co = await C.post("/api/billing/create-checkout", { plan_slug: "basic_monthly", payer_email: emailC });
  const token = co.json.checkout_token;
  const prefId = co.json.preference_id;
  assert.equal((await C.get("/api/billing/me")).json.access, false);
  // 1) pagamento ainda nao aprovado na busca -> vincula mas nao libera
  mp.searchResults.set(token, [{ id: 1, status: "pending", external_reference: token }]);
  const r1 = await C.post("/api/billing/link-checkout", { checkout_token: token });
  assert.equal(r1.status, 200);
  assert.equal((await C.get("/api/billing/me")).json.access, false);
  // 2) preference diferente: nao conta como pago
  mp.searchResults.set(token, [{ id: 2, status: "approved", external_reference: token, preference_id: "outra-pref" }]);
  await C.post("/api/billing/link-checkout", { checkout_token: token });
  assert.equal((await C.get("/api/billing/me")).json.access, false);
  // 3) approved com a preference certa -> libera
  mp.searchResults.set(token, [{ id: 3, status: "approved", external_reference: token, preference_id: prefId }]);
  const r3 = await C.post("/api/billing/link-checkout", { checkout_token: token });
  assert.equal(r3.status, 200);
  const me = (await C.get("/api/billing/me")).json;
  assert.equal(me.access, true);
  const d = daysFromNow(me.subscription.current_period_end);
  assert.ok(d > 29.9 && d < 30.1);
  const s = (await db.execute({ sql: "SELECT status FROM checkout_sessions WHERE token=?", args: [token] })).rows[0];
  assert.equal(s.status, "linked");
});
await test("segundo pagamento do mesmo usuario atualiza a linha aberta (nao cria segunda) e REDEFINE o fim", async () => {
  // C tem assinatura ativa; novo checkout nao derruba o acesso.
  const co = await C.post("/api/billing/create-checkout", { plan_slug: "basic_monthly", payer_email: emailC });
  assert.equal((await C.get("/api/billing/me")).json.access, true, "renovar nao pode tirar o acesso");
  // encurta o periodo para provar que o pagamento redefine (nao soma sobre o fim anterior)
  const soon = new Date(Date.now() + 2 * 86400000).toISOString();
  await db.execute({ sql: "UPDATE subscriptions SET current_period_end=? WHERE user_id=(SELECT id FROM users WHERE email=?)", args: [soon, emailC] });
  mp.payments.set(`pay-${run}-c2`, { id: `pay-${run}-c2`, status: "approved", external_reference: co.json.checkout_token });
  const w = signedWebhook(`pay-${run}-c2`);
  assert.equal((await new Client().post("/api/billing/mercadopago-webhook", w.body, w.headers)).status, 200);
  const subs = await sub(emailC);
  assert.equal(subs.length, 1);
  assert.equal(subs[0].status, "active");
  const d = daysFromNow(subs[0].current_period_end);
  assert.ok(d > 29.9 && d < 30.1, `fim=${d} (deve ser ~30, nao 32)`);
});

// ---------- REGRA DE ACESSO / TOLERANCIA ----------
await test("past_due ate 3 dias de tolerancia entra; alem disso nao. active vencido nao entra", async () => {
  const idC = (await db.execute({ sql: "SELECT id FROM users WHERE email=?", args: [emailC] })).rows[0].id;
  const set = (status, ms) =>
    db.execute({ sql: "UPDATE subscriptions SET status=?, current_period_end=? WHERE user_id=?", args: [status, new Date(Date.now() + ms).toISOString(), idC] });
  const ok = async () => (await C.get("/api/despesas?month=2&year=2026")).status;
  await set("past_due", -2 * 86400000);
  assert.equal(await ok(), 200);
  assert.equal((await C.get("/api/billing/me")).json.access, true);
  await set("past_due", -4 * 86400000);
  assert.equal(await ok(), 402);
  await set("active", -60000);
  assert.equal(await ok(), 402, "active vencido nao tem tolerancia");
  await set("active", 60000);
  assert.equal(await ok(), 200);
  await set("canceled", 86400000);
  assert.equal(await ok(), 402);
});
await test("admin (ADMIN_EMAILS) ignora a trava mesmo sem assinatura", async () => {
  const r = await ADMIN.post("/api/auth/signup", { email: "admin@test.com", password: PASS });
  assert.ok(r.status === 201 || r.status === 409);
  if (r.status === 409) await ADMIN.post("/api/auth/login", { email: "admin@test.com", password: PASS });
  assert.equal((await ADMIN.get("/api/despesas?month=2&year=2026")).status, 200);
  const me = (await ADMIN.get("/api/billing/me")).json;
  assert.equal(me.isAdmin, true);
  assert.equal(me.access, true);
});

// ---------- RECUPERAR / REDEFINIR SENHA ----------
await test("forgot-password em producao sem RESEND_API_KEY: 503 e nao grava token", async () => {
  const before = (await db.execute("SELECT COUNT(*) n FROM password_reset_tokens")).rows[0].n;
  const r = await new Client().post("/api/auth/forgot-password", { email: emailA });
  if (process.env.RESEND_API_KEY) {
    assert.equal(r.status, 200);
  } else {
    assert.equal(r.status, 503);
    assert.equal(r.json.message, "Recuperacao de senha indisponivel.");
    assert.equal((await db.execute("SELECT COUNT(*) n FROM password_reset_tokens")).rows[0].n, before);
  }
});
await test("reset-password: token invalido 400; valido troca senha, marca usado e derruba sessoes; nao reutiliza", async () => {
  assert.equal((await new Client().post("/api/auth/reset-password", { token: "inventado", password: "nova-senha-123" })).status, 400);
  const idA = (await db.execute({ sql: "SELECT id FROM users WHERE email=?", args: [emailA] })).rows[0].id;
  const token = randomUUID() + randomUUID();
  await db.execute({
    sql: "INSERT INTO password_reset_tokens (id,user_id,token_hash,expires_at) VALUES (?,?,?,?)",
    args: [randomUUID(), idA, sha256(token), new Date(Date.now() + 3600000).toISOString()],
  });
  const expired = randomUUID();
  await db.execute({
    sql: "INSERT INTO password_reset_tokens (id,user_id,token_hash,expires_at) VALUES (?,?,?,?)",
    args: [randomUUID(), idA, sha256(expired), new Date(Date.now() - 1000).toISOString()],
  });
  assert.equal((await new Client().post("/api/auth/reset-password", { token: expired, password: "nova-senha-123" })).status, 400);
  assert.equal((await new Client().post("/api/auth/reset-password", { token, password: "curta" })).status, 400);
  assert.equal((await new Client().post("/api/auth/reset-password", { token, password: "nova-senha-123" })).status, 200);
  assert.equal((await new Client().post("/api/auth/reset-password", { token, password: "outra-senha-123" })).status, 400, "uso unico");
  assert.equal((await A.get("/api/auth/me")).json.user, null, "sessoes antigas invalidadas");
  assert.equal((await new Client().post("/api/auth/login", { email: emailA, password: PASS })).status, 401);
  assert.equal((await A.post("/api/auth/login", { email: emailA, password: "nova-senha-123" })).status, 200);
});
await test("logout apaga a sessao no banco e o JWT antigo para de valer", async () => {
  const oldCookie = A.cookie;
  assert.equal((await A.post("/api/auth/logout")).status, 200);
  assert.equal((await A.get("/api/auth/me")).json.user, null);
  const replay = new Client();
  replay.cookie = oldCookie;
  assert.equal((await replay.get("/api/auth/me")).json.user, null);
});

mpServer.close();
console.log(`\n${passed} verificacoes passaram${process.exitCode ? " (HOUVE FALHAS)" : ""}.`);
process.exit(process.exitCode || 0);
