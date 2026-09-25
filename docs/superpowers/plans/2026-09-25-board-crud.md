# Board-CRUD (API + Dashboard) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Boards anlegen, auflisten und löschen — API + Dashboard. Deckt SPEC.md Abschnitt 10, Punkt 3 ab. Duplizieren/Reset/Token-Regenerierung (Punkt 7) und der volle Zellen-Editor (Punkt 4) sind bewusst nicht Teil dieses Plans.

**Architecture:** Zusammengesetzte Zod-Validierung (`createBoardSchema`) wandert nach `packages/shared`, damit Frontend und Backend dieselbe Regel nutzen (SPEC 3). Ein wiederverwendbarer `requireAuth`-Helper kapselt die Login-Prüfung für alle `/api/boards`-Routen; Eigentümer-Prüfung erfolgt direkt in den DB-Queries (WHERE `user_id = ...`), sodass fremde/nicht existente Boards ununterscheidbar 404 liefern (SPEC 5, „sonst 404, nicht 403"). Beim Anlegen eines Boards werden sofort alle `size × size` Zellen erzeugt (SPEC 4). `/boards/:id/edit` ist vorerst ein schreibgeschützter Platzhalter, der den eigentümergeschützten Abruf beweist — der volle Editor kommt in einem Folgeplan, genau wie `/boards` in der Foundation-Phase ein Platzhalter war, den der Auth-Plan gefüllt hat.

**Tech Stack:** Zod (zusammengesetzte Schemas mit `superRefine`), Drizzle ORM (Aggregation via `count(*) filter (where ...)`), Fastify, Pinia, Vue Router.

**Spec:** `SPEC.md` (Abschnitte 2.2, 2.4, 2.5, 4, 5, 6, 10 Punkt 3); Vorgänger-Pläne `docs/superpowers/plans/2026-09-24-foundation-monorepo.md`, `docs/superpowers/plans/2026-09-24-auth-twitch-sessions.md` (beide vollständig umgesetzt, `apps/api`/`apps/web` haben bereits Auth, Sessions, Cookie/CORS-Plugins)

## Global Constraints

- Board-Größe ist nach Anlage fix; `size × size` Zellen werden sofort beim Anlegen erzeugt (SPEC 4, 2.2).
- `label_mode` ausschließlich `'letters' | 'bingo' | 'custom'`; `'bingo'` nur bei `size = 5`; `'custom'` erfordert `column_labels` mit exakt `size` Einträgen (SPEC 2.3, 11).
- Alle `/api/*`-Routen (außer `/api/overlay/*`, hier nicht relevant) erfordern Login; fremde/nicht existente Boards liefern **404, nicht 403** (SPEC 5).
- Overlay-Token: mind. 128 Bit, URL-safe (SPEC 2.7) — wird bereits beim Anlegen generiert, auch wenn die Overlay-Seite selbst erst in einem Folgeplan kommt.
- Board-Name Pflichtfeld, max. 60 Zeichen, Default „Neues Bingo" (SPEC 2.4).
- Alle Eingaben serverseitig mit Zod validieren (SPEC 8).
- Die lokale `.env`-Datei enthält echte Secrets — kein Task darf sie verändern, überschreiben oder löschen, nur `.env.example` ist ein Template zum Bearbeiten.
- Alle Datenbank-Tests laufen gegen die echte, laufende Postgres-Instanz (Docker Compose, Port 5433) — kein Mocken der eigenen DB-Logik.
- Kein `"packageManager"`-Feld irgendwo im Repo.
- Jeder Commit endet mit exakt: `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- UI-Sprache Deutsch.
- Sowohl `vitest run` als auch der jeweilige TypeScript-Compiler (`tsc --noEmit` für `apps/api`, `vue-tsc --noEmit` für `apps/web`) müssen für jeden Task sauber durchlaufen — ein früherer Plan hatte mehrfach Testdateien, die `vitest` bestanden, aber den Compiler nicht.

---

## Datei-Übersicht

```
packages/shared/src/boards.ts             # createBoardSchema (zusammengesetzt, superRefine)
packages/shared/src/boards.test.ts
packages/shared/src/index.ts              # erweitert: export * from "./boards"

apps/api/src/db/schema.ts                 # erweitert: size/labelMode mit $type<BoardSize>/$type<LabelMode>
apps/api/src/db/boards.ts                 # createBoardWithCells, listBoardsForUser, getBoardById, deleteBoard
apps/api/src/db/boards.test.ts
apps/api/src/auth/require-auth.ts         # requireAuth(request, reply) -> AuthUser | null
apps/api/src/test-helpers/auth.ts         # createFakeProvider, extractCookie, loginViaFakeProvider (Testhelfer)
apps/api/src/boards/routes.ts             # POST/GET /api/boards, GET/DELETE /api/boards/:id
apps/api/src/boards/routes.test.ts
apps/api/src/server.ts                    # erweitert: registerBoardRoutes(app)

apps/web/src/stores/boards.ts             # Pinia-Store: boards, fetchBoards, createBoard, deleteBoard
apps/web/src/stores/boards.test.ts
apps/web/src/views/BoardsView.vue         # umgebaut: echtes Dashboard (Header + Board-Liste)
apps/web/src/views/BoardsView.test.ts     # erweitert für neues Layout
apps/web/src/views/NewBoardView.vue       # neu: /boards/new
apps/web/src/views/NewBoardView.test.ts
apps/web/src/views/BoardEditView.vue      # neu: /boards/:id/edit (Platzhalter)
apps/web/src/views/BoardEditView.test.ts
apps/web/src/router/index.ts              # erweitert: /boards/new, /boards/:id/edit
```

---

### Task 1: `packages/shared` – Zusammengesetztes `createBoardSchema` (TDD)

**Files:**
- Create: `packages/shared/src/boards.test.ts`
- Create: `packages/shared/src/boards.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: `boardSizeSchema`, `labelModeSchema`, `boardNameSchema`, `columnLabelSchema` aus `./schemas` (bereits vorhanden)
- Produces: `createBoardSchema` (Zod-Schema), `CreateBoardInput` (Typ) — genutzt von Task 3 (`apps/api/src/boards/routes.ts`) und Task 7 (`apps/web/src/views/NewBoardView.vue`)

- [ ] **Step 1: Fehlschlagenden Test schreiben — `packages/shared/src/boards.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { createBoardSchema } from "./boards";

describe("createBoardSchema", () => {
  it("akzeptiert letters-Modus ohne column_labels", () => {
    const result = createBoardSchema.safeParse({
      name: "Mein Board",
      size: 3,
      label_mode: "letters",
    });
    expect(result.success).toBe(true);
  });

  it("akzeptiert bingo-Modus bei size=5", () => {
    const result = createBoardSchema.safeParse({
      name: "Mein Board",
      size: 5,
      label_mode: "bingo",
    });
    expect(result.success).toBe(true);
  });

  it("lehnt bingo-Modus bei size!=5 ab", () => {
    const result = createBoardSchema.safeParse({
      name: "Mein Board",
      size: 3,
      label_mode: "bingo",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["label_mode"]);
    }
  });

  it("akzeptiert custom-Modus mit passender Anzahl column_labels", () => {
    const result = createBoardSchema.safeParse({
      name: "Mein Board",
      size: 3,
      label_mode: "custom",
      column_labels: ["WIN", "GG", "GLHF"],
    });
    expect(result.success).toBe(true);
  });

  it("lehnt custom-Modus mit falscher Anzahl column_labels ab", () => {
    const result = createBoardSchema.safeParse({
      name: "Mein Board",
      size: 3,
      label_mode: "custom",
      column_labels: ["WIN"],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["column_labels"]);
    }
  });

  it("lehnt custom-Modus ohne column_labels ab", () => {
    const result = createBoardSchema.safeParse({
      name: "Mein Board",
      size: 3,
      label_mode: "custom",
    });
    expect(result.success).toBe(false);
  });

  it("lehnt leeren Namen ab", () => {
    const result = createBoardSchema.safeParse({
      name: "",
      size: 3,
      label_mode: "letters",
    });
    expect(result.success).toBe(false);
  });

  it("lehnt ungültige Größe ab", () => {
    const result = createBoardSchema.safeParse({
      name: "Mein Board",
      size: 4,
      label_mode: "letters",
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag verifizieren**

Run: `pnpm --filter @bingo/shared test`
Expected: FAIL — `boards.ts` existiert nicht.

- [ ] **Step 3: Minimale Implementierung — `packages/shared/src/boards.ts`**

```ts
import { z } from "zod";
import { boardSizeSchema, labelModeSchema, boardNameSchema, columnLabelSchema } from "./schemas";

export const createBoardSchema = z
  .object({
    name: boardNameSchema,
    size: boardSizeSchema,
    label_mode: labelModeSchema,
    column_labels: z.array(columnLabelSchema).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.label_mode === "bingo" && data.size !== 5) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'label_mode "bingo" ist nur bei size=5 erlaubt',
        path: ["label_mode"],
      });
    }
    if (data.label_mode === "custom") {
      if (!data.column_labels || data.column_labels.length !== data.size) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `column_labels muss genau ${data.size} Einträge enthalten`,
          path: ["column_labels"],
        });
      }
    }
  });

export type CreateBoardInput = z.infer<typeof createBoardSchema>;
```

- [ ] **Step 4: `packages/shared/src/index.ts` erweitern**

```ts
export * from "./constants";
export * from "./labels";
export * from "./schemas";
export * from "./boards";
```

- [ ] **Step 5: Test ausführen, Erfolg verifizieren**

Run: `pnpm --filter @bingo/shared test`
Expected: PASS — alle 8 neuen Tests grün (plus alle bisherigen Tests weiterhin grün).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/boards.ts packages/shared/src/boards.test.ts packages/shared/src/index.ts
git commit -m "$(cat <<'EOF'
feat(shared): zusammengesetztes createBoardSchema mit Cross-Validierung

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `apps/api` – Board-DB-Helfer + Schema-Typisierung (TDD, echte DB)

**Files:**
- Modify: `apps/api/src/db/schema.ts`
- Create: `apps/api/src/db/boards.test.ts`
- Create: `apps/api/src/db/boards.ts`

**Interfaces:**
- Consumes: `CreateBoardInput` aus `@bingo/shared` (Task 1), `BoardSize`/`LabelMode` aus `@bingo/shared` (bereits vorhanden), `db`/`boards`/`boardCells` aus `./client`/`./schema`
- Produces: `createBoardWithCells(userId, input): Promise<BoardRow>`, `listBoardsForUser(userId): Promise<BoardListRow[]>` (inkl. `checkedCount`), `getBoardById(userId, boardId): Promise<(BoardRow & {cells: CellRow[]}) | null>`, `deleteBoard(userId, boardId): Promise<boolean>` — genutzt von Task 3/4 (`apps/api/src/boards/routes.ts`)

Voraussetzung: Docker-Compose-Postgres läuft, `.env` ist vorhanden.

- [ ] **Step 1: `apps/api/src/db/schema.ts` erweitern (Import + `$type<>()` auf `size`/`labelMode`)**

```ts
import {
  pgTable,
  uuid,
  text,
  smallint,
  boolean,
  timestamp,
  jsonb,
  primaryKey,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { BoardSize, LabelMode } from "@bingo/shared";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  twitchId: text("twitch_id").notNull().unique(),
  login: text("login").notNull(),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const boards = pgTable(
  "boards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    size: smallint("size").notNull().$type<BoardSize>(),
    labelMode: text("label_mode").notNull().$type<LabelMode>(),
    columnLabels: jsonb("column_labels").$type<string[] | null>(),
    overlayToken: text("overlay_token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    sizeCheck: check("boards_size_check", sql`${table.size} IN (3, 5, 7, 9)`),
    labelModeCheck: check(
      "boards_label_mode_check",
      sql`${table.labelMode} IN ('letters', 'bingo', 'custom')`
    ),
  })
);

export const boardCells = pgTable(
  "board_cells",
  {
    boardId: uuid("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    row: smallint("row").notNull(),
    col: smallint("col").notNull(),
    text: text("text").notNull().default(""),
    checked: boolean("checked").notNull().default(false),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.boardId, table.row, table.col] }),
  })
);

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
```

> **Hinweis:** `$type<>()` ist rein TypeScript-seitig (keine Migration nötig, keine DB-Änderung) — die CHECK-Constraints in Postgres bleiben unverändert die eigentliche Laufzeit-Absicherung. Schließt einen in der Foundation-Phase zurückgestellten Punkt ("DB-Schema nicht an Shared-Types gekoppelt").

- [ ] **Step 2: Fehlschlagenden Test schreiben — `apps/api/src/db/boards.test.ts`**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import "../env";
import { db } from "./client";
import { users, boards, boardCells } from "./schema";
import {
  createBoardWithCells,
  listBoardsForUser,
  getBoardById,
  deleteBoard,
} from "./boards";

async function createTestUser() {
  const [user] = await db
    .insert(users)
    .values({
      twitchId: `test-${randomUUID()}`,
      login: "test-user",
      displayName: "Test User",
      avatarUrl: null,
    })
    .returning();
  return user;
}

describe("Board-DB-Helfer", () => {
  const createdUserIds: string[] = [];

  afterEach(async () => {
    for (const userId of createdUserIds.splice(0)) {
      await db.delete(users).where(eq(users.id, userId));
    }
  });

  it("createBoardWithCells legt Board mit korrekten Feldern und size×size Zellen an", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);

    const board = await createBoardWithCells(user.id, {
      name: "Mein Board",
      size: 3,
      label_mode: "letters",
    });

    expect(board.name).toBe("Mein Board");
    expect(board.size).toBe(3);
    expect(board.labelMode).toBe("letters");
    expect(board.userId).toBe(user.id);
    expect(board.overlayToken).toMatch(/^[A-Za-z0-9_-]{20,}$/);

    const cells = await db.select().from(boardCells).where(eq(boardCells.boardId, board.id));
    expect(cells).toHaveLength(9);
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const cell = cells.find((c) => c.row === row && c.col === col);
        expect(cell).toBeDefined();
        expect(cell?.text).toBe("");
        expect(cell?.checked).toBe(false);
      }
    }
  });

  it("listBoardsForUser liefert nur eigene Boards mit korrektem checkedCount", async () => {
    const owner = await createTestUser();
    const other = await createTestUser();
    createdUserIds.push(owner.id, other.id);

    const ownBoard = await createBoardWithCells(owner.id, {
      name: "Eigenes Board",
      size: 3,
      label_mode: "letters",
    });
    await createBoardWithCells(other.id, {
      name: "Fremdes Board",
      size: 3,
      label_mode: "letters",
    });

    await db
      .update(boardCells)
      .set({ checked: true })
      .where(and(eq(boardCells.boardId, ownBoard.id), eq(boardCells.row, 0), eq(boardCells.col, 0)));

    const result = await listBoardsForUser(owner.id);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(ownBoard.id);
    expect(result[0].checkedCount).toBe(1);
  });

  it("getBoardById liefert Board inkl. Zellen für den Eigentümer", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const board = await createBoardWithCells(user.id, {
      name: "Mein Board",
      size: 3,
      label_mode: "letters",
    });

    const result = await getBoardById(user.id, board.id);

    expect(result?.id).toBe(board.id);
    expect(result?.cells).toHaveLength(9);
  });

  it("getBoardById liefert null für fremden User", async () => {
    const owner = await createTestUser();
    const other = await createTestUser();
    createdUserIds.push(owner.id, other.id);
    const board = await createBoardWithCells(owner.id, {
      name: "Mein Board",
      size: 3,
      label_mode: "letters",
    });

    const result = await getBoardById(other.id, board.id);

    expect(result).toBeNull();
  });

  it("getBoardById liefert null für nicht existierende ID", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);

    const result = await getBoardById(user.id, randomUUID());

    expect(result).toBeNull();
  });

  it("deleteBoard löscht Board (und kaskadiert Zellen) für den Eigentümer", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const board = await createBoardWithCells(user.id, {
      name: "Mein Board",
      size: 3,
      label_mode: "letters",
    });

    const deleted = await deleteBoard(user.id, board.id);

    expect(deleted).toBe(true);
    const [row] = await db.select().from(boards).where(eq(boards.id, board.id));
    expect(row).toBeUndefined();
    const cells = await db.select().from(boardCells).where(eq(boardCells.boardId, board.id));
    expect(cells).toHaveLength(0);
  });

  it("deleteBoard löscht nichts und liefert false für fremden User", async () => {
    const owner = await createTestUser();
    const other = await createTestUser();
    createdUserIds.push(owner.id, other.id);
    const board = await createBoardWithCells(owner.id, {
      name: "Mein Board",
      size: 3,
      label_mode: "letters",
    });

    const deleted = await deleteBoard(other.id, board.id);

    expect(deleted).toBe(false);
    const [row] = await db.select().from(boards).where(eq(boards.id, board.id));
    expect(row).toBeDefined();
  });
});
```

- [ ] **Step 3: Test ausführen, Fehlschlag verifizieren**

Run: `pnpm --filter @bingo/api test`
Expected: FAIL — `db/boards.ts` existiert nicht.

- [ ] **Step 4: Minimale Implementierung — `apps/api/src/db/boards.ts`**

```ts
import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "./client";
import { boards, boardCells } from "./schema";
import type { CreateBoardInput } from "@bingo/shared";

export async function createBoardWithCells(userId: string, input: CreateBoardInput) {
  const overlayToken = randomBytes(16).toString("base64url");

  const [board] = await db
    .insert(boards)
    .values({
      userId,
      name: input.name,
      size: input.size,
      labelMode: input.label_mode,
      columnLabels: input.column_labels ?? null,
      overlayToken,
    })
    .returning();

  const cellRows: Array<{ boardId: string; row: number; col: number }> = [];
  for (let row = 0; row < input.size; row++) {
    for (let col = 0; col < input.size; col++) {
      cellRows.push({ boardId: board.id, row, col });
    }
  }
  await db.insert(boardCells).values(cellRows);

  return board;
}

export async function listBoardsForUser(userId: string) {
  return db
    .select({
      id: boards.id,
      name: boards.name,
      size: boards.size,
      labelMode: boards.labelMode,
      overlayToken: boards.overlayToken,
      createdAt: boards.createdAt,
      updatedAt: boards.updatedAt,
      checkedCount: sql<number>`count(*) filter (where ${boardCells.checked})`.mapWith(Number),
    })
    .from(boards)
    .leftJoin(boardCells, eq(boardCells.boardId, boards.id))
    .where(eq(boards.userId, userId))
    .groupBy(boards.id)
    .orderBy(sql`${boards.updatedAt} desc`);
}

export async function getBoardById(userId: string, boardId: string) {
  const [board] = await db
    .select()
    .from(boards)
    .where(and(eq(boards.id, boardId), eq(boards.userId, userId)));

  if (!board) {
    return null;
  }

  const cells = await db.select().from(boardCells).where(eq(boardCells.boardId, boardId));

  return { ...board, cells };
}

export async function deleteBoard(userId: string, boardId: string): Promise<boolean> {
  const deleted = await db
    .delete(boards)
    .where(and(eq(boards.id, boardId), eq(boards.userId, userId)))
    .returning({ id: boards.id });

  return deleted.length > 0;
}
```

- [ ] **Step 5: Test ausführen, Erfolg verifizieren**

Run: `pnpm --filter @bingo/api test`
Expected: PASS — alle 7 neuen Tests grün.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @bingo/api exec tsc --noEmit`
Expected: Keine Ausgabe, Exit-Code 0.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/db/schema.ts apps/api/src/db/boards.ts apps/api/src/db/boards.test.ts
git commit -m "$(cat <<'EOF'
feat(api): Board-DB-Helfer (create/list/get/delete) + Schema-Typisierung

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `apps/api` – `requireAuth`-Helfer + `POST`/`GET /api/boards` (TDD, echte DB)

**Files:**
- Create: `apps/api/src/auth/require-auth.ts`
- Create: `apps/api/src/test-helpers/auth.ts`
- Create: `apps/api/src/boards/routes.ts`
- Create: `apps/api/src/boards/routes.test.ts`
- Modify: `apps/api/src/server.ts`

**Interfaces:**
- Consumes: `getCurrentUser`/`AuthUser` aus `../auth/current-user` (Phase 2), `createBoardSchema` aus `@bingo/shared` (Task 1), `createBoardWithCells`/`listBoardsForUser` aus `../db/boards` (Task 2), `OAuthProvider`/`OAuthUserInfo` aus `../auth/types` (Phase 2)
- Produces: `requireAuth(request, reply): Promise<AuthUser | null>` — wiederverwendbar für alle künftigen geschützten Routen; `createFakeProvider`/`extractCookie`/`loginViaFakeProvider` (Testhelfer) — wiederverwendbar für alle künftigen Tests geschützter Routen; `registerBoardRoutes(app)` mit `POST /api/boards`, `GET /api/boards`

- [ ] **Step 1: `apps/api/src/auth/require-auth.ts` anlegen**

```ts
import type { FastifyReply, FastifyRequest } from "fastify";
import { getCurrentUser, type AuthUser } from "./current-user";

export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<AuthUser | null> {
  const user = await getCurrentUser(request);
  if (!user) {
    reply.status(401).send({ error: "Nicht eingeloggt" });
    return null;
  }
  return user;
}
```

- [ ] **Step 2: `apps/api/src/test-helpers/auth.ts` anlegen**

```ts
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
```

> **Hinweis:** Diese Datei dupliziert bewusst keine bereits committeten Testdateien — `apps/auth/routes.test.ts` (Phase 2) behält seine eigenen, bereits reviewten Kopien dieser Helfer. Ab jetzt nutzen neue Testdateien für geschützte Routen diesen gemeinsamen Helfer.

- [ ] **Step 3: Fehlschlagenden Test schreiben — `apps/api/src/boards/routes.test.ts`**

```ts
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
```

- [ ] **Step 4: Test ausführen, Fehlschlag verifizieren**

Run: `pnpm --filter @bingo/api test`
Expected: FAIL — `boards/routes.ts` existiert nicht.

- [ ] **Step 5: Minimale Implementierung — `apps/api/src/boards/routes.ts`**

```ts
import type { FastifyInstance } from "fastify";
import { createBoardSchema } from "@bingo/shared";
import { requireAuth } from "../auth/require-auth";
import { createBoardWithCells, listBoardsForUser } from "../db/boards";

export async function registerBoardRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/boards", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) {
      return;
    }

    const parseResult = createBoardSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: parseResult.error.flatten() });
    }

    const board = await createBoardWithCells(user.id, parseResult.data);
    return reply.status(201).send(board);
  });

  app.get("/api/boards", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) {
      return;
    }

    return listBoardsForUser(user.id);
  });
}
```

- [ ] **Step 6: `apps/api/src/server.ts` erweitern**

```ts
import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import "./env";
import { registerAuthRoutes } from "./auth/routes";
import { registerBoardRoutes } from "./boards/routes";
import type { OAuthProvider } from "./auth/types";

export interface BuildServerOptions {
  authProvider?: OAuthProvider;
}

export async function buildServer(options: BuildServerOptions = {}) {
  const app = Fastify({ logger: true });

  const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:5173";
  await app.register(cors, {
    origin: webOrigin,
    credentials: true,
  });

  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) {
    throw new Error("SESSION_SECRET ist nicht gesetzt");
  }
  await app.register(cookie, { secret: sessionSecret });

  app.get("/health", async () => ({ status: "ok" }));

  await registerAuthRoutes(app, { provider: options.authProvider });
  await registerBoardRoutes(app);

  return app;
}

async function main() {
  const app = await buildServer();
  const port = Number(process.env.PORT ?? 3001);
  await app.listen({ port, host: "0.0.0.0" });
}

const isDirectRun = process.argv[1] === new URL(import.meta.url).pathname;
if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

- [ ] **Step 7: Test ausführen, Erfolg verifizieren**

Run: `pnpm --filter @bingo/api test`
Expected: PASS — alle neuen Tests grün, bisherige Tests weiterhin grün.

- [ ] **Step 8: Typecheck**

Run: `pnpm --filter @bingo/api exec tsc --noEmit`
Expected: Keine Ausgabe, Exit-Code 0.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/auth/require-auth.ts apps/api/src/test-helpers apps/api/src/boards/routes.ts apps/api/src/boards/routes.test.ts apps/api/src/server.ts
git commit -m "$(cat <<'EOF'
feat(api): requireAuth-Helfer + POST/GET /api/boards

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `apps/api` – `GET`/`DELETE /api/boards/:id` (TDD, echte DB, 404-statt-403)

**Files:**
- Modify: `apps/api/src/boards/routes.ts`
- Modify: `apps/api/src/boards/routes.test.ts`

**Interfaces:**
- Consumes: `getBoardById`/`deleteBoard` aus `../db/boards` (Task 2)
- Produces: `GET /api/boards/:id`, `DELETE /api/boards/:id` — beide eigentümergeschützt, 404 für fremde oder nicht existierende Boards (SPEC 5)

- [ ] **Step 1: Fehlschlagende Tests ergänzen — `apps/api/src/boards/routes.test.ts`**

Ganz oben bei den bestehenden Imports ergänzen: `import { randomUUID } from "node:crypto";`

Am Ende der Datei (nach dem bestehenden `describe("GET /api/boards", ...)`-Block) ergänzen:

```ts
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
```

- [ ] **Step 2: Test ausführen, Fehlschlag verifizieren**

Run: `pnpm --filter @bingo/api test`
Expected: FAIL — Routen `GET`/`DELETE /api/boards/:id` existieren nicht (404 von Fastifys eigenem Not-Found-Handler statt der erwarteten Assertions).

- [ ] **Step 3: Implementierung — `apps/api/src/boards/routes.ts` erweitern**

```ts
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createBoardSchema } from "@bingo/shared";
import { requireAuth } from "../auth/require-auth";
import { createBoardWithCells, listBoardsForUser, getBoardById, deleteBoard } from "../db/boards";

const boardIdParamSchema = z.object({ id: z.string().uuid() });

export async function registerBoardRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/boards", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) {
      return;
    }

    const parseResult = createBoardSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: parseResult.error.flatten() });
    }

    const board = await createBoardWithCells(user.id, parseResult.data);
    return reply.status(201).send(board);
  });

  app.get("/api/boards", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) {
      return;
    }

    return listBoardsForUser(user.id);
  });

  app.get<{ Params: { id: string } }>("/api/boards/:id", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) {
      return;
    }

    const paramsResult = boardIdParamSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(404).send({ error: "Board nicht gefunden" });
    }

    const board = await getBoardById(user.id, paramsResult.data.id);
    if (!board) {
      return reply.status(404).send({ error: "Board nicht gefunden" });
    }
    return board;
  });

  app.delete<{ Params: { id: string } }>("/api/boards/:id", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) {
      return;
    }

    const paramsResult = boardIdParamSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(404).send({ error: "Board nicht gefunden" });
    }

    const deleted = await deleteBoard(user.id, paramsResult.data.id);
    if (!deleted) {
      return reply.status(404).send({ error: "Board nicht gefunden" });
    }
    return reply.status(204).send();
  });
}
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
feat(api): GET/DELETE /api/boards/:id, eigentümergeschützt (404 statt 403)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `apps/web` – Boards-Store (TDD)

**Files:**
- Create: `apps/web/src/stores/boards.test.ts`
- Create: `apps/web/src/stores/boards.ts`

**Interfaces:**
- Consumes: nichts Neues
- Produces: `useBoardsStore()` mit State `boards: Board[]`, `isLoading: boolean` und Actions `fetchBoards()`, `createBoard(input)`, `deleteBoard(id)` — genutzt von Task 6 (`BoardsView.vue`) und Task 7 (`NewBoardView.vue`)

- [ ] **Step 1: Fehlschlagenden Test schreiben — `apps/web/src/stores/boards.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useBoardsStore } from "./boards";

describe("useBoardsStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetchBoards füllt boards bei erfolgreicher Antwort", async () => {
    const mockBoards = [{ id: "1", name: "Test", size: 3, checkedCount: 0 }];
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => mockBoards } as Response);

    const store = useBoardsStore();
    await store.fetchBoards();

    expect(store.boards).toEqual(mockBoards);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/boards"),
      expect.objectContaining({ credentials: "include" })
    );
  });

  it("fetchBoards setzt boards auf leeres Array bei Fehler", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, json: async () => ({}) } as Response);

    const store = useBoardsStore();
    await store.fetchBoards();

    expect(store.boards).toEqual([]);
  });

  it("createBoard sendet POST mit korrektem Body und liefert das erstellte Board", async () => {
    const created = { id: "1", name: "Neu", size: 3 };
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => created } as Response);

    const store = useBoardsStore();
    const result = await store.createBoard({ name: "Neu", size: 3, label_mode: "letters" });

    expect(result).toEqual(created);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/boards"),
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ name: "Neu", size: 3, label_mode: "letters" }),
      })
    );
  });

  it("createBoard wirft bei Fehlerantwort", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      json: async () => ({ error: "ungültig" }),
    } as Response);

    const store = useBoardsStore();
    await expect(
      store.createBoard({ name: "Neu", size: 3, label_mode: "letters" })
    ).rejects.toThrow();
  });

  it("deleteBoard sendet DELETE und entfernt das Board aus dem State", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({}) } as Response);

    const store = useBoardsStore();
    store.boards = [{ id: "1", name: "Test", size: 3, checkedCount: 0 } as never];

    await store.deleteBoard("1");

    expect(store.boards).toHaveLength(0);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/boards/1"),
      expect.objectContaining({ method: "DELETE", credentials: "include" })
    );
  });
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag verifizieren**

Run: `pnpm --filter @bingo/web test`
Expected: FAIL — `stores/boards.ts` existiert nicht.

- [ ] **Step 3: Minimale Implementierung — `apps/web/src/stores/boards.ts`**

```ts
import { defineStore } from "pinia";

export interface Board {
  id: string;
  name: string;
  size: number;
  labelMode?: string;
  overlayToken?: string;
  checkedCount: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateBoardInput {
  name: string;
  size: number;
  label_mode: string;
  column_labels?: string[];
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:3001";

export const useBoardsStore = defineStore("boards", {
  state: () => ({
    boards: [] as Board[],
    isLoading: false,
  }),
  actions: {
    async fetchBoards() {
      this.isLoading = true;
      try {
        const response = await fetch(`${API_BASE_URL}/api/boards`, {
          credentials: "include",
        });
        this.boards = response.ok ? ((await response.json()) as Board[]) : [];
      } finally {
        this.isLoading = false;
      }
    },
    async createBoard(input: CreateBoardInput): Promise<Board> {
      const response = await fetch(`${API_BASE_URL}/api/boards`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(
          typeof body?.error === "string" ? body.error : "Board konnte nicht erstellt werden"
        );
      }
      return (await response.json()) as Board;
    },
    async deleteBoard(id: string) {
      await fetch(`${API_BASE_URL}/api/boards/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      this.boards = this.boards.filter((board) => board.id !== id);
    },
  },
});
```

- [ ] **Step 4: Test ausführen, Erfolg verifizieren**

Run: `pnpm --filter @bingo/web test`
Expected: PASS — alle 5 Tests grün.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @bingo/web exec vue-tsc --noEmit`
Expected: Keine Ausgabe, Exit-Code 0.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/stores/boards.ts apps/web/src/stores/boards.test.ts
git commit -m "$(cat <<'EOF'
feat(web): Boards-Store (fetchBoards/createBoard/deleteBoard)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `apps/web` – `BoardsView.vue` zum echten Dashboard ausbauen (TDD)

**Files:**
- Modify: `apps/web/src/views/BoardsView.vue`
- Modify: `apps/web/src/views/BoardsView.test.ts`

**Interfaces:**
- Consumes: `useAuthStore` (Phase 2), `useBoardsStore` (Task 5)
- Produces: Dashboard-UI mit User-Header, Board-Liste, „Neues Board"-Link, Löschen-Button

- [ ] **Step 1: `apps/web/src/views/BoardsView.vue` ersetzen**

```vue
<script setup lang="ts">
import { onMounted } from "vue";
import { useRouter, RouterLink } from "vue-router";
import { useAuthStore } from "../stores/auth";
import { useBoardsStore } from "../stores/boards";

const auth = useAuthStore();
const boardsStore = useBoardsStore();
const router = useRouter();

onMounted(async () => {
  if (!auth.user) {
    await auth.fetchMe();
  }
  await boardsStore.fetchBoards();
});

async function handleLogout() {
  await auth.logout();
  router.push({ name: "home" });
}

async function handleDelete(id: string) {
  if (!confirm("Board wirklich löschen? Der Overlay-Link wird dadurch ungültig.")) {
    return;
  }
  await boardsStore.deleteBoard(id);
}
</script>

<template>
  <main class="min-h-screen bg-slate-900 text-slate-100">
    <header class="flex items-center justify-between border-b border-slate-700 p-4">
      <div v-if="auth.user" class="flex items-center gap-3">
        <img
          v-if="auth.user.avatarUrl"
          :src="auth.user.avatarUrl"
          :alt="auth.user.displayName"
          class="h-10 w-10 rounded-full"
        />
        <span>{{ auth.user.displayName }}</span>
      </div>
      <button
        class="rounded bg-purple-600 px-4 py-2 font-semibold hover:bg-purple-700"
        @click="handleLogout"
      >
        Ausloggen
      </button>
    </header>

    <div class="mx-auto max-w-3xl p-6">
      <div class="mb-4 flex items-center justify-between">
        <h1 class="text-2xl font-bold">Meine Boards</h1>
        <RouterLink
          to="/boards/new"
          class="rounded bg-purple-600 px-4 py-2 font-semibold hover:bg-purple-700"
        >
          Neues Board
        </RouterLink>
      </div>

      <p v-if="boardsStore.isLoading">Lade...</p>
      <p v-else-if="boardsStore.boards.length === 0" class="text-slate-400">
        Noch keine Boards vorhanden.
      </p>
      <ul v-else class="flex flex-col gap-2">
        <li
          v-for="board in boardsStore.boards"
          :key="board.id"
          class="flex items-center justify-between rounded bg-slate-800 p-4"
        >
          <div>
            <p class="font-semibold">{{ board.name }}</p>
            <p class="text-sm text-slate-400">
              {{ board.size }}×{{ board.size }} · {{ board.checkedCount }} abgehakt
            </p>
          </div>
          <div class="flex gap-2">
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
        </li>
      </ul>
    </div>
  </main>
</template>
```

- [ ] **Step 2: `apps/web/src/views/BoardsView.test.ts` ersetzen**

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createRouter, createWebHistory } from "vue-router";
import BoardsView from "./BoardsView.vue";
import { useAuthStore } from "../stores/auth";
import { useBoardsStore } from "../stores/boards";

function createTestRouter() {
  return createRouter({
    history: createWebHistory(),
    routes: [
      { path: "/", name: "home", component: { template: "<div />" } },
      { path: "/boards/new", name: "board-new", component: { template: "<div />" } },
      { path: "/boards/:id/edit", name: "board-edit", component: { template: "<div />" } },
    ],
  });
}

describe("BoardsView", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("fetch", vi.fn());
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("zeigt User-Header und Boardliste", async () => {
    const router = createTestRouter();
    const auth = useAuthStore();
    const boardsStore = useBoardsStore();
    auth.user = { id: "1", login: "x", displayName: "Streamerin", avatarUrl: null };
    boardsStore.boards = [
      { id: "b1", name: "Board Eins", size: 3, checkedCount: 2 } as never,
    ];

    const wrapper = mount(BoardsView, { global: { plugins: [router] } });
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain("Streamerin");
    expect(wrapper.text()).toContain("Board Eins");
    expect(wrapper.text()).toContain("3×3");
    expect(wrapper.text()).toContain("2 abgehakt");
  });

  it("zeigt Leerzustand ohne Boards", async () => {
    const router = createTestRouter();
    const auth = useAuthStore();
    auth.user = { id: "1", login: "x", displayName: "Streamerin", avatarUrl: null };

    const wrapper = mount(BoardsView, { global: { plugins: [router] } });
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain("Noch keine Boards vorhanden");
  });

  it("löscht ein Board nach Bestätigung", async () => {
    const router = createTestRouter();
    const auth = useAuthStore();
    const boardsStore = useBoardsStore();
    auth.user = { id: "1", login: "x", displayName: "Streamerin", avatarUrl: null };
    boardsStore.boards = [{ id: "b1", name: "Board Eins", size: 3, checkedCount: 0 } as never];
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({}) } as Response);

    const wrapper = mount(BoardsView, { global: { plugins: [router] } });
    await wrapper.find("button.bg-red-700").trigger("click");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(boardsStore.boards).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Test ausführen, Erfolg verifizieren**

Run: `pnpm --filter @bingo/web test`
Expected: PASS — alle Tests in `BoardsView.test.ts` grün.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @bingo/web exec vue-tsc --noEmit`
Expected: Keine Ausgabe, Exit-Code 0.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/views/BoardsView.vue apps/web/src/views/BoardsView.test.ts
git commit -m "$(cat <<'EOF'
feat(web): BoardsView zum echten Dashboard ausgebaut

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `apps/web` – `NewBoardView.vue` (TDD)

**Files:**
- Create: `apps/web/src/views/NewBoardView.vue`
- Create: `apps/web/src/views/NewBoardView.test.ts`
- Modify: `apps/web/src/router/index.ts`

**Interfaces:**
- Consumes: `BOARD_SIZES`/`DEFAULT_BOARD_NAME`/`BoardSize`/`LabelMode` aus `@bingo/shared`, `useBoardsStore` (Task 5)
- Produces: Route `/boards/new`

- [ ] **Step 1: `apps/web/src/views/NewBoardView.vue` anlegen**

```vue
<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useRouter } from "vue-router";
import { BOARD_SIZES, DEFAULT_BOARD_NAME, type BoardSize, type LabelMode } from "@bingo/shared";
import { useBoardsStore } from "../stores/boards";

const router = useRouter();
const boardsStore = useBoardsStore();

const name = ref(DEFAULT_BOARD_NAME);
const size = ref<BoardSize>(3);
const labelMode = ref<LabelMode>("letters");
const columnLabels = ref<string[]>([]);
const error = ref<string | null>(null);
const isSubmitting = ref(false);

const canUseBingo = computed(() => size.value === 5);

watch([size, labelMode], () => {
  if (labelMode.value === "custom") {
    columnLabels.value = Array.from({ length: size.value }, (_, i) => columnLabels.value[i] ?? "");
  }
  if (labelMode.value === "bingo" && !canUseBingo.value) {
    labelMode.value = "letters";
  }
});

async function handleSubmit() {
  error.value = null;
  isSubmitting.value = true;
  try {
    const board = await boardsStore.createBoard({
      name: name.value,
      size: size.value,
      label_mode: labelMode.value,
      column_labels: labelMode.value === "custom" ? columnLabels.value : undefined,
    });
    router.push(`/boards/${board.id}/edit`);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unbekannter Fehler";
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <main class="min-h-screen bg-slate-900 p-6 text-slate-100">
    <div class="mx-auto max-w-md">
      <h1 class="mb-4 text-2xl font-bold">Neues Board</h1>

      <form class="flex flex-col gap-4" @submit.prevent="handleSubmit">
        <label class="flex flex-col gap-1">
          Name
          <input v-model="name" type="text" maxlength="60" class="rounded bg-slate-800 p-2" />
        </label>

        <label class="flex flex-col gap-1">
          Größe
          <select v-model.number="size" class="rounded bg-slate-800 p-2">
            <option v-for="s in BOARD_SIZES" :key="s" :value="s">{{ s }}×{{ s }}</option>
          </select>
        </label>

        <label class="flex flex-col gap-1">
          Beschriftung
          <select v-model="labelMode" class="rounded bg-slate-800 p-2">
            <option value="letters">Buchstaben (A, B, C, …)</option>
            <option value="bingo" :disabled="!canUseBingo">BINGO</option>
            <option value="custom">Eigene Wörter</option>
          </select>
        </label>

        <div v-if="labelMode === 'custom'" class="flex flex-col gap-2">
          <label v-for="(_, i) in columnLabels" :key="i" class="flex flex-col gap-1">
            Spalte {{ i + 1 }}
            <input v-model="columnLabels[i]" type="text" maxlength="20" class="rounded bg-slate-800 p-2" />
          </label>
        </div>

        <p v-if="error" class="text-red-400">{{ error }}</p>

        <button
          type="submit"
          :disabled="isSubmitting"
          class="rounded bg-purple-600 px-4 py-2 font-semibold hover:bg-purple-700"
        >
          Board erstellen
        </button>
      </form>
    </div>
  </main>
</template>
```

- [ ] **Step 2: Test schreiben — `apps/web/src/views/NewBoardView.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createRouter, createWebHistory } from "vue-router";
import NewBoardView from "./NewBoardView.vue";
import { useBoardsStore } from "../stores/boards";

function createTestRouter() {
  return createRouter({
    history: createWebHistory(),
    routes: [
      { path: "/", name: "home", component: { template: "<div />" } },
      { path: "/boards/:id/edit", name: "board-edit", component: { template: "<div />" } },
    ],
  });
}

describe("NewBoardView", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("startet mit Default-Name, size=3 und label_mode=letters, ohne Custom-Felder", () => {
    const router = createTestRouter();
    const wrapper = mount(NewBoardView, { global: { plugins: [router] } });

    expect((wrapper.find("input[type=text]").element as HTMLInputElement).value).toBe(
      "Neues Bingo"
    );
    expect(wrapper.findAll("input[type=text]")).toHaveLength(1);
    expect(wrapper.text()).not.toContain("Spalte");
  });

  it("zeigt bei label_mode=custom genau size Spalten-Inputs", async () => {
    const router = createTestRouter();
    const wrapper = mount(NewBoardView, { global: { plugins: [router] } });

    const sizeSelect = wrapper.findAll("select")[0];
    await sizeSelect.setValue("5");
    const labelSelect = wrapper.findAll("select")[1];
    await labelSelect.setValue("custom");

    const columnInputs = wrapper.findAll("input[type=text]").filter((_, i) => i > 0);
    expect(columnInputs).toHaveLength(5);
  });

  it("ruft beim Absenden createBoard auf und navigiert zum Editor", async () => {
    const router = createTestRouter();
    const boardsStore = useBoardsStore();
    vi.spyOn(boardsStore, "createBoard").mockResolvedValue({
      id: "new-board-id",
      name: "Neues Bingo",
      size: 3,
      checkedCount: 0,
    });
    const pushSpy = vi.spyOn(router, "push");

    const wrapper = mount(NewBoardView, { global: { plugins: [router] } });
    await wrapper.find("form").trigger("submit.prevent");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(boardsStore.createBoard).toHaveBeenCalledWith({
      name: "Neues Bingo",
      size: 3,
      label_mode: "letters",
      column_labels: undefined,
    });
    expect(pushSpy).toHaveBeenCalledWith("/boards/new-board-id/edit");
  });

  it("zeigt eine Fehlermeldung, wenn createBoard fehlschlägt", async () => {
    const router = createTestRouter();
    const boardsStore = useBoardsStore();
    vi.spyOn(boardsStore, "createBoard").mockRejectedValue(new Error("Serverfehler"));

    const wrapper = mount(NewBoardView, { global: { plugins: [router] } });
    await wrapper.find("form").trigger("submit.prevent");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(wrapper.text()).toContain("Serverfehler");
  });
});
```

- [ ] **Step 3: `apps/web/src/router/index.ts` erweitern**

```ts
import { createRouter, createWebHistory, type RouteLocationNormalized } from "vue-router";
import HomeView from "../views/HomeView.vue";
import BoardsView from "../views/BoardsView.vue";
import NewBoardView from "../views/NewBoardView.vue";
import { useAuthStore } from "../stores/auth";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "home", component: HomeView },
    { path: "/boards", name: "boards", component: BoardsView, meta: { requiresAuth: true } },
    { path: "/boards/new", name: "board-new", component: NewBoardView, meta: { requiresAuth: true } },
  ],
});

export async function requireAuthGuard(to: RouteLocationNormalized) {
  if (!to.meta.requiresAuth) {
    return true;
  }

  const auth = useAuthStore();
  if (!auth.user) {
    await auth.fetchMe();
  }

  return auth.user ? true : { name: "home" };
}

router.beforeEach(requireAuthGuard);
```

> **Hinweis:** Die `/boards/:id/edit`-Route wird in Task 8 ergänzt (dort auch der zugehörige Router-Test erweitert).

- [ ] **Step 4: Test ausführen, Erfolg verifizieren**

Run: `pnpm --filter @bingo/web test`
Expected: PASS — alle Tests in `NewBoardView.test.ts` grün.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @bingo/web exec vue-tsc --noEmit`
Expected: Keine Ausgabe, Exit-Code 0.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/views/NewBoardView.vue apps/web/src/views/NewBoardView.test.ts apps/web/src/router/index.ts
git commit -m "$(cat <<'EOF'
feat(web): NewBoardView (/boards/new) mit Größe/Beschriftung/Name

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: `apps/web` – `BoardEditView.vue`-Platzhalter (TDD)

**Files:**
- Create: `apps/web/src/views/BoardEditView.vue`
- Create: `apps/web/src/views/BoardEditView.test.ts`
- Modify: `apps/web/src/router/index.ts`

**Interfaces:**
- Consumes: nichts Neues (eigener `fetch`-Aufruf gegen `/api/boards/:id`, analog zum bestehenden Muster in `stores/auth.ts`/`stores/boards.ts`)
- Produces: Route `/boards/:id/edit` (Platzhalter — voller Editor folgt in einem Folgeplan)

- [ ] **Step 1: `apps/web/src/views/BoardEditView.vue` anlegen**

```vue
<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute } from "vue-router";

interface BoardDetail {
  id: string;
  name: string;
  size: number;
}

const route = useRoute();
const board = ref<BoardDetail | null>(null);
const notFound = ref(false);

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:3001";

onMounted(async () => {
  const response = await fetch(`${API_BASE_URL}/api/boards/${route.params.id}`, {
    credentials: "include",
  });
  if (!response.ok) {
    notFound.value = true;
    return;
  }
  board.value = (await response.json()) as BoardDetail;
});
</script>

<template>
  <main class="flex min-h-screen items-center justify-center bg-slate-900 text-slate-100">
    <div v-if="notFound">Board nicht gefunden.</div>
    <div v-else-if="board">
      <h1 class="text-2xl font-bold">{{ board.name }}</h1>
      <p class="text-slate-400">{{ board.size }}×{{ board.size }} — Editor folgt in einer späteren Phase.</p>
    </div>
    <p v-else>Lade...</p>
  </main>
</template>
```

- [ ] **Step 2: Test schreiben — `apps/web/src/views/BoardEditView.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createWebHistory } from "vue-router";
import BoardEditView from "./BoardEditView.vue";

function createTestRouter() {
  const router = createRouter({
    history: createWebHistory(),
    routes: [{ path: "/boards/:id/edit", name: "board-edit", component: BoardEditView }],
  });
  return router;
}

describe("BoardEditView", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("zeigt Name und Größe des geladenen Boards", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ id: "b1", name: "Mein Board", size: 5 }),
    } as Response);

    const router = createTestRouter();
    router.push("/boards/b1/edit");
    await router.isReady();

    const wrapper = mount(BoardEditView, { global: { plugins: [router] } });
    await flushPromises();

    expect(wrapper.text()).toContain("Mein Board");
    expect(wrapper.text()).toContain("5×5");
  });

  it("zeigt 'nicht gefunden' bei 404", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, json: async () => ({}) } as Response);

    const router = createTestRouter();
    router.push("/boards/missing/edit");
    await router.isReady();

    const wrapper = mount(BoardEditView, { global: { plugins: [router] } });
    await flushPromises();

    expect(wrapper.text()).toContain("nicht gefunden");
  });
});
```

- [ ] **Step 3: `apps/web/src/router/index.ts` erweitern (Route + Import ergänzen)**

```ts
import { createRouter, createWebHistory, type RouteLocationNormalized } from "vue-router";
import HomeView from "../views/HomeView.vue";
import BoardsView from "../views/BoardsView.vue";
import NewBoardView from "../views/NewBoardView.vue";
import BoardEditView from "../views/BoardEditView.vue";
import { useAuthStore } from "../stores/auth";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "home", component: HomeView },
    { path: "/boards", name: "boards", component: BoardsView, meta: { requiresAuth: true } },
    { path: "/boards/new", name: "board-new", component: NewBoardView, meta: { requiresAuth: true } },
    {
      path: "/boards/:id/edit",
      name: "board-edit",
      component: BoardEditView,
      meta: { requiresAuth: true },
    },
  ],
});

export async function requireAuthGuard(to: RouteLocationNormalized) {
  if (!to.meta.requiresAuth) {
    return true;
  }

  const auth = useAuthStore();
  if (!auth.user) {
    await auth.fetchMe();
  }

  return auth.user ? true : { name: "home" };
}

router.beforeEach(requireAuthGuard);
```

- [ ] **Step 4: Alle Tests ausführen**

Run: `pnpm --filter @bingo/web test`
Expected: PASS — alle Testdateien grün (`stores/auth.test.ts`, `stores/boards.test.ts`, `router/index.test.ts`, `views/HomeView.test.ts`, `views/BoardsView.test.ts`, `views/NewBoardView.test.ts`, `views/BoardEditView.test.ts`).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @bingo/web exec vue-tsc --noEmit`
Expected: Keine Ausgabe, Exit-Code 0.

- [ ] **Step 6: Dev-Server manuell prüfen**

Run: `pnpm --filter @bingo/web dev`
Expected: Vite startet auf `http://localhost:5173` ohne Fehler. Danach Server mit Strg+C beenden.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/views/BoardEditView.vue apps/web/src/views/BoardEditView.test.ts apps/web/src/router/index.ts
git commit -m "$(cat <<'EOF'
feat(web): BoardEditView-Platzhalter (/boards/:id/edit)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Nach Abschluss dieses Plans

Automatisiert vollständig verifiziert: zusammengesetzte Board-Validierung, alle vier
API-Endpunkte (Create/List/Get/Delete) inkl. Eigentümer-Isolation (404 statt 403),
Dashboard/Erstellungs-/Editor-Platzhalter-UI.

**Manuell zu verifizieren** (End-to-End im Browser, mit den echten Twitch-Credentials
aus Phase 2): Login → Dashboard zeigt leere Liste → „Neues Board" → Größe/Beschriftung/Name
wählen → Board erstellen → Redirect zum Editor-Platzhalter zeigt Name/Größe → zurück zum
Dashboard zeigt das neue Board → Löschen mit Bestätigung entfernt es wieder.

Nächster Schritt laut SPEC.md Abschnitt 10: **Editor inkl. Beschriftungslogik** (Punkt 4) —
der volle Zellen-Editor auf `/boards/:id/edit`, der `getColumnLabels`/`getRowLabels`
(bereits in `packages/shared` seit der Foundation-Phase) tatsächlich zum Rendern nutzt,
plus `PATCH /api/boards/:id` für Zelltext-/Namens-/Beschriftungs-Änderungen.
