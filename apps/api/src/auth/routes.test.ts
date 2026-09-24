import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import "../env";
import { buildServer } from "../server";
import { db } from "../db/client";
import { users } from "../db/schema";
import type { OAuthProvider, OAuthUserInfo } from "./types";

function createFakeProvider(userInfo: OAuthUserInfo): OAuthProvider {
  return {
    name: "fake",
    getAuthorizationUrl: (state, redirectUri) =>
      `https://fake-provider.test/authorize?state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`,
    exchangeCode: async () => userInfo,
  };
}

function extractCookie(setCookieHeader: string | string[] | undefined, name: string): string | undefined {
  const headers = Array.isArray(setCookieHeader) ? setCookieHeader : setCookieHeader ? [setCookieHeader] : [];
  const match = headers.find((h) => h.startsWith(`${name}=`));
  const raw = match?.split(";")[0].split("=")[1];
  // light-my-request's `cookies` inject option re-serializes (URI-encodes) whatever
  // value it's given, so the value extracted here — already URI-encoded from the
  // Set-Cookie header — must be decoded first, or it gets double-encoded on the way
  // back in and signature verification fails. See routes.test.ts self-review notes.
  return raw === undefined ? undefined : decodeURIComponent(raw);
}

describe("Auth-Routen", () => {
  const createdUserIds: string[] = [];

  afterEach(async () => {
    for (const id of createdUserIds.splice(0)) {
      await db.delete(users).where(eq(users.id, id));
    }
  });

  it("GET /auth/twitch leitet zur Autorisierungs-URL weiter und setzt ein State-Cookie", async () => {
    const app = await buildServer({
      authProvider: createFakeProvider({ providerId: "x", login: "x", displayName: "x", avatarUrl: null }),
    });

    const response = await app.inject({ method: "GET", url: "/auth/twitch" });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toContain("fake-provider.test/authorize");
    expect(extractCookie(response.headers["set-cookie"], "oauth_state")).toBeTruthy();
  });

  it("GET /auth/twitch/callback legt User+Session an und redirected zu /boards", async () => {
    const twitchId = `routes-test-${Date.now()}`;
    const app = await buildServer({
      authProvider: createFakeProvider({
        providerId: twitchId,
        login: "routes-tester",
        displayName: "Routes Tester",
        avatarUrl: "https://example.com/a.png",
      }),
    });

    const stateResponse = await app.inject({ method: "GET", url: "/auth/twitch" });
    const stateCookie = extractCookie(stateResponse.headers["set-cookie"], "oauth_state");
    const state = new URL(stateResponse.headers.location as string).searchParams.get("state");

    const callbackResponse = await app.inject({
      method: "GET",
      url: `/auth/twitch/callback?code=whatever&state=${state}`,
      cookies: { oauth_state: stateCookie ?? "" },
    });

    expect(callbackResponse.statusCode).toBe(302);
    expect(callbackResponse.headers.location).toContain("/boards");
    expect(extractCookie(callbackResponse.headers["set-cookie"], "session")).toBeTruthy();

    const [user] = await db.select().from(users).where(eq(users.twitchId, twitchId));
    expect(user).toBeDefined();
    createdUserIds.push(user.id);
  });

  it("GET /auth/twitch/callback lehnt ein falsches state ab und redirected mit Fehler", async () => {
    const app = await buildServer({
      authProvider: createFakeProvider({ providerId: "x", login: "x", displayName: "x", avatarUrl: null }),
    });

    const response = await app.inject({
      method: "GET",
      url: "/auth/twitch/callback?code=whatever&state=falsch",
      cookies: { oauth_state: "richtig" },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toContain("error=oauth_state");
  });

  it("GET /api/me liefert 401 ohne Session", async () => {
    const app = await buildServer();
    const response = await app.inject({ method: "GET", url: "/api/me" });
    expect(response.statusCode).toBe(401);
  });

  it("GET /api/me liefert den User nach erfolgreichem Login, POST /auth/logout beendet die Session", async () => {
    const twitchId = `routes-test-${Date.now()}-2`;
    const app = await buildServer({
      authProvider: createFakeProvider({
        providerId: twitchId,
        login: "me-tester",
        displayName: "Me Tester",
        avatarUrl: null,
      }),
    });

    const stateResponse = await app.inject({ method: "GET", url: "/auth/twitch" });
    const stateCookie = extractCookie(stateResponse.headers["set-cookie"], "oauth_state");
    const state = new URL(stateResponse.headers.location as string).searchParams.get("state");

    const callbackResponse = await app.inject({
      method: "GET",
      url: `/auth/twitch/callback?code=whatever&state=${state}`,
      cookies: { oauth_state: stateCookie ?? "" },
    });
    const sessionCookie = extractCookie(callbackResponse.headers["set-cookie"], "session");

    const [user] = await db.select().from(users).where(eq(users.twitchId, twitchId));
    createdUserIds.push(user.id);

    const meResponse = await app.inject({
      method: "GET",
      url: "/api/me",
      cookies: { session: sessionCookie ?? "" },
    });
    expect(meResponse.statusCode).toBe(200);
    expect(meResponse.json()).toEqual({
      id: user.id,
      login: "me-tester",
      displayName: "Me Tester",
      avatarUrl: null,
    });

    const logoutResponse = await app.inject({
      method: "POST",
      url: "/auth/logout",
      cookies: { session: sessionCookie ?? "" },
    });
    expect(logoutResponse.statusCode).toBe(204);

    const meAfterLogout = await app.inject({
      method: "GET",
      url: "/api/me",
      cookies: { session: sessionCookie ?? "" },
    });
    expect(meAfterLogout.statusCode).toBe(401);
  });
});
