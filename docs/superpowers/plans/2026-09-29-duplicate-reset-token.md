# Duplizieren, Reset, Token neu generieren Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drei Board-Verwaltungsaktionen aus dem Dashboard ergänzen: Board duplizieren, Häkchen zurücksetzen, Overlay-Token neu generieren. Deckt SPEC.md Abschnitt 10, Punkt 7 ab.

**Architecture:** Drei neue, eigentümergeschützte `POST`-Endpoints (`/duplicate`, `/reset`, `/regenerate-token`) nach dem exakt gleichen Muster wie die bestehenden `PATCH`/`PUT .../checked`-Routen (404 statt 403, DB-Helfer selbst eigentümergeschützt). `reset` veröffentlicht danach ein Board-Event über das bestehende Pub/Sub-Modul (SPEC nennt „Reset" explizit in der Event-Liste); `duplicate` und `regenerate-token` tun das nicht (nicht in der SPEC-Event-Liste — ein frisches Board hat noch keine Abonnenten, und Token-Regenerierung blockiert laut Entscheidung nur zukünftige Verbindungsversuche, trennt aber keine bereits offenen SSE-Streams aktiv). Das Frontend ruft nach jeder der drei Aktionen `fetchBoards()` erneut auf, statt den lokalen State manuell zu patchen — einfacher und robust, da sich Name, `checkedCount` bzw. `overlayToken` unterschiedlich ändern.

**Tech Stack:** Drizzle ORM (`db.transaction`), Fastify-Routen nach bestehendem Muster, Vue 3 Composition API, Pinia.

**Spec:** `SPEC.md` (Abschnitte 2.4, 2.5, 4, 5); Vorgänger-Pläne (Foundation/Auth/Board-CRUD/Editor/Control-Seite/Overlay+SSE) vollständig gemergt auf `main`. Seit dem letzten Plan wurde außerhalb dieser Planreihe ein gemeinsamer `AppHeader` extrahiert (`apps/web/src/components/AppHeader.vue`) und in alle Views eingebunden — dieser Plan berücksichtigt den dadurch veränderten aktuellen Stand von `BoardsView.vue`.

## Global Constraints

- Alle drei neuen Endpoints erfordern Login und sind eigentümergeschützt; fremde/nicht existente Boards liefern 404, nicht 403 (SPEC 5).
- **Duplizieren:** neues Board mit Name `"<Name> (Kopie)"`, gleiche Größe/Beschriftung/Zelltexte, **alle Häkchen zurückgesetzt**, neuer Overlay-Token (SPEC 2.5). Der Name darf `BOARD_NAME_MAX_LENGTH` (60, aus `@bingo/shared`) nicht überschreiten — der Basisname wird bei Bedarf gekürzt, bevor `" (Kopie)"` angehängt wird.
- **Häkchen zurücksetzen:** alle Kreuze entfernen (SPEC 2.5); veröffentlicht danach ein Board-Event, da SPEC 5 „Reset" explizit in der Event-Liste nennt.
- **Overlay-Link neu generieren:** alter Token wird ungültig für neue Verbindungsversuche (SPEC 2.5); bereits offene SSE-Verbindungen werden laut Entscheidung nicht aktiv getrennt — kein Event-Publish nötig.
- Board-Größe (`size`) bleibt beim Duplizieren identisch zum Original (SPEC 2.2).
- Alle Datenbank-Tests laufen gegen die echte, laufende Postgres-Instanz (Docker Compose, Port 5433) — kein Mocken der eigenen DB-Logik.
- Sowohl `vitest run` als auch der jeweilige TypeScript-Compiler (`tsc --noEmit` für `apps/api`, `vue-tsc --noEmit` für `apps/web`) müssen für jeden Task sauber durchlaufen.
- Die lokale `.env`-Datei enthält echte Secrets — kein Task darf sie verändern, überschreiben oder löschen.
- Jeder Commit endet mit exakt: `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- UI-Sprache Deutsch.

---

## Datei-Übersicht

```
apps/api/src/db/boards.ts                 # + duplicateBoard, resetBoardChecks, regenerateOverlayToken
apps/api/src/db/boards.test.ts            # erweitert
apps/api/src/boards/routes.ts             # + POST .../duplicate, .../reset, .../regenerate-token
apps/api/src/boards/routes.test.ts        # erweitert

apps/web/src/stores/boards.ts             # + duplicateBoard, resetBoardChecks, regenerateOverlayToken
apps/web/src/stores/boards.test.ts        # erweitert
apps/web/src/views/BoardsView.vue         # + 3 neue Aktions-Buttons, Button-Reihe umbricht (flex-wrap)
apps/web/src/views/BoardsView.test.ts     # erweitert
```

---

### Task 1: `apps/api` – DB-Helfer für Duplizieren/Reset/Token-Regenerierung (TDD, echte DB)

**Files:**
- Modify: `apps/api/src/db/boards.ts`
- Modify: `apps/api/src/db/boards.test.ts`

**Interfaces:**
- Consumes: `BOARD_NAME_MAX_LENGTH` aus `@bingo/shared` (bereits vorhanden, Wert 60)
- Produces: `duplicateBoard(userId, boardId): Promise<BoardRow | null>`, `resetBoardChecks(userId, boardId): Promise<(BoardRow & {cells}) | null>`, `regenerateOverlayToken(userId, boardId): Promise<BoardRow | null>` — alle eigentümergeschützt (liefern `null` für fremde/nicht existierende Boards, ohne etwas zu ändern) — genutzt von Task 2 (`apps/api/src/boards/routes.ts`)

- [ ] **Step 1: Fehlschlagende Tests ergänzen — `apps/api/src/db/boards.test.ts` (Import-Zeilen erweitern und am Ende der Datei ergänzen)**

Import-Zeile erweitern:
```ts
import {
  createBoardWithCells,
  listBoardsForUser,
  getBoardById,
  deleteBoard,
  updateBoard,
  setCellChecked,
  getBoardByOverlayToken,
  duplicateBoard,
  resetBoardChecks,
  regenerateOverlayToken,
} from "./boards";
```

Am Ende der Datei ergänzen (die Datei endet aktuell ohne abschließenden Zeilenumbruch nach `});` — vor dem Anhängen einen Zeilenumbruch ergänzen):
```ts

describe("duplicateBoard", () => {
  const createdUserIds: string[] = [];

  afterEach(async () => {
    for (const userId of createdUserIds.splice(0)) {
      await db.delete(users).where(eq(users.id, userId));
    }
  });

  it("erstellt eine Kopie mit angehängtem '(Kopie)', gleicher Größe/Beschriftung/Texten und zurückgesetzten Häkchen", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const board = await createBoardWithCells(user.id, {
      name: "Original",
      size: 3,
      label_mode: "letters",
    });
    await setCellChecked(user.id, board.id, 0, 0, true);
    await updateBoard(user.id, board.id, { cells: [{ row: 0, col: 0, text: "Hallo" }] });

    const duplicate = await duplicateBoard(user.id, board.id);

    expect(duplicate?.name).toBe("Original (Kopie)");
    expect(duplicate?.size).toBe(3);
    expect(duplicate?.labelMode).toBe("letters");
    expect(duplicate?.id).not.toBe(board.id);
    expect(duplicate?.overlayToken).not.toBe(board.overlayToken);

    const cells = await db.select().from(boardCells).where(eq(boardCells.boardId, duplicate!.id));
    expect(cells).toHaveLength(9);
    const copiedCell = cells.find((c) => c.row === 0 && c.col === 0);
    expect(copiedCell?.text).toBe("Hallo");
    expect(copiedCell?.checked).toBe(false);
  });

  it("kürzt den Basisnamen, damit der Kopie-Name das Längenlimit einhält", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const longName = "a".repeat(60);
    const board = await createBoardWithCells(user.id, {
      name: longName,
      size: 3,
      label_mode: "letters",
    });

    const duplicate = await duplicateBoard(user.id, board.id);

    expect(duplicate?.name.length).toBeLessThanOrEqual(60);
    expect(duplicate?.name.endsWith(" (Kopie)")).toBe(true);
  });

  it("liefert null für ein Board eines fremden Users, ohne etwas zu erstellen", async () => {
    const owner = await createTestUser();
    const other = await createTestUser();
    createdUserIds.push(owner.id, other.id);
    const board = await createBoardWithCells(owner.id, {
      name: "Board",
      size: 3,
      label_mode: "letters",
    });

    const duplicate = await duplicateBoard(other.id, board.id);

    expect(duplicate).toBeNull();
    const boardsForOwner = await listBoardsForUser(owner.id);
    expect(boardsForOwner).toHaveLength(1);
  });
});

describe("resetBoardChecks", () => {
  const createdUserIds: string[] = [];

  afterEach(async () => {
    for (const userId of createdUserIds.splice(0)) {
      await db.delete(users).where(eq(users.id, userId));
    }
  });

  it("setzt alle Häkchen und checkedAt-Zeitstempel zurück", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const board = await createBoardWithCells(user.id, {
      name: "Board",
      size: 3,
      label_mode: "letters",
    });
    await setCellChecked(user.id, board.id, 0, 0, true);
    await setCellChecked(user.id, board.id, 1, 1, true);

    const result = await resetBoardChecks(user.id, board.id);

    expect(result?.cells.every((c) => c.checked === false)).toBe(true);
    expect(result?.cells.every((c) => c.checkedAt === null)).toBe(true);
  });

  it("lässt Zelltexte unverändert", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const board = await createBoardWithCells(user.id, {
      name: "Board",
      size: 3,
      label_mode: "letters",
    });
    await updateBoard(user.id, board.id, { cells: [{ row: 0, col: 0, text: "Bleibt" }] });

    const result = await resetBoardChecks(user.id, board.id);

    expect(result?.cells.find((c) => c.row === 0 && c.col === 0)?.text).toBe("Bleibt");
  });

  it("liefert null für ein Board eines fremden Users, ohne etwas zu ändern", async () => {
    const owner = await createTestUser();
    const other = await createTestUser();
    createdUserIds.push(owner.id, other.id);
    const board = await createBoardWithCells(owner.id, {
      name: "Board",
      size: 3,
      label_mode: "letters",
    });
    await setCellChecked(owner.id, board.id, 0, 0, true);

    const result = await resetBoardChecks(other.id, board.id);

    expect(result).toBeNull();
    const cells = await db.select().from(boardCells).where(eq(boardCells.boardId, board.id));
    expect(cells.find((c) => c.row === 0 && c.col === 0)?.checked).toBe(true);
  });
});

describe("regenerateOverlayToken", () => {
  const createdUserIds: string[] = [];

  afterEach(async () => {
    for (const userId of createdUserIds.splice(0)) {
      await db.delete(users).where(eq(users.id, userId));
    }
  });

  it("setzt einen neuen, anderen Overlay-Token", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const board = await createBoardWithCells(user.id, {
      name: "Board",
      size: 3,
      label_mode: "letters",
    });

    const result = await regenerateOverlayToken(user.id, board.id);

    expect(result?.overlayToken).toBeDefined();
    expect(result?.overlayToken).not.toBe(board.overlayToken);
  });

  it("macht den alten Token ungültig (nicht mehr auffindbar)", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const board = await createBoardWithCells(user.id, {
      name: "Board",
      size: 3,
      label_mode: "letters",
    });

    await regenerateOverlayToken(user.id, board.id);

    const found = await getBoardByOverlayToken(board.overlayToken);
    expect(found).toBeNull();
  });

  it("liefert null für ein Board eines fremden Users, ohne den Token zu ändern", async () => {
    const owner = await createTestUser();
    const other = await createTestUser();
    createdUserIds.push(owner.id, other.id);
    const board = await createBoardWithCells(owner.id, {
      name: "Board",
      size: 3,
      label_mode: "letters",
    });

    const result = await regenerateOverlayToken(other.id, board.id);

    expect(result).toBeNull();
    const stillFound = await getBoardByOverlayToken(board.overlayToken);
    expect(stillFound?.id).toBe(board.id);
  });
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag verifizieren**

Run: `pnpm --filter @bingo/api test`
Expected: FAIL — `duplicateBoard`, `resetBoardChecks`, `regenerateOverlayToken` existieren nicht.

- [ ] **Step 3: Minimale Implementierung — `apps/api/src/db/boards.ts`**

Import-Zeilen erweitern (die bestehende Type-Import-Zeile bleibt, eine neue Value-Import-Zeile ergänzen):
```ts
import type { CreateBoardInput, PatchBoardInput } from "@bingo/shared";
import { BOARD_NAME_MAX_LENGTH } from "@bingo/shared";
```

Am Ende der Datei ergänzen:
```ts
export async function duplicateBoard(userId: string, boardId: string) {
  return db.transaction(async (tx) => {
    const [original] = await tx
      .select()
      .from(boards)
      .where(and(eq(boards.id, boardId), eq(boards.userId, userId)));

    if (!original) {
      return null;
    }

    const originalCells = await tx
      .select()
      .from(boardCells)
      .where(eq(boardCells.boardId, boardId));

    const suffix = " (Kopie)";
    const maxBaseLength = BOARD_NAME_MAX_LENGTH - suffix.length;
    const baseName =
      original.name.length > maxBaseLength
        ? original.name.slice(0, maxBaseLength)
        : original.name;
    const overlayToken = randomBytes(16).toString("base64url");

    const [duplicate] = await tx
      .insert(boards)
      .values({
        userId,
        name: `${baseName}${suffix}`,
        size: original.size,
        labelMode: original.labelMode,
        columnLabels: original.columnLabels,
        overlayToken,
      })
      .returning();

    await tx.insert(boardCells).values(
      originalCells.map((cell) => ({
        boardId: duplicate.id,
        row: cell.row,
        col: cell.col,
        text: cell.text,
      }))
    );

    return duplicate;
  });
}

export async function resetBoardChecks(userId: string, boardId: string) {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: boards.id })
      .from(boards)
      .where(and(eq(boards.id, boardId), eq(boards.userId, userId)));

    if (!existing) {
      return null;
    }

    await tx
      .update(boardCells)
      .set({ checked: false, checkedAt: null })
      .where(eq(boardCells.boardId, boardId));

    const [board] = await tx
      .select()
      .from(boards)
      .where(and(eq(boards.id, boardId), eq(boards.userId, userId)));
    const cells = await tx.select().from(boardCells).where(eq(boardCells.boardId, boardId));

    return { ...board, cells };
  });
}

export async function regenerateOverlayToken(userId: string, boardId: string) {
  const overlayToken = randomBytes(16).toString("base64url");
  const [board] = await db
    .update(boards)
    .set({ overlayToken, updatedAt: new Date() })
    .where(and(eq(boards.id, boardId), eq(boards.userId, userId)))
    .returning();

  return board ?? null;
}
```

- [ ] **Step 4: Test ausführen, Erfolg verifizieren**

Run: `pnpm --filter @bingo/api test`
Expected: PASS — alle 9 neuen Tests grün.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @bingo/api exec tsc --noEmit`
Expected: Keine Ausgabe, Exit-Code 0.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/db/boards.ts apps/api/src/db/boards.test.ts
git commit -m "$(cat <<'EOF'
feat(api): DB-Helfer für Duplizieren, Reset und Token-Regenerierung

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `apps/api` – `POST .../duplicate`, `.../reset`, `.../regenerate-token` (TDD, echte DB, 404-statt-403)

**Files:**
- Modify: `apps/api/src/boards/routes.ts`
- Modify: `apps/api/src/boards/routes.test.ts`

**Interfaces:**
- Consumes: `duplicateBoard`, `resetBoardChecks`, `regenerateOverlayToken` aus `../db/boards` (Task 1)
- Produces: `POST /api/boards/:id/duplicate` (201 + neues Board), `POST /api/boards/:id/reset` (200 + aktualisiertes Board, veröffentlicht Event), `POST /api/boards/:id/regenerate-token` (200 + aktualisiertes Board) — alle eigentümergeschützt (404 statt 403)

- [ ] **Step 1: Fehlschlagende Tests ergänzen — `apps/api/src/boards/routes.test.ts` (am Ende der Datei ergänzen, keine neuen Imports nötig — `buildServer`, `db`, `users`, `eq`, `createFakeProvider`, `loginViaFakeProvider`, `randomUUID`, `subscribeToBoard` sind bereits importiert)**

```ts
describe("POST /api/boards/:id/duplicate", () => {
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

  it("erstellt eine Kopie mit '(Kopie)'-Namenszusatz", async () => {
    const twitchId = `duplicate-test-${Date.now()}`;
    const { app, sessionCookie, userId, boardId } = await createLoggedInUserWithBoard(twitchId, {
      name: "Board",
      size: 3,
      label_mode: "letters",
    });
    createdUserIds.push(userId);

    const response = await app.inject({
      method: "POST",
      url: `/api/boards/${boardId}/duplicate`,
      cookies: { session: sessionCookie },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().name).toBe("Board (Kopie)");
    expect(response.json().id).not.toBe(boardId);
  });

  it("liefert 401 ohne Session", async () => {
    const app = await buildServer();
    const response = await app.inject({
      method: "POST",
      url: "/api/boards/00000000-0000-0000-0000-000000000000/duplicate",
    });
    expect(response.statusCode).toBe(401);
  });

  it("liefert 404 statt 403 für fremdes Board, ohne etwas zu erstellen", async () => {
    const twitchIdA = `duplicate-test-foreign-a-${Date.now()}`;
    const twitchIdB = `duplicate-test-foreign-b-${Date.now()}`;
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
      method: "POST",
      url: `/api/boards/${boardId}/duplicate`,
      cookies: { session: sessionB },
    });
    expect(response.statusCode).toBe(404);

    const listResponse = await appA.inject({
      method: "GET",
      url: "/api/boards",
      cookies: { session: sessionA },
    });
    expect(listResponse.json()).toHaveLength(1);
  });

  it("liefert 404 für nicht existierendes Board", async () => {
    const twitchId = `duplicate-test-missing-${Date.now()}`;
    const { app, sessionCookie, userId } = await createLoggedInUserWithBoard(twitchId, {
      name: "Board",
      size: 3,
      label_mode: "letters",
    });
    createdUserIds.push(userId);

    const response = await app.inject({
      method: "POST",
      url: `/api/boards/${randomUUID()}/duplicate`,
      cookies: { session: sessionCookie },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("POST /api/boards/:id/reset", () => {
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

  it("setzt alle Häkchen zurück und veröffentlicht ein Board-Event", async () => {
    const twitchId = `reset-test-${Date.now()}`;
    const { app, sessionCookie, userId, boardId } = await createLoggedInUserWithBoard(twitchId, {
      name: "Board",
      size: 3,
      label_mode: "letters",
    });
    createdUserIds.push(userId);
    await app.inject({
      method: "PUT",
      url: `/api/boards/${boardId}/cells/0/0/checked`,
      cookies: { session: sessionCookie },
      payload: { checked: true },
    });

    const events: unknown[] = [];
    const unsubscribe = subscribeToBoard(boardId, (payload) => events.push(payload));

    const response = await app.inject({
      method: "POST",
      url: `/api/boards/${boardId}/reset`,
      cookies: { session: sessionCookie },
    });

    expect(response.statusCode).toBe(200);
    expect(
      (response.json().cells as Array<{ checked: boolean }>).every((c) => !c.checked)
    ).toBe(true);
    expect(events).toHaveLength(1);
    unsubscribe();
  });

  it("liefert 401 ohne Session", async () => {
    const app = await buildServer();
    const response = await app.inject({
      method: "POST",
      url: "/api/boards/00000000-0000-0000-0000-000000000000/reset",
    });
    expect(response.statusCode).toBe(401);
  });

  it("liefert 404 statt 403 für fremdes Board, ohne etwas zu ändern", async () => {
    const twitchIdA = `reset-test-foreign-a-${Date.now()}`;
    const twitchIdB = `reset-test-foreign-b-${Date.now()}`;
    const { app: appA, sessionCookie: sessionA, userId: userIdA, boardId } =
      await createLoggedInUserWithBoard(twitchIdA, {
        name: "Board A",
        size: 3,
        label_mode: "letters",
      });
    createdUserIds.push(userIdA);
    await appA.inject({
      method: "PUT",
      url: `/api/boards/${boardId}/cells/0/0/checked`,
      cookies: { session: sessionA },
      payload: { checked: true },
    });

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
      method: "POST",
      url: `/api/boards/${boardId}/reset`,
      cookies: { session: sessionB },
    });
    expect(response.statusCode).toBe(404);

    const getResponse = await appA.inject({
      method: "GET",
      url: `/api/boards/${boardId}`,
      cookies: { session: sessionA },
    });
    expect(
      (getResponse.json().cells as Array<{ row: number; col: number; checked: boolean }>).find(
        (c) => c.row === 0 && c.col === 0
      )?.checked
    ).toBe(true);
  });

  it("liefert 404 für nicht existierendes Board", async () => {
    const twitchId = `reset-test-missing-${Date.now()}`;
    const { app, sessionCookie, userId } = await createLoggedInUserWithBoard(twitchId, {
      name: "Board",
      size: 3,
      label_mode: "letters",
    });
    createdUserIds.push(userId);

    const response = await app.inject({
      method: "POST",
      url: `/api/boards/${randomUUID()}/reset`,
      cookies: { session: sessionCookie },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("POST /api/boards/:id/regenerate-token", () => {
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

  it("liefert einen neuen Overlay-Token, der alte wird ungültig", async () => {
    const twitchId = `regen-test-${Date.now()}`;
    const { app, sessionCookie, userId, boardId } = await createLoggedInUserWithBoard(twitchId, {
      name: "Board",
      size: 3,
      label_mode: "letters",
    });
    createdUserIds.push(userId);

    const getResponse = await app.inject({
      method: "GET",
      url: `/api/boards/${boardId}`,
      cookies: { session: sessionCookie },
    });
    const oldToken = getResponse.json().overlayToken;

    const response = await app.inject({
      method: "POST",
      url: `/api/boards/${boardId}/regenerate-token`,
      cookies: { session: sessionCookie },
    });

    expect(response.statusCode).toBe(200);
    const newToken = response.json().overlayToken;
    expect(newToken).not.toBe(oldToken);

    const oldOverlayResponse = await app.inject({
      method: "GET",
      url: `/api/overlay/${oldToken}`,
    });
    expect(oldOverlayResponse.statusCode).toBe(404);

    const newOverlayResponse = await app.inject({
      method: "GET",
      url: `/api/overlay/${newToken}`,
    });
    expect(newOverlayResponse.statusCode).toBe(200);
  });

  it("liefert 401 ohne Session", async () => {
    const app = await buildServer();
    const response = await app.inject({
      method: "POST",
      url: "/api/boards/00000000-0000-0000-0000-000000000000/regenerate-token",
    });
    expect(response.statusCode).toBe(401);
  });

  it("liefert 404 statt 403 für fremdes Board, ohne den Token zu ändern", async () => {
    const twitchIdA = `regen-test-foreign-a-${Date.now()}`;
    const twitchIdB = `regen-test-foreign-b-${Date.now()}`;
    const { app: appA, sessionCookie: sessionA, userId: userIdA, boardId } =
      await createLoggedInUserWithBoard(twitchIdA, {
        name: "Board A",
        size: 3,
        label_mode: "letters",
      });
    createdUserIds.push(userIdA);

    const getBefore = await appA.inject({
      method: "GET",
      url: `/api/boards/${boardId}`,
      cookies: { session: sessionA },
    });
    const tokenBefore = getBefore.json().overlayToken;

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
      method: "POST",
      url: `/api/boards/${boardId}/regenerate-token`,
      cookies: { session: sessionB },
    });
    expect(response.statusCode).toBe(404);

    const getAfter = await appA.inject({
      method: "GET",
      url: `/api/boards/${boardId}`,
      cookies: { session: sessionA },
    });
    expect(getAfter.json().overlayToken).toBe(tokenBefore);
  });

  it("liefert 404 für nicht existierendes Board", async () => {
    const twitchId = `regen-test-missing-${Date.now()}`;
    const { app, sessionCookie, userId } = await createLoggedInUserWithBoard(twitchId, {
      name: "Board",
      size: 3,
      label_mode: "letters",
    });
    createdUserIds.push(userId);

    const response = await app.inject({
      method: "POST",
      url: `/api/boards/${randomUUID()}/regenerate-token`,
      cookies: { session: sessionCookie },
    });
    expect(response.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag verifizieren**

Run: `pnpm --filter @bingo/api test`
Expected: FAIL — die drei neuen Routen existieren nicht.

- [ ] **Step 3: Implementierung — `apps/api/src/boards/routes.ts` erweitern**

Import-Zeile erweitern:
```ts
import {
  createBoardWithCells,
  listBoardsForUser,
  getBoardById,
  deleteBoard,
  updateBoard,
  setCellChecked,
  duplicateBoard,
  resetBoardChecks,
  regenerateOverlayToken,
} from "../db/boards";
```

Innerhalb von `registerBoardRoutes`, nach der bestehenden `app.put<...>(...)`-Route für `.../checked` (vor der schließenden `}` der Funktion) ergänzen:
```ts
  app.post<{ Params: { id: string } }>("/api/boards/:id/duplicate", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) {
      return;
    }

    const paramsResult = boardIdParamSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(404).send({ error: "Board nicht gefunden" });
    }

    const duplicate = await duplicateBoard(user.id, paramsResult.data.id);
    if (!duplicate) {
      return reply.status(404).send({ error: "Board nicht gefunden" });
    }
    return reply.status(201).send(duplicate);
  });

  app.post<{ Params: { id: string } }>("/api/boards/:id/reset", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) {
      return;
    }

    const paramsResult = boardIdParamSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(404).send({ error: "Board nicht gefunden" });
    }

    const result = await resetBoardChecks(user.id, paramsResult.data.id);
    if (!result) {
      return reply.status(404).send({ error: "Board nicht gefunden" });
    }
    publishBoardEvent(result.id, toPublicBoard(result));
    return result;
  });

  app.post<{ Params: { id: string } }>(
    "/api/boards/:id/regenerate-token",
    async (request, reply) => {
      const user = await requireAuth(request, reply);
      if (!user) {
        return;
      }

      const paramsResult = boardIdParamSchema.safeParse(request.params);
      if (!paramsResult.success) {
        return reply.status(404).send({ error: "Board nicht gefunden" });
      }

      const board = await regenerateOverlayToken(user.id, paramsResult.data.id);
      if (!board) {
        return reply.status(404).send({ error: "Board nicht gefunden" });
      }
      return board;
    }
  );
```

- [ ] **Step 4: Test ausführen, Erfolg verifizieren**

Run: `pnpm --filter @bingo/api test`
Expected: PASS — alle Tests grün.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @bingo/api exec tsc --noEmit`
Expected: Keine Ausgabe, Exit-Code 0.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/boards/routes.ts apps/api/src/boards/routes.test.ts
git commit -m "$(cat <<'EOF'
feat(api): Routen für Duplizieren, Reset und Token-Regenerierung

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `apps/web` – `BoardsStore`: `duplicateBoard`/`resetBoardChecks`/`regenerateOverlayToken` (TDD)

**Files:**
- Modify: `apps/web/src/stores/boards.ts`
- Modify: `apps/web/src/stores/boards.test.ts`

**Interfaces:**
- Consumes: nichts Neues
- Produces: `duplicateBoard(id): Promise<void>`, `resetBoardChecks(id): Promise<void>`, `regenerateOverlayToken(id): Promise<void>` — alle senden POST und laden danach die Boardliste neu — genutzt von Task 4 (`BoardsView.vue`)

- [ ] **Step 1: Fehlschlagende Tests ergänzen — `apps/web/src/stores/boards.test.ts` (innerhalb des bestehenden `describe("useBoardsStore", ...)`-Blocks einfügen, direkt vor dessen schließender `});` — die verschachtelten `describe`-Blöcke erben so das äußere `beforeEach`/`afterEach` mit `setActivePinia`/`vi.stubGlobal("fetch", ...)`)**

```ts
describe("duplicateBoard", () => {
  it("sendet POST und lädt die Boardliste danach neu", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => [] } as Response);

    const store = useBoardsStore();
    await store.duplicateBoard("b1");

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/boards/b1/duplicate"),
      expect.objectContaining({ method: "POST", credentials: "include" })
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("wirft bei Fehlerantwort", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, json: async () => ({}) } as Response);

    const store = useBoardsStore();
    await expect(store.duplicateBoard("b1")).rejects.toThrow();
  });
});

describe("resetBoardChecks", () => {
  it("sendet POST und lädt die Boardliste danach neu", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => [] } as Response);

    const store = useBoardsStore();
    await store.resetBoardChecks("b1");

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/boards/b1/reset"),
      expect.objectContaining({ method: "POST", credentials: "include" })
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("wirft bei Fehlerantwort", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, json: async () => ({}) } as Response);

    const store = useBoardsStore();
    await expect(store.resetBoardChecks("b1")).rejects.toThrow();
  });
});

describe("regenerateOverlayToken", () => {
  it("sendet POST und lädt die Boardliste danach neu", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => [] } as Response);

    const store = useBoardsStore();
    await store.regenerateOverlayToken("b1");

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/boards/b1/regenerate-token"),
      expect.objectContaining({ method: "POST", credentials: "include" })
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("wirft bei Fehlerantwort", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, json: async () => ({}) } as Response);

    const store = useBoardsStore();
    await expect(store.regenerateOverlayToken("b1")).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag verifizieren**

Run: `pnpm --filter @bingo/web test`
Expected: FAIL — `duplicateBoard`/`resetBoardChecks`/`regenerateOverlayToken` existieren nicht.

- [ ] **Step 3: Minimale Implementierung — `apps/web/src/stores/boards.ts` in `actions` ergänzen (nach `setCellChecked`, vor der schließenden `},` von `actions`)**

```ts
    async duplicateBoard(id: string): Promise<void> {
      const response = await fetch(`${API_BASE_URL}/api/boards/${id}/duplicate`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Board konnte nicht dupliziert werden");
      }
      await this.fetchBoards();
    },
    async resetBoardChecks(id: string): Promise<void> {
      const response = await fetch(`${API_BASE_URL}/api/boards/${id}/reset`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Häkchen konnten nicht zurückgesetzt werden");
      }
      await this.fetchBoards();
    },
    async regenerateOverlayToken(id: string): Promise<void> {
      const response = await fetch(`${API_BASE_URL}/api/boards/${id}/regenerate-token`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Overlay-Link konnte nicht erneuert werden");
      }
      await this.fetchBoards();
    },
```

- [ ] **Step 4: Test ausführen, Erfolg verifizieren**

Run: `pnpm --filter @bingo/web test`
Expected: PASS — alle 6 neuen Tests grün.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @bingo/web exec vue-tsc --noEmit`
Expected: Keine Ausgabe, Exit-Code 0.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/stores/boards.ts apps/web/src/stores/boards.test.ts
git commit -m "$(cat <<'EOF'
feat(web): BoardsStore.duplicateBoard/resetBoardChecks/regenerateOverlayToken

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `apps/web` – Dashboard: drei neue Aktions-Buttons (TDD)

**Files:**
- Modify: `apps/web/src/views/BoardsView.vue`
- Modify: `apps/web/src/views/BoardsView.test.ts`

**Interfaces:**
- Consumes: `duplicateBoard`, `resetBoardChecks`, `regenerateOverlayToken` aus `../stores/boards` (Task 3)
- Produces: drei neue Buttons pro Board ("Duplizieren", "Häkchen zurücksetzen", "Overlay-Link neu generieren")

- [ ] **Step 1: Fehlschlagende Tests ergänzen — `apps/web/src/views/BoardsView.test.ts`**

Drei neue Tests in `describe("BoardsView", ...)` ergänzen (nach dem bestehenden Test "kopiert den Overlay-Link in die Zwischenablage"):
```ts
  it("dupliziert ein Board", async () => {
    const router = createTestRouter();
    const auth = useAuthStore();
    const boardsStore = useBoardsStore();
    auth.user = { id: "1", login: "x", displayName: "Streamerin", avatarUrl: null };
    boardsStore.boards = [{ id: "b1", name: "Board Eins", size: 3, checkedCount: 0 } as never];

    const wrapper = mount(BoardsView, { global: { plugins: [router] } });
    await wrapper.vm.$nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const duplicateButton = wrapper.findAll("button").find((b) => b.text() === "Duplizieren");
    await duplicateButton!.trigger("click");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/boards/b1/duplicate"),
      expect.objectContaining({ method: "POST" })
    );
  });

  it("setzt Häkchen nach Bestätigung zurück", async () => {
    const router = createTestRouter();
    const auth = useAuthStore();
    const boardsStore = useBoardsStore();
    auth.user = { id: "1", login: "x", displayName: "Streamerin", avatarUrl: null };
    boardsStore.boards = [{ id: "b1", name: "Board Eins", size: 3, checkedCount: 3 } as never];

    const wrapper = mount(BoardsView, { global: { plugins: [router] } });
    await wrapper.vm.$nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const resetButton = wrapper
      .findAll("button")
      .find((b) => b.text() === "Häkchen zurücksetzen");
    await resetButton!.trigger("click");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/boards/b1/reset"),
      expect.objectContaining({ method: "POST" })
    );
  });

  it("generiert den Overlay-Token neu", async () => {
    const router = createTestRouter();
    const auth = useAuthStore();
    const boardsStore = useBoardsStore();
    auth.user = { id: "1", login: "x", displayName: "Streamerin", avatarUrl: null };
    boardsStore.boards = [{ id: "b1", name: "Board Eins", size: 3, checkedCount: 0 } as never];

    const wrapper = mount(BoardsView, { global: { plugins: [router] } });
    await wrapper.vm.$nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const regenButton = wrapper
      .findAll("button")
      .find((b) => b.text() === "Overlay-Link neu generieren");
    await regenButton!.trigger("click");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/boards/b1/regenerate-token"),
      expect.objectContaining({ method: "POST" })
    );
  });
```

- [ ] **Step 2: Test ausführen, Fehlschlag verifizieren**

Run: `pnpm --filter @bingo/web test`
Expected: FAIL — die drei Buttons existieren nicht.

- [ ] **Step 3: Minimale Implementierung — `apps/web/src/views/BoardsView.vue` erweitern**

Im `<script setup>`-Block, nach `handleCopyOverlayLink` ergänzen:
```ts
async function handleDuplicate(id: string) {
  await boardsStore.duplicateBoard(id);
}

async function handleResetChecks(id: string) {
  if (!confirm("Alle Häkchen auf diesem Board zurücksetzen?")) {
    return;
  }
  await boardsStore.resetBoardChecks(id);
}

async function handleRegenerateToken(id: string) {
  await boardsStore.regenerateOverlayToken(id);
}
```

Im Template den bestehenden Button-Container-`<div>` (`class="flex gap-2"`) durch die erweiterte Version ersetzen:
```vue
          <div class="flex flex-wrap gap-2">
            <RouterLink
              :to="`/boards/${board.id}/play`"
              class="rounded bg-slate-700 px-3 py-1 hover:bg-slate-600"
            >
              Spielen
            </RouterLink>
            <button
              class="rounded bg-slate-700 px-3 py-1 hover:bg-slate-600"
              @click="handleCopyOverlayLink(board.overlayToken)"
            >
              Overlay-Link kopieren
            </button>
            <RouterLink
              :to="`/boards/${board.id}/edit`"
              class="rounded bg-slate-700 px-3 py-1 hover:bg-slate-600"
            >
              Bearbeiten
            </RouterLink>
            <button
              class="rounded bg-slate-700 px-3 py-1 hover:bg-slate-600"
              @click="handleDuplicate(board.id)"
            >
              Duplizieren
            </button>
            <button
              class="rounded bg-slate-700 px-3 py-1 hover:bg-slate-600"
              @click="handleResetChecks(board.id)"
            >
              Häkchen zurücksetzen
            </button>
            <button
              class="rounded bg-slate-700 px-3 py-1 hover:bg-slate-600"
              @click="handleRegenerateToken(board.id)"
            >
              Overlay-Link neu generieren
            </button>
            <button
              class="rounded bg-red-700 px-3 py-1 hover:bg-red-600"
              @click="handleDelete(board.id)"
            >
              Löschen
            </button>
          </div>
```

- [ ] **Step 4: Test ausführen, Erfolg verifizieren**

Run: `pnpm --filter @bingo/web test`
Expected: PASS — alle Tests in `BoardsView.test.ts` grün (8 insgesamt).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @bingo/web exec vue-tsc --noEmit`
Expected: Keine Ausgabe, Exit-Code 0.

- [ ] **Step 6: Dev-Server manuell prüfen**

Run: `pnpm --filter @bingo/web dev`
Expected: Vite startet ohne Fehler. Danach Server beenden.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/views/BoardsView.vue apps/web/src/views/BoardsView.test.ts
git commit -m "$(cat <<'EOF'
feat(web): Dashboard-Buttons für Duplizieren, Reset und Token-Regenerierung

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Nach Abschluss dieses Plans

Automatisiert vollständig verifiziert: eigentümergeschützte Duplizieren-/Reset-/Token-Endpoints
(404 statt 403), korrekte Namensbildung inkl. Längenbegrenzung, Reset veröffentlicht ein
Board-Event, Token-Regenerierung macht den alten Token sofort ungültig für neue Verbindungen.

**Manuell zu verifizieren** (End-to-End im Browser): Board mit Text und Häkchen anlegen →
"Duplizieren" → neues Board mit "(Kopie)"-Namen, gleichem Text, aber ohne Häkchen erscheint in
der Liste → Overlay der Kopie öffnen, eigenen Token verwenden (nicht den des Originals) →
"Häkchen zurücksetzen" am Original → Bestätigungsdialog → abgehakte Felder verschwinden, im
offenen Overlay-Tab sofort sichtbar (SSE) → "Overlay-Link neu generieren" → alter Overlay-Link
zeigt danach nichts mehr, neuer Link funktioniert.

Nächster Schritt laut SPEC.md Abschnitt 10: **Tests (Unit + E2E der Akzeptanzkriterien), README
mit Setup- und OBS-Anleitung** (Punkt 8) — der letzte Schritt der Umsetzungsreihenfolge.
