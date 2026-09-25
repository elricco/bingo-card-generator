# Control-Seite mit Häkchen-Persistenz Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Control-Seite bauen (`/boards/:id/play`), auf der die Streamerin während des Spiels Felder an-/abhaken kann — jede Interaktion wird sofort persistiert (Zielzustand, idempotent), mit optimistischem UI und Rollback bei Fehler. Deckt SPEC.md Abschnitt 10, Punkt 5 ab.

**Architecture:** Der Schreib-Pfad ist ein neuer, eigenständiger `PUT /api/boards/:id/cells/:row/:col/checked`-Endpoint mit demselben eigentümergeschützten Muster wie `PATCH /api/boards/:id` (404 statt 403, Bounds-Check gegen die Boardgröße vor dem DB-Zugriff, DB-Helfer ist zusätzlich selbst eigentümergeschützt). Die Control-Seite nutzt dieselbe Raster-/Label-Darstellung wie der Editor (`buildGridCells`, `getColumnLabels`, `getRowLabels` — unverändert wiederverwendet), aber rein lesend für Texte; Klick auf ein Feld toggelt nur den Häkchen-Zustand. SSE-Live-Updates ans Overlay sind laut Umsetzungsreihenfolge Teil von Phase 6 und werden hier bewusst nicht gebaut — der Schreib-Pfad ist aber so geschnitten (ein einzelner, klar benannter DB-Helfer), dass Phase 6 dort später einfach ein Event-Publish ergänzen kann, ohne diesen Plan zu berühren. Rate-Limiting auf Schreib-Endpoints (SPEC 8) ist projektweit noch nicht umgesetzt und wird hier bewusst nicht mitgebaut (siehe Rückstellungs-Entscheidung unten) — betrifft alle Schreib-Routen, nicht nur diese.

**Tech Stack:** Fastify-Route mit Zod-Parametervalidierung (`z.coerce.number()` für Pfadparameter), Drizzle ORM (`UPDATE ... RETURNING`), Vue 3 Composition API (optimistisches Update via `reactive`-State + Rollback im `catch`), Pinia.

**Spec:** `SPEC.md` (Abschnitte 2.5, 2.6, 4, 5, 6); Vorgänger-Pläne (Foundation/Auth/Board-CRUD/Editor) vollständig gemergt auf `main` — `packages/shared` hat `getColumnLabels`/`getRowLabels`; `apps/api` hat Auth, Sessions, Board-CRUD inkl. PATCH; `apps/web` hat Dashboard, Neu-Board-Formular, vollen Editor mit Raster/Labels/Speichern/Verlassen-Warnung.

## Global Constraints

- Alle `/api/*`-Routen (außer später `/api/overlay/*`) erfordern Login; fremde/nicht existente Boards liefern 404, nicht 403 (SPEC 5) — inklusive des neuen Checked-Endpoints.
- Der Checked-Request sendet den **Zielzustand** (`checked: true/false`), kein Toggle → idempotent, keine Race Conditions bei Doppelklick (SPEC 2.6).
- Jede Interaktion auf der Control-Seite wird **sofort** gespeichert: optimistisches UI, bei Fehler zurückrollen + Hinweis (SPEC 2.6).
- Control-Seite nur für eingeloggten Besitzer erreichbar (SPEC 2.6) — Route mit `meta: { requiresAuth: true }`.
- Zellkoordinaten müssen serverseitig gegen die tatsächliche Boardgröße geprüft werden (0 ≤ row/col < size), analog zum bestehenden PATCH-Endpoint.
- Zelltexte nur als Text rendern, kein `v-html` (SPEC 8).
- Alle Datenbank-Tests laufen gegen die echte, laufende Postgres-Instanz (Docker Compose, Port 5433) — kein Mocken der eigenen DB-Logik.
- Sowohl `vitest run` als auch der jeweilige TypeScript-Compiler (`tsc --noEmit` für `apps/api`, `vue-tsc --noEmit` für `apps/web`) müssen für jeden Task sauber durchlaufen.
- Neue/geänderte Frontend-Tests, die einen gemockten `fetch` involvieren, müssen echte Trennschärfe haben (nicht grün bleiben, wenn das getestete Feature kaputt ist) — bei Unsicherheit: Code temporär kaputt machen, Fehlschlag bestätigen, wiederherstellen.
- Die lokale `.env`-Datei enthält echte Secrets — kein Task darf sie verändern, überschreiben oder löschen.
- Jeder Commit endet mit exakt: `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- UI-Sprache Deutsch.

---

## Datei-Übersicht

```
apps/api/src/db/boards.ts                 # + setCellChecked (eigentümergeschützt)
apps/api/src/db/boards.test.ts            # erweitert
apps/api/src/boards/routes.ts             # + PUT /api/boards/:id/cells/:row/:col/checked
apps/api/src/boards/routes.test.ts        # erweitert

apps/web/src/stores/boards.ts             # + setCellChecked
apps/web/src/stores/boards.test.ts        # erweitert
apps/web/src/views/ControlView.vue        # neu: Raster mit Klick-zum-Abhaken
apps/web/src/views/ControlView.test.ts    # neu
apps/web/src/router/index.ts              # + Route /boards/:id/play
apps/web/src/views/BoardsView.vue         # + "Spielen/Steuern"-Link
apps/web/src/views/BoardsView.test.ts     # erweitert
```

---

### Task 1: `apps/api` – `setCellChecked`-DB-Helfer (TDD, echte DB)

**Files:**
- Modify: `apps/api/src/db/boards.ts`
- Modify: `apps/api/src/db/boards.test.ts`

**Interfaces:**
- Consumes: nichts Neues (nutzt bestehende `boards`/`boardCells`-Tabellen aus `./schema`)
- Produces: `setCellChecked(userId, boardId, row, col, checked): Promise<BoardCellRow | null>` — eigentümergeschützt (liefert `null` für fremde/nicht existierende Boards, ohne etwas zu ändern) — genutzt von Task 2 (`apps/api/src/boards/routes.ts`)

Voraussetzung: Docker-Compose-Postgres läuft, `.env` ist vorhanden.

- [ ] **Step 1: Fehlschlagende Tests ergänzen — `apps/api/src/db/boards.test.ts` (Import-Zeile erweitern und am Ende der Datei ergänzen)**

Import-Zeile erweitern:
```ts
import {
  createBoardWithCells,
  listBoardsForUser,
  getBoardById,
  deleteBoard,
  updateBoard,
  setCellChecked,
} from "./boards";
```

Am Ende der Datei ergänzen:
```ts
describe("setCellChecked", () => {
  const createdUserIds: string[] = [];

  afterEach(async () => {
    for (const userId of createdUserIds.splice(0)) {
      await db.delete(users).where(eq(users.id, userId));
    }
  });

  it("setzt checked=true und einen checkedAt-Zeitstempel", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const board = await createBoardWithCells(user.id, {
      name: "Board",
      size: 3,
      label_mode: "letters",
    });

    const cell = await setCellChecked(user.id, board.id, 1, 1, true);

    expect(cell?.checked).toBe(true);
    expect(cell?.checkedAt).not.toBeNull();
  });

  it("setzt checked=false und löscht checkedAt", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const board = await createBoardWithCells(user.id, {
      name: "Board",
      size: 3,
      label_mode: "letters",
    });

    await setCellChecked(user.id, board.id, 1, 1, true);
    const cell = await setCellChecked(user.id, board.id, 1, 1, false);

    expect(cell?.checked).toBe(false);
    expect(cell?.checkedAt).toBeNull();
  });

  it("lässt andere Zellen unverändert", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const board = await createBoardWithCells(user.id, {
      name: "Board",
      size: 3,
      label_mode: "letters",
    });

    await setCellChecked(user.id, board.id, 0, 0, true);

    const cells = await db
      .select()
      .from(boardCells)
      .where(and(eq(boardCells.boardId, board.id), eq(boardCells.row, 1), eq(boardCells.col, 1)));
    expect(cells[0].checked).toBe(false);
  });

  it("ist idempotent (mehrfaches Setzen desselben Zielzustands erzeugt keinen Fehler)", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const board = await createBoardWithCells(user.id, {
      name: "Board",
      size: 3,
      label_mode: "letters",
    });

    await setCellChecked(user.id, board.id, 2, 2, true);
    const cell = await setCellChecked(user.id, board.id, 2, 2, true);

    expect(cell?.checked).toBe(true);
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

    const cell = await setCellChecked(other.id, board.id, 0, 0, true);

    expect(cell).toBeNull();
    const stillUnchecked = await db
      .select()
      .from(boardCells)
      .where(and(eq(boardCells.boardId, board.id), eq(boardCells.row, 0), eq(boardCells.col, 0)));
    expect(stillUnchecked[0].checked).toBe(false);
  });
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag verifizieren**

Run: `pnpm --filter @bingo/api test`
Expected: FAIL — `setCellChecked` existiert nicht.

- [ ] **Step 3: Minimale Implementierung — `apps/api/src/db/boards.ts` am Ende der Datei ergänzen**

```ts
export async function setCellChecked(
  userId: string,
  boardId: string,
  row: number,
  col: number,
  checked: boolean
) {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: boards.id })
      .from(boards)
      .where(and(eq(boards.id, boardId), eq(boards.userId, userId)));

    if (!existing) {
      return null;
    }

    const [cell] = await tx
      .update(boardCells)
      .set({ checked, checkedAt: checked ? new Date() : null })
      .where(
        and(eq(boardCells.boardId, boardId), eq(boardCells.row, row), eq(boardCells.col, col))
      )
      .returning();

    return cell ?? null;
  });
}
```

- [ ] **Step 4: Test ausführen, Erfolg verifizieren**

Run: `pnpm --filter @bingo/api test`
Expected: PASS — alle 5 neuen Tests grün.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @bingo/api exec tsc --noEmit`
Expected: Keine Ausgabe, Exit-Code 0.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/db/boards.ts apps/api/src/db/boards.test.ts
git commit -m "$(cat <<'EOF'
feat(api): setCellChecked-DB-Helfer (eigentümergeschützt, idempotent)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `apps/api` – `PUT /api/boards/:id/cells/:row/:col/checked` (TDD, echte DB, 404-statt-403)

**Files:**
- Modify: `apps/api/src/boards/routes.ts`
- Modify: `apps/api/src/boards/routes.test.ts`

**Interfaces:**
- Consumes: `setCellChecked` aus `../db/boards` (Task 1)
- Produces: `PUT /api/boards/:id/cells/:row/:col/checked` — eigentümergeschützt (404 statt 403), validiert Zellkoordinaten gegen die tatsächliche Boardgröße, sendet Zielzustand (idempotent)

- [ ] **Step 1: Fehlschlagende Tests ergänzen — `apps/api/src/boards/routes.test.ts` (am Ende der Datei ergänzen, keine neuen Imports nötig — `buildServer`, `db`, `users`, `eq`, `createFakeProvider`, `loginViaFakeProvider`, `randomUUID` sind bereits importiert)**

```ts
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
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag verifizieren**

Run: `pnpm --filter @bingo/api test`
Expected: FAIL — die `PUT`-Route existiert nicht.

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
} from "../db/boards";
```

Nach `boardIdParamSchema` (vor `export async function registerBoardRoutes`) ergänzen:
```ts
const cellCheckedParamsSchema = z.object({
  id: z.string().uuid(),
  row: z.coerce.number().int().min(0),
  col: z.coerce.number().int().min(0),
});
const cellCheckedBodySchema = z.object({ checked: z.boolean() });
```

Innerhalb von `registerBoardRoutes`, nach der bestehenden `app.delete<...>(...)`-Route (vor der schließenden `}` der Funktion) ergänzen:
```ts
  app.put<{ Params: { id: string; row: string; col: string } }>(
    "/api/boards/:id/cells/:row/:col/checked",
    async (request, reply) => {
      const user = await requireAuth(request, reply);
      if (!user) {
        return;
      }

      const paramsResult = cellCheckedParamsSchema.safeParse(request.params);
      if (!paramsResult.success) {
        return reply.status(404).send({ error: "Board nicht gefunden" });
      }

      const bodyResult = cellCheckedBodySchema.safeParse(request.body);
      if (!bodyResult.success) {
        return reply
          .status(400)
          .send({ error: "Ungültige Eingabe", details: bodyResult.error.flatten() });
      }

      const existingBoard = await getBoardById(user.id, paramsResult.data.id);
      if (!existingBoard) {
        return reply.status(404).send({ error: "Board nicht gefunden" });
      }

      if (
        paramsResult.data.row >= existingBoard.size ||
        paramsResult.data.col >= existingBoard.size
      ) {
        return reply.status(400).send({
          error: "Ungültige Eingabe",
          details: { formErrors: ["Zellkoordinaten außerhalb des Boards"], fieldErrors: {} },
        });
      }

      const updatedCell = await setCellChecked(
        user.id,
        paramsResult.data.id,
        paramsResult.data.row,
        paramsResult.data.col,
        bodyResult.data.checked
      );
      if (!updatedCell) {
        return reply.status(404).send({ error: "Board nicht gefunden" });
      }
      return updatedCell;
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
feat(api): PUT /api/boards/:id/cells/:row/:col/checked, eigentümergeschützt

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `apps/web` – `BoardsStore.setCellChecked` (TDD)

**Files:**
- Modify: `apps/web/src/stores/boards.ts`
- Modify: `apps/web/src/stores/boards.test.ts`

**Interfaces:**
- Consumes: nichts Neues
- Produces: `setCellChecked(boardId, row, col, checked): Promise<void>` — genutzt von Task 4 (`ControlView.vue`)

- [ ] **Step 1: Fehlschlagende Tests ergänzen — `apps/web/src/stores/boards.test.ts` (innerhalb des bestehenden `describe("useBoardsStore", ...)`-Blocks einfügen, direkt vor dessen schließender `});` — die verschachtelten `describe`-Blöcke erben so das äußere `beforeEach`/`afterEach` mit `setActivePinia`/`vi.stubGlobal("fetch", ...)`)**

```ts
describe("setCellChecked", () => {
  it("sendet PUT mit korrektem Body an den Checked-Endpoint", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ row: 1, col: 1, text: "", checked: true, checkedAt: "2024-01-01T00:00:00Z" }),
    } as Response);

    const store = useBoardsStore();
    await store.setCellChecked("b1", 1, 1, true);

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/boards/b1/cells/1/1/checked"),
      expect.objectContaining({
        method: "PUT",
        credentials: "include",
        body: JSON.stringify({ checked: true }),
      })
    );
  });

  it("wirft bei Fehlerantwort mit der Server-Fehlermeldung", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Ungültige Eingabe" }),
    } as Response);

    const store = useBoardsStore();
    await expect(store.setCellChecked("b1", 1, 1, true)).rejects.toThrow("Ungültige Eingabe");
  });
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag verifizieren**

Run: `pnpm --filter @bingo/web test`
Expected: FAIL — `setCellChecked` existiert nicht.

- [ ] **Step 3: Minimale Implementierung — `apps/web/src/stores/boards.ts` in `actions` ergänzen (nach `updateBoard`, vor der schließenden `},` von `actions`)**

```ts
    async setCellChecked(
      boardId: string,
      row: number,
      col: number,
      checked: boolean
    ): Promise<void> {
      const response = await fetch(
        `${API_BASE_URL}/api/boards/${boardId}/cells/${row}/${col}/checked`,
        {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ checked }),
        }
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(
          typeof body?.error === "string" ? body.error : "Häkchen konnte nicht gespeichert werden"
        );
      }
    },
```

- [ ] **Step 4: Test ausführen, Erfolg verifizieren**

Run: `pnpm --filter @bingo/web test`
Expected: PASS — alle 2 neuen Tests grün.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @bingo/web exec vue-tsc --noEmit`
Expected: Keine Ausgabe, Exit-Code 0.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/stores/boards.ts apps/web/src/stores/boards.test.ts
git commit -m "$(cat <<'EOF'
feat(web): BoardsStore.setCellChecked

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `apps/web` – `ControlView.vue`: Raster mit Klick-zum-Abhaken (TDD)

**Files:**
- Create: `apps/web/src/views/ControlView.vue`
- Create: `apps/web/src/views/ControlView.test.ts`
- Modify: `apps/web/src/router/index.ts`

**Interfaces:**
- Consumes: `getColumnLabels`/`getRowLabels`/`LabelMode` aus `@bingo/shared` (bereits vorhanden), `useBoardsStore`/`BoardDetail`/`fetchBoard`/`setCellChecked` aus `../stores/boards` (Task 3, sowie `fetchBoard` aus Phase 4), `buildGridCells` aus `../utils/grid` (bereits vorhanden)
- Produces: Route `/boards/:id/play` (Name `board-play`), vollständige Klick-zum-Abhaken-Ansicht

- [ ] **Step 1: `apps/web/src/router/index.ts` erweitern**

Import-Zeile ergänzen (nach `BoardEditView`):
```ts
import ControlView from "../views/ControlView.vue";
```

In `routes` nach dem `board-edit`-Eintrag ergänzen:
```ts
    {
      path: "/boards/:id/play",
      name: "board-play",
      component: ControlView,
      meta: { requiresAuth: true },
    },
```

- [ ] **Step 2: `apps/web/src/views/ControlView.vue` erstellen**

```vue
<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute } from "vue-router";
import { getColumnLabels, getRowLabels, type LabelMode } from "@bingo/shared";
import { useBoardsStore, type BoardDetail } from "../stores/boards";
import { buildGridCells } from "../utils/grid";

const route = useRoute();
const boardsStore = useBoardsStore();

const board = ref<BoardDetail | null>(null);
const notFound = ref(false);
const checkedState = reactive<Record<string, boolean>>({});
const pendingCells = reactive<Record<string, boolean>>({});
const toggleError = ref<string | null>(null);

function cellKey(row: number, col: number): string {
  return `${row}-${col}`;
}

function cellText(row: number, col: number): string {
  return board.value?.cells.find((c) => c.row === row && c.col === col)?.text ?? "";
}

const columnLabelsForGrid = computed(() => {
  if (!board.value) {
    return [];
  }
  try {
    return getColumnLabels(
      board.value.size,
      board.value.labelMode as LabelMode,
      board.value.columnLabels ?? undefined
    );
  } catch {
    return Array.from({ length: board.value.size }, () => "");
  }
});

const rowLabelsForGrid = computed(() => (board.value ? getRowLabels(board.value.size) : []));

const gridCells = computed(() =>
  board.value
    ? buildGridCells(board.value.size, columnLabelsForGrid.value, rowLabelsForGrid.value)
    : []
);

async function toggleCell(row: number, col: number) {
  if (!board.value) {
    return;
  }
  const key = cellKey(row, col);
  if (pendingCells[key]) {
    return;
  }
  const previous = checkedState[key] ?? false;
  const next = !previous;
  checkedState[key] = next;
  pendingCells[key] = true;
  toggleError.value = null;
  try {
    await boardsStore.setCellChecked(board.value.id, row, col, next);
  } catch (err) {
    checkedState[key] = previous;
    toggleError.value =
      err instanceof Error ? err.message : "Häkchen konnte nicht gespeichert werden";
  } finally {
    pendingCells[key] = false;
  }
}

onMounted(async () => {
  const id = route.params.id as string;
  const result = await boardsStore.fetchBoard(id);
  if (!result) {
    notFound.value = true;
    return;
  }
  board.value = result;
  for (const cell of result.cells) {
    checkedState[cellKey(cell.row, cell.col)] = cell.checked;
  }
});
</script>

<template>
  <main class="min-h-screen bg-slate-900 p-6 text-slate-100">
    <div v-if="notFound">Board nicht gefunden.</div>
    <div v-else-if="board" class="mx-auto max-w-3xl">
      <h1 class="mb-4 text-2xl font-bold">{{ board.name }}</h1>
      <p v-if="toggleError" class="mb-2 text-red-400">{{ toggleError }}</p>

      <div
        class="grid gap-1"
        :style="{ gridTemplateColumns: `repeat(${board.size + 2}, minmax(2.5rem, 1fr))` }"
      >
        <template v-for="(gridCell, index) in gridCells" :key="index">
          <div v-if="gridCell.kind === 'empty'" class="aspect-square" />
          <div
            v-else-if="gridCell.kind === 'label'"
            class="flex aspect-square items-center justify-center font-semibold"
          >
            {{ gridCell.text }}
          </div>
          <button
            v-else
            type="button"
            class="relative flex aspect-square items-center justify-center rounded bg-slate-800 p-1 text-center text-sm hover:bg-slate-700"
            @click="toggleCell(gridCell.row, gridCell.col)"
          >
            <span>{{ cellText(gridCell.row, gridCell.col) }}</span>
            <span
              v-if="checkedState[cellKey(gridCell.row, gridCell.col)]"
              class="pointer-events-none absolute inset-0 flex items-center justify-center text-3xl font-bold text-red-500"
            >
              ✕
            </span>
          </button>
        </template>
      </div>
    </div>
    <p v-else>Lade...</p>
  </main>
</template>
```

- [ ] **Step 3: `apps/web/src/views/ControlView.test.ts` erstellen**

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createRouter, createWebHistory } from "vue-router";
import ControlView from "./ControlView.vue";

function createTestRouter() {
  return createRouter({
    history: createWebHistory(),
    routes: [{ path: "/boards/:id/play", name: "board-play", component: ControlView }],
  });
}

const sampleBoard = {
  id: "b1",
  name: "Mein Board",
  size: 3,
  labelMode: "letters",
  columnLabels: null,
  overlayToken: "token",
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
  cells: [
    { row: 0, col: 0, text: "Erste Zelle", checked: false },
    { row: 1, col: 1, text: "Mitte", checked: true },
  ],
};

describe("ControlView", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("zeigt Name, Labels und Zelltext, mit X auf bereits abgehakten Feldern", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => sampleBoard } as Response);

    const router = createTestRouter();
    router.push("/boards/b1/play");
    await router.isReady();

    const wrapper = mount(ControlView, { global: { plugins: [router] } });
    await flushPromises();

    expect(wrapper.text()).toContain("Mein Board");
    expect(wrapper.text()).toContain("Erste Zelle");
    expect(wrapper.text()).toContain("✕");
  });

  it("setzt beim Klick auf eine unabgehakte Zelle optimistisch ein Kreuz und sendet PUT checked:true", async () => {
    vi.mocked(fetch).mockImplementation(async (url, options) => {
      const method = ((options as RequestInit)?.method ?? "GET").toUpperCase();
      if (method === "PUT") {
        return {
          ok: true,
          json: async () => ({ row: 0, col: 0, text: "Erste Zelle", checked: true, checkedAt: "2024-01-01T00:00:00Z" }),
        } as Response;
      }
      return { ok: true, json: async () => sampleBoard } as Response;
    });

    const router = createTestRouter();
    router.push("/boards/b1/play");
    await router.isReady();
    const wrapper = mount(ControlView, { global: { plugins: [router] } });
    await flushPromises();

    const buttons = wrapper.findAll("button");
    await buttons[0].trigger("click");
    await flushPromises();

    expect(wrapper.findAll("button")[0].text()).toContain("✕");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/boards/b1/cells/0/0/checked"),
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ checked: true }) })
    );
  });

  it("setzt beim Klick auf eine abgehakte Zelle das Kreuz zurück und sendet PUT checked:false", async () => {
    vi.mocked(fetch).mockImplementation(async (url, options) => {
      const method = ((options as RequestInit)?.method ?? "GET").toUpperCase();
      if (method === "PUT") {
        return {
          ok: true,
          json: async () => ({ row: 1, col: 1, text: "Mitte", checked: false, checkedAt: null }),
        } as Response;
      }
      return { ok: true, json: async () => sampleBoard } as Response;
    });

    const router = createTestRouter();
    router.push("/boards/b1/play");
    await router.isReady();
    const wrapper = mount(ControlView, { global: { plugins: [router] } });
    await flushPromises();

    const middleButton = wrapper
      .findAll("button")
      .find((b) => b.text().includes("Mitte"));
    await middleButton!.trigger("click");
    await flushPromises();

    expect(middleButton!.text()).not.toContain("✕");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/boards/b1/cells/1/1/checked"),
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ checked: false }) })
    );
  });

  it("rollt bei Fehler zurück und zeigt eine Fehlermeldung", async () => {
    vi.mocked(fetch).mockImplementation(async (url, options) => {
      const method = ((options as RequestInit)?.method ?? "GET").toUpperCase();
      if (method === "PUT") {
        return { ok: false, json: async () => ({ error: "Serverfehler" }) } as Response;
      }
      return { ok: true, json: async () => sampleBoard } as Response;
    });

    const router = createTestRouter();
    router.push("/boards/b1/play");
    await router.isReady();
    const wrapper = mount(ControlView, { global: { plugins: [router] } });
    await flushPromises();

    const buttons = wrapper.findAll("button");
    await buttons[0].trigger("click");
    await flushPromises();

    expect(wrapper.findAll("button")[0].text()).not.toContain("✕");
    expect(wrapper.text()).toContain("Serverfehler");
  });

  it("zeigt 'nicht gefunden' bei 404", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, json: async () => ({}) } as Response);

    const router = createTestRouter();
    router.push("/boards/missing/play");
    await router.isReady();

    const wrapper = mount(ControlView, { global: { plugins: [router] } });
    await flushPromises();

    expect(wrapper.text()).toContain("nicht gefunden");
  });
});
```

> **Hinweis für die Umsetzung:** Bei den beiden Toggle-Tests und dem Rollback-Test ist besondere Sorgfalt bei der Trennschärfe angebracht — bei Unsicherheit den Toggle-Handler oder das Rollback temporär deaktivieren, Fehlschlag des jeweiligen Tests bestätigen, wiederherstellen (siehe Global Constraints).

- [ ] **Step 4: Test ausführen, Erfolg verifizieren**

Run: `pnpm --filter @bingo/web test`
Expected: PASS — alle 5 Tests in `ControlView.test.ts` grün.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @bingo/web exec vue-tsc --noEmit`
Expected: Keine Ausgabe, Exit-Code 0.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/views/ControlView.vue apps/web/src/views/ControlView.test.ts apps/web/src/router/index.ts
git commit -m "$(cat <<'EOF'
feat(web): ControlView – Raster mit Klick-zum-Abhaken, optimistisches UI

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `apps/web` – Dashboard: "Spielen/Steuern"-Link (TDD)

**Files:**
- Modify: `apps/web/src/views/BoardsView.vue`
- Modify: `apps/web/src/views/BoardsView.test.ts`

**Interfaces:**
- Consumes: Route `board-play` aus `../router` (Task 4)
- Produces: sichtbarer Link pro Board zur Control-Seite

- [ ] **Step 1: Fehlschlagenden Test ergänzen — `apps/web/src/views/BoardsView.test.ts`**

`createTestRouter` erweitern (neue Route ergänzen):
```ts
function createTestRouter() {
  return createRouter({
    history: createWebHistory(),
    routes: [
      { path: "/", name: "home", component: { template: "<div />" } },
      { path: "/boards/new", name: "board-new", component: { template: "<div />" } },
      { path: "/boards/:id/edit", name: "board-edit", component: { template: "<div />" } },
      { path: "/boards/:id/play", name: "board-play", component: { template: "<div />" } },
    ],
  });
}
```

Neuen Test in `describe("BoardsView", ...)` ergänzen (nach dem bestehenden Test "zeigt User-Header und Boardliste"):
```ts
  it("zeigt einen Link zur Control-Seite pro Board", async () => {
    const router = createTestRouter();
    const auth = useAuthStore();
    const boardsStore = useBoardsStore();
    auth.user = { id: "1", login: "x", displayName: "Streamerin", avatarUrl: null };
    boardsStore.boards = [
      { id: "b1", name: "Board Eins", size: 3, checkedCount: 2 } as never,
    ];

    const wrapper = mount(BoardsView, { global: { plugins: [router] } });
    await wrapper.vm.$nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const playLink = wrapper.find('a[href="/boards/b1/play"]');
    expect(playLink.exists()).toBe(true);
    expect(playLink.text()).toContain("Spielen");
  });
```

- [ ] **Step 2: Test ausführen, Fehlschlag verifizieren**

Run: `pnpm --filter @bingo/web test`
Expected: FAIL — kein Link zu `/boards/b1/play` vorhanden.

- [ ] **Step 3: Minimale Implementierung — `apps/web/src/views/BoardsView.vue` erweitern**

Im Template, im `<div class="flex gap-2">`-Block, vor dem bestehenden `Bearbeiten`-Link ergänzen:
```vue
            <RouterLink
              :to="`/boards/${board.id}/play`"
              class="rounded bg-slate-700 px-3 py-1 hover:bg-slate-600"
            >
              Spielen
            </RouterLink>
```

Der Block sieht danach so aus:
```vue
          <div class="flex gap-2">
            <RouterLink
              :to="`/boards/${board.id}/play`"
              class="rounded bg-slate-700 px-3 py-1 hover:bg-slate-600"
            >
              Spielen
            </RouterLink>
            <RouterLink
              :to="`/boards/${board.id}/edit`"
              class="rounded bg-slate-700 px-3 py-1 hover:bg-slate-600"
            >
              Bearbeiten
            </RouterLink>
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
Expected: PASS — alle Tests in `BoardsView.test.ts` grün (4 insgesamt).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @bingo/web exec vue-tsc --noEmit`
Expected: Keine Ausgabe, Exit-Code 0.

- [ ] **Step 6: Dev-Server manuell prüfen**

Run: `pnpm --filter @bingo/web dev`
Expected: Vite startet auf `http://localhost:5173` ohne Fehler. Danach Server beenden.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/views/BoardsView.vue apps/web/src/views/BoardsView.test.ts
git commit -m "$(cat <<'EOF'
feat(web): Dashboard-Link zur Control-Seite

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Nach Abschluss dieses Plans

Automatisiert vollständig verifiziert: eigentümergeschützter, idempotenter Checked-Endpoint
(404 statt 403, Bounds-Check), optimistisches UI mit Rollback bei Fehler, Dashboard-Verlinkung.

**Manuell zu verifizieren** (End-to-End im Browser): Board anlegen → auf "Spielen" klicken →
Felder anklicken, Kreuze erscheinen sofort → Seite neu laden zeigt denselben Stand (Persistenz)
→ Netzwerk kurz kappen (DevTools offline) und ein Feld anklicken → Kreuz erscheint kurz, wird
nach Fehlschlag zurückgerollt, Fehlermeldung erscheint.

Nächster Schritt laut SPEC.md Abschnitt 10: **Overlay-Seite + SSE-Live-Updates** (Punkt 6) —
öffentliche, token-basierte, read-only Overlay-Route mit transparentem Hintergrund, automatischem
Text-Auto-Fit und Server-Sent Events für Live-Updates ohne Reload.
