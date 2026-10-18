import { db, nowIso, str } from "@/server/db";
import { asString, fail, json, readJson } from "@/server/http";
import { hashPassword, MIN_PASSWORD_LENGTH, sha256Hex } from "@/server/session";

export async function POST(req: Request) {
  const body = await readJson(req);
  if (!body) return fail(400, "invalid_body");

  const token = asString(body.token).trim();
  const password = asString(body.password);

  if (!token) return fail(400, "invalid_token", "Link de redefinicao invalido ou expirado.");
  if (password.length < MIN_PASSWORD_LENGTH) {
    return fail(400, "weak_password", `A senha precisa ter no minimo ${MIN_PASSWORD_LENGTH} caracteres.`);
  }
  if (Buffer.byteLength(password, "utf8") > 72) {
    return fail(400, "weak_password", "A senha pode ter no maximo 72 caracteres.");
  }

  const now = nowIso();
  const found = await db().execute({
    sql: `SELECT id, user_id FROM password_reset_tokens
          WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?`,
    args: [sha256Hex(token), now],
  });
  const row = found.rows[0];
  if (!row) return fail(400, "invalid_token", "Link de redefinicao invalido ou expirado.");

  const tokenId = str(row, "id");
  const userId = str(row, "user_id");
  const passwordHash = await hashPassword(password);

  // Transacao: marca o token (uso unico), troca a senha e derruba todas as sessoes do usuario.
  const tx = await db().transaction("write");
  try {
    const claimed = await tx.execute({
      sql: "UPDATE password_reset_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL",
      args: [now, tokenId],
    });
    if (claimed.rowsAffected === 0) {
      await tx.rollback();
      return fail(400, "invalid_token", "Link de redefinicao invalido ou expirado.");
    }
    await tx.execute({ sql: "UPDATE users SET password_hash = ? WHERE id = ?", args: [passwordHash, userId] });
    await tx.execute({ sql: "DELETE FROM sessions WHERE user_id = ?", args: [userId] });
    await tx.commit();
  } catch (error) {
    await tx.rollback().catch(() => {});
    throw error;
  } finally {
    tx.close();
  }

  return json({ ok: true });
}
