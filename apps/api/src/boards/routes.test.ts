import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import "../env";
import { buildServer } from "../server";
import { db } from "../db/client";
import { users } from "../db/schema";
import { createFakeProvider, loginViaFakeProvider } from "../test-helpers/auth";

describe("POST /api/boards", () => {
  const createdUserIds: string[] = [];

  afterEach(async () => {
    for (const id of createdUserIds.splice(0)) {
      await db.delete(users).where(eq(users.id, id));
    }
  });

  it("erstellt ein Board für den eingeloggten User", async () => {
    const twitchId = `board-routes-test-${Date.now()}`;
    const app = await buildServer({
      authProvider: createFakeProvider({
        providerId: twitchId,
        login: "board-tester",
        displayName: "Board Tester",
        avatarUrl: null,
      }),
    });
    const sessionCookie = await loginViaFakeProvider(app, {
      providerId: twitchId,
      login: "board-tester",
      displayName: "Board Tester",
      avatarUrl: null,
    });

    const [user] = await db.select().from(users).where(eq(users.twitchId, twitchId));
    createdUserIds.push(user.id);

    const response = await app.inject({
      method: "POST",
      url: "/api/boards",
      cookies: { session: sessionCookie },
      payload: { name: "Mein Board", size: 3, label_mode: "letters" },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.name).toBe("Mein Board");
    expect(body.size).toBe(3);
  });

  it("lehnt ungültigen Body mit 400 ab", async () => {
    const twitchId = `board-routes-test-invalid-${Date.now()}`;
    const app = await buildServer({
      authProvider: createFakeProvider({
        providerId: twitchId,
        login: "board-tester-2",
        displayName: "Board Tester 2",
        avatarUrl: null,
      }),
    });
    const sessionCookie = await loginViaFakeProvider(app, {
      providerId: twitchId,
      login: "board-tester-2",
      displayName: "Board Tester 2",
      avatarUrl: null,
    });

    const [user] = await db.select().from(users).where(eq(users.twitchId, twitchId));
    createdUserIds.push(user.id);

    const response = await app.inject({
      method: "POST",
      url: "/api/boards",
      cookies: { session: sessionCookie },
      payload: { name: "Mein Board", size: 3, label_mode: "bingo" },
    });

    expect(response.statusCode).toBe(400);
  });

  it("liefert 401 ohne Session", async () => {
    const app = await buildServer();
    const response = await app.inject({
      method: "POST",
      url: "/api/boards",
      payload: { name: "Mein Board", size: 3, label_mode: "letters" },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe("GET /api/boards", () => {
  const createdUserIds: string[] = [];

  afterEach(async () => {
    for (const id of createdUserIds.splice(0)) {
      await db.delete(users).where(eq(users.id, id));
    }
  });

  it("liefert nur die eigenen Boards des eingeloggten Users", async () => {
    const twitchIdA = `board-routes-list-a-${Date.now()}`;
    const twitchIdB = `board-routes-list-b-${Date.now()}`;

    const appA = await buildServer({
      authProvider: createFakeProvider({
        providerId: twitchIdA,
        login: "user-a",
        displayName: "User A",
        avatarUrl: null,
      }),
    });
    const sessionA = await loginViaFakeProvider(appA, {
      providerId: twitchIdA,
      login: "user-a",
      displayName: "User A",
      avatarUrl: null,
    });

    const appB = await buildServer({
      authProvider: createFakeProvider({
        providerId: twitchIdB,
        login: "user-b",
        displayName: "User B",
        avatarUrl: null,
      }),
    });
    const sessionB = await loginViaFakeProvider(appB, {
      providerId: twitchIdB,
      login: "user-b",
      displayName: "User B",
      avatarUrl: null,
    });

    const [userA] = await db.select().from(users).where(eq(users.twitchId, twitchIdA));
    const [userB] = await db.select().from(users).where(eq(users.twitchId, twitchIdB));
    createdUserIds.push(userA.id, userB.id);

    await appA.inject({
      method: "POST",
      url: "/api/boards",
      cookies: { session: sessionA },
      payload: { name: "Board von A", size: 3, label_mode: "letters" },
    });
    await appB.inject({
      method: "POST",
      url: "/api/boards",
      cookies: { session: sessionB },
      payload: { name: "Board von B", size: 3, label_mode: "letters" },
    });

    const response = await appA.inject({
      method: "GET",
      url: "/api/boards",
      cookies: { session: sessionA },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe("Board von A");
    expect(body[0].checkedCount).toBe(0);
  });

  it("liefert 401 ohne Session", async () => {
    const app = await buildServer();
    const response = await app.inject({ method: "GET", url: "/api/boards" });
    expect(response.statusCode).toBe(401);
  });
});
