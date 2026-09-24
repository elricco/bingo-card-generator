# Foundation & Monorepo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das Monorepo-Fundament aufbauen: pnpm-Workspace mit `apps/web`, `apps/api`, `packages/shared`, Docker-Compose-Postgres, Drizzle-Schema samt Migration und die zentrale Label-/Validierungslogik im shared-Package — alles lauffähig und getestet, bevor Auth und Board-CRUD (spätere Pläne) darauf aufbauen.

**Architecture:** pnpm-Workspace-Monorepo mit drei Paketen: `packages/shared` (Zod-Schemas, Konstanten, reine Label-Funktionen, von Frontend und Backend genutzt), `apps/api` (Fastify + Drizzle ORM gegen Postgres, vorerst nur Health-Check-Route), `apps/web` (Vue 3 + Vite + Tailwind, vorerst nur Platzhalter-Seite). Postgres läuft lokal via Docker Compose; Drizzle-Migrationen werden versioniert im Repo abgelegt.

**Tech Stack:** pnpm workspaces, TypeScript 5, Vue 3 (`<script setup>`), Vite, Vue Router, Pinia, Tailwind CSS, Fastify 4, Drizzle ORM + drizzle-kit, `postgres` (postgres.js), Zod, Vitest, Docker Compose.

**Spec:** `SPEC.md` (Abschnitte 3 „Technischer Stack", 4 „Datenmodell", 10 „Umsetzungsreihenfolge" Punkt 1)

## Global Constraints

- Board-Größen ausschließlich `3, 5, 7, 9` (SPEC 2.2, 4).
- `label_mode` ausschließlich `'letters' | 'bingo' | 'custom'`; `'bingo'` nur bei `size = 5` (SPEC 2.3, 4, 11).
- Zelltext max. 80 Zeichen, Board-Name max. 60 Zeichen, Spaltenlabel (custom) max. 20 Zeichen (SPEC 2.3, 2.4, 11).
- Alle Eingaben serverseitig mit Zod validieren (SPEC 8).
- Env-Variablen (DB-URL, Secrets) ausschließlich über `.env`, niemals hart codiert; `.env.example` muss im Repo gepflegt werden (SPEC 8).
- UI-Sprache Deutsch (spätere Phasen; betrifft hier nur Kommentare/Fehlermeldungen im shared-Package, siehe SPEC 7).
- Repo-Struktur exakt `apps/web`, `apps/api`, `packages/shared` (SPEC 3).

---

## Datei-Übersicht (vor der Aufgabenplanung)

```
pnpm-workspace.yaml
package.json                        # Root-Workspace-Scripts
tsconfig.base.json                  # Gemeinsame TS-Compiler-Optionen
docker-compose.yml                  # Postgres für lokale Entwicklung
.env.example                        # DB-URL, Ports, Platzhalter für Twitch-Secrets

packages/shared/
  package.json
  tsconfig.json
  src/constants.ts                  # Größen, Zeichenlimits, Label-Modi
  src/labels.ts                     # getColumnLabels(), getRowLabels()
  src/labels.test.ts
  src/schemas.ts                    # Basis-Zod-Schemas (Größe, Label-Modus, Namen, Zelltext, Spaltenlabel)
  src/schemas.test.ts
  src/index.ts                      # Re-Exports

apps/api/
  package.json
  tsconfig.json
  drizzle.config.ts
  src/server.ts                     # Fastify-Instanz + /health
  src/server.test.ts
  src/db/schema.ts                  # Drizzle-Tabellen: users, boards, board_cells, sessions
  src/db/client.ts                  # Drizzle-Client (postgres.js)
  src/db/migrate.ts                 # Migrations-Runner-Script
  drizzle/                          # generierte SQL-Migrationen (via drizzle-kit generate)

apps/web/
  package.json
  tsconfig.json
  vite.config.ts
  tailwind.config.ts
  postcss.config.js
  index.html
  src/main.ts
  src/App.vue
  src/style.css
  src/router/index.ts
  src/views/HomeView.vue
  src/App.test.ts
```

Jedes Paket besitzt sein eigenes `package.json`/`tsconfig.json`; `packages/shared` wird von `apps/api` und `apps/web` per `workspace:*` referenziert.

---

### Task 1: Monorepo-Grundgerüst (Root-Konfiguration)

**Files:**
- Create: `pnpm-workspace.yaml`
- Create: `package.json`
- Create: `tsconfig.base.json`

**Interfaces:**
- Consumes: nichts (erste Task)
- Produces: pnpm-Workspace-Glob `apps/*`, `packages/*`; Root-Scripts `dev:web`, `dev:api`, `build`, `test`, `lint`; `tsconfig.base.json` als `extends`-Basis für alle Pakete

- [ ] **Step 1: `pnpm-workspace.yaml` anlegen**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 2: Root `package.json` anlegen**

```json
{
  "name": "bingo-card-generator",
  "private": true,
  "engines": {
    "node": ">=20"
  },
  "packageManager": "pnpm@9.12.0",
  "scripts": {
    "dev:web": "pnpm --filter @bingo/web dev",
    "dev:api": "pnpm --filter @bingo/api dev",
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "lint": "pnpm -r lint"
  }
}
```

- [ ] **Step 3: `tsconfig.base.json` anlegen**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true
  }
}
```

- [ ] **Step 4: Verifizieren**

Run: `pnpm install`
Expected: Läuft ohne Fehler durch (noch keine Workspace-Pakete vorhanden, das ist ok), erzeugt `pnpm-lock.yaml`.

- [ ] **Step 5: Commit**

```bash
git add pnpm-workspace.yaml package.json tsconfig.base.json pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
chore: pnpm-Workspace-Grundgerüst anlegen

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `packages/shared` – Setup und Konstanten

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/constants.ts`
- Create: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: `tsconfig.base.json` (Task 1)
- Produces: `BOARD_SIZES`, `BoardSize`, `LABEL_MODES`, `LabelMode`, `CELL_TEXT_MAX_LENGTH`, `BOARD_NAME_MAX_LENGTH`, `COLUMN_LABEL_MAX_LENGTH`, `DEFAULT_BOARD_NAME`, `BINGO_LABELS` — genutzt von `labels.ts` (Task 3), `schemas.ts` (Task 4) und später `apps/api`, `apps/web`

- [ ] **Step 1: `packages/shared/package.json` anlegen**

```json
{
  "name": "@bingo/shared",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "typescript": "^5.5.4",
    "vitest": "^2.0.5"
  }
}
```

- [ ] **Step 2: `packages/shared/tsconfig.json` anlegen**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: `packages/shared/src/constants.ts` anlegen**

```ts
export const BOARD_SIZES = [3, 5, 7, 9] as const;
export type BoardSize = (typeof BOARD_SIZES)[number];

export const LABEL_MODES = ["letters", "bingo", "custom"] as const;
export type LabelMode = (typeof LABEL_MODES)[number];

export const CELL_TEXT_MAX_LENGTH = 80;
export const BOARD_NAME_MAX_LENGTH = 60;
export const COLUMN_LABEL_MAX_LENGTH = 20;
export const DEFAULT_BOARD_NAME = "Neues Bingo";

export const BINGO_LABELS = ["B", "I", "N", "G", "O"] as const;
```

- [ ] **Step 4: `packages/shared/src/index.ts` anlegen**

```ts
export * from "./constants";
```

- [ ] **Step 5: Verifizieren**

Run: `pnpm install`
Expected: `@bingo/shared` wird als Workspace-Paket erkannt (`pnpm -r list` zeigt es an), kein Fehler.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/package.json packages/shared/tsconfig.json packages/shared/src/constants.ts packages/shared/src/index.ts pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat(shared): Konstanten für Boardgrößen, Label-Modi und Zeichenlimits

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `packages/shared` – Label-Logik (TDD)

**Files:**
- Create: `packages/shared/src/labels.test.ts`
- Create: `packages/shared/src/labels.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: `BINGO_LABELS`, `LabelMode` aus `./constants` (Task 2)
- Produces: `getColumnLabels(size: number, labelMode: LabelMode, columnLabels?: string[]): string[]`, `getRowLabels(size: number): string[]` — zentrale Label-Logik, wird später von `apps/web` (Editor, Control, Overlay) und `apps/api` (Overlay-Endpoint-Validierung) genutzt

- [ ] **Step 1: Fehlschlagenden Test schreiben — `packages/shared/src/labels.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { getColumnLabels, getRowLabels } from "./labels";

describe("getColumnLabels", () => {
  it("liefert A-C für size=3 im Modus letters", () => {
    expect(getColumnLabels(3, "letters")).toEqual(["A", "B", "C"]);
  });

  it("liefert A-I für size=9 im Modus letters", () => {
    expect(getColumnLabels(9, "letters")).toEqual([
      "A", "B", "C", "D", "E", "F", "G", "H", "I",
    ]);
  });

  it("liefert B-I-N-G-O für size=5 im Modus bingo", () => {
    expect(getColumnLabels(5, "bingo")).toEqual(["B", "I", "N", "G", "O"]);
  });

  it("wirft bei Modus bingo und size != 5", () => {
    expect(() => getColumnLabels(3, "bingo")).toThrow(/size=5/);
  });

  it("liefert eigene Wörter im Modus custom", () => {
    expect(getColumnLabels(3, "custom", ["WIN", "GG", "GLHF"])).toEqual([
      "WIN", "GG", "GLHF",
    ]);
  });

  it("wirft bei Modus custom mit falscher Länge", () => {
    expect(() => getColumnLabels(3, "custom", ["WIN"])).toThrow(/3 Einträgen/);
  });

  it("wirft bei Modus custom ohne columnLabels", () => {
    expect(() => getColumnLabels(3, "custom")).toThrow();
  });
});

describe("getRowLabels", () => {
  it("liefert 1..n als Strings", () => {
    expect(getRowLabels(5)).toEqual(["1", "2", "3", "4", "5"]);
  });
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag verifizieren**

Run: `pnpm --filter @bingo/shared test`
Expected: FAIL — `labels.ts` existiert nicht / Module not found.

- [ ] **Step 3: Minimale Implementierung — `packages/shared/src/labels.ts`**

```ts
import { BINGO_LABELS, type LabelMode } from "./constants";

function lettersForSize(size: number): string[] {
  return Array.from({ length: size }, (_, i) => String.fromCharCode(65 + i));
}

export function getColumnLabels(
  size: number,
  labelMode: LabelMode,
  columnLabels?: string[]
): string[] {
  if (labelMode === "bingo") {
    if (size !== 5) {
      throw new Error(
        `label_mode "bingo" ist nur bei size=5 erlaubt, erhalten: size=${size}`
      );
    }
    return [...BINGO_LABELS];
  }

  if (labelMode === "custom") {
    if (!columnLabels || columnLabels.length !== size) {
      throw new Error(
        `label_mode "custom" erfordert columnLabels mit genau ${size} Einträgen, erhalten: ${
          columnLabels?.length ?? 0
        }`
      );
    }
    return columnLabels;
  }

  return lettersForSize(size);
}

export function getRowLabels(size: number): string[] {
  return Array.from({ length: size }, (_, i) => String(i + 1));
}
```

- [ ] **Step 4: `packages/shared/src/index.ts` erweitern**

```ts
export * from "./constants";
export * from "./labels";
```

- [ ] **Step 5: Test ausführen, Erfolg verifizieren**

Run: `pnpm --filter @bingo/shared test`
Expected: PASS — alle 7 Tests grün.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/labels.ts packages/shared/src/labels.test.ts packages/shared/src/index.ts
git commit -m "$(cat <<'EOF'
feat(shared): zentrale Label-Logik für Spalten- und Reihenbeschriftung

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `packages/shared` – Basis-Zod-Schemas (TDD)

**Files:**
- Create: `packages/shared/src/schemas.test.ts`
- Create: `packages/shared/src/schemas.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: `LABEL_MODES`, `CELL_TEXT_MAX_LENGTH`, `BOARD_NAME_MAX_LENGTH`, `COLUMN_LABEL_MAX_LENGTH` aus `./constants` (Task 2)
- Produces: `boardSizeSchema`, `labelModeSchema`, `boardNameSchema`, `cellTextSchema`, `columnLabelSchema` (Zod-Schemas) — Basis-Bausteine, aus denen spätere Pläne (Board-CRUD) zusammengesetzte Request-Schemas bauen

- [ ] **Step 1: Fehlschlagenden Test schreiben — `packages/shared/src/schemas.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import {
  boardSizeSchema,
  labelModeSchema,
  boardNameSchema,
  cellTextSchema,
  columnLabelSchema,
} from "./schemas";

describe("boardSizeSchema", () => {
  it("akzeptiert 3, 5, 7, 9", () => {
    for (const size of [3, 5, 7, 9]) {
      expect(boardSizeSchema.parse(size)).toBe(size);
    }
  });

  it("lehnt andere Zahlen ab", () => {
    expect(() => boardSizeSchema.parse(4)).toThrow();
  });
});

describe("labelModeSchema", () => {
  it("akzeptiert letters, bingo, custom", () => {
    expect(labelModeSchema.parse("letters")).toBe("letters");
    expect(labelModeSchema.parse("bingo")).toBe("bingo");
    expect(labelModeSchema.parse("custom")).toBe("custom");
  });

  it("lehnt unbekannte Werte ab", () => {
    expect(() => labelModeSchema.parse("foo")).toThrow();
  });
});

describe("boardNameSchema", () => {
  it("akzeptiert Namen bis 60 Zeichen", () => {
    expect(boardNameSchema.parse("a".repeat(60))).toHaveLength(60);
  });

  it("lehnt leere Namen ab", () => {
    expect(() => boardNameSchema.parse("")).toThrow();
  });

  it("lehnt Namen über 60 Zeichen ab", () => {
    expect(() => boardNameSchema.parse("a".repeat(61))).toThrow();
  });
});

describe("cellTextSchema", () => {
  it("akzeptiert leeren Text", () => {
    expect(cellTextSchema.parse("")).toBe("");
  });

  it("akzeptiert Text bis 80 Zeichen", () => {
    expect(cellTextSchema.parse("a".repeat(80))).toHaveLength(80);
  });

  it("lehnt Text über 80 Zeichen ab", () => {
    expect(() => cellTextSchema.parse("a".repeat(81))).toThrow();
  });
});

describe("columnLabelSchema", () => {
  it("akzeptiert Label bis 20 Zeichen", () => {
    expect(columnLabelSchema.parse("a".repeat(20))).toHaveLength(20);
  });

  it("lehnt Label über 20 Zeichen ab", () => {
    expect(() => columnLabelSchema.parse("a".repeat(21))).toThrow();
  });

  it("lehnt leeres Label ab", () => {
    expect(() => columnLabelSchema.parse("")).toThrow();
  });
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag verifizieren**

Run: `pnpm --filter @bingo/shared test`
Expected: FAIL — `schemas.ts` existiert nicht.

- [ ] **Step 3: Minimale Implementierung — `packages/shared/src/schemas.ts`**

```ts
import { z } from "zod";
import {
  LABEL_MODES,
  CELL_TEXT_MAX_LENGTH,
  BOARD_NAME_MAX_LENGTH,
  COLUMN_LABEL_MAX_LENGTH,
} from "./constants";

export const boardSizeSchema = z.union([
  z.literal(3),
  z.literal(5),
  z.literal(7),
  z.literal(9),
]);

export const labelModeSchema = z.enum(LABEL_MODES);

export const boardNameSchema = z
  .string()
  .trim()
  .min(1, "Board-Name darf nicht leer sein")
  .max(BOARD_NAME_MAX_LENGTH, `Board-Name darf max. ${BOARD_NAME_MAX_LENGTH} Zeichen haben`);

export const cellTextSchema = z
  .string()
  .max(CELL_TEXT_MAX_LENGTH, `Zelltext darf max. ${CELL_TEXT_MAX_LENGTH} Zeichen haben`);

export const columnLabelSchema = z
  .string()
  .trim()
  .min(1, "Spaltenlabel darf nicht leer sein")
  .max(
    COLUMN_LABEL_MAX_LENGTH,
    `Spaltenlabel darf max. ${COLUMN_LABEL_MAX_LENGTH} Zeichen haben`
  );
```

- [ ] **Step 4: `packages/shared/src/index.ts` erweitern**

```ts
export * from "./constants";
export * from "./labels";
export * from "./schemas";
```

- [ ] **Step 5: Test ausführen, Erfolg verifizieren**

Run: `pnpm --filter @bingo/shared test`
Expected: PASS — alle Tests aus Task 3 und Task 4 grün.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/schemas.ts packages/shared/src/schemas.test.ts packages/shared/src/index.ts
git commit -m "$(cat <<'EOF'
feat(shared): Basis-Zod-Schemas für Boardgröße, Label-Modus, Namen und Zelltext

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `apps/api` – Grundgerüst mit Health-Route (TDD)

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/src/server.test.ts`
- Create: `apps/api/src/server.ts`

**Interfaces:**
- Consumes: `@bingo/shared` (Workspace-Dependency, noch ungenutzt in dieser Task, aber als Dependency vorbereitet)
- Produces: `buildServer(): FastifyInstance` — Factory-Funktion, die spätere Tasks (Drizzle-Anbindung, Auth-Routen in Folgeplänen) erweitern; `GET /health` Route

- [ ] **Step 1: `apps/api/package.json` anlegen**

```json
{
  "name": "@bingo/api",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server.js",
    "test": "vitest run",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "tsx src/db/migrate.ts"
  },
  "dependencies": {
    "@bingo/shared": "workspace:*",
    "fastify": "^4.28.1",
    "drizzle-orm": "^0.33.0",
    "postgres": "^3.4.4",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "drizzle-kit": "^0.24.2",
    "tsx": "^4.19.0",
    "typescript": "^5.5.4",
    "vitest": "^2.0.5",
    "@types/node": "^22.5.0"
  }
}
```

- [ ] **Step 2: `apps/api/tsconfig.json` anlegen**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Fehlschlagenden Test schreiben — `apps/api/src/server.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { buildServer } from "./server";

describe("GET /health", () => {
  it("antwortet mit status ok", async () => {
    const app = buildServer();
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });
});
```

- [ ] **Step 4: Test ausführen, Fehlschlag verifizieren**

Run: `pnpm install && pnpm --filter @bingo/api test`
Expected: FAIL — `server.ts` existiert nicht.

- [ ] **Step 5: Minimale Implementierung — `apps/api/src/server.ts`**

```ts
import Fastify from "fastify";

export function buildServer() {
  const app = Fastify({ logger: true });

  app.get("/health", async () => ({ status: "ok" }));

  return app;
}

async function main() {
  const app = buildServer();
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

- [ ] **Step 6: Test ausführen, Erfolg verifizieren**

Run: `pnpm --filter @bingo/api test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/package.json apps/api/tsconfig.json apps/api/src/server.ts apps/api/src/server.test.ts pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat(api): Fastify-Grundgerüst mit Health-Route

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `apps/api` – Drizzle-Schema und Migrations-Setup

**Files:**
- Create: `apps/api/drizzle.config.ts`
- Create: `apps/api/src/db/schema.ts`
- Create: `apps/api/src/db/client.ts`
- Create: `apps/api/src/db/migrate.ts`

**Interfaces:**
- Consumes: nichts Neues (reines Drizzle-Setup)
- Produces: Tabellen `users`, `boards`, `boardCells`, `sessions` (Drizzle-Objekte, exportiert aus `./schema`) — werden von Folgeplänen (Auth, Board-CRUD) importiert; `db` (Drizzle-Client-Instanz aus `./client`) für Queries

- [ ] **Step 1: `apps/api/drizzle.config.ts` anlegen**

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://bingo:bingo@localhost:5432/bingo",
  },
});
```

- [ ] **Step 2: `apps/api/src/db/schema.ts` anlegen**

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
    size: smallint("size").notNull(),
    labelMode: text("label_mode").notNull(),
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

- [ ] **Step 3: `apps/api/src/db/client.ts` anlegen**

```ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL ist nicht gesetzt");
}

const queryClient = postgres(connectionString);
export const db = drizzle(queryClient, { schema });
```

- [ ] **Step 4: `apps/api/src/db/migrate.ts` anlegen**

```ts
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL ist nicht gesetzt");
  }

  const migrationClient = postgres(connectionString, { max: 1 });
  const db = drizzle(migrationClient);

  await migrate(db, { migrationsFolder: "./drizzle" });
  await migrationClient.end();

  console.log("Migrationen erfolgreich angewendet.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 5: Verifizieren (Typecheck, DB folgt in Task 7)**

Run: `pnpm --filter @bingo/api exec tsc --noEmit`
Expected: Keine Typfehler.

- [ ] **Step 6: Commit**

```bash
git add apps/api/drizzle.config.ts apps/api/src/db
git commit -m "$(cat <<'EOF'
feat(api): Drizzle-Schema für users, boards, board_cells, sessions

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Docker Compose (Postgres) + Migration ausführen und verifizieren

**Files:**
- Create: `docker-compose.yml`
- Create: `.env.example`
- Create: `apps/api/drizzle/` (generiert durch `drizzle-kit generate`, nicht händisch)

**Interfaces:**
- Consumes: `apps/api/drizzle.config.ts`, `apps/api/src/db/schema.ts` (Task 6)
- Produces: laufende Postgres-Instanz auf `localhost:5432` mit angewendetem Schema — Grundlage für alle Folgepläne (Auth, Board-CRUD), die gegen `db` (Task 6) Queries ausführen

Hinweis: Der `app`-Service (API/Web als Container) wird bewusst noch nicht ergänzt — dafür fehlen bis Phase 8 noch Dockerfiles für `apps/api`/`apps/web`. Diese Compose-Datei deckt vorerst nur die lokale Postgres-Instanz für die Entwicklung ab.

- [ ] **Step 1: `docker-compose.yml` anlegen**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-bingo}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-bingo}
      POSTGRES_DB: ${POSTGRES_DB:-bingo}
    ports:
      - "5432:5432"
    volumes:
      - bingo_postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-bingo}"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  bingo_postgres_data:
```

- [ ] **Step 2: `.env.example` anlegen**

```
# Postgres
POSTGRES_USER=bingo
POSTGRES_PASSWORD=bingo
POSTGRES_DB=bingo
DATABASE_URL=postgres://bingo:bingo@localhost:5432/bingo

# API
PORT=3001
SESSION_SECRET=change-me-to-a-random-64-char-string

# Twitch OAuth (wird in einem Folgeplan benötigt)
TWITCH_CLIENT_ID=
TWITCH_CLIENT_SECRET=
TWITCH_REDIRECT_URI=http://localhost:3001/auth/twitch/callback
```

- [ ] **Step 3: Lokale `.env` aus Vorlage erzeugen**

Run: `cp .env.example .env`
Expected: `.env` existiert lokal (ist via `.gitignore` von Git ausgeschlossen).

- [ ] **Step 4: Postgres starten und auf „healthy" warten**

Run: `docker compose up -d postgres && docker compose ps`
Expected: Service `postgres` zeigt Status `healthy` (ggf. wenige Sekunden warten und `docker compose ps` erneut ausführen).

- [ ] **Step 5: Migration generieren**

Run: `pnpm --filter @bingo/api db:generate`
Expected: Neue SQL-Datei(en) unter `apps/api/drizzle/` werden erzeugt.

- [ ] **Step 6: Migration anwenden**

Run: `set -a && source .env && set +a && pnpm --filter @bingo/api db:migrate`
Expected: Konsolenausgabe „Migrationen erfolgreich angewendet."

- [ ] **Step 7: Tabellen verifizieren**

Run: `docker compose exec postgres psql -U bingo -d bingo -c '\dt'`
Expected: Tabellen `users`, `boards`, `board_cells`, `sessions` werden aufgelistet.

- [ ] **Step 8: Commit**

```bash
git add docker-compose.yml .env.example apps/api/drizzle
git commit -m "$(cat <<'EOF'
feat: Docker-Compose-Postgres und initiale Datenbank-Migration

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: `apps/web` – Grundgerüst mit Smoke-Test (TDD)

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/tailwind.config.ts`
- Create: `apps/web/postcss.config.js`
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.ts`
- Create: `apps/web/src/App.vue`
- Create: `apps/web/src/style.css`
- Create: `apps/web/src/router/index.ts`
- Create: `apps/web/src/views/HomeView.vue`
- Create: `apps/web/src/App.test.ts`

**Interfaces:**
- Consumes: `@bingo/shared` (Workspace-Dependency, noch ungenutzt in dieser Task)
- Produces: `router` (Vue-Router-Instanz aus `./router`) — Basis, auf der Folgepläne (Dashboard, Editor, Control, Overlay) weitere Routen ergänzen

- [ ] **Step 1: `apps/web/package.json` anlegen**

```json
{
  "name": "@bingo/web",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vue-tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": {
    "@bingo/shared": "workspace:*",
    "vue": "^3.4.38",
    "vue-router": "^4.4.3",
    "pinia": "^2.2.2"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^5.1.2",
    "@vue/test-utils": "^2.4.6",
    "autoprefixer": "^10.4.20",
    "jsdom": "^25.0.0",
    "postcss": "^8.4.41",
    "tailwindcss": "^3.4.10",
    "typescript": "^5.5.4",
    "vite": "^5.4.2",
    "vitest": "^2.0.5",
    "vue-tsc": "^2.0.29"
  }
}
```

- [ ] **Step 2: `apps/web/tsconfig.json` anlegen**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "preserve",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: `apps/web/vite.config.ts` anlegen**

```ts
/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
  },
  test: {
    environment: "jsdom",
  },
});
```

- [ ] **Step 4: `apps/web/tailwind.config.ts` anlegen**

```ts
import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{vue,ts}"],
  theme: {
    extend: {},
  },
  plugins: [],
} satisfies Config;
```

- [ ] **Step 5: `apps/web/postcss.config.js` anlegen**

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 6: `apps/web/index.html` anlegen**

```html
<!doctype html>
<html lang="de">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Bingo Card Generator</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 7: `apps/web/src/style.css` anlegen**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 8: `apps/web/src/router/index.ts` anlegen**

```ts
import { createRouter, createWebHistory } from "vue-router";
import HomeView from "../views/HomeView.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [{ path: "/", name: "home", component: HomeView }],
});
```

- [ ] **Step 9: `apps/web/src/views/HomeView.vue` anlegen**

```vue
<script setup lang="ts"></script>

<template>
  <main class="flex min-h-screen items-center justify-center bg-slate-900 text-slate-100">
    <h1 class="text-3xl font-bold">Bingo Card Generator</h1>
  </main>
</template>
```

- [ ] **Step 10: `apps/web/src/App.vue` anlegen**

```vue
<script setup lang="ts"></script>

<template>
  <router-view />
</template>
```

- [ ] **Step 11: `apps/web/src/main.ts` anlegen**

```ts
import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { router } from "./router";
import "./style.css";

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount("#app");
```

- [ ] **Step 12: Fehlschlagenden Test schreiben — `apps/web/src/App.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import HomeView from "./views/HomeView.vue";

describe("HomeView", () => {
  it("zeigt den Titel an", () => {
    const wrapper = mount(HomeView);
    expect(wrapper.text()).toContain("Bingo Card Generator");
  });
});
```

- [ ] **Step 13: Abhängigkeiten installieren und Test ausführen**

Run: `pnpm install && pnpm --filter @bingo/web test`
Expected: PASS (die Implementierung wurde bereits in Schritt 9 geschrieben — dieser Schritt bestätigt, dass Setup und Test zusammenpassen).

- [ ] **Step 14: Dev-Server manuell prüfen**

Run: `pnpm --filter @bingo/web dev`
Expected: Vite startet auf `http://localhost:5173`, Browser zeigt „Bingo Card Generator" auf dunklem Hintergrund (Tailwind-Klassen greifen). Danach Server mit Strg+C beenden.

- [ ] **Step 15: Commit**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat(web): Vite/Vue/Router/Pinia/Tailwind-Grundgerüst mit Smoke-Test

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Nach Abschluss dieses Plans

Alle drei Pakete sind lauffähig und getestet:
- `packages/shared`: Konstanten, Label-Logik, Basis-Schemas.
- `apps/api`: Fastify-Server mit Health-Route, Drizzle-Schema gegen laufende Postgres-Instanz migriert.
- `apps/web`: Vite/Vue-Dev-Server mit Tailwind, Router, Pinia.

Nächster Schritt laut SPEC.md Abschnitt 10: **Plan 2 – Twitch-Login + Sessions**, wird nach Abschluss und Review dieses Plans separat geschrieben (siehe writing-plans-Skill-Hinweis zu unabhängig testbaren Increments).
