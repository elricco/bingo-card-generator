# Editor inkl. Beschriftungslogik Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Den vollen Zellen-Editor bauen: Raster mit Spalten-/Reihenbeschriftung (SPEC 2.3/7), Inline-Textbearbeitung pro Feld, Name/Beschriftungsmodus änderbar, Speichern via `PATCH /api/boards/:id`, Warnung bei ungespeicherten Änderungen beim Verlassen. Deckt SPEC.md Abschnitt 10, Punkt 4 ab.

**Architecture:** Die Cross-Feld-Validierung von Boardgröße/Beschriftungsmodus/Spaltenlabels (bisher nur in `createBoardSchema`) wird in eine wiederverwendbare `validateLabelConfig`-Funktion in `packages/shared` extrahiert, damit `PATCH /api/boards/:id` dieselbe Regel nutzt wie `POST /api/boards` — ohne Logik-Duplizierung/-Drift. Das PATCH prüft die Kombination aus eingehenden und bereits gespeicherten Werten (Zod allein kennt die bestehende Boardgröße nicht). Die Grid-Positionierung (Ecken leer, Label-Ring außen, SPEC 7) wird als reine, isoliert testbare Utility-Funktion gebaut statt als Template-Index-Arithmetik. Der `BoardsStore` bekommt `fetchBoard`/`updateBoard`, damit `BoardEditView` konsistent über den Store auf die API zugreift (schließt einen in Phase 3 zurückgestellten Punkt).

**Tech Stack:** Zod (geteilte Cross-Feld-Validierung), Drizzle ORM (transaktionales Update), Vue 3 Composition API (`watch`, `computed`, `onBeforeRouteLeave`), Pinia.

**Spec:** `SPEC.md` (Abschnitte 2.3, 2.4, 4, 5, 7, 10 Punkt 4); Vorgänger-Pläne `docs/superpowers/plans/2026-09-24-foundation-monorepo.md`, `docs/superpowers/plans/2026-09-24-auth-twitch-sessions.md`, `docs/superpowers/plans/2026-09-25-board-crud.md` (alle vollständig umgesetzt — `packages/shared` hat bereits `getColumnLabels`/`getRowLabels`/`createBoardSchema`; `apps/api` hat Auth, Sessions, Board-CRUD (Create/List/Get/Delete); `apps/web` hat Dashboard, Neu-Board-Formular, einen Editor-Platzhalter)

## Global Constraints

- Max. 80 Zeichen pro Zelltext, max. 60 Zeichen Board-Name, max. 20 Zeichen pro Spaltenlabel (SPEC 2.3, 2.4).
- Leere Felder sind erlaubt (SPEC 2.4).
- `label_mode` ausschließlich `'letters' | 'bingo' | 'custom'`; `'bingo'` nur bei `size = 5`; `'custom'` erfordert `column_labels` mit exakt `size` Einträgen — diese Regel gilt identisch für `POST` (Anlegen) und `PATCH` (Bearbeiten) und darf nicht doppelt implementiert werden (SPEC 2.3, 11).
- Board-Größe ist nach Anlage fix — `PATCH` ändert niemals `size` (SPEC 2.2, 11).
- Alle `/api/*`-Routen erfordern Login; fremde/nicht existente Boards liefern 404, nicht 403 (SPEC 5).
- Alle Eingaben serverseitig mit Zod validieren, inkl. Zellkoordinaten im gültigen Bereich (SPEC 8).
- Zelltexte nur als Text rendern, kein `v-html` (SPEC 8).
- Die lokale `.env`-Datei enthält echte Secrets — kein Task darf sie verändern, überschreiben oder löschen.
- Alle Datenbank-Tests laufen gegen die echte, laufende Postgres-Instanz (Docker Compose, Port 5433) — kein Mocken der eigenen DB-Logik.
- Kein `"packageManager"`-Feld irgendwo im Repo.
- Jeder Commit endet mit exakt: `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- UI-Sprache Deutsch.
- Sowohl `vitest run` als auch der jeweilige TypeScript-Compiler (`tsc --noEmit` für `apps/api`, `vue-tsc --noEmit` für `apps/web`) müssen für jeden Task sauber durchlaufen.
- Neue/geänderte Frontend-Tests, die einen gemockten `fetch` involvieren, müssen echte Trennschärfe haben (nicht grün bleiben, wenn das getestete Feature kaputt ist) — bei Unsicherheit: Code temporär kaputt machen, Fehlschlag bestätigen, wiederherstellen (etablierte Praxis aus dem vorherigen Plan).

---

## Datei-Übersicht

```
packages/shared/src/boards.ts             # + validateLabelConfig, + patchBoardSchema; createBoardSchema nutzt validateLabelConfig
packages/shared/src/boards.test.ts        # erweitert

apps/api/src/db/boards.ts                 # + updateBoard (transaktional, eigentümergeschützt)
apps/api/src/db/boards.test.ts            # erweitert
apps/api/src/boards/routes.ts             # + PATCH /api/boards/:id
apps/api/src/boards/routes.test.ts        # erweitert

apps/web/src/utils/grid.ts                # neu: buildGridCells (reine Layout-Funktion)
apps/web/src/utils/grid.test.ts           # neu
apps/web/src/stores/boards.ts             # + fetchBoard, + updateBoard, + BoardDetail/CellData/PatchBoardInput-Typen
apps/web/src/stores/boards.test.ts        # erweitert
apps/web/src/views/BoardEditView.vue      # umgebaut: voller Editor (Raster, Inline-Edit, Speichern, Verlassen-Warnung)
apps/web/src/views/BoardEditView.test.ts  # umgebaut
```

---

### Task 1: `packages/shared` – `validateLabelConfig` extrahieren + `patchBoardSchema` (TDD)

**Files:**
- Modify: `packages/shared/src/boards.ts`
- Modify: `packages/shared/src/boards.test.ts`

**Interfaces:**
- Consumes: `boardSizeSchema`, `labelModeSchema`, `boardNameSchema`, `cellTextSchema`, `columnLabelSchema` aus `./schemas`, `BoardSize`/`LabelMode` aus `./constants` (alle bereits vorhanden)
- Produces: `validateLabelConfig(size, labelMode, columnLabels?): {path: "label_mode"|"column_labels"; message: string} | null` — genutzt von Task 3 (`apps/api/src/boards/routes.ts`, PATCH-Route); `patchBoardSchema`/`PatchBoardInput` — genutzt von Task 2/3 (`apps/api`) und Task 5 (`apps/web`); `createBoardSchema` bleibt nach außen unverändert (gleiche Fehler/Pfade), nutzt intern jetzt `validateLabelConfig`

- [ ] **Step 1: Fehlschlagenden Test schreiben — `packages/shared/src/boards.test.ts` komplett ersetzen**

```ts
import { describe, it, expect } from "vitest";
import { createBoardSchema, patchBoardSchema, validateLabelConfig } from "./boards";

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

  it("lehnt column_labels bei nicht-custom-Modus ab", () => {
    const result = createBoardSchema.safeParse({
      name: "Mein Board",
      size: 3,
      label_mode: "letters",
      column_labels: ["a", "b", "c"],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["column_labels"]);
    }
  });
});

describe("validateLabelConfig", () => {
  it("liefert null für letters ohne column_labels", () => {
    expect(validateLabelConfig(3, "letters")).toBeNull();
  });

  it("liefert null für bingo bei size=5", () => {
    expect(validateLabelConfig(5, "bingo")).toBeNull();
  });

  it("liefert einen label_mode-Fehler für bingo bei size!=5", () => {
    const error = validateLabelConfig(3, "bingo");
    expect(error?.path).toBe("label_mode");
  });

  it("liefert null für custom mit passender Anzahl column_labels", () => {
    expect(validateLabelConfig(3, "custom", ["a", "b", "c"])).toBeNull();
  });

  it("liefert einen column_labels-Fehler für custom mit falscher Anzahl", () => {
    const error = validateLabelConfig(3, "custom", ["a"]);
    expect(error?.path).toBe("column_labels");
  });

  it("liefert einen column_labels-Fehler, wenn column_labels bei nicht-custom gesetzt ist", () => {
    const error = validateLabelConfig(3, "letters", ["a", "b", "c"]);
    expect(error?.path).toBe("column_labels");
  });
});

describe("patchBoardSchema", () => {
  it("akzeptiert ein leeres Objekt (keine Änderungen)", () => {
    expect(patchBoardSchema.safeParse({}).success).toBe(true);
  });

  it("akzeptiert nur name", () => {
    expect(patchBoardSchema.safeParse({ name: "Neuer Name" }).success).toBe(true);
  });

  it("akzeptiert cells mit gültigen Koordinaten und Text", () => {
    const result = patchBoardSchema.safeParse({
      cells: [{ row: 0, col: 0, text: "Hallo" }],
    });
    expect(result.success).toBe(true);
  });

  it("lehnt negative Zellkoordinaten ab", () => {
    const result = patchBoardSchema.safeParse({
      cells: [{ row: -1, col: 0, text: "Hallo" }],
    });
    expect(result.success).toBe(false);
  });

  it("lehnt zu langen Zelltext ab", () => {
    const result = patchBoardSchema.safeParse({
      cells: [{ row: 0, col: 0, text: "a".repeat(81) }],
    });
    expect(result.success).toBe(false);
  });

  it("akzeptiert leeren Zelltext", () => {
    const result = patchBoardSchema.safeParse({
      cells: [{ row: 0, col: 0, text: "" }],
    });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag verifizieren**

Run: `pnpm --filter @bingo/shared test`
Expected: FAIL — `validateLabelConfig` und `patchBoardSchema` existieren nicht.

- [ ] **Step 3: Minimale Implementierung — `packages/shared/src/boards.ts` komplett ersetzen**

```ts
import { z } from "zod";
import {
  boardSizeSchema,
  labelModeSchema,
  boardNameSchema,
  cellTextSchema,
  columnLabelSchema,
} from "./schemas";
import type { BoardSize, LabelMode } from "./constants";

export interface LabelConfigError {
  path: "label_mode" | "column_labels";
  message: string;
}

export function validateLabelConfig(
  size: BoardSize,
  labelMode: LabelMode,
  columnLabels?: string[]
): LabelConfigError | null {
  if (labelMode === "bingo" && size !== 5) {
    return { path: "label_mode", message: 'label_mode "bingo" ist nur bei size=5 erlaubt' };
  }
  if (labelMode === "custom") {
    if (!columnLabels || columnLabels.length !== size) {
      return {
        path: "column_labels",
        message: `column_labels muss genau ${size} Einträge enthalten`,
      };
    }
  } else if (columnLabels !== undefined) {
    return {
      path: "column_labels",
      message: 'column_labels ist nur bei label_mode="custom" erlaubt',
    };
  }
  return null;
}

export const createBoardSchema = z
  .object({
    name: boardNameSchema,
    size: boardSizeSchema,
    label_mode: labelModeSchema,
    column_labels: z.array(columnLabelSchema).optional(),
  })
  .superRefine((data, ctx) => {
    const error = validateLabelConfig(data.size, data.label_mode, data.column_labels);
    if (error) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: error.message, path: [error.path] });
    }
  });

export type CreateBoardInput = z.infer<typeof createBoardSchema>;

export const patchBoardSchema = z.object({
  name: boardNameSchema.optional(),
  label_mode: labelModeSchema.optional(),
  column_labels: z.array(columnLabelSchema).optional(),
  cells: z
    .array(
      z.object({
        row: z.number().int().min(0),
        col: z.number().int().min(0),
        text: cellTextSchema,
      })
    )
    .optional(),
});

export type PatchBoardInput = z.infer<typeof patchBoardSchema>;
```

- [ ] **Step 4: Test ausführen, Erfolg verifizieren**

Run: `pnpm --filter @bingo/shared test`
Expected: PASS — alle 21 Tests in `boards.test.ts` grün (9 `createBoardSchema` + 6 `validateLabelConfig` + 6 `patchBoardSchema`), plus alle bisherigen Tests im Paket weiterhin grün.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/boards.ts packages/shared/src/boards.test.ts
git commit -m "$(cat <<'EOF'
refactor(shared): validateLabelConfig extrahieren, patchBoardSchema ergänzen

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `apps/api` – `updateBoard`-DB-Helfer (TDD, echte DB)

**Files:**
- Modify: `apps/api/src/db/boards.ts`
- Modify: `apps/api/src/db/boards.test.ts`

**Interfaces:**
- Consumes: `PatchBoardInput` aus `@bingo/shared` (Task 1)
- Produces: `updateBoard(userId, boardId, input): Promise<(BoardRow & {cells: CellRow[]}) | null>` — eigentümergeschützt (liefert `null` für fremde/nicht existierende Boards, ohne etwas zu ändern) — genutzt von Task 3 (`apps/api/src/boards/routes.ts`)

Voraussetzung: Docker-Compose-Postgres läuft, `.env` ist vorhanden.

- [ ] **Step 1: Fehlschlagende Tests ergänzen — `apps/api/src/db/boards.test.ts` (am Ende der Datei, `updateBoard` zu den Imports ergänzen)**

Import-Zeile erweitern:
```ts
import {
  createBoardWithCells,
  listBoardsForUser,
  getBoardById,
  deleteBoard,
  updateBoard,
} from "./boards";
```

Am Ende der Datei ergänzen:
```ts
describe("updateBoard", () => {
  const createdUserIds: string[] = [];

  afterEach(async () => {
    for (const userId of createdUserIds.splice(0)) {
      await db.delete(users).where(eq(users.id, userId));
    }
  });

  it("aktualisiert nur den Namen, andere Felder bleiben unverändert", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const board = await createBoardWithCells(user.id, {
      name: "Alt",
      size: 3,
      label_mode: "letters",
    });

    const result = await updateBoard(user.id, board.id, { name: "Neu" });

    expect(result?.name).toBe("Neu");
    expect(result?.labelMode).toBe("letters");
  });

  it("aktualisiert label_mode und column_labels gemeinsam", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const board = await createBoardWithCells(user.id, {
      name: "Board",
      size: 3,
      label_mode: "letters",
    });

    const result = await updateBoard(user.id, board.id, {
      label_mode: "custom",
      column_labels: ["WIN", "GG", "GLHF"],
    });

    expect(result?.labelMode).toBe("custom");
    expect(result?.columnLabels).toEqual(["WIN", "GG", "GLHF"]);
  });

  it("aktualisiert den Text einer einzelnen Zelle, andere bleiben unverändert", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const board = await createBoardWithCells(user.id, {
      name: "Board",
      size: 3,
      label_mode: "letters",
    });

    const result = await updateBoard(user.id, board.id, {
      cells: [{ row: 1, col: 1, text: "Mittelfeld" }],
    });

    const updatedCell = result?.cells.find((c) => c.row === 1 && c.col === 1);
    const otherCell = result?.cells.find((c) => c.row === 0 && c.col === 0);
    expect(updatedCell?.text).toBe("Mittelfeld");
    expect(otherCell?.text).toBe("");
  });

  it("aktualisiert mehrere Zellen in einem Aufruf", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const board = await createBoardWithCells(user.id, {
      name: "Board",
      size: 3,
      label_mode: "letters",
    });

    const result = await updateBoard(user.id, board.id, {
      cells: [
        { row: 0, col: 0, text: "A" },
        { row: 2, col: 2, text: "B" },
      ],
    });

    expect(result?.cells.find((c) => c.row === 0 && c.col === 0)?.text).toBe("A");
    expect(result?.cells.find((c) => c.row === 2 && c.col === 2)?.text).toBe("B");
  });

  it("bumpt updatedAt", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const board = await createBoardWithCells(user.id, {
      name: "Board",
      size: 3,
      label_mode: "letters",
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    const result = await updateBoard(user.id, board.id, { name: "Neu" });

    expect(new Date(result!.updatedAt).getTime()).toBeGreaterThan(
      new Date(board.updatedAt).getTime()
    );
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

    const result = await updateBoard(other.id, board.id, { name: "Gehackt" });

    expect(result).toBeNull();
    const stillOwned = await getBoardById(owner.id, board.id);
    expect(stillOwned?.name).toBe("Board");
  });
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag verifizieren**

Run: `pnpm --filter @bingo/api test`
Expected: FAIL — `updateBoard` existiert nicht.

- [ ] **Step 3: Minimale Implementierung — `apps/api/src/db/boards.ts` erweitern**

Import-Zeile erweitern:
```ts
import type { CreateBoardInput, PatchBoardInput } from "@bingo/shared";
```

Am Ende der Datei ergänzen:
```ts
export async function updateBoard(userId: string, boardId: string, input: PatchBoardInput) {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: boards.id })
      .from(boards)
      .where(and(eq(boards.id, boardId), eq(boards.userId, userId)));

    if (!existing) {
      return null;
    }

    const boardUpdates: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) {
      boardUpdates.name = input.name;
    }
    if (input.label_mode !== undefined) {
      boardUpdates.labelMode = input.label_mode;
    }
    if (input.column_labels !== undefined) {
      boardUpdates.columnLabels = input.column_labels;
    }

    await tx
      .update(boards)
      .set(boardUpdates)
      .where(and(eq(boards.id, boardId), eq(boards.userId, userId)));

    if (input.cells) {
      for (const cell of input.cells) {
        await tx
          .update(boardCells)
          .set({ text: cell.text })
          .where(
            and(
              eq(boardCells.boardId, boardId),
              eq(boardCells.row, cell.row),
              eq(boardCells.col, cell.col)
            )
          );
      }
    }

    const [board] = await tx
      .select()
      .from(boards)
      .where(and(eq(boards.id, boardId), eq(boards.userId, userId)));
    const cells = await tx.select().from(boardCells).where(eq(boardCells.boardId, boardId));

    return { ...board, cells };
  });
}
```

- [ ] **Step 4: Test ausführen, Erfolg verifizieren**

Run: `pnpm --filter @bingo/api test`
Expected: PASS — alle 6 neuen Tests grün.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @bingo/api exec tsc --noEmit`
Expected: Keine Ausgabe, Exit-Code 0.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/db/boards.ts apps/api/src/db/boards.test.ts
git commit -m "$(cat <<'EOF'
feat(api): updateBoard-DB-Helfer (Name/Beschriftung/Zellen, transaktional)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `apps/api` – `PATCH /api/boards/:id` (TDD, echte DB, 404-statt-403)

**Files:**
- Modify: `apps/api/src/boards/routes.ts`
- Modify: `apps/api/src/boards/routes.test.ts`

**Interfaces:**
- Consumes: `patchBoardSchema`/`validateLabelConfig` aus `@bingo/shared` (Task 1), `updateBoard` aus `../db/boards` (Task 2)
- Produces: `PATCH /api/boards/:id` — eigentümergeschützt (404 statt 403), validiert Zellkoordinaten gegen die tatsächliche Boardgröße, validiert Beschriftungs-Kombination gegen den bestehenden Board-Zustand

- [ ] **Step 1: Fehlschlagende Tests ergänzen — `apps/api/src/boards/routes.test.ts` (am Ende der Datei ergänzen, keine neuen Imports nötig — `buildServer`, `db`, `users`, `eq`, `createFakeProvider`, `loginViaFakeProvider`, `randomUUID` sind bereits importiert)**

```ts
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
```

- [ ] **Step 2: Test ausführen, Fehlschlag verifizieren**

Run: `pnpm --filter @bingo/api test`
Expected: FAIL — die `PATCH`-Route existiert nicht (Fastifys eigener 404-Handler antwortet, was einige der obigen Assertions nicht erfüllt).

- [ ] **Step 3: Implementierung — `apps/api/src/boards/routes.ts` komplett ersetzen**

```ts
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createBoardSchema, patchBoardSchema, validateLabelConfig } from "@bingo/shared";
import { requireAuth } from "../auth/require-auth";
import {
  createBoardWithCells,
  listBoardsForUser,
  getBoardById,
  deleteBoard,
  updateBoard,
} from "../db/boards";

const boardIdParamSchema = z.object({ id: z.string().uuid() });

export async function registerBoardRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/boards", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) {
      return;
    }

    const parseResult = createBoardSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply
        .status(400)
        .send({ error: "Ungültige Eingabe", details: parseResult.error.flatten() });
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

  app.patch<{ Params: { id: string } }>("/api/boards/:id", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) {
      return;
    }

    const paramsResult = boardIdParamSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(404).send({ error: "Board nicht gefunden" });
    }

    const bodyResult = patchBoardSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply
        .status(400)
        .send({ error: "Ungültige Eingabe", details: bodyResult.error.flatten() });
    }

    const existingBoard = await getBoardById(user.id, paramsResult.data.id);
    if (!existingBoard) {
      return reply.status(404).send({ error: "Board nicht gefunden" });
    }

    const effectiveLabelMode = bodyResult.data.label_mode ?? existingBoard.labelMode;
    const effectiveColumnLabels =
      bodyResult.data.column_labels ?? existingBoard.columnLabels ?? undefined;
    const labelError = validateLabelConfig(
      existingBoard.size,
      effectiveLabelMode,
      effectiveColumnLabels
    );
    if (labelError) {
      return reply.status(400).send({
        error: "Ungültige Eingabe",
        details: { formErrors: [], fieldErrors: { [labelError.path]: [labelError.message] } },
      });
    }

    if (bodyResult.data.cells) {
      const outOfBounds = bodyResult.data.cells.some(
        (cell) => cell.row >= existingBoard.size || cell.col >= existingBoard.size
      );
      if (outOfBounds) {
        return reply.status(400).send({
          error: "Ungültige Eingabe",
          details: { formErrors: ["Zellkoordinaten außerhalb des Boards"], fieldErrors: {} },
        });
      }
    }

    const updated = await updateBoard(user.id, paramsResult.data.id, bodyResult.data);
    if (!updated) {
      return reply.status(404).send({ error: "Board nicht gefunden" });
    }
    return updated;
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
feat(api): PATCH /api/boards/:id, eigentümergeschützt (404 statt 403)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `apps/web` – `buildGridCells`-Utility (TDD, reine Funktion)

**Files:**
- Create: `apps/web/src/utils/grid.test.ts`
- Create: `apps/web/src/utils/grid.ts`

**Interfaces:**
- Consumes: nichts (reine Funktion)
- Produces: `GridCell` (Typ), `buildGridCells(size, columnLabels, rowLabels): GridCell[]` — genutzt von Task 6 (`BoardEditView.vue`)

- [ ] **Step 1: Fehlschlagenden Test schreiben — `apps/web/src/utils/grid.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { buildGridCells } from "./grid";

describe("buildGridCells", () => {
  it("liefert (size+2)^2 Einträge", () => {
    const result = buildGridCells(3, ["A", "B", "C"], ["1", "2", "3"]);
    expect(result).toHaveLength(25);
  });

  it("hat leere Ecken", () => {
    const result = buildGridCells(3, ["A", "B", "C"], ["1", "2", "3"]);
    expect(result[0]).toEqual({ kind: "empty" });
    expect(result[4]).toEqual({ kind: "empty" });
    expect(result[20]).toEqual({ kind: "empty" });
    expect(result[24]).toEqual({ kind: "empty" });
  });

  it("zeigt Spaltenlabels in der obersten und untersten Reihe", () => {
    const result = buildGridCells(3, ["A", "B", "C"], ["1", "2", "3"]);
    expect(result.slice(1, 4)).toEqual([
      { kind: "label", text: "A" },
      { kind: "label", text: "B" },
      { kind: "label", text: "C" },
    ]);
    expect(result.slice(21, 24)).toEqual([
      { kind: "label", text: "A" },
      { kind: "label", text: "B" },
      { kind: "label", text: "C" },
    ]);
  });

  it("zeigt Reihenlabels links und rechts", () => {
    const result = buildGridCells(3, ["A", "B", "C"], ["1", "2", "3"]);
    expect(result[5]).toEqual({ kind: "label", text: "1" });
    expect(result[9]).toEqual({ kind: "label", text: "1" });
  });

  it("liefert size×size editierbare Zellen mit korrekten 0-basierten Koordinaten", () => {
    const result = buildGridCells(3, ["A", "B", "C"], ["1", "2", "3"]);
    const editableCells = result.filter((c) => c.kind === "cell");
    expect(editableCells).toHaveLength(9);
    expect(editableCells[0]).toEqual({ kind: "cell", row: 0, col: 0 });
    expect(editableCells[8]).toEqual({ kind: "cell", row: 2, col: 2 });
  });
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag verifizieren**

Run: `pnpm --filter @bingo/web test`
Expected: FAIL — `grid.ts` existiert nicht.

- [ ] **Step 3: Minimale Implementierung — `apps/web/src/utils/grid.ts`**

```ts
export type GridCell =
  | { kind: "empty" }
  | { kind: "label"; text: string }
  | { kind: "cell"; row: number; col: number };

export function buildGridCells(
  size: number,
  columnLabels: string[],
  rowLabels: string[]
): GridCell[] {
  const cells: GridCell[] = [];
  const totalCols = size + 2;
  const totalRows = size + 2;

  for (let gridRow = 0; gridRow < totalRows; gridRow++) {
    for (let gridCol = 0; gridCol < totalCols; gridCol++) {
      const isTopOrBottomRow = gridRow === 0 || gridRow === totalRows - 1;
      const isLeftOrRightCol = gridCol === 0 || gridCol === totalCols - 1;

      if (isTopOrBottomRow && isLeftOrRightCol) {
        cells.push({ kind: "empty" });
      } else if (isTopOrBottomRow) {
        cells.push({ kind: "label", text: columnLabels[gridCol - 1] ?? "" });
      } else if (isLeftOrRightCol) {
        cells.push({ kind: "label", text: rowLabels[gridRow - 1] ?? "" });
      } else {
        cells.push({ kind: "cell", row: gridRow - 1, col: gridCol - 1 });
      }
    }
  }

  return cells;
}
```

- [ ] **Step 4: Test ausführen, Erfolg verifizieren**

Run: `pnpm --filter @bingo/web test`
Expected: PASS — alle 5 Tests grün.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @bingo/web exec vue-tsc --noEmit`
Expected: Keine Ausgabe, Exit-Code 0.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/utils/grid.ts apps/web/src/utils/grid.test.ts
git commit -m "$(cat <<'EOF'
feat(web): buildGridCells – reine Layout-Funktion für das Bingo-Raster

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `apps/web` – `BoardsStore`: `fetchBoard`/`updateBoard` (TDD)

**Files:**
- Modify: `apps/web/src/stores/boards.ts`
- Modify: `apps/web/src/stores/boards.test.ts`

**Interfaces:**
- Consumes: nichts Neues
- Produces: `CellData`, `BoardDetail`, `PatchBoardInput` (Typen); `fetchBoard(id): Promise<BoardDetail | null>`, `updateBoard(id, input): Promise<BoardDetail>` — genutzt von Task 6/7 (`BoardEditView.vue`)

- [ ] **Step 1: Fehlschlagende Tests ergänzen — `apps/web/src/stores/boards.test.ts` (am Ende der Datei ergänzen)**

```ts
describe("fetchBoard", () => {
  it("liefert das Board bei erfolgreicher Antwort", async () => {
    const detail = {
      id: "b1",
      name: "Board",
      size: 3,
      labelMode: "letters",
      columnLabels: null,
      overlayToken: "token",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
      cells: [],
    };
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => detail } as Response);

    const store = useBoardsStore();
    const result = await store.fetchBoard("b1");

    expect(result).toEqual(detail);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/boards/b1"),
      expect.objectContaining({ credentials: "include" })
    );
  });

  it("liefert null bei Fehlerantwort", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, json: async () => ({}) } as Response);

    const store = useBoardsStore();
    const result = await store.fetchBoard("b1");

    expect(result).toBeNull();
  });
});

describe("updateBoard", () => {
  it("sendet PATCH mit korrektem Body und liefert das aktualisierte Board", async () => {
    const updated = {
      id: "b1",
      name: "Neuer Name",
      size: 3,
      labelMode: "letters",
      columnLabels: null,
      overlayToken: "token",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
      cells: [],
    };
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => updated } as Response);

    const store = useBoardsStore();
    const result = await store.updateBoard("b1", { name: "Neuer Name" });

    expect(result).toEqual(updated);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/boards/b1"),
      expect.objectContaining({
        method: "PATCH",
        credentials: "include",
        body: JSON.stringify({ name: "Neuer Name" }),
      })
    );
  });

  it("wirft bei Fehlerantwort mit der Server-Fehlermeldung", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Ungültige Eingabe" }),
    } as Response);

    const store = useBoardsStore();
    await expect(store.updateBoard("b1", { name: "x" })).rejects.toThrow("Ungültige Eingabe");
  });
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag verifizieren**

Run: `pnpm --filter @bingo/web test`
Expected: FAIL — `fetchBoard`/`updateBoard` existieren nicht.

- [ ] **Step 3: Minimale Implementierung — `apps/web/src/stores/boards.ts` komplett ersetzen**

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

export interface CellData {
  row: number;
  col: number;
  text: string;
  checked: boolean;
}

export interface BoardDetail {
  id: string;
  name: string;
  size: number;
  labelMode: string;
  columnLabels: string[] | null;
  overlayToken: string;
  createdAt: string;
  updatedAt: string;
  cells: CellData[];
}

export interface PatchBoardInput {
  name?: string;
  label_mode?: string;
  column_labels?: string[];
  cells?: Array<{ row: number; col: number; text: string }>;
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
      const response = await fetch(`${API_BASE_URL}/api/boards/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok && response.status !== 404) {
        throw new Error("Board konnte nicht gelöscht werden");
      }
      this.boards = this.boards.filter((board) => board.id !== id);
    },
    async fetchBoard(id: string): Promise<BoardDetail | null> {
      const response = await fetch(`${API_BASE_URL}/api/boards/${id}`, {
        credentials: "include",
      });
      if (!response.ok) {
        return null;
      }
      return (await response.json()) as BoardDetail;
    },
    async updateBoard(id: string, input: PatchBoardInput): Promise<BoardDetail> {
      const response = await fetch(`${API_BASE_URL}/api/boards/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(
          typeof body?.error === "string" ? body.error : "Board konnte nicht gespeichert werden"
        );
      }
      return (await response.json()) as BoardDetail;
    },
  },
});
```

- [ ] **Step 4: Test ausführen, Erfolg verifizieren**

Run: `pnpm --filter @bingo/web test`
Expected: PASS — alle 4 neuen Tests grün, bisherige Tests in `boards.test.ts` weiterhin grün.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @bingo/web exec vue-tsc --noEmit`
Expected: Keine Ausgabe, Exit-Code 0.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/stores/boards.ts apps/web/src/stores/boards.test.ts
git commit -m "$(cat <<'EOF'
feat(web): BoardsStore.fetchBoard/updateBoard

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `apps/web` – `BoardEditView.vue`: Raster-/Label-Anzeige (TDD)

**Files:**
- Modify: `apps/web/src/views/BoardEditView.vue`
- Modify: `apps/web/src/views/BoardEditView.test.ts`

**Interfaces:**
- Consumes: `getColumnLabels`/`getRowLabels`/`LabelMode` aus `@bingo/shared` (bereits vorhanden), `useBoardsStore`/`BoardDetail` aus `../stores/boards` (Task 5), `buildGridCells` aus `../utils/grid` (Task 4)
- Produces: Vollständige Raster-Anzeige mit Beschriftungs-Ring; Name/Beschriftungsmodus als Formularfelder (noch ohne Speichern-Funktion — folgt in Task 7)

- [ ] **Step 1: `apps/web/src/views/BoardEditView.vue` komplett ersetzen**

```vue
<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { getColumnLabels, getRowLabels, type LabelMode } from "@bingo/shared";
import { useBoardsStore, type BoardDetail } from "../stores/boards";
import { buildGridCells } from "../utils/grid";

const route = useRoute();
const boardsStore = useBoardsStore();

const board = ref<BoardDetail | null>(null);
const notFound = ref(false);
const name = ref("");
const labelMode = ref<LabelMode>("letters");
const columnLabels = ref<string[]>([]);

const canUseBingo = computed(() => board.value?.size === 5);

watch(labelMode, (mode) => {
  if (mode === "custom" && board.value && columnLabels.value.length !== board.value.size) {
    columnLabels.value = Array.from(
      { length: board.value.size },
      (_, i) => columnLabels.value[i] ?? ""
    );
  }
});

const columnLabelsForGrid = computed(() => {
  if (!board.value) {
    return [];
  }
  try {
    return getColumnLabels(
      board.value.size,
      labelMode.value,
      labelMode.value === "custom" ? columnLabels.value : undefined
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

function cellText(row: number, col: number): string {
  return board.value?.cells.find((c) => c.row === row && c.col === col)?.text ?? "";
}

onMounted(async () => {
  const id = route.params.id as string;
  const result = await boardsStore.fetchBoard(id);
  if (!result) {
    notFound.value = true;
    return;
  }
  board.value = result;
  name.value = result.name;
  labelMode.value = result.labelMode as LabelMode;
  columnLabels.value = result.columnLabels ?? [];
});
</script>

<template>
  <main class="min-h-screen bg-slate-900 p-6 text-slate-100">
    <div v-if="notFound">Board nicht gefunden.</div>
    <div v-else-if="board" class="mx-auto max-w-3xl">
      <div class="mb-4 flex flex-col gap-4">
        <label class="flex flex-col gap-1">
          Name
          <input v-model="name" type="text" maxlength="60" class="rounded bg-slate-800 p-2" />
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
          <label v-for="i in board.size" :key="i" class="flex flex-col gap-1">
            Spalte {{ i }}
            <input
              v-model="columnLabels[i - 1]"
              type="text"
              maxlength="20"
              class="rounded bg-slate-800 p-2"
            />
          </label>
        </div>
      </div>

      <div
        class="grid gap-1"
        :style="{ gridTemplateColumns: `repeat(${board.size + 2}, minmax(2.5rem, 1fr))` }"
      >
        <template v-for="(gridCell, index) in gridCells" :key="index">
          <div v-if="gridCell.kind === 'empty'" />
          <div
            v-else-if="gridCell.kind === 'label'"
            class="flex items-center justify-center font-semibold"
          >
            {{ gridCell.text }}
          </div>
          <div
            v-else
            class="flex min-h-16 items-center justify-center rounded bg-slate-800 p-1 text-center text-sm"
          >
            {{ cellText(gridCell.row, gridCell.col) }}
          </div>
        </template>
      </div>
    </div>
    <p v-else>Lade...</p>
  </main>
</template>
```

- [ ] **Step 2: `apps/web/src/views/BoardEditView.test.ts` komplett ersetzen**

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createWebHistory } from "vue-router";
import BoardEditView from "./BoardEditView.vue";

function createTestRouter() {
  return createRouter({
    history: createWebHistory(),
    routes: [{ path: "/boards/:id/edit", name: "board-edit", component: BoardEditView }],
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
    { row: 1, col: 1, text: "", checked: false },
  ],
};

describe("BoardEditView", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("zeigt Name, Spaltenlabels (A/B/C) und Zelltext", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => sampleBoard } as Response);

    const router = createTestRouter();
    router.push("/boards/b1/edit");
    await router.isReady();

    const wrapper = mount(BoardEditView, { global: { plugins: [router] } });
    await flushPromises();

    expect((wrapper.find("input[type=text]").element as HTMLInputElement).value).toBe(
      "Mein Board"
    );
    expect(wrapper.text()).toContain("A");
    expect(wrapper.text()).toContain("C");
    expect(wrapper.text()).toContain("Erste Zelle");
  });

  it("zeigt die BINGO-Option nur bei size=5 aktiviert", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ ...sampleBoard, size: 3 }),
    } as Response);

    const router = createTestRouter();
    router.push("/boards/b1/edit");
    await router.isReady();

    const wrapper = mount(BoardEditView, { global: { plugins: [router] } });
    await flushPromises();

    const bingoOption = wrapper.find("option[value=bingo]");
    expect((bingoOption.element as HTMLOptionElement).disabled).toBe(true);
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

- [ ] **Step 3: Test ausführen, Erfolg verifizieren**

Run: `pnpm --filter @bingo/web test`
Expected: PASS — alle 3 Tests in `BoardEditView.test.ts` grün.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @bingo/web exec vue-tsc --noEmit`
Expected: Keine Ausgabe, Exit-Code 0.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/views/BoardEditView.vue apps/web/src/views/BoardEditView.test.ts
git commit -m "$(cat <<'EOF'
feat(web): BoardEditView zeigt vollständiges Raster mit Beschriftungen

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `apps/web` – Inline-Zellbearbeitung + Speichern (TDD)

**Files:**
- Modify: `apps/web/src/views/BoardEditView.vue`
- Modify: `apps/web/src/views/BoardEditView.test.ts`

**Interfaces:**
- Consumes: nichts Neues
- Produces: Klick-auf-Zelle → Textarea (Enter = Zeilenumbruch, Standard-Textarea-Verhalten; Esc/Blur = übernehmen); „Speichern"-Button sendet nur geänderte Felder/Zellen via `PATCH`

- [ ] **Step 1: `apps/web/src/views/BoardEditView.vue` komplett ersetzen**

```vue
<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { getColumnLabels, getRowLabels, type LabelMode } from "@bingo/shared";
import { useBoardsStore, type BoardDetail, type PatchBoardInput } from "../stores/boards";
import { buildGridCells } from "../utils/grid";

const route = useRoute();
const boardsStore = useBoardsStore();

const board = ref<BoardDetail | null>(null);
const notFound = ref(false);
const name = ref("");
const labelMode = ref<LabelMode>("letters");
const columnLabels = ref<string[]>([]);
const cellTexts = reactive<Record<string, string>>({});
const editingCell = ref<{ row: number; col: number } | null>(null);
const isSaving = ref(false);
const saveError = ref<string | null>(null);

const canUseBingo = computed(() => board.value?.size === 5);

watch(labelMode, (mode) => {
  if (mode === "custom" && board.value && columnLabels.value.length !== board.value.size) {
    columnLabels.value = Array.from(
      { length: board.value.size },
      (_, i) => columnLabels.value[i] ?? ""
    );
  }
});

const columnLabelsForGrid = computed(() => {
  if (!board.value) {
    return [];
  }
  try {
    return getColumnLabels(
      board.value.size,
      labelMode.value,
      labelMode.value === "custom" ? columnLabels.value : undefined
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

function cellKey(row: number, col: number): string {
  return `${row}-${col}`;
}

function isEditing(row: number, col: number): boolean {
  return editingCell.value?.row === row && editingCell.value?.col === col;
}

async function startEditing(row: number, col: number) {
  editingCell.value = { row, col };
  await nextTick();
  document.querySelector<HTMLTextAreaElement>(`textarea[data-cell="${cellKey(row, col)}"]`)?.focus();
}

function stopEditing() {
  editingCell.value = null;
}

const isDirty = computed(() => {
  if (!board.value) {
    return false;
  }
  if (name.value !== board.value.name) {
    return true;
  }
  if (labelMode.value !== board.value.labelMode) {
    return true;
  }
  if (
    labelMode.value === "custom" &&
    JSON.stringify(columnLabels.value) !== JSON.stringify(board.value.columnLabels ?? [])
  ) {
    return true;
  }
  return board.value.cells.some(
    (cell) => (cellTexts[cellKey(cell.row, cell.col)] ?? "") !== cell.text
  );
});

function applyBoard(result: BoardDetail) {
  board.value = result;
  name.value = result.name;
  labelMode.value = result.labelMode as LabelMode;
  columnLabels.value = result.columnLabels ?? [];
  for (const cell of result.cells) {
    cellTexts[cellKey(cell.row, cell.col)] = cell.text;
  }
}

async function handleSave() {
  if (!board.value) {
    return;
  }
  isSaving.value = true;
  saveError.value = null;
  try {
    const changedCells = board.value.cells
      .filter((cell) => (cellTexts[cellKey(cell.row, cell.col)] ?? "") !== cell.text)
      .map((cell) => ({
        row: cell.row,
        col: cell.col,
        text: cellTexts[cellKey(cell.row, cell.col)] ?? "",
      }));

    const payload: PatchBoardInput = {};
    if (name.value !== board.value.name) {
      payload.name = name.value;
    }
    if (labelMode.value !== board.value.labelMode) {
      payload.label_mode = labelMode.value;
    }
    if (labelMode.value === "custom") {
      payload.column_labels = columnLabels.value;
    }
    if (changedCells.length > 0) {
      payload.cells = changedCells;
    }

    const updated = await boardsStore.updateBoard(board.value.id, payload);
    applyBoard(updated);
  } catch (err) {
    saveError.value = err instanceof Error ? err.message : "Speichern fehlgeschlagen";
  } finally {
    isSaving.value = false;
  }
}

onMounted(async () => {
  const id = route.params.id as string;
  const result = await boardsStore.fetchBoard(id);
  if (!result) {
    notFound.value = true;
    return;
  }
  applyBoard(result);
});
</script>

<template>
  <main class="min-h-screen bg-slate-900 p-6 text-slate-100">
    <div v-if="notFound">Board nicht gefunden.</div>
    <div v-else-if="board" class="mx-auto max-w-3xl">
      <div class="mb-4 flex flex-col gap-4">
        <label class="flex flex-col gap-1">
          Name
          <input v-model="name" type="text" maxlength="60" class="rounded bg-slate-800 p-2" />
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
          <label v-for="i in board.size" :key="i" class="flex flex-col gap-1">
            Spalte {{ i }}
            <input
              v-model="columnLabels[i - 1]"
              type="text"
              maxlength="20"
              class="rounded bg-slate-800 p-2"
            />
          </label>
        </div>
      </div>

      <div
        class="mb-4 grid gap-1"
        :style="{ gridTemplateColumns: `repeat(${board.size + 2}, minmax(2.5rem, 1fr))` }"
      >
        <template v-for="(gridCell, index) in gridCells" :key="index">
          <div v-if="gridCell.kind === 'empty'" />
          <div
            v-else-if="gridCell.kind === 'label'"
            class="flex items-center justify-center font-semibold"
          >
            {{ gridCell.text }}
          </div>
          <div
            v-else
            class="min-h-16 rounded bg-slate-800 p-1 text-center text-sm"
            @click="!isEditing(gridCell.row, gridCell.col) && startEditing(gridCell.row, gridCell.col)"
          >
            <textarea
              v-if="isEditing(gridCell.row, gridCell.col)"
              v-model="cellTexts[cellKey(gridCell.row, gridCell.col)]"
              :data-cell="cellKey(gridCell.row, gridCell.col)"
              maxlength="80"
              class="h-full w-full resize-none bg-slate-700 p-1 text-center text-sm"
              @blur="stopEditing"
              @keydown.esc="stopEditing"
            />
            <span v-else>{{ cellTexts[cellKey(gridCell.row, gridCell.col)] }}</span>
          </div>
        </template>
      </div>

      <p v-if="saveError" class="mb-2 text-red-400">{{ saveError }}</p>
      <button
        :disabled="isSaving"
        class="rounded bg-purple-600 px-4 py-2 font-semibold hover:bg-purple-700"
        @click="handleSave"
      >
        Speichern
      </button>
    </div>
    <p v-else>Lade...</p>
  </main>
</template>
```

- [ ] **Step 2: Tests ergänzen — `apps/web/src/views/BoardEditView.test.ts` (am Ende der Datei ergänzen)**

```ts
it("öffnet beim Klick eine Textarea mit dem aktuellen Zelltext", async () => {
  vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => sampleBoard } as Response);
  const router = createTestRouter();
  router.push("/boards/b1/edit");
  await router.isReady();
  const wrapper = mount(BoardEditView, { global: { plugins: [router] } });
  await flushPromises();

  const cells = wrapper.findAll(".bg-slate-800.p-1");
  await cells[0].trigger("click");

  const textarea = wrapper.find("textarea");
  expect((textarea.element as HTMLTextAreaElement).value).toBe("Erste Zelle");
});

it("übernimmt den Text beim Blur und schließt die Textarea", async () => {
  vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => sampleBoard } as Response);
  const router = createTestRouter();
  router.push("/boards/b1/edit");
  await router.isReady();
  const wrapper = mount(BoardEditView, { global: { plugins: [router] } });
  await flushPromises();

  const cells = wrapper.findAll(".bg-slate-800.p-1");
  await cells[0].trigger("click");
  const textarea = wrapper.find("textarea");
  await textarea.setValue("Neuer Text");
  await textarea.trigger("blur");

  expect(wrapper.find("textarea").exists()).toBe(false);
  expect(wrapper.text()).toContain("Neuer Text");
});

it("speichert nur geänderte Felder und Zellen via PATCH", async () => {
  vi.mocked(fetch).mockImplementation(async (_url, options) => {
    const method = ((options as RequestInit)?.method ?? "GET").toUpperCase();
    if (method === "PATCH") {
      return {
        ok: true,
        json: async () => ({
          ...sampleBoard,
          name: "Neuer Name",
          cells: sampleBoard.cells,
        }),
      } as Response;
    }
    return { ok: true, json: async () => sampleBoard } as Response;
  });

  const router = createTestRouter();
  router.push("/boards/b1/edit");
  await router.isReady();
  const wrapper = mount(BoardEditView, { global: { plugins: [router] } });
  await flushPromises();

  await wrapper.find("input[type=text]").setValue("Neuer Name");
  await wrapper.find("button").trigger("click");
  await flushPromises();

  expect(fetch).toHaveBeenCalledWith(
    expect.stringContaining("/api/boards/b1"),
    expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ name: "Neuer Name" }),
    })
  );
});

it("zeigt eine Fehlermeldung, wenn das Speichern fehlschlägt", async () => {
  vi.mocked(fetch).mockImplementation(async (_url, options) => {
    const method = ((options as RequestInit)?.method ?? "GET").toUpperCase();
    if (method === "PATCH") {
      return { ok: false, json: async () => ({ error: "Serverfehler" }) } as Response;
    }
    return { ok: true, json: async () => sampleBoard } as Response;
  });

  const router = createTestRouter();
  router.push("/boards/b1/edit");
  await router.isReady();
  const wrapper = mount(BoardEditView, { global: { plugins: [router] } });
  await flushPromises();

  await wrapper.find("input[type=text]").setValue("Neuer Name");
  await wrapper.find("button").trigger("click");
  await flushPromises();

  expect(wrapper.text()).toContain("Serverfehler");
});
```

> **Hinweis für die Umsetzung:** Bei den beiden letzten Tests (Speichern erfolgreich/fehlgeschlagen) ist besondere Sorgfalt bei der Trennschärfe angebracht — bei Unsicherheit den Save-Aufruf oder die Fehlerbehandlung temporär deaktivieren, Fehlschlag des Tests bestätigen, wiederherstellen (siehe Global Constraints).

- [ ] **Step 3: Test ausführen, Erfolg verifizieren**

Run: `pnpm --filter @bingo/web test`
Expected: PASS — alle Tests in `BoardEditView.test.ts` grün (7 insgesamt).

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @bingo/web exec vue-tsc --noEmit`
Expected: Keine Ausgabe, Exit-Code 0.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/views/BoardEditView.vue apps/web/src/views/BoardEditView.test.ts
git commit -m "$(cat <<'EOF'
feat(web): Inline-Zellbearbeitung + Speichern via PATCH

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: `apps/web` – Warnung bei ungespeicherten Änderungen (TDD)

**Files:**
- Modify: `apps/web/src/views/BoardEditView.vue`
- Modify: `apps/web/src/views/BoardEditView.test.ts`

**Interfaces:**
- Consumes: `isDirty` (bereits in der Komponente vorhanden, Task 7)
- Produces: Router-Navigation weg von der Editor-Seite fragt bei ungespeicherten Änderungen nach Bestätigung; `beforeunload`-Warnung beim Schließen/Neuladen des Tabs

- [ ] **Step 1: `apps/web/src/views/BoardEditView.vue` erweitern (Imports + neue Logik nach `handleSave`, vor `onMounted`)**

Import-Zeile erweitern:
```ts
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { onBeforeRouteLeave, useRoute } from "vue-router";
```

Nach der `handleSave`-Funktion und vor `onMounted` ergänzen:
```ts
onBeforeRouteLeave(() => {
  if (isDirty.value) {
    return window.confirm("Es gibt ungespeicherte Änderungen. Trotzdem verlassen?");
  }
  return true;
});

function handleBeforeUnload(event: BeforeUnloadEvent) {
  if (isDirty.value) {
    event.preventDefault();
  }
}
```

`onMounted` erweitern (Event-Listener zusätzlich zum bestehenden Fetch registrieren) und einen `onUnmounted`-Block ergänzen:
```ts
onMounted(async () => {
  window.addEventListener("beforeunload", handleBeforeUnload);
  const id = route.params.id as string;
  const result = await boardsStore.fetchBoard(id);
  if (!result) {
    notFound.value = true;
    return;
  }
  applyBoard(result);
});

onUnmounted(() => {
  window.removeEventListener("beforeunload", handleBeforeUnload);
});
```

- [ ] **Step 2: Tests ergänzen — `apps/web/src/views/BoardEditView.test.ts` (am Ende der Datei ergänzen; `createRouter`/`createWebHistory` sind bereits importiert)**

```ts
function createTestRouterWithBoardsList() {
  return createRouter({
    history: createWebHistory(),
    routes: [
      { path: "/boards/:id/edit", name: "board-edit", component: BoardEditView },
      { path: "/boards", name: "boards", component: { template: "<div />" } },
    ],
  });
}

describe("BoardEditView – Verlassen-Warnung", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("erlaubt das Verlassen ohne ungespeicherte Änderungen ohne Bestätigung", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => sampleBoard } as Response);
    const confirmSpy = vi.spyOn(window, "confirm");
    const router = createTestRouterWithBoardsList();
    router.push("/boards/b1/edit");
    await router.isReady();
    mount(BoardEditView, { global: { plugins: [router] } });
    await flushPromises();

    await router.push("/boards");

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(router.currentRoute.value.name).toBe("boards");
  });

  it("fragt bei ungespeicherten Änderungen und respektiert einen Abbruch", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => sampleBoard } as Response);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const router = createTestRouterWithBoardsList();
    router.push("/boards/b1/edit");
    await router.isReady();
    const wrapper = mount(BoardEditView, { global: { plugins: [router] } });
    await flushPromises();

    await wrapper.find("input[type=text]").setValue("Geändert");
    await router.push("/boards");

    expect(window.confirm).toHaveBeenCalled();
    expect(router.currentRoute.value.name).toBe("board-edit");
  });

  it("lässt das Verlassen zu, wenn die Bestätigung akzeptiert wird", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => sampleBoard } as Response);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const router = createTestRouterWithBoardsList();
    router.push("/boards/b1/edit");
    await router.isReady();
    const wrapper = mount(BoardEditView, { global: { plugins: [router] } });
    await flushPromises();

    await wrapper.find("input[type=text]").setValue("Geändert");
    await router.push("/boards");

    expect(router.currentRoute.value.name).toBe("boards");
  });
});
```

- [ ] **Step 3: Test ausführen, Erfolg verifizieren**

Run: `pnpm --filter @bingo/web test`
Expected: PASS — alle Tests grün (10 in `BoardEditView.test.ts`).

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @bingo/web exec vue-tsc --noEmit`
Expected: Keine Ausgabe, Exit-Code 0.

- [ ] **Step 5: Dev-Server manuell prüfen**

Run: `pnpm --filter @bingo/web dev`
Expected: Vite startet auf `http://localhost:5173` ohne Fehler. Danach Server mit Strg+C beenden.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/views/BoardEditView.vue apps/web/src/views/BoardEditView.test.ts
git commit -m "$(cat <<'EOF'
feat(web): Warnung bei ungespeicherten Änderungen beim Verlassen

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Nach Abschluss dieses Plans

Automatisiert vollständig verifiziert: geteilte Cross-Feld-Validierung (Anlegen und
Bearbeiten nutzen dieselbe Regel), eigentümergeschütztes `PATCH` (404 statt 403,
Zellkoordinaten-Validierung), Raster-Layout als reine Funktion, Inline-Bearbeitung,
Speichern nur geänderter Felder, Verlassen-Warnung.

**Manuell zu verifizieren** (End-to-End im Browser): Board anlegen → Editor öffnen →
Namen ändern, Zelltext eintragen (Enter erzeugt Zeilenumbruch), Beschriftung auf
„Eigene Wörter" umstellen und Labels eintragen → Speichern → Seite neu laden zeigt
gespeicherten Stand → Text ändern, Browser-Zurück-Navigation zeigt Bestätigungsdialog.

Nächster Schritt laut SPEC.md Abschnitt 10: **Control-Seite mit Häkchen-Persistenz**
(Punkt 5) — Klick auf ein Feld setzt/entfernt ein Kreuz, `PUT
/api/boards/:id/cells/:row/:col/checked`, optimistisches UI mit Rollback bei Fehler.
