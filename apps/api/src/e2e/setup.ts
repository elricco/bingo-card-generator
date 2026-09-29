import type { FastifyInstance } from "fastify";
import type { OAuthProvider, OAuthUserInfo } from "../auth/types";
import { upsertUserFromTwitch } from "../db/users";
import { createSession } from "../auth/session";
import { setSessionCookie } from "../auth/current-user";

export const E2E_USERS: Record<string, OAuthUserInfo> = {
  streamerin: {
    providerId: "e2e-streamerin",
    login: "e2e_streamerin",
    displayName: "E2E Streamerin",
    avatarUrl: null,
  },
  andere: {
    providerId: "e2e-andere",
    login: "e2e_andere",
    displayName: "E2E Andere Nutzerin",
    avatarUrl: null,
  },
};

export function createE2EProvider(): OAuthProvider {
  return {
    name: "e2e-fake",
    getAuthorizationUrl: (state, redirectUri) =>
      `/e2e/bridge?state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(redirectUri)}`,
    exchangeCode: async () => E2E_USERS.streamerin,
  };
}

export function registerE2ERoutes(app: FastifyInstance): void {
  app.get<{ Querystring: { state: string; redirect_uri: string } }>(
    "/e2e/bridge",
    async (request, reply) => {
      const { state, redirect_uri } = request.query;
      const url = new URL(redirect_uri);
      url.searchParams.set("code", "streamerin");
      url.searchParams.set("state", state);
      return reply.redirect(url.toString());
    }
  );

  app.get<{ Params: { userKey: string } }>("/e2e/login/:userKey", async (request, reply) => {
    const userInfo = E2E_USERS[request.params.userKey];
    if (!userInfo) {
      return reply.status(404).send({ error: "Unbekannter E2E-Testnutzer" });
    }
    const user = await upsertUserFromTwitch(userInfo);
    const session = await createSession(user.id);
    setSessionCookie(reply, session.id, session.expiresAt);
    const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:5173";
    return reply.redirect(`${webOrigin}/boards`);
  });
}
