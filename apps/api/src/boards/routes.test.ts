import { randomUUID } from "node:crypto";
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
    const body = response.json();
    expect(body.error).toBe("Ungültige Eingabe");
    expect(typeof body.details).toBe("object");
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

describe("GET /api/boards/:id", () => {
  const createdUserIds: string[] = [];

  afterEach(async () => {
    for (const id of createdUserIds.splice(0)) {
      await db.delete(users).where(eq(users.id, id));
    }
  });

  it("liefert das eigene Board inkl. Zellen", async () => {
    const twitchId = `board-routes-get-${Date.now()}`;
    const app = await buildServer({
      authProvider: createFakeProvider({
        providerId: twitchId,
        login: "get-tester",
        displayName: "Get Tester",
        avatarUrl: null,
      }),
    });
    const sessionCookie = await loginViaFakeProvider(app, {
      providerId: twitchId,
      login: "get-tester",
      displayName: "Get Tester",
      avatarUrl: null,
    });
    const [user] = await db.select().from(users).where(eq(users.twitchId, twitchId));
    createdUserIds.push(user.id);

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/boards",
      cookies: { session: sessionCookie },
      payload: { name: "Mein Board", size: 3, label_mode: "letters" },
    });
    const boardId = createResponse.json().id;

    const response = await app.inject({
      method: "GET",
      url: `/api/boards/${boardId}`,
      cookies: { session: sessionCookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().cells).toHaveLength(9);
  });

  it("liefert 404 statt 403 für fremdes Board", async () => {
    const twitchIdA = `board-routes-get-a-${Date.now()}`;
    const twitchIdB = `board-routes-get-b-${Date.now()}`;

    const appA = await buildServer({
      authProvider: createFakeProvider({
        providerId: twitchIdA,
        login: "get-a",
        displayName: "Get A",
        avatarUrl: null,
      }),
    });
    const sessionA = await loginViaFakeProvider(appA, {
      providerId: twitchIdA,
      login: "get-a",
      displayName: "Get A",
      avatarUrl: null,
    });

    const appB = await buildServer({
      authProvider: createFakeProvider({
        providerId: twitchIdB,
        login: "get-b",
        displayName: "Get B",
        avatarUrl: null,
      }),
    });
    const sessionB = await loginViaFakeProvider(appB, {
      providerId: twitchIdB,
      login: "get-b",
      displayName: "Get B",
      avatarUrl: null,
    });

    const [userA] = await db.select().from(users).where(eq(users.twitchId, twitchIdA));
    const [userB] = await db.select().from(users).where(eq(users.twitchId, twitchIdB));
    createdUserIds.push(userA.id, userB.id);

    const createResponse = await appA.inject({
      method: "POST",
      url: "/api/boards",
      cookies: { session: sessionA },
      payload: { name: "Board von A", size: 3, label_mode: "letters" },
    });
    const boardId = createResponse.json().id;

    const response = await appB.inject({
      method: "GET",
      url: `/api/boards/${boardId}`,
      cookies: { session: sessionB },
    });

    expect(response.statusCode).toBe(404);
  });

  it("liefert 404 für nicht existierende ID", async () => {
    const twitchId = `board-routes-get-missing-${Date.now()}`;
    const app = await buildServer({
      authProvider: createFakeProvider({
        providerId: twitchId,
        login: "get-missing",
        displayName: "Get Missing",
        avatarUrl: null,
      }),
    });
    const sessionCookie = await loginViaFakeProvider(app, {
      providerId: twitchId,
      login: "get-missing",
      displayName: "Get Missing",
      avatarUrl: null,
    });
    const [user] = await db.select().from(users).where(eq(users.twitchId, twitchId));
    createdUserIds.push(user.id);

    const response = await app.inject({
      method: "GET",
      url: `/api/boards/${randomUUID()}`,
      cookies: { session: sessionCookie },
    });

    expect(response.statusCode).toBe(404);
  });

  it("liefert 404 für eine nicht-UUID-förmige ID statt eines 500ers", async () => {
    const twitchId = `board-routes-get-malformed-${Date.now()}`;
    const app = await buildServer({
      authProvider: createFakeProvider({
        providerId: twitchId,
        login: "get-malformed",
        displayName: "Get Malformed",
        avatarUrl: null,
      }),
    });
    const sessionCookie = await loginViaFakeProvider(app, {
      providerId: twitchId,
      login: "get-malformed",
      displayName: "Get Malformed",
      avatarUrl: null,
    });
    const [user] = await db.select().from(users).where(eq(users.twitchId, twitchId));
    createdUserIds.push(user.id);

    const response = await app.inject({
      method: "GET",
      url: "/api/boards/not-a-uuid",
      cookies: { session: sessionCookie },
    });

    expect(response.statusCode).toBe(404);
  });
});

describe("DELETE /api/boards/:id", () => {
  const createdUserIds: string[] = [];

  afterEach(async () => {
    for (const id of createdUserIds.splice(0)) {
      await db.delete(users).where(eq(users.id, id));
    }
  });

  it("löscht das eigene Board", async () => {
    const twitchId = `board-routes-delete-${Date.now()}`;
    const app = await buildServer({
      authProvider: createFakeProvider({
        providerId: twitchId,
        login: "delete-tester",
        displayName: "Delete Tester",
        avatarUrl: null,
      }),
    });
    const sessionCookie = await loginViaFakeProvider(app, {
      providerId: twitchId,
      login: "delete-tester",
      displayName: "Delete Tester",
      avatarUrl: null,
    });
    const [user] = await db.select().from(users).where(eq(users.twitchId, twitchId));
    createdUserIds.push(user.id);

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/boards",
      cookies: { session: sessionCookie },
      payload: { name: "Mein Board", size: 3, label_mode: "letters" },
    });
    const boardId = createResponse.json().id;

    const response = await app.inject({
      method: "DELETE",
      url: `/api/boards/${boardId}`,
      cookies: { session: sessionCookie },
    });

    expect(response.statusCode).toBe(204);

    const getResponse = await app.inject({
      method: "GET",
      url: `/api/boards/${boardId}`,
      cookies: { session: sessionCookie },
    });
    expect(getResponse.statusCode).toBe(404);
  });

  it("liefert 404 statt 403 und löscht nichts bei fremdem Board", async () => {
    const twitchIdA = `board-routes-delete-a-${Date.now()}`;
    const twitchIdB = `board-routes-delete-b-${Date.now()}`;

    const appA = await buildServer({
      authProvider: createFakeProvider({
        providerId: twitchIdA,
        login: "delete-a",
        displayName: "Delete A",
        avatarUrl: null,
      }),
    });
    const sessionA = await loginViaFakeProvider(appA, {
      providerId: twitchIdA,
      login: "delete-a",
      displayName: "Delete A",
      avatarUrl: null,
    });

    const appB = await buildServer({
      authProvider: createFakeProvider({
        providerId: twitchIdB,
        login: "delete-b",
        displayName: "Delete B",
        avatarUrl: null,
      }),
    });
    const sessionB = await loginViaFakeProvider(appB, {
      providerId: twitchIdB,
      login: "delete-b",
      displayName: "Delete B",
      avatarUrl: null,
    });

    const [userA] = await db.select().from(users).where(eq(users.twitchId, twitchIdA));
    const [userB] = await db.select().from(users).where(eq(users.twitchId, twitchIdB));
    createdUserIds.push(userA.id, userB.id);

    const createResponse = await appA.inject({
      method: "POST",
      url: "/api/boards",
      cookies: { session: sessionA },
      payload: { name: "Board von A", size: 3, label_mode: "letters" },
    });
    const boardId = createResponse.json().id;

    const deleteResponse = await appB.inject({
      method: "DELETE",
      url: `/api/boards/${boardId}`,
      cookies: { session: sessionB },
    });
    expect(deleteResponse.statusCode).toBe(404);

    const getResponse = await appA.inject({
      method: "GET",
      url: `/api/boards/${boardId}`,
      cookies: { session: sessionA },
    });
    expect(getResponse.statusCode).toBe(200);
  });
});

describe("PATCH /api/boards/:id", () => {
  const createdUserIds: string[] = [];

  afterEach(async () => {
    for (const id of createdUserIds.splice(0)) {
      await db.delete(users).where(eq(users.id, id));
    }
  });

  async function createLoggedInUserWithBoard(
    twitchId: string,
    boardInput: Record<string, unknown>
  ) {
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
      payload: boardInput,
    });

    return { app, sessionCookie, userId: user.id, boardId: createResponse.json().id };
  }

  it("aktualisiert den Namen", async () => {
    const twitchId = `patch-test-name-${Date.now()}`;
    const { app, sessionCookie, userId, boardId } = await createLoggedInUserWithBoard(twitchId, {
      name: "Alt",
      size: 3,
      label_mode: "letters",
    });
    createdUserIds.push(userId);

    const response = await app.inject({
      method: "PATCH",
      url: `/api/boards/${boardId}`,
      cookies: { session: sessionCookie },
      payload: { name: "Neu" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().name).toBe("Neu");
  });

  it("aktualisiert label_mode und column_labels gemeinsam", async () => {
    const twitchId = `patch-test-labelmode-${Date.now()}`;
    const { app, sessionCookie, userId, boardId } = await createLoggedInUserWithBoard(twitchId, {
      name: "Board",
      size: 3,
      label_mode: "letters",
    });
    createdUserIds.push(userId);

    const response = await app.inject({
      method: "PATCH",
      url: `/api/boards/${boardId}`,
      cookies: { session: sessionCookie },
      payload: { label_mode: "custom", column_labels: ["WIN", "GG", "GLHF"] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().labelMode).toBe("custom");
    expect(response.json().columnLabels).toEqual(["WIN", "GG", "GLHF"]);
  });

  it("lehnt bingo-Modus bei size!=5 mit 400 ab", async () => {
    const twitchId = `patch-test-bingo-${Date.now()}`;
    const { app, sessionCookie, userId, boardId } = await createLoggedInUserWithBoard(twitchId, {
      name: "Board",
      size: 3,
      label_mode: "letters",
    });
    createdUserIds.push(userId);

    const response = await app.inject({
      method: "PATCH",
      url: `/api/boards/${boardId}`,
      cookies: { session: sessionCookie },
      payload: { label_mode: "bingo" },
    });

    expect(response.statusCode).toBe(400);
  });

  it("aktualisiert Zelltext", async () => {
    const twitchId = `patch-test-cells-${Date.now()}`;
    const { app, sessionCookie, userId, boardId } = await createLoggedInUserWithBoard(twitchId, {
      name: "Board",
      size: 3,
      label_mode: "letters",
    });
    createdUserIds.push(userId);

    const response = await app.inject({
      method: "PATCH",
      url: `/api/boards/${boardId}`,
      cookies: { session: sessionCookie },
      payload: { cells: [{ row: 1, col: 1, text: "Mitte" }] },
    });

    expect(response.statusCode).toBe(200);
    const cell = (response.json().cells as Array<{ row: number; col: number; text: string }>).find(
      (c) => c.row === 1 && c.col === 1
    );
    expect(cell?.text).toBe("Mitte");
  });

  it("lehnt Zellkoordinaten außerhalb des Boards mit 400 ab", async () => {
    const twitchId = `patch-test-oob-${Date.now()}`;
    const { app, sessionCookie, userId, boardId } = await createLoggedInUserWithBoard(twitchId, {
      name: "Board",
      size: 3,
      label_mode: "letters",
    });
    createdUserIds.push(userId);

    const response = await app.inject({
      method: "PATCH",
      url: `/api/boards/${boardId}`,
      cookies: { session: sessionCookie },
      payload: { cells: [{ row: 5, col: 0, text: "x" }] },
    });

    expect(response.statusCode).toBe(400);
  });

  it("liefert 401 ohne Session", async () => {
    const app = await buildServer();
    const response = await app.inject({
      method: "PATCH",
      url: "/api/boards/00000000-0000-0000-0000-000000000000",
      payload: { name: "x" },
    });
    expect(response.statusCode).toBe(401);
  });

  it("liefert 404 statt 403 für fremdes Board, ohne etwas zu ändern", async () => {
    const twitchIdA = `patch-test-foreign-a-${Date.now()}`;
    const twitchIdB = `patch-test-foreign-b-${Date.now()}`;
    const { app: appA, sessionCookie: sessionA, userId: userIdA, boardId } =
      await createLoggedInUserWithBoard(twitchIdA, {
        name: "Board A",
        size: 3,
        label_mode: "letters",
      });
    createdUserIds.push(userIdA);

    const appB = await buildServer({
      authProvider: createFakeProvider({
        providerId: twitchIdB,
        login: "b",
        displayName: "B",
        avatarUrl: null,
      }),
    });
    const sessionB = await loginViaFakeProvider(appB, {
      providerId: twitchIdB,
      login: "b",
      displayName: "B",
      avatarUrl: null,
    });
    const [userB] = await db.select().from(users).where(eq(users.twitchId, twitchIdB));
    createdUserIds.push(userB.id);

    const response = await appB.inject({
      method: "PATCH",
      url: `/api/boards/${boardId}`,
      cookies: { session: sessionB },
      payload: { name: "Übernommen" },
    });

    expect(response.statusCode).toBe(404);

    const stillOriginal = await appA.inject({
      method: "GET",
      url: `/api/boards/${boardId}`,
      cookies: { session: sessionA },
    });
    expect(stillOriginal.json().name).toBe("Board A");
  });

  it("liefert 404 für nicht existierendes Board", async () => {
    const twitchId = `patch-test-missing-${Date.now()}`;
    const { app, sessionCookie, userId } = await createLoggedInUserWithBoard(twitchId, {
      name: "Board",
      size: 3,
      label_mode: "letters",
    });
    createdUserIds.push(userId);

    const response = await app.inject({
      method: "PATCH",
      url: `/api/boards/${randomUUID()}`,
      cookies: { session: sessionCookie },
      payload: { name: "x" },
    });

    expect(response.statusCode).toBe(404);
  });

  it("lehnt ungültigen Body mit 400 ab", async () => {
    const twitchId = `patch-test-invalid-${Date.now()}`;
    const { app, sessionCookie, userId, boardId } = await createLoggedInUserWithBoard(twitchId, {
      name: "Board",
      size: 3,
      label_mode: "letters",
    });
    createdUserIds.push(userId);

    const response = await app.inject({
      method: "PATCH",
      url: `/api/boards/${boardId}`,
      cookies: { session: sessionCookie },
      payload: { name: "a".repeat(61) },
    });

    expect(response.statusCode).toBe(400);
  });
});
