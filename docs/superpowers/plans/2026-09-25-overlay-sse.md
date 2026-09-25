# Overlay-Seite + SSE-Live-Updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die öffentliche, token-basierte OBS-Overlay-Seite bauen (`/overlay/:token`), die Häkchen- und Textänderungen live per Server-Sent Events zeigt, ohne Reload — plus einen "Overlay-Link kopieren"-Button im Dashboard. Deckt SPEC.md Abschnitt 10, Punkt 6 ab.

**Architecture:** Ein In-Memory-Pub/Sub-Modul (`EventEmitter`-basiert, pro Board-ID) wird hinter einer schmalen Schnittstelle (`publishBoardEvent`/`subscribeToBoard`) gekapselt, damit es laut SPEC später durch Postgres `LISTEN/NOTIFY` oder Redis ersetzt werden kann. Die bestehenden `PATCH`- und `PUT .../checked`-Routen rufen nach erfolgreichem Schreiben `publishBoardEvent` auf. Zwei neue, komplett unauthentifizierte Routen (`GET /api/overlay/:token` und `GET /api/overlay/:token/events`) bilden eine eigene Vertrauensgrenze und leben in einer eigenen Datei getrennt von den Board-Routen. Beide senden eine "öffentliche" Board-Repräsentation (`toPublicBoard`) ohne `id`, `userId`, `overlayToken`, `name` oder Zeitstempel. Der SSE-Endpoint sendet bei jedem Connect (auch nach Reconnect) sofort den kompletten aktuellen Zustand als erstes Event — keine granularen Diffs, das hält Client und Server einfach und race-condition-frei. Das Frontend nutzt für die Overlay-Seite bewusst KEINEN Pinia-Store (die Daten sind öffentlich/anonym und strukturell anders als die authentifizierten `BoardDetail`-Daten) — `OverlayView.vue` hält ihren Zustand lokal und verwaltet Fetch + `EventSource` selbst.

**Tech Stack:** Node `EventEmitter` (Pub/Sub), Fastify `reply.hijack()` + rohes `reply.raw.write()` für SSE (kein zusätzliches Plugin nötig), Browser-natives `EventSource` (übernimmt Reconnect automatisch), Vue 3 Composition API, reines CSS (`clamp()`/`vmin`-Einheiten) für Auto-Fit-Text und Kontur-Schatten auf der Overlay-Seite.

**Spec:** `SPEC.md` (Abschnitte 2.5, 2.7, 4, 5, 6, 9); Vorgänger-Pläne (Foundation/Auth/Board-CRUD/Editor/Control-Seite) vollständig gemergt auf `main` — `apps/api` hat PATCH/PUT-Routen für Boards, `apps/web` hat Dashboard, Editor, Control-Seite.

## Global Constraints

- `/api/overlay/*`-Routen erfordern **kein** Login (einzige Ausnahme von der sonstigen Login-Pflicht, SPEC 5).
- Die öffentliche Board-Repräsentation enthält **kein** `user_id` und **keine internen IDs** (`id`, `overlayToken`) und laut Design-Entscheidung auch **keinen Board-Namen** — nur `size`, `labelMode`, `columnLabels`, `cells` (`row`, `col`, `text`, `checked`).
- Ungültiger/gelöschter Token → 404 auf beiden Overlay-Routen, kein Fehler-Payload nötig; das Frontend zeigt dann einfach nichts (leer, transparent) statt eines Fehlers.
- Nach jeder Änderung an Texten, Häkchen oder Beschriftung (PATCH, PUT-checked) wird ein Event an alle SSE-Clients des betroffenen Boards gesendet (SPEC 5).
- SSE-Events senden immer den **vollständigen** aktuellen öffentlichen Board-Zustand, keine Diffs — sowohl beim initialen Connect als auch bei jeder späteren Änderung.
- Die Overlay-Seite hat **keine App-Chrome** (keine Navigation, kein Login-Hinweis) und einen **transparenten Hintergrund**; kein `meta: { requiresAuth: true }` auf der Route.
- Texte/Zellinhalte nur als Text rendern, kein `v-html`.
- Alle Datenbank-Tests laufen gegen die echte, laufende Postgres-Instanz (Docker Compose, Port 5433) — kein Mocken der eigenen DB-Logik.
- Sowohl `vitest run` als auch der jeweilige TypeScript-Compiler (`tsc --noEmit` für `apps/api`, `vue-tsc --noEmit` für `apps/web`) müssen für jeden Task sauber durchlaufen.
- Neue/geänderte Frontend-Tests, die `fetch`/`EventSource` involvieren, müssen echte Trennschärfe haben (nicht grün bleiben, wenn das getestete Feature kaputt ist) — bei Unsicherheit: Code temporär kaputt machen, Fehlschlag bestätigen, wiederherstellen.
- Die lokale `.env`-Datei enthält echte Secrets — kein Task darf sie verändern, überschreiben oder löschen.
- Jeder Commit endet mit exakt: `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- UI-Sprache Deutsch.

---

## Datei-Übersicht

```
apps/api/src/events/board-events.ts        # neu: In-Memory Pub/Sub (publishBoardEvent, subscribeToBoard)
apps/api/src/events/board-events.test.ts   # neu

apps/api/src/overlay/public-board.ts       # neu: toPublicBoard (Serialisierung, keine internen Felder)
apps/api/src/overlay/public-board.test.ts  # neu

apps/api/src/db/boards.ts                  # + getBoardByOverlayToken
apps/api/src/db/boards.test.ts             # erweitert

apps/api/src/boards/routes.ts              # PATCH/PUT-checked rufen publishBoardEvent auf
apps/api/src/boards/routes.test.ts         # erweitert

apps/api/src/overlay/routes.ts             # neu: GET /api/overlay/:token, GET .../events (SSE)
apps/api/src/overlay/routes.test.ts        # neu
apps/api/src/server.ts                     # + registerOverlayRoutes

apps/web/src/views/OverlayView.vue         # neu: öffentliche Overlay-Seite mit Live-Updates
apps/web/src/views/OverlayView.test.ts     # neu
apps/web/src/router/index.ts               # + Route /overlay/:token (kein requiresAuth)

apps/web/src/views/BoardsView.vue          # + "Overlay-Link kopieren"-Button
apps/web/src/views/BoardsView.test.ts      # erweitert
```

---

### Task 1: `apps/api` – In-Memory Pub/Sub-Modul (TDD, reine Funktionen)

**Files:**
- Create: `apps/api/src/events/board-events.test.ts`
- Create: `apps/api/src/events/board-events.ts`

**Interfaces:**
- Consumes: nichts (reines Modul, kein DB-/HTTP-Zugriff)
- Produces: `publishBoardEvent(boardId: string, payload: unknown): void`, `subscribeToBoard(boardId: string, listener: (payload: unknown) => void): () => void` — genutzt von Task 4 (`apps/api/src/boards/routes.ts`) und Task 5 (`apps/api/src/overlay/routes.ts`)

- [ ] **Step 1: Fehlschlagenden Test schreiben — `apps/api/src/events/board-events.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { publishBoardEvent, subscribeToBoard } from "./board-events";

describe("board-events", () => {
  it("liefert ein publiziertes Event an einen abonnierten Listener", () => {
    const listener = vi.fn();
    subscribeToBoard("board-1", listener);

    publishBoardEvent("board-1", { hello: "world" });

    expect(listener).toHaveBeenCalledWith({ hello: "world" });
  });

  it("liefert ein Event an mehrere Listener desselben Boards", () => {
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    subscribeToBoard("board-2", listenerA);
    subscribeToBoard("board-2", listenerB);

    publishBoardEvent("board-2", { n: 1 });

    expect(listenerA).toHaveBeenCalledWith({ n: 1 });
    expect(listenerB).toHaveBeenCalledWith({ n: 1 });
  });

  it("liefert Events nicht an Listener eines anderen Boards", () => {
    const listener = vi.fn();
    subscribeToBoard("board-3", listener);

    publishBoardEvent("board-4", { n: 1 });

    expect(listener).not.toHaveBeenCalled();
  });

  it("stoppt die Zustellung nach dem Aufruf der Unsubscribe-Funktion", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToBoard("board-5", listener);

    unsubscribe();
    publishBoardEvent("board-5", { n: 1 });

    expect(listener).not.toHaveBeenCalled();
  });

  it("wirft nicht, wenn für eine Board-ID ohne Abonnenten publiziert wird", () => {
    expect(() => publishBoardEvent("board-ohne-abonnenten", { n: 1 })).not.toThrow();
  });
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag verifizieren**

Run: `pnpm --filter @bingo/api test`
Expected: FAIL — `./board-events` existiert nicht.

- [ ] **Step 3: Minimale Implementierung — `apps/api/src/events/board-events.ts`**

```ts
import { EventEmitter } from "node:events";

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

export function publishBoardEvent(boardId: string, payload: unknown): void {
  emitter.emit(boardId, payload);
}

export function subscribeToBoard(
  boardId: string,
  listener: (payload: unknown) => void
): () => void {
  emitter.on(boardId, listener);
  return () => {
    emitter.off(boardId, listener);
  };
}
```

- [ ] **Step 4: Test ausführen, Erfolg verifizieren**

Run: `pnpm --filter @bingo/api test`
Expected: PASS — alle 5 Tests grün.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @bingo/api exec tsc --noEmit`
Expected: Keine Ausgabe, Exit-Code 0.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/events/board-events.ts apps/api/src/events/board-events.test.ts
git commit -m "$(cat <<'EOF'
feat(api): In-Memory Pub/Sub-Modul für Board-Events

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `apps/api` – `toPublicBoard`-Serialisierung (TDD, reine Funktion)

**Files:**
- Create: `apps/api/src/overlay/public-board.test.ts`
- Create: `apps/api/src/overlay/public-board.ts`

**Interfaces:**
- Consumes: nichts (reine Funktion)
- Produces: `PublicCell`, `PublicBoard` (Typen), `toPublicBoard(board): PublicBoard` — genutzt von Task 4 (`apps/api/src/boards/routes.ts`) und Task 5 (`apps/api/src/overlay/routes.ts`)

- [ ] **Step 1: Fehlschlagenden Test schreiben — `apps/api/src/overlay/public-board.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { toPublicBoard } from "./public-board";

describe("toPublicBoard", () => {
  const fullBoard = {
    id: "board-uuid",
    userId: "user-uuid",
    name: "Mein geheimes Board",
    size: 3,
    labelMode: "letters",
    columnLabels: null as string[] | null,
    overlayToken: "geheimer-token",
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-02"),
    cells: [
      {
        boardId: "board-uuid",
        row: 0,
        col: 0,
        text: "Zelle A",
        checked: true,
        checkedAt: new Date("2024-01-03"),
      },
      {
        boardId: "board-uuid",
        row: 0,
        col: 1,
        text: "",
        checked: false,
        checkedAt: null,
      },
    ],
  };

  it("enthält size, labelMode, columnLabels und cells", () => {
    const result = toPublicBoard(fullBoard);

    expect(result.size).toBe(3);
    expect(result.labelMode).toBe("letters");
    expect(result.columnLabels).toBeNull();
    expect(result.cells).toEqual([
      { row: 0, col: 0, text: "Zelle A", checked: true },
      { row: 0, col: 1, text: "", checked: false },
    ]);
  });

  it("enthält keine internen IDs, keine user_id, keinen Namen und keine Zeitstempel", () => {
    const result = toPublicBoard(fullBoard) as Record<string, unknown>;

    expect(result).not.toHaveProperty("id");
    expect(result).not.toHaveProperty("userId");
    expect(result).not.toHaveProperty("overlayToken");
    expect(result).not.toHaveProperty("name");
    expect(result).not.toHaveProperty("createdAt");
    expect(result).not.toHaveProperty("updatedAt");
  });

  it("enthält pro Zelle keine boardId und kein checkedAt", () => {
    const result = toPublicBoard(fullBoard);
    const cell = result.cells[0] as Record<string, unknown>;

    expect(cell).not.toHaveProperty("boardId");
    expect(cell).not.toHaveProperty("checkedAt");
  });

  it("gibt columnLabels unverändert weiter, wenn gesetzt", () => {
    const result = toPublicBoard({ ...fullBoard, columnLabels: ["WIN", "GG", "GLHF"] });

    expect(result.columnLabels).toEqual(["WIN", "GG", "GLHF"]);
  });
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag verifizieren**

Run: `pnpm --filter @bingo/api test`
Expected: FAIL — `./public-board` existiert nicht.

- [ ] **Step 3: Minimale Implementierung — `apps/api/src/overlay/public-board.ts`**

```ts
export interface PublicCell {
  row: number;
  col: number;
  text: string;
  checked: boolean;
}

export interface PublicBoard {
  size: number;
  labelMode: string;
  columnLabels: string[] | null;
  cells: PublicCell[];
}

interface FullBoardLike {
  size: number;
  labelMode: string;
  columnLabels: string[] | null;
  cells: Array<{ row: number; col: number; text: string; checked: boolean }>;
}

export function toPublicBoard(board: FullBoardLike): PublicBoard {
  return {
    size: board.size,
    labelMode: board.labelMode,
    columnLabels: board.columnLabels,
    cells: board.cells.map((cell) => ({
      row: cell.row,
      col: cell.col,
      text: cell.text,
      checked: cell.checked,
    })),
  };
}
```

- [ ] **Step 4: Test ausführen, Erfolg verifizieren**

Run: `pnpm --filter @bingo/api test`
Expected: PASS — alle 4 Tests grün.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @bingo/api exec tsc --noEmit`
Expected: Keine Ausgabe, Exit-Code 0.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/overlay/public-board.ts apps/api/src/overlay/public-board.test.ts
git commit -m "$(cat <<'EOF'
feat(api): toPublicBoard – Serialisierung ohne interne Felder

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `apps/api` – `getBoardByOverlayToken`-DB-Helfer (TDD, echte DB)

**Files:**
- Modify: `apps/api/src/db/boards.ts`
- Modify: `apps/api/src/db/boards.test.ts`

**Interfaces:**
- Consumes: nichts Neues
- Produces: `getBoardByOverlayToken(token: string): Promise<(BoardRow & {cells: CellRow[]}) | null>` — kein Ownership-Parameter (der Token selbst ist die Autorisierung, SPEC 2.7) — genutzt von Task 5 (`apps/api/src/overlay/routes.ts`)

- [ ] **Step 1: Fehlschlagenden Test ergänzen — `apps/api/src/db/boards.test.ts` (Import-Zeile erweitern und am Ende der Datei ergänzen)**

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
} from "./boards";
```

Am Ende der Datei ergänzen:
```ts
describe("getBoardByOverlayToken", () => {
  const createdUserIds: string[] = [];

  afterEach(async () => {
    for (const userId of createdUserIds.splice(0)) {
      await db.delete(users).where(eq(users.id, userId));
    }
  });

  it("liefert das Board inkl. Zellen für einen gültigen Token", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const board = await createBoardWithCells(user.id, {
      name: "Board",
      size: 3,
      label_mode: "letters",
    });

    const result = await getBoardByOverlayToken(board.overlayToken);

    expect(result?.id).toBe(board.id);
    expect(result?.cells).toHaveLength(9);
  });

  it("liefert null für einen ungültigen Token", async () => {
    const result = await getBoardByOverlayToken("token-existiert-nicht");

    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag verifizieren**

Run: `pnpm --filter @bingo/api test`
Expected: FAIL — `getBoardByOverlayToken` existiert nicht.

- [ ] **Step 3: Minimale Implementierung — `apps/api/src/db/boards.ts` am Ende der Datei ergänzen**

```ts
export async function getBoardByOverlayToken(token: string) {
  const [board] = await db.select().from(boards).where(eq(boards.overlayToken, token));

  if (!board) {
    return null;
  }

  const cells = await db.select().from(boardCells).where(eq(boardCells.boardId, board.id));

  return { ...board, cells };
}
```

- [ ] **Step 4: Test ausführen, Erfolg verifizieren**

Run: `pnpm --filter @bingo/api test`
Expected: PASS — alle 2 neuen Tests grün.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @bingo/api exec tsc --noEmit`
Expected: Keine Ausgabe, Exit-Code 0.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/db/boards.ts apps/api/src/db/boards.test.ts
git commit -m "$(cat <<'EOF'
feat(api): getBoardByOverlayToken-DB-Helfer

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `apps/api` – PATCH/PUT-checked veröffentlichen Board-Events (TDD, echte DB)

**Files:**
- Modify: `apps/api/src/boards/routes.ts`
- Modify: `apps/api/src/boards/routes.test.ts`

**Interfaces:**
- Consumes: `publishBoardEvent` aus `../events/board-events` (Task 1), `toPublicBoard` aus `../overlay/public-board` (Task 2)
- Produces: `PATCH /api/boards/:id` und `PUT /api/boards/:id/cells/:row/:col/checked` veröffentlichen nach erfolgreichem Schreiben je ein Event mit dem vollständigen öffentlichen Board-Zustand

- [ ] **Step 1: Fehlschlagende Tests ergänzen — `apps/api/src/boards/routes.test.ts`**

Import-Zeile ergänzen (nach der bestehenden `createFakeProvider`-Import-Zeile):
```ts
import { subscribeToBoard } from "../events/board-events";
```

Innerhalb von `describe("PATCH /api/boards/:id", () => { ... })`, am Ende des Blocks (vor dessen schließender `});`) ergänzen:
```ts
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
```

Innerhalb von `describe("PUT /api/boards/:id/cells/:row/:col/checked", () => { ... })`, am Ende des Blocks (vor dessen schließender `});`) ergänzen:
```ts
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
```

- [ ] **Step 2: Test ausführen, Fehlschlag verifizieren**

Run: `pnpm --filter @bingo/api test`
Expected: FAIL — beide neuen Tests schlagen fehl (`events` bleibt leer, da noch nichts publiziert wird).

- [ ] **Step 3: Implementierung — `apps/api/src/boards/routes.ts` erweitern**

Import-Zeilen erweitern (nach der bestehenden `../db/boards`-Import-Zeile):
```ts
import { publishBoardEvent } from "../events/board-events";
import { toPublicBoard } from "../overlay/public-board";
```

Im PATCH-Handler den Rückgabeblock ersetzen:
```ts
    const updated = await updateBoard(user.id, paramsResult.data.id, bodyResult.data);
    if (!updated) {
      return reply.status(404).send({ error: "Board nicht gefunden" });
    }
    publishBoardEvent(updated.id, toPublicBoard(updated));
    return updated;
```

Im PUT-checked-Handler den Rückgabeblock ersetzen:
```ts
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
      const freshBoard = await getBoardById(user.id, paramsResult.data.id);
      if (freshBoard) {
        publishBoardEvent(freshBoard.id, toPublicBoard(freshBoard));
      }
      return updatedCell;
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
feat(api): PATCH und PUT-checked veröffentlichen Board-Events

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `apps/api` – Overlay-Routen: `GET /api/overlay/:token` + SSE-Stream (TDD, echte DB + echter Server)

**Files:**
- Create: `apps/api/src/overlay/routes.test.ts`
- Create: `apps/api/src/overlay/routes.ts`
- Modify: `apps/api/src/server.ts`

**Interfaces:**
- Consumes: `getBoardByOverlayToken` aus `../db/boards` (Task 3), `subscribeToBoard` aus `../events/board-events` (Task 1), `toPublicBoard` aus `./public-board` (Task 2)
- Produces: `registerOverlayRoutes(app)`, registriert `GET /api/overlay/:token` (öffentliche JSON-Antwort) und `GET /api/overlay/:token/events` (SSE-Stream) — beide ohne Login

Hinweis: Das SSE-`GET .../events`-Handler nutzt `reply.hijack()` und schreibt direkt auf `reply.raw` — dieses Muster wurde vorab gegen eine echte laufende Fastify-Instanz verifiziert (`app.listen()` + echter `fetch()`-Stream-Read + `reader.cancel()`), bevor dieser Plan geschrieben wurde. Es funktioniert wie unten spezifiziert.

- [ ] **Step 1: Fehlschlagende Tests schreiben — `apps/api/src/overlay/routes.test.ts`**

```ts
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
```

- [ ] **Step 2: Test ausführen, Fehlschlag verifizieren**

Run: `pnpm --filter @bingo/api test`
Expected: FAIL — `apps/api/src/overlay/routes.ts` und die Registrierung existieren nicht.

- [ ] **Step 3: Minimale Implementierung — `apps/api/src/overlay/routes.ts` erstellen**

```ts
import type { FastifyInstance } from "fastify";
import { getBoardByOverlayToken } from "../db/boards";
import { subscribeToBoard } from "../events/board-events";
import { toPublicBoard } from "./public-board";

export async function registerOverlayRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { token: string } }>("/api/overlay/:token", async (request, reply) => {
    const board = await getBoardByOverlayToken(request.params.token);
    if (!board) {
      return reply.status(404).send();
    }
    return toPublicBoard(board);
  });

  app.get<{ Params: { token: string } }>("/api/overlay/:token/events", async (request, reply) => {
    const board = await getBoardByOverlayToken(request.params.token);
    if (!board) {
      return reply.status(404).send();
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    function send(payload: unknown) {
      reply.raw.write(`event: board-update\ndata: ${JSON.stringify(payload)}\n\n`);
    }

    send(toPublicBoard(board));

    const unsubscribe = subscribeToBoard(board.id, (payload) => {
      send(payload);
    });

    const heartbeat = setInterval(() => {
      reply.raw.write(": heartbeat\n\n");
    }, 30000);

    request.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
      reply.raw.end();
    });
  });
}
```

- [ ] **Step 4: `apps/api/src/server.ts` erweitern**

Import-Zeile ergänzen (nach `registerBoardRoutes`-Import):
```ts
import { registerOverlayRoutes } from "./overlay/routes";
```

Nach `await registerBoardRoutes(app);` ergänzen:
```ts
  await registerOverlayRoutes(app);
```

- [ ] **Step 5: Test ausführen, Erfolg verifizieren**

Run: `pnpm --filter @bingo/api test`
Expected: PASS — alle Tests grün.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @bingo/api exec tsc --noEmit`
Expected: Keine Ausgabe, Exit-Code 0.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/overlay/routes.ts apps/api/src/overlay/routes.test.ts apps/api/src/server.ts
git commit -m "$(cat <<'EOF'
feat(api): öffentliche Overlay-Routen (GET + SSE-Stream)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `apps/web` – `OverlayView.vue`: öffentliche Overlay-Seite mit Live-Updates (TDD)

**Files:**
- Create: `apps/web/src/views/OverlayView.vue`
- Create: `apps/web/src/views/OverlayView.test.ts`
- Modify: `apps/web/src/router/index.ts`

**Interfaces:**
- Consumes: `getColumnLabels`/`getRowLabels`/`LabelMode` aus `@bingo/shared` (bereits vorhanden), `buildGridCells` aus `../utils/grid` (bereits vorhanden). Nutzt bewusst **keinen** Pinia-Store — eigener lokaler Zustand, da die Daten öffentlich/anonym sind.
- Produces: Route `/overlay/:token` (Name `overlay`, **kein** `meta.requiresAuth`)

- [ ] **Step 1: `apps/web/src/router/index.ts` erweitern**

Import-Zeile ergänzen (nach `ControlView`):
```ts
import OverlayView from "../views/OverlayView.vue";
```

In `routes` nach dem `board-play`-Eintrag ergänzen:
```ts
    {
      path: "/overlay/:token",
      name: "overlay",
      component: OverlayView,
    },
```

- [ ] **Step 2: `apps/web/src/views/OverlayView.vue` erstellen**

```vue
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { getColumnLabels, getRowLabels, type LabelMode } from "@bingo/shared";
import { buildGridCells } from "../utils/grid";

interface PublicCell {
  row: number;
  col: number;
  text: string;
  checked: boolean;
}

interface PublicBoard {
  size: number;
  labelMode: string;
  columnLabels: string[] | null;
  cells: PublicCell[];
}

const route = useRoute();
const board = ref<PublicBoard | null>(null);
let eventSource: EventSource | null = null;

const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:3001";

function cellText(row: number, col: number): string {
  return board.value?.cells.find((c) => c.row === row && c.col === col)?.text ?? "";
}

function isChecked(row: number, col: number): boolean {
  return board.value?.cells.find((c) => c.row === row && c.col === col)?.checked ?? false;
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

onMounted(async () => {
  const token = route.params.token as string;

  const response = await fetch(`${API_BASE_URL}/api/overlay/${token}`);
  if (response.ok) {
    board.value = (await response.json()) as PublicBoard;
  }

  eventSource = new EventSource(`${API_BASE_URL}/api/overlay/${token}/events`);
  eventSource.addEventListener("board-update", (event) => {
    board.value = JSON.parse((event as MessageEvent).data) as PublicBoard;
  });
});

onBeforeUnmount(() => {
  eventSource?.close();
});
</script>

<template>
  <div class="overlay-root">
    <div
      v-if="board"
      class="overlay-grid"
      :style="{ gridTemplateColumns: `repeat(${board.size + 2}, 1fr)` }"
    >
      <template v-for="(gridCell, index) in gridCells" :key="index">
        <div v-if="gridCell.kind === 'empty'" class="overlay-cell" />
        <div v-else-if="gridCell.kind === 'label'" class="overlay-cell overlay-label">
          {{ gridCell.text }}
        </div>
        <div v-else class="overlay-cell overlay-content">
          <span class="overlay-text">{{ cellText(gridCell.row, gridCell.col) }}</span>
          <span v-if="isChecked(gridCell.row, gridCell.col)" class="overlay-mark">✕</span>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
:global(html),
:global(body) {
  background: transparent;
}

.overlay-root {
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
}

.overlay-grid {
  display: grid;
  width: min(100vw, 100vh);
  height: min(100vw, 100vh);
  gap: 0.3vmin;
}

.overlay-cell {
  aspect-ratio: 1 / 1;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
}

.overlay-label {
  color: white;
  font-weight: 700;
  font-size: clamp(0.6rem, 3vmin, 2rem);
  text-shadow:
    -1px -1px 0 #000,
    1px -1px 0 #000,
    -1px 1px 0 #000,
    1px 1px 0 #000;
}

.overlay-content {
  background: rgba(15, 23, 42, 0.55);
  border-radius: 0.4vmin;
}

.overlay-text {
  color: white;
  font-size: clamp(0.5rem, 2.2vmin, 1.5rem);
  text-align: center;
  padding: 0.4vmin;
  word-break: break-word;
  text-shadow:
    -1px -1px 0 #000,
    1px -1px 0 #000,
    -1px 1px 0 #000,
    1px 1px 0 #000;
}

.overlay-mark {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ef4444;
  font-size: clamp(1rem, 6vmin, 4rem);
  font-weight: 900;
  text-shadow:
    -1px -1px 0 #000,
    1px -1px 0 #000,
    -1px 1px 0 #000,
    1px 1px 0 #000;
  pointer-events: none;
}
</style>
```

> **Hinweis für die Umsetzung:** Diese Komponente nutzt bewusst reines `<style scoped>`-CSS statt Tailwind-Utility-Klassen — die viewport-relative `clamp()`/`vmin`-Größenberechnung und der mehrfache `text-shadow`-Konturausstoß lassen sich damit deutlich klarer ausdrücken als über Tailwind-Arbitrary-Values. Das ist eine bewusste Ausnahme nur für diese eine, strukturell andersartige Seite (transparentes OBS-Overlay ohne App-Chrome), keine Abkehr von der sonstigen Tailwind-Konvention im Projekt.

- [ ] **Step 3: `apps/web/src/views/OverlayView.test.ts` erstellen**

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createWebHistory } from "vue-router";
import OverlayView from "./OverlayView.vue";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners: Record<string, Array<(event: MessageEvent) => void>> = {};
  closed = false;

  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    (this.listeners[type] ??= []).push(listener);
  }

  close() {
    this.closed = true;
  }

  emit(type: string, data: unknown) {
    for (const listener of this.listeners[type] ?? []) {
      listener({ data: JSON.stringify(data) } as MessageEvent);
    }
  }
}

function createTestRouter() {
  return createRouter({
    history: createWebHistory(),
    routes: [{ path: "/overlay/:token", name: "overlay", component: OverlayView }],
  });
}

const samplePublicBoard = {
  size: 3,
  labelMode: "letters",
  columnLabels: null,
  cells: [
    { row: 0, col: 0, text: "Erste Zelle", checked: false },
    { row: 1, col: 1, text: "Mitte", checked: true },
  ],
};

describe("OverlayView", () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lädt den initialen Zustand und zeigt Labels, Text und Kreuz", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => samplePublicBoard,
    } as Response);

    const router = createTestRouter();
    router.push("/overlay/token123");
    await router.isReady();
    const wrapper = mount(OverlayView, { global: { plugins: [router] } });
    await flushPromises();

    expect(wrapper.text()).toContain("A");
    expect(wrapper.text()).toContain("Erste Zelle");
    expect(wrapper.text()).toContain("✕");
  });

  it("öffnet eine EventSource-Verbindung zum richtigen Pfad", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => samplePublicBoard,
    } as Response);

    const router = createTestRouter();
    router.push("/overlay/token123");
    await router.isReady();
    mount(OverlayView, { global: { plugins: [router] } });
    await flushPromises();

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toContain("/api/overlay/token123/events");
  });

  it("aktualisiert den Zustand bei einem board-update-Event", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => samplePublicBoard,
    } as Response);

    const router = createTestRouter();
    router.push("/overlay/token123");
    await router.isReady();
    const wrapper = mount(OverlayView, { global: { plugins: [router] } });
    await flushPromises();

    FakeEventSource.instances[0].emit("board-update", {
      ...samplePublicBoard,
      cells: [
        { row: 0, col: 0, text: "Geändert", checked: true },
        { row: 1, col: 1, text: "Mitte", checked: true },
      ],
    });
    await flushPromises();

    expect(wrapper.text()).toContain("Geändert");
  });

  it("schließt die EventSource-Verbindung beim Unmount", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => samplePublicBoard,
    } as Response);

    const router = createTestRouter();
    router.push("/overlay/token123");
    await router.isReady();
    const wrapper = mount(OverlayView, { global: { plugins: [router] } });
    await flushPromises();

    wrapper.unmount();

    expect(FakeEventSource.instances[0].closed).toBe(true);
  });

  it("zeigt nichts bei ungültigem Token", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, json: async () => ({}) } as Response);

    const router = createTestRouter();
    router.push("/overlay/invalid");
    await router.isReady();
    const wrapper = mount(OverlayView, { global: { plugins: [router] } });
    await flushPromises();

    expect(wrapper.find(".overlay-grid").exists()).toBe(false);
  });
});
```

- [ ] **Step 4: Test ausführen, Erfolg verifizieren**

Run: `pnpm --filter @bingo/web test`
Expected: PASS — alle 5 Tests in `OverlayView.test.ts` grün.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @bingo/web exec vue-tsc --noEmit`
Expected: Keine Ausgabe, Exit-Code 0.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/views/OverlayView.vue apps/web/src/views/OverlayView.test.ts apps/web/src/router/index.ts
git commit -m "$(cat <<'EOF'
feat(web): OverlayView – öffentliche Overlay-Seite mit SSE-Live-Updates

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `apps/web` – Dashboard: "Overlay-Link kopieren"-Button (TDD)

**Files:**
- Modify: `apps/web/src/views/BoardsView.vue`
- Modify: `apps/web/src/views/BoardsView.test.ts`

**Interfaces:**
- Consumes: `board.overlayToken` (bereits vorhanden in `Board`-Typ und in `listBoardsForUser`s Antwort)
- Produces: Button pro Board, der `${window.location.origin}/overlay/${board.overlayToken}` in die Zwischenablage kopiert

- [ ] **Step 1: Fehlschlagenden Test ergänzen — `apps/web/src/views/BoardsView.test.ts`**

Neuen Test in `describe("BoardsView", ...)` ergänzen (nach dem bestehenden Test "zeigt einen Link zur Control-Seite pro Board"):
```ts
  it("kopiert den Overlay-Link in die Zwischenablage", async () => {
    const router = createTestRouter();
    const auth = useAuthStore();
    const boardsStore = useBoardsStore();
    auth.user = { id: "1", login: "x", displayName: "Streamerin", avatarUrl: null };
    boardsStore.boards = [
      { id: "b1", name: "Board Eins", size: 3, checkedCount: 0, overlayToken: "abc123" } as never,
    ];
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const wrapper = mount(BoardsView, { global: { plugins: [router] } });
    await wrapper.vm.$nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));

    await wrapper.find("button.bg-slate-700").trigger("click");

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("/overlay/abc123"));
  });
```

- [ ] **Step 2: Test ausführen, Fehlschlag verifizieren**

Run: `pnpm --filter @bingo/web test`
Expected: FAIL — kein `button.bg-slate-700`-Element vorhanden (nur `RouterLink`s haben aktuell diese Klasse als `<a>`, kein `<button>`).

- [ ] **Step 3: Minimale Implementierung — `apps/web/src/views/BoardsView.vue` erweitern**

Im `<script setup>`-Block, nach `handleDelete` ergänzen:
```ts
async function handleCopyOverlayLink(token?: string) {
  if (!token) {
    return;
  }
  const url = `${window.location.origin}/overlay/${token}`;
  await navigator.clipboard.writeText(url);
}
```

Im Template, im `<div class="flex gap-2">`-Block, nach dem "Spielen"-`RouterLink` und vor dem "Bearbeiten"-`RouterLink` ergänzen:
```vue
            <button
              class="rounded bg-slate-700 px-3 py-1 hover:bg-slate-600"
              @click="handleCopyOverlayLink(board.overlayToken)"
            >
              Overlay-Link kopieren
            </button>
```

- [ ] **Step 4: Test ausführen, Erfolg verifizieren**

Run: `pnpm --filter @bingo/web test`
Expected: PASS — alle Tests in `BoardsView.test.ts` grün (5 insgesamt).

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
feat(web): Dashboard-Button zum Kopieren des Overlay-Links

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Nach Abschluss dieses Plans

Automatisiert vollständig verifiziert: öffentliche, token-basierte Overlay-Routen ohne interne
Felder, Pub/Sub-Wiring in PATCH/PUT-checked, SSE-Stream sendet initialen Zustand + Live-Updates
(gegen eine echte laufende Server-Instanz getestet, nicht nur simuliert), Frontend-Overlay mit
EventSource-Reconnect-Handling (nativ durch den Browser), Dashboard-Link zum Kopieren.

**Manuell zu verifizieren** (End-to-End im Browser, idealerweise in zwei Tabs oder mit OBS):
Board anlegen → Dashboard → "Overlay-Link kopieren" → Link in neuem Tab öffnen (kein App-Chrome,
transparenter Hintergrund sichtbar als z.B. Schachbrett-Muster im Browser) → in einem zweiten Tab
die Control-Seite öffnen und ein Feld anklicken → Kreuz erscheint im Overlay-Tab innerhalb von
~1s ohne Reload (SPEC 9, AC7) → Overlay-Tab neu laden → letzter Stand weiterhin sichtbar (AC7/AC8)
→ Netzwerk kurz kappen und wiederherstellen (DevTools offline/online) → Overlay verbindet sich
automatisch neu und zeigt den aktuellen Stand.

Nächster Schritt laut SPEC.md Abschnitt 10: **Duplizieren, Reset, Token neu generieren** (Punkt 7).
