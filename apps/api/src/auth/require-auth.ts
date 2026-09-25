import type { FastifyReply, FastifyRequest } from "fastify";
import { getCurrentUser, type AuthUser } from "./current-user";

export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<AuthUser | null> {
  const user = await getCurrentUser(request);
  if (!user) {
    reply.status(401).send({ error: "Nicht eingeloggt" });
    return null;
  }
  return user;
}
