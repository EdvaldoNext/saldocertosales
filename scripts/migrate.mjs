// Aplica as migracoes de db/migrations/*.sql no banco apontado por TURSO_DATABASE_URL.
// Uso: npm run migrate   (le .env.local automaticamente)
import { createClient } from "@libsql/client";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN || undefined;

if (!url) {
  console.error("TURSO_DATABASE_URL nao definido. Preencha o .env.local.");
  process.exit(1);
}

const client = createClient({ url, authToken });

await client.execute(
  `CREATE TABLE IF NOT EXISTS _migrations (
     name TEXT PRIMARY KEY,
     applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
   )`,
);

const dir = path.join(root, "db", "migrations");
const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
const applied = new Set((await client.execute("SELECT name FROM _migrations")).rows.map((r) => String(r.name)));

let count = 0;
for (const file of files) {
  if (applied.has(file)) {
    console.log(`= ${file} (ja aplicada)`);
    continue;
  }
  const sql = await readFile(path.join(dir, file), "utf8");
  console.log(`> aplicando ${file} ...`);
  await client.executeMultiple(sql);
  await client.execute({ sql: "INSERT INTO _migrations (name) VALUES (?)", args: [file] });
  count += 1;
}

console.log(count ? `OK: ${count} migracao(oes) aplicada(s).` : "Nada a aplicar.");

const plans = await client.execute("SELECT slug, price_brl FROM plans");
console.log("plans:", plans.rows.map((r) => `${r.slug}=${r.price_brl}`).join(", ") || "(vazio)");
client.close();
