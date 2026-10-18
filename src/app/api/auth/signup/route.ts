import { asString, fail, isValidEmail, json, normalizeEmail, readJson } from "@/server/http";
import { db, isUniqueViolation, nowIso, uuid } from "@/server/db";
import { createSession, hashPassword, MIN_PASSWORD_LENGTH, setSessionCookie } from "@/server/session";

export async function POST(req: Request) {
  const body = await readJson(req);
  if (!body) return fail(400, "invalid_body");

  const email = normalizeEmail(body.email);
  const password = asString(body.password);

  if (!isValidEmail(email)) return fail(400, "invalid_email", "Informe um email valido.");
  if (password.length < MIN_PASSWORD_LENGTH) {
    return fail(400, "weak_password", `A senha precisa ter no minimo ${MIN_PASSWORD_LENGTH} caracteres.`);
  }
  if (Buffer.byteLength(password, "utf8") > 72) {
    return fail(400, "weak_password", "A senha pode ter no maximo 72 caracteres.");
  }

  const userId = uuid();
  const passwordHash = await hashPassword(password);
  try {
    await db().execute({
      sql: "INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)",
      args: [userId, email, passwordHash, nowIso()],
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return fail(409, "email_exists", "Este email ja existe. Entre com a senha ou recupere a senha.");
    }
    throw error;
  }

  // Sem confirmacao de e-mail: o cadastro ja entra na sessao.
  const { token, expiresAt } = await createSession(userId);
  await setSessionCookie(token, expiresAt);
  return json({ user: { id: userId, email } }, 201);
}
