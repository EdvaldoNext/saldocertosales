import { randomBytes } from "node:crypto";
import { db, str, uuid } from "@/server/db";
import { appUrl, isDevelopment } from "@/server/env";
import { emailEnabled, sendResetEmail } from "@/server/email";
import { fail, json, normalizeEmail, readJson } from "@/server/http";
import { sha256Hex } from "@/server/session";

const GENERIC_OK = "Se o email existir, enviaremos as instrucoes.";
const RESET_VALID_MS = 60 * 60 * 1000;

export async function POST(req: Request) {
  const body = await readJson(req);
  if (!body) return fail(400, "invalid_body");
  const email = normalizeEmail(body.email);
  if (!email) return fail(400, "invalid_email", "Informe seu email para recuperar a senha.");

  const canEmail = emailEnabled();
  // Sem chave: so em desenvolvimento o link vai para o log. Fora disso nao grava token e responde 503.
  if (!canEmail && !isDevelopment()) {
    return fail(503, "reset_unavailable", "Recuperacao de senha indisponivel.");
  }

  const result = await db().execute({ sql: "SELECT id, email FROM users WHERE email = ?", args: [email] });
  const row = result.rows[0];

  if (row) {
    const userId = str(row, "id");
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + RESET_VALID_MS).toISOString();

    // Um pedido novo invalida os links anteriores ainda nao usados.
    await db().batch(
      [
        { sql: "DELETE FROM password_reset_tokens WHERE user_id = ? AND used_at IS NULL", args: [userId] },
        {
          sql: "INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)",
          args: [uuid(), userId, sha256Hex(token), expiresAt],
        },
      ],
      "write",
    );

    const link = `${appUrl()}/?reset=${token}`;
    if (canEmail) {
      try {
        await sendResetEmail(str(row, "email"), link);
      } catch (error) {
        // Nao vaza a falha para o cliente (nao revelar se a conta existe).
        console.error("[forgot-password] falha ao enviar e-mail:", error);
      }
    } else {
      console.log(`[forgot-password] (dev, sem RESEND_API_KEY) link de redefinicao para ${email}: ${link}`);
    }
  }

  return json({ ok: true, message: GENERIC_OK });
}
