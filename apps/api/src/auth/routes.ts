import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { OAuthProvider } from "./types";
import { createTwitchProvider } from "./twitch";
import { createSession, deleteSession } from "./session";
import { upsertUserFromTwitch } from "../db/users";
import {
  clearSessionCookie,
  getCurrentUser,
  getSessionIdFromRequest,
  setSessionCookie,
} from "./current-user";

const STATE_COOKIE_NAME = "oauth_state";
const STATE_COOKIE_MAX_AGE_SECONDS = 600;

export interface RegisterAuthRoutesOptions {
  provider?: OAuthProvider;
}

function createDefaultTwitchProvider(): OAuthProvider {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("TWITCH_CLIENT_ID und TWITCH_CLIENT_SECRET müssen gesetzt sein");
  }
  return createTwitchProvider(clientId, clientSecret);
}

function getRedirectUri(): string {
  const redirectUri = process.env.TWITCH_REDIRECT_URI;
  if (!redirectUri) {
    throw new Error("TWITCH_REDIRECT_URI muss gesetzt sein");
  }
  return redirectUri;
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  options: RegisterAuthRoutesOptions = {}
): Promise<void> {
  const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:5173";
  const getProvider = (): OAuthProvider => options.provider ?? createDefaultTwitchProvider();

  app.get("/auth/twitch", async (_request, reply) => {
    const provider = getProvider();
    const redirectUri = getRedirectUri();
    const state = randomBytes(16).toString("hex");

    reply.setCookie(STATE_COOKIE_NAME, state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: STATE_COOKIE_MAX_AGE_SECONDS,
    });

    return reply.redirect(provider.getAuthorizationUrl(state, redirectUri));
  });

  app.get<{ Querystring: { code?: string; state?: string } }>(
    "/auth/twitch/callback",
    async (request, reply) => {
      const provider = getProvider();
      const redirectUri = getRedirectUri();
      const { code, state } = request.query;
      const cookieState = request.cookies[STATE_COOKIE_NAME];

      reply.clearCookie(STATE_COOKIE_NAME, { path: "/" });

      if (!code || !state || !cookieState || state !== cookieState) {
        return reply.redirect(`${webOrigin}/?error=oauth_state`);
      }

      let userInfo;
      try {
        userInfo = await provider.exchangeCode(code, redirectUri);
      } catch (err) {
        request.log.error(err);
        return reply.redirect(`${webOrigin}/?error=oauth_exchange`);
      }

      const user = await upsertUserFromTwitch(userInfo);
      const session = await createSession(user.id);
      setSessionCookie(reply, session.id, session.expiresAt);

      return reply.redirect(`${webOrigin}/boards`);
    }
  );

  app.post("/auth/logout", async (request, reply) => {
    const sessionId = getSessionIdFromRequest(request);
    if (sessionId) {
      await deleteSession(sessionId);
    }
    clearSessionCookie(reply);
    return reply.status(204).send();
  });

  app.get("/api/me", async (request, reply) => {
    const user = await getCurrentUser(request);
    if (!user) {
      return reply.status(401).send({ error: "Nicht eingeloggt" });
    }
    return user;
  });
}
