import { randomUUID } from "node:crypto";
import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import "../env";
import { buildServer } from "../server";
import { db } from "../db/client";
import { users } from "../db/schema";
import { createFakeProvider, loginViaFakeProvider } from "../test-helpers/auth";
import { subscribeToBoard } from "../events/board-events";

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

  it("erlaubt den Wechsel von custom zurück zu letters ohne column_labels im Body", async () => {
    const twitchId = `patch-test-custom-to-letters-${Date.now()}`;
    const { app, sessionCookie, userId, boardId } = await createLoggedInUserWithBoard(twitchId, {
      name: "Board",
      size: 3,
      label_mode: "custom",
      column_labels: ["WIN", "GG", "GLHF"],
    });
    createdUserIds.push(userId);

    const response = await app.inject({
      method: "PATCH",
      url: `/api/boards/${boardId}`,
      cookies: { session: sessionCookie },
      payload: { label_mode: "letters" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().labelMode).toBe("letters");
    expect(response.json().columnLabels).toBeNull();
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

  it("veröffentlicht ein Board-Event mit dem aktuellen öffentlichen Zustand", async () => {
    const twitchId = `patch-test-event-${Date.now()}`;
    const { app, sessionCookie, userId, boardId } = await createLoggedInUserWithBoard(twitchId, {
      name: "Board",
      size: 3,
      label_mode: "letters",
    });
    createdUserIds.push(userId);

    const events: unknown[] = [];
    const unsubscribe = subscribeToBoard(boardId, (payload) => events.push(payload));

    const response = await app.inject({
      method: "PATCH",
      url: `/api/boards/${boardId}`,
      cookies: { session: sessionCookie },
      payload: { name: "Neuer Name" },
    });

    expect(response.statusCode).toBe(200);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ size: 3, labelMode: "letters" });
    unsubscribe();
  });
});

describe("PUT /api/boards/:id/cells/:row/:col/checked", () => {
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

  it("setzt checked=true", async () => {
    const twitchId = `checked-test-true-${Date.now()}`;
    const { app, sessionCookie, userId, boardId } = await createLoggedInUserWithBoard(twitchId, {
      name: "Board",
      size: 3,
      label_mode: "letters",
    });
    createdUserIds.push(userId);

    const response = await app.inject({
      method: "PUT",
      url: `/api/boards/${boardId}/cells/1/1/checked`,
      cookies: { session: sessionCookie },
      payload: { checked: true },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().checked).toBe(true);
    expect(response.json().checkedAt).not.toBeNull();
  });

  it("setzt checked=false", async () => {
    const twitchId = `checked-test-false-${Date.now()}`;
    const { app, sessionCookie, userId, boardId } = await createLoggedInUserWithBoard(twitchId, {
      name: "Board",
      size: 3,
      label_mode: "letters",
    });
    createdUserIds.push(userId);

    await app.inject({
      method: "PUT",
      url: `/api/boards/${boardId}/cells/1/1/checked`,
      cookies: { session: sessionCookie },
      payload: { checked: true },
    });
    const response = await app.inject({
      method: "PUT",
      url: `/api/boards/${boardId}/cells/1/1/checked`,
      cookies: { session: sessionCookie },
      payload: { checked: false },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().checked).toBe(false);
    expect(response.json().checkedAt).toBeNull();
  });

  it("ist idempotent bei wiederholtem Setzen desselben Zielzustands", async () => {
    const twitchId = `checked-test-idempotent-${Date.now()}`;
    const { app, sessionCookie, userId, boardId } = await createLoggedInUserWithBoard(twitchId, {
      name: "Board",
      size: 3,
      label_mode: "letters",
    });
    createdUserIds.push(userId);

    const first = await app.inject({
      method: "PUT",
      url: `/api/boards/${boardId}/cells/0/0/checked`,
      cookies: { session: sessionCookie },
      payload: { checked: true },
    });
    const second = await app.inject({
      method: "PUT",
      url: `/api/boards/${boardId}/cells/0/0/checked`,
      cookies: { session: sessionCookie },
      payload: { checked: true },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json().checked).toBe(true);
  });

  it("lehnt Zellkoordinaten außerhalb des Boards mit 400 ab", async () => {
    const twitchId = `checked-test-oob-${Date.now()}`;
    const { app, sessionCookie, userId, boardId } = await createLoggedInUserWithBoard(twitchId, {
      name: "Board",
      size: 3,
      label_mode: "letters",
    });
    createdUserIds.push(userId);

    const response = await app.inject({
      method: "PUT",
      url: `/api/boards/${boardId}/cells/5/0/checked`,
      cookies: { session: sessionCookie },
      payload: { checked: true },
    });

    expect(response.statusCode).toBe(400);
  });

  it("lehnt einen ungültigen Body mit 400 ab", async () => {
    const twitchId = `checked-test-invalid-body-${Date.now()}`;
    const { app, sessionCookie, userId, boardId } = await createLoggedInUserWithBoard(twitchId, {
      name: "Board",
      size: 3,
      label_mode: "letters",
    });
    createdUserIds.push(userId);

    const response = await app.inject({
      method: "PUT",
      url: `/api/boards/${boardId}/cells/0/0/checked`,
      cookies: { session: sessionCookie },
      payload: { checked: "ja" },
    });

    expect(response.statusCode).toBe(400);
  });

  it("liefert 401 ohne Session", async () => {
    const app = await buildServer();
    const response = await app.inject({
      method: "PUT",
      url: "/api/boards/00000000-0000-0000-0000-000000000000/cells/0/0/checked",
      payload: { checked: true },
    });
    expect(response.statusCode).toBe(401);
  });

  it("liefert 404 statt 403 für fremdes Board, ohne etwas zu ändern", async () => {
    const twitchIdA = `checked-test-foreign-a-${Date.now()}`;
    const twitchIdB = `checked-test-foreign-b-${Date.now()}`;
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
      method: "PUT",
      url: `/api/boards/${boardId}/cells/0/0/checked`,
      cookies: { session: sessionB },
      payload: { checked: true },
    });

    expect(response.statusCode).toBe(404);

    const getResponse = await appA.inject({
      method: "GET",
      url: `/api/boards/${boardId}`,
      cookies: { session: sessionA },
    });
    expect(getResponse.json().cells.find((c: { row: number; col: number }) => c.row === 0 && c.col === 0).checked).toBe(false);
  });

  it("liefert 404 für nicht existierendes Board", async () => {
    const twitchId = `checked-test-missing-${Date.now()}`;
    const { app, sessionCookie, userId } = await createLoggedInUserWithBoard(twitchId, {
      name: "Board",
      size: 3,
      label_mode: "letters",
    });
    createdUserIds.push(userId);

    const response = await app.inject({
      method: "PUT",
      url: `/api/boards/${randomUUID()}/cells/0/0/checked`,
      cookies: { session: sessionCookie },
      payload: { checked: true },
    });

    expect(response.statusCode).toBe(404);
  });

  it("liefert 404 für nicht-numerische Zellkoordinaten", async () => {
    const twitchId = `checked-test-nan-${Date.now()}`;
    const { app, sessionCookie, userId, boardId } = await createLoggedInUserWithBoard(twitchId, {
      name: "Board",
      size: 3,
      label_mode: "letters",
    });
    createdUserIds.push(userId);

    const response = await app.inject({
      method: "PUT",
      url: `/api/boards/${boardId}/cells/abc/0/checked`,
      cookies: { session: sessionCookie },
      payload: { checked: true },
    });

    expect(response.statusCode).toBe(404);
  });

  it("veröffentlicht ein Board-Event mit dem aktualisierten Häkchen-Zustand", async () => {
    const twitchId = `checked-test-event-${Date.now()}`;
    const { app, sessionCookie, userId, boardId } = await createLoggedInUserWithBoard(twitchId, {
      name: "Board",
      size: 3,
      label_mode: "letters",
    });
    createdUserIds.push(userId);

    const events: Array<{ cells: Array<{ row: number; col: number; checked: boolean }> }> = [];
    const unsubscribe = subscribeToBoard(boardId, (payload) => events.push(payload as never));

    const response = await app.inject({
      method: "PUT",
      url: `/api/boards/${boardId}/cells/1/1/checked`,
      cookies: { session: sessionCookie },
      payload: { checked: true },
    });

    expect(response.statusCode).toBe(200);
    expect(events).toHaveLength(1);
    const publishedCell = events[0].cells.find((c) => c.row === 1 && c.col === 1);
    expect(publishedCell?.checked).toBe(true);
    unsubscribe();
  });
});
