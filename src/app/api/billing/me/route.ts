import { buildBillingMe } from "@/server/access";
import { json } from "@/server/http";
import { requireSession } from "@/server/session";

/** Funciona para qualquer usuario logado, com ou sem acesso (a tela Conta precisa existir). */
export async function GET(req: Request) {
  const auth = await requireSession(req, { allowBearer: true });
  if (auth instanceof Response) return auth;
  return json(await buildBillingMe(auth.user));
}
