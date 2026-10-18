import { json } from "@/server/http";
import { clearSessionCookie, destroySession, getSession } from "@/server/session";

export async function POST(req: Request) {
  const session = await getSession(req);
  if (session) await destroySession(session.sessionId);
  await clearSessionCookie();
  return json({ ok: true });
}
