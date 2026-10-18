import { json } from "@/server/http";
import { getSession, renewSessionIfNeeded } from "@/server/session";

export async function GET(req: Request) {
  const session = await getSession(req);
  if (!session) return json({ user: null });
  await renewSessionIfNeeded(session);
  return json({ user: { id: session.user.id, email: session.user.email } });
}
