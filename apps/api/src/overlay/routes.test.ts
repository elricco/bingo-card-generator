import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import "../env";
import { buildServer } from "../server";
import { db } from "../db/client";
import { users } from "../db/schema";
import { createFakeProvider, loginViaFakeProvider } from "../test-helpers/auth";

async function createBoardViaApi(twitchId: string) {
  const app = await buildServer({
    authProvider: createFakeProvider({
      providerId: twitchId,
      login: twitchId,
      displayName: twitchId,
      avatarUrl: null,
    }),
  });
  const sessionCookie = await loginViaFakeProvider(app, {
    providerId: twitchId,
    login: twitchId,
    displayName: twitchId,
    avatarUrl: null,
  });
  const [user] = await db.select().from(users).where(eq(users.twitchId, twitchId));

  const createResponse = await app.inject({
    method: "POST",
    url: "/api/boards",
    cookies: { session: sessionCookie },
    payload: { name: "Mein Board", size: 3, label_mode: "letters" },
  });

  return {
    app,
    sessionCookie,
    userId: user.id,
    boardId: createResponse.json().id,
    token: createResponse.json().overlayToken,
  };
}

describe("GET /api/overlay/:token", () => {
  const createdUserIds: string[] = [];

  afterEach(async () => {
    for (const id of createdUserIds.splice(0)) {
      await db.delete(users).where(eq(users.id, id));
    }
  });

  it("liefert die öffentlichen Boarddaten ohne Login", async () => {
    const twitchId = `overlay-test-get-${Date.now()}`;
    const { app, userId, token } = await createBoardViaApi(twitchId);
    createdUserIds.push(userId);

    const response = await app.inject({ method: "GET", url: `/api/overlay/${token}` });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.size).toBe(3);
    expect(body.labelMode).toBe("letters");
    expect(body.cells).toHaveLength(9);
    expect(body).not.toHaveProperty("id");
    expect(body).not.toHaveProperty("userId");
    expect(body).not.toHaveProperty("overlayToken");
    expect(body).not.toHaveProperty("name");
  });

  it("liefert 404 für einen ungültigen Token", async () => {
    const app = await buildServer();

    const response = await app.inject({ method: "GET", url: "/api/overlay/token-existiert-nicht" });

    expect(response.statusCode).toBe(404);
  });
});

describe("GET /api/overlay/:token/events", () => {
  const createdUserIds: string[] = [];

  afterEach(async () => {
    for (const id of createdUserIds.splice(0)) {
      await db.delete(users).where(eq(users.id, id));
    }
  });

  it("sendet SSE-Header und den initialen Board-Zustand als erstes Event", async () => {
    const twitchId = `overlay-test-sse-initial-${Date.now()}`;
    const { app, userId, token } = await createBoardViaApi(twitchId);
    createdUserIds.push(userId);

    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    try {
      const response = await fetch(`${address}/api/overlay/${token}/events`);
      expect(response.headers.get("content-type")).toContain("text/event-stream");

      const reader = response.body!.getReader();
      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);

      expect(text).toContain("event: board-update");
      expect(text).toContain('"size":3');

      await reader.cancel();
    } finally {
      await app.close();
    }
  });

  it("sendet ein neues Event nach einer Änderung über PATCH", async () => {
    const twitchId = `overlay-test-sse-live-${Date.now()}`;
    const { app, userId, sessionCookie, boardId, token } = await createBoardViaApi(twitchId);
    createdUserIds.push(userId);

    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    try {
      const response = await fetch(`${address}/api/overlay/${token}/events`);
      const reader = response.body!.getReader();
      await reader.read();

      await app.inject({
        method: "PATCH",
        url: `/api/boards/${boardId}`,
        cookies: { session: sessionCookie },
        payload: { name: "Neuer Name" },
      });

      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);
      expect(text).toContain("event: board-update");

      await reader.cancel();
    } finally {
      await app.close();
    }
  });

  it("liefert 404 für einen ungültigen Token", async () => {
    const app = await buildServer();

    const response = await app.inject({
      method: "GET",
      url: "/api/overlay/token-existiert-nicht/events",
    });

    expect(response.statusCode).toBe(404);
  });
});
