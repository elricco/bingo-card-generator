import type { FastifyInstance } from "fastify";
import type { OAuthProvider, OAuthUserInfo } from "../auth/types";

export function createFakeProvider(userInfo: OAuthUserInfo): OAuthProvider {
  return {
    name: "fake",
    getAuthorizationUrl: (state, redirectUri) =>
      `https://fake-provider.test/authorize?state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`,
    exchangeCode: async () => userInfo,
  };
}

export function extractCookie(
  setCookieHeader: string | string[] | undefined,
  name: string
): string | undefined {
  const headers = Array.isArray(setCookieHeader) ? setCookieHeader : setCookieHeader ? [setCookieHeader] : [];
  const match = headers.find((h) => h.startsWith(`${name}=`));
  const raw = match?.split(";")[0].split("=")[1];
  return raw === undefined ? undefined : decodeURIComponent(raw);
}

export async function loginViaFakeProvider(
  app: FastifyInstance,
  userInfo: OAuthUserInfo
): Promise<string> {
  const stateResponse = await app.inject({ method: "GET", url: "/auth/twitch" });
  const stateCookie = extractCookie(stateResponse.headers["set-cookie"], "oauth_state");
  const state = new URL(stateResponse.headers.location as string).searchParams.get("state");

  const callbackResponse = await app.inject({
    method: "GET",
    url: `/auth/twitch/callback?code=whatever&state=${state}`,
    cookies: { oauth_state: stateCookie ?? "" },
  });

  const sessionCookie = extractCookie(callbackResponse.headers["set-cookie"], "session");
  if (!sessionCookie) {
    throw new Error("Login über Fake-Provider fehlgeschlagen: kein session-Cookie erhalten");
  }
  return sessionCookie;
}
