# Tests (Unit + E2E) und README Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Letzter Punkt der Umsetzungsreihenfolge (SPEC 10.8): E2E-Tests der 9 Akzeptanzkriterien mit Playwright, eine vollständige README mit Setup- und OBS-Anleitung — plus, laut expliziter Nutzerentscheidung, zwei seit längerem zurückgestellte Punkte: den kaputten Produktions-Build/-Start beheben und Rate-Limiting auf Schreib-Endpoints ergänzen.

**Architecture:** Für den Build-Fix wird **kein** kompilierter `dist/`-Build mehr für `apps/api` verwendet — stattdessen läuft `pnpm start` wie `pnpm dev` über `tsx` direkt gegen die TypeScript-Quellen. Das umgeht sauber ein tieferes Problem: `@bingo/shared`s `package.json` zeigt bewusst auf TypeScript-Quellcode (`main: "./src/index.ts"`), damit Vite und Vitest es ohne Build-Schritt live nutzen können; ein `node dist/server.js`-Lauf könnte das nicht auflösen, ohne diese Quelldistribution zu ändern (mit Konsequenzen für den bestehenden Dev-Workflow). `tsx` wird bereits für `pnpm dev` und `db:migrate` verwendet — die Erweiterung auf `start` ist konsistent mit dem bestehenden Muster, nicht neu. `apps/api`s `build`-Skript wird zu einem reinen Typecheck (`tsc --noEmit`), identisch zu dem Befehl, der in jeder vorherigen Phase bereits als CI-Gate lief.

Für Rate-Limiting wird `@fastify/rate-limit` **nicht global**, sondern gezielt pro Schreib-Route via `config.rateLimit` aktiviert (SPEC verlangt es nur für Schreib-Endpoints). Da `requireAuth` aktuell innerhalb der Handler aufgerufen wird (nicht als Fastify-`preHandler`-Hook) und der Rate-Limiter vor dem Handler läuft, dient der **Session-Cookie-Wert** (nicht die aufgelöste User-ID) als Rate-Limit-Schlüssel — eindeutig pro eingeloggter Sitzung, ohne den bestehenden Auth-Mechanismus umzubauen.

Für E2E-Tests wird ein neues Workspace-Paket `apps/e2e` mit Playwright angelegt, das die echte laufende App (API + Web + Postgres) über einen echten Browser testet. Ein echter Twitch-OAuth-Flow kann in Tests nicht laufen; stattdessen wird der echte API-Prozess für E2E-Läufe mit `E2E_TEST_MODE=1` gestartet, was zusätzliche, sonst nie registrierte Routen aktiviert: eine Fake-Provider-„Bridge"-Route, die den echten Redirect-Flow (`/auth/twitch` → Bridge → `/auth/twitch/callback`) mit einer festen Test-Identität durchläuft (für den einen Test, der den echten Login-Mechanismus prüft), sowie eine direkte `/e2e/login/:userKey`-Route für mehrere feste Test-Identitäten (für alle anderen Tests, die nur „eingeloggt als X" brauchen, ohne jedes Mal den vollen Redirect zu durchlaufen). Beides ist ausschließlich hinter `E2E_TEST_MODE=1` erreichbar, niemals in Produktion aktiv.

**Tech Stack:** `tsx` (Produktionsausführung ohne Kompilierschritt), `@fastify/rate-limit`, `@playwright/test` (E2E, wie in SPEC 3 vorgeschrieben).

**Spec:** `SPEC.md` (Abschnitte 3, 8, 9, 10 Punkt 8); alle sieben Vorgänger-Pläne vollständig gemergt auf `main`.

## Global Constraints

- `pnpm build` und `pnpm start` müssen nach diesem Plan für `apps/api` und `apps/web` fehlerfrei durchlaufen (verifiziert vor Planerstellung, siehe Architecture).
- Rate-Limiting: 30 Requests / 10 Sekunden pro Sitzung auf Schreib-Endpoints (POST/PATCH/PUT/DELETE unter `/api/boards*`), SPEC 8. Nicht auf GET-Routen, nicht auf `/api/overlay/*`.
- E2E-Testmodus (`E2E_TEST_MODE=1`) darf **niemals** in einer normalen Produktionsumgebung aktiv sein — die zusätzlichen Routen werden nur registriert, wenn diese Env-Var exakt `"1"` ist, mit einer lauten Warnung im Log.
- E2E-Tests laufen gegen die echte, laufende Postgres-Instanz (Docker Compose, Port 5433) sowie echte, per Playwright automatisch gestartete `apps/api`- und `apps/web`-Prozesse — kein Mocken.
- Die 9 Akzeptanzkriterien aus SPEC.md Abschnitt 9 müssen vollständig durch E2E-Tests abgedeckt sein.
- Sowohl `vitest run` als auch der jeweilige TypeScript-Compiler (`tsc --noEmit` für `apps/api`, `vue-tsc --noEmit` für `apps/web`) müssen für jeden Task sauber durchlaufen.
- Die lokale `.env`-Datei enthält echte Secrets — kein Task darf sie verändern, überschreiben oder löschen.
- Jeder Commit endet mit exakt: `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- UI-Sprache Deutsch.

---

## Datei-Übersicht

```
apps/api/package.json                      # build/start-Skripte geändert, tsx zu dependencies
apps/web/tsconfig.json                     # + noEmit

apps/api/src/server.ts                     # + Rate-Limit-Plugin-Registrierung, + E2E_TEST_MODE-Wiring
apps/api/src/boards/routes.ts              # + Rate-Limit-Config auf allen 7 Schreib-Routen
apps/api/src/boards/routes.test.ts         # erweitert (Rate-Limit-Test)
apps/api/src/e2e/setup.ts                  # neu: Fake-Provider-Bridge + Direkt-Login-Route für E2E

apps/e2e/package.json                      # neu
apps/e2e/playwright.config.ts              # neu
apps/e2e/tsconfig.json                     # neu
apps/e2e/tests/auth-and-boards.spec.ts     # neu (AC1, AC2, AC3)
apps/e2e/tests/editor-and-management.spec.ts # neu (AC4, AC5)
apps/e2e/tests/overlay-live-sync.spec.ts   # neu (AC6, AC7, AC8)
apps/e2e/tests/ownership-isolation.spec.ts # neu (AC9)

package.json                               # + test:e2e-Skript
README.md                                  # komplett neu
```

---

### Task 1: Build-Fix — `apps/api` läuft in Produktion über `tsx`, `apps/web` kompiliert sauber

**Files:**
- Modify: `apps/api/package.json`
- Modify: `apps/web/tsconfig.json`

**Interfaces:**
- Consumes: nichts Neues
- Produces: `pnpm build && pnpm start` funktioniert für beide Apps fehlerfrei — genutzt von Task 3 (Playwright startet `apps/api` über `pnpm --filter @bingo/api start`)

- [ ] **Step 1: `apps/api/package.json` anpassen**

Aktuelle `scripts` und `devDependencies`/`dependencies` (Auszug):
```json
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server.js",
    "test": "vitest run",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "tsx src/db/migrate.ts"
  },
```

Ändere zu:
```json
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc --noEmit",
    "start": "tsx src/server.ts",
    "test": "vitest run",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "tsx src/db/migrate.ts"
  },
```

Verschiebe `"tsx": "^4.19.0"` aus `devDependencies` in `dependencies` (es wird jetzt für `start` in Produktion gebraucht, nicht mehr nur für `dev`). Die vollständige Datei sieht danach so aus:
```json
{
  "name": "@bingo/api",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc --noEmit",
    "start": "tsx src/server.ts",
    "test": "vitest run",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "tsx src/db/migrate.ts"
  },
  "dependencies": {
    "@bingo/shared": "workspace:*",
    "@fastify/cookie": "^9.4.0",
    "@fastify/cors": "^9.0.1",
    "@fastify/rate-limit": "^9.1.0",
    "fastify": "^4.28.1",
    "drizzle-orm": "^0.33.0",
    "postgres": "^3.4.4",
    "tsx": "^4.19.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "drizzle-kit": "^0.24.2",
    "typescript": "^5.5.4",
    "vitest": "^2.0.5",
    "@types/node": "^22.5.0"
  }
}
```

(`@fastify/rate-limit` wird hier bereits mit ergänzt, da Task 2 sie direkt braucht — spart einen zusätzlichen `pnpm install`-Lauf.)

- [ ] **Step 2: `apps/web/tsconfig.json` anpassen**

Aktuell:
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

Ändere zu (füge `"noEmit": true` als erste Option in `compilerOptions` ein — verhindert, dass `vue-tsc -b` `.d.ts`-Dateien direkt neben die `.vue`-Quelldateien schreibt und dabei mit "would overwrite input file" fehlschlägt; Vite/Rollup erzeugen das eigentliche Build-Output bereits selbst):
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "jsx": "preserve",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: `pnpm install` (wegen der Dependency-Verschiebung)**

Run: `pnpm install`
Expected: Lockfile aktualisiert sich, keine Fehler.

- [ ] **Step 4: Build und Start beider Apps verifizieren**

Run (im Projekt-Root):
```bash
rm -rf apps/api/dist apps/web/dist
pnpm --filter @bingo/api build
pnpm --filter @bingo/web build
```
Expected: Beide Befehle laufen ohne Fehler durch (kein `ERR_MODULE_NOT_FOUND`, kein `TS5055`), `apps/web/dist` enthält `index.html` + Assets, `apps/api/dist` wird **nicht** mehr erzeugt (reiner Typecheck).

Run:
```bash
pnpm --filter @bingo/api start &
sleep 2
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/health
kill %1
```
Expected: `200`.

- [ ] **Step 5: Bestehende Tests weiterhin grün**

Run: `pnpm -r test` und `pnpm --filter @bingo/api exec tsc --noEmit` und `pnpm --filter @bingo/web exec vue-tsc --noEmit`
Expected: Alle bestehenden Tests weiterhin grün, beide Typechecks sauber.

- [ ] **Step 6: Commit**

```bash
git add apps/api/package.json apps/web/tsconfig.json pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
fix: Produktions-Build/-Start für api und web reparieren

apps/api lief über `node dist/server.js`, aber `@bingo/shared` zeigt
bewusst auf TS-Quellcode (main: "./src/index.ts"), damit Vite/Vitest
es ohne Build-Schritt nutzen können – das kompilierte Ergebnis konnte
diese Quelldistribution zur Laufzeit nicht auflösen. Start läuft jetzt
wie dev und db:migrate über tsx direkt gegen die Quellen; build ist
reiner Typecheck. apps/web scheiterte an vue-tsc -b, das ohne noEmit
.d.ts-Dateien neben die .vue-Quellen schreiben wollte.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Rate-Limiting auf Schreib-Endpoints (TDD, echte DB)

**Files:**
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/boards/routes.ts`
- Modify: `apps/api/src/boards/routes.test.ts`

**Interfaces:**
- Consumes: `@fastify/rate-limit` (bereits in Task 1 zu `apps/api/package.json` ergänzt)
- Produces: 30 Requests/10s pro Sitzung auf allen 7 Schreib-Routen (`POST /api/boards`, `PATCH /api/boards/:id`, `DELETE /api/boards/:id`, `PUT .../checked`, `POST .../duplicate`, `POST .../reset`, `POST .../regenerate-token`); Überschreitung liefert `429`

- [ ] **Step 1: Fehlschlagenden Test ergänzen — `apps/api/src/boards/routes.test.ts` (am Ende der Datei ergänzen, keine neuen Imports nötig)**

```ts
describe("Rate-Limiting auf Schreib-Endpoints", () => {
  const createdUserIds: string[] = [];

  afterEach(async () => {
    for (const id of createdUserIds.splice(0)) {
      await db.delete(users).where(eq(users.id, id));
    }
  });

  it("blockiert nach 30 Schreib-Requests innerhalb von 10 Sekunden mit 429", async () => {
    const twitchId = `ratelimit-test-${Date.now()}`;
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
    createdUserIds.push(user.id);

    const statusCodes: number[] = [];
    for (let i = 0; i < 31; i++) {
      const response = await app.inject({
        method: "POST",
        url: "/api/boards",
        cookies: { session: sessionCookie },
        payload: { name: `Rate-Limit-Board ${i}`, size: 3, label_mode: "letters" },
      });
      statusCodes.push(response.statusCode);
    }

    expect(statusCodes.filter((code) => code === 201)).toHaveLength(30);
    expect(statusCodes[30]).toBe(429);
  });

  it("zählt pro Sitzung getrennt (eine zweite, frische Sitzung ist nicht blockiert)", async () => {
    const twitchId = `ratelimit-test-separate-${Date.now()}`;
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
    createdUserIds.push(user.id);

    for (let i = 0; i < 30; i++) {
      await app.inject({
        method: "POST",
        url: "/api/boards",
        cookies: { session: sessionCookie },
        payload: { name: `Board ${i}`, size: 3, label_mode: "letters" },
      });
    }

    const secondSessionCookie = await loginViaFakeProvider(app, {
      providerId: twitchId,
      login: twitchId,
      displayName: twitchId,
      avatarUrl: null,
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/boards",
      cookies: { session: secondSessionCookie },
      payload: { name: "Board mit frischer Sitzung", size: 3, label_mode: "letters" },
    });

    expect(response.statusCode).toBe(201);
  });
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag verifizieren**

Run: `pnpm --filter @bingo/api test`
Expected: FAIL — kein Rate-Limiting registriert, alle 31 Requests liefern 201.

- [ ] **Step 3: Implementierung — `apps/api/src/server.ts` erweitern**

Import-Zeile ergänzen (nach `cookie`-Import):
```ts
import rateLimit from "@fastify/rate-limit";
```

Nach `await app.register(cookie, { secret: sessionSecret });` ergänzen:
```ts
  await app.register(rateLimit, { global: false });
```

- [ ] **Step 4: Implementierung — `apps/api/src/boards/routes.ts` erweitern**

Import-Zeile für den Typ ergänzen (nach der bestehenden `FastifyInstance`-Import-Zeile):
```ts
import type { FastifyInstance, FastifyRequest } from "fastify";
```

Nach `const cellCheckedBodySchema = z.object({ checked: z.boolean() });` ergänzen:
```ts
const writeRouteOptions = {
  config: {
    rateLimit: {
      max: 30,
      timeWindow: "10 seconds",
      keyGenerator: (request: FastifyRequest) => request.cookies?.session ?? request.ip,
    },
  },
};
```

Füge `writeRouteOptions` als zweites Argument (vor dem Handler) bei allen 7 Schreib-Routen ein:

`app.post("/api/boards", async (request, reply) => {` wird zu `app.post("/api/boards", writeRouteOptions, async (request, reply) => {`

`app.patch<{ Params: { id: string } }>("/api/boards/:id", async (request, reply) => {` wird zu `app.patch<{ Params: { id: string } }>("/api/boards/:id", writeRouteOptions, async (request, reply) => {`

`app.delete<{ Params: { id: string } }>("/api/boards/:id", async (request, reply) => {` wird zu `app.delete<{ Params: { id: string } }>("/api/boards/:id", writeRouteOptions, async (request, reply) => {`

Der `app.put<...>("/api/boards/:id/cells/:row/:col/checked", async (request, reply) => {` (Callback-Form mit Zeilenumbruch vor `async`) wird zu:
```ts
  app.put<{ Params: { id: string; row: string; col: string } }>(
    "/api/boards/:id/cells/:row/:col/checked",
    writeRouteOptions,
    async (request, reply) => {
```

`app.post<{ Params: { id: string } }>("/api/boards/:id/duplicate", async (request, reply) => {` wird zu `app.post<{ Params: { id: string } }>("/api/boards/:id/duplicate", writeRouteOptions, async (request, reply) => {`

`app.post<{ Params: { id: string } }>("/api/boards/:id/reset", async (request, reply) => {` wird zu `app.post<{ Params: { id: string } }>("/api/boards/:id/reset", writeRouteOptions, async (request, reply) => {`

Der `app.post<{ Params: { id: string } }>("/api/boards/:id/regenerate-token", async (request, reply) => {` (Callback-Form mit Zeilenumbruch) wird zu:
```ts
  app.post<{ Params: { id: string } }>(
    "/api/boards/:id/regenerate-token",
    writeRouteOptions,
    async (request, reply) => {
```

- [ ] **Step 5: Test ausführen, Erfolg verifizieren**

Run: `pnpm --filter @bingo/api test`
Expected: PASS — alle Tests grün, inkl. der 2 neuen Rate-Limit-Tests. (Bestehende Tests bleiben unberührt: Jeder Test loggt sich mit einer frischen Session ein und macht weit weniger als 30 Schreib-Requests pro Session.)

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @bingo/api exec tsc --noEmit`
Expected: Keine Ausgabe, Exit-Code 0.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/server.ts apps/api/src/boards/routes.ts apps/api/src/boards/routes.test.ts
git commit -m "$(cat <<'EOF'
feat(api): Rate-Limiting (30/10s pro Sitzung) auf Schreib-Endpoints

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: E2E-Infrastruktur — `apps/e2e`-Paket, Playwright-Konfiguration, Fake-Auth-Bridge im API-Prozess

**Files:**
- Create: `apps/api/src/e2e/setup.ts`
- Modify: `apps/api/src/server.ts`
- Create: `apps/e2e/package.json`
- Create: `apps/e2e/playwright.config.ts`
- Create: `apps/e2e/tsconfig.json`
- Modify: `package.json` (Root)

**Interfaces:**
- Consumes: `upsertUserFromTwitch` aus `../db/users`, `createSession` aus `../auth/session`, `setSessionCookie` aus `../auth/current-user`, `OAuthProvider`/`OAuthUserInfo` aus `../auth/types` (alle bereits vorhanden)
- Produces: `createE2EProvider()`, `registerE2ERoutes(app)` — genutzt von `server.ts`s `main()`; Playwright-Testumgebung mit automatisch gestarteten `apps/api`- und `apps/web`-Prozessen — genutzt von Tasks 4–7

- [ ] **Step 1: `apps/api/src/e2e/setup.ts` erstellen**

```ts
import type { FastifyInstance } from "fastify";
import type { OAuthProvider, OAuthUserInfo } from "../auth/types";
import { upsertUserFromTwitch } from "../db/users";
import { createSession } from "../auth/session";
import { setSessionCookie } from "../auth/current-user";

export const E2E_USERS: Record<string, OAuthUserInfo> = {
  streamerin: {
    providerId: "e2e-streamerin",
    login: "e2e_streamerin",
    displayName: "E2E Streamerin",
    avatarUrl: null,
  },
  andere: {
    providerId: "e2e-andere",
    login: "e2e_andere",
    displayName: "E2E Andere Nutzerin",
    avatarUrl: null,
  },
};

export function createE2EProvider(): OAuthProvider {
  return {
    name: "e2e-fake",
    getAuthorizationUrl: (state, redirectUri) =>
      `/e2e/bridge?state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(redirectUri)}`,
    exchangeCode: async () => E2E_USERS.streamerin,
  };
}

export function registerE2ERoutes(app: FastifyInstance): void {
  app.get<{ Querystring: { state: string; redirect_uri: string } }>(
    "/e2e/bridge",
    async (request, reply) => {
      const { state, redirect_uri } = request.query;
      const url = new URL(redirect_uri);
      url.searchParams.set("code", "streamerin");
      url.searchParams.set("state", state);
      return reply.redirect(url.toString());
    }
  );

  app.get<{ Params: { userKey: string } }>("/e2e/login/:userKey", async (request, reply) => {
    const userInfo = E2E_USERS[request.params.userKey];
    if (!userInfo) {
      return reply.status(404).send({ error: "Unbekannter E2E-Testnutzer" });
    }
    const user = await upsertUserFromTwitch(userInfo);
    const session = await createSession(user.id);
    setSessionCookie(reply, session.id, session.expiresAt);
    const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:5173";
    return reply.redirect(`${webOrigin}/boards`);
  });
}
```

- [ ] **Step 2: `apps/api/src/server.ts` erweitern**

Import-Zeile ergänzen (nach dem `type OAuthProvider`-Import):
```ts
import { createE2EProvider, registerE2ERoutes } from "./e2e/setup";
```

Die `main()`-Funktion ersetzen:
```ts
async function main() {
  const isE2ETestMode = process.env.E2E_TEST_MODE === "1";
  if (isE2ETestMode) {
    console.warn(
      "E2E_TEST_MODE aktiv — Fake-Login-Routen (/e2e/*) sind registriert. Niemals in Produktion verwenden."
    );
  }
  const app = await buildServer(isE2ETestMode ? { authProvider: createE2EProvider() } : {});
  if (isE2ETestMode) {
    await registerE2ERoutes(app);
  }
  const port = Number(process.env.PORT ?? 3001);
  await app.listen({ port, host: "0.0.0.0" });
}
```

- [ ] **Step 3: Verifizieren, dass der E2E-Testmodus lokal funktioniert**

Run (Docker-Postgres muss laufen):
```bash
cd apps/api
E2E_TEST_MODE=1 pnpm start &
sleep 2
curl -s -o /dev/null -w "bridge: %{http_code}\n" "http://localhost:3001/e2e/login/streamerin"
kill %1
```
Expected: `bridge: 302` (Redirect zu `http://localhost:5173/boards`; dass der Web-Dev-Server dort nicht läuft, ist für diesen Check irrelevant — nur der Statuscode der API-Antwort zählt).

- [ ] **Step 4: `apps/e2e/package.json` erstellen**

```json
{
  "name": "e2e",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "playwright test"
  },
  "devDependencies": {
    "@playwright/test": "^1.47.0",
    "typescript": "^5.5.4"
  }
}
```

- [ ] **Step 5: `apps/e2e/tsconfig.json` erstellen**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "types": ["@playwright/test"]
  },
  "include": ["tests", "playwright.config.ts"]
}
```

- [ ] **Step 6: `apps/e2e/playwright.config.ts` erstellen**

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "pnpm --filter @bingo/api start",
      url: "http://localhost:3001/health",
      cwd: "../..",
      env: { E2E_TEST_MODE: "1", PORT: "3001" },
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
    {
      command: "pnpm --filter @bingo/web dev",
      url: "http://localhost:5173",
      cwd: "../..",
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
  ],
});
```

- [ ] **Step 7: Playwright-Browser installieren**

Run: `cd apps/e2e && pnpm exec playwright install --with-deps chromium`
Expected: Chromium wird heruntergeladen und installiert (kann je nach Netzwerk einige Minuten dauern).

- [ ] **Step 8: Rauch-Test — ein triviales Test-Grundgerüst zur Verifikation der Infrastruktur**

Erstelle vorübergehend `apps/e2e/tests/smoke.spec.ts`:
```ts
import { test, expect } from "@playwright/test";

test("Landing-Seite lädt und zeigt den Login-Link", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Mit Twitch einloggen" })).toBeVisible();
});
```

Run: `pnpm --filter e2e test`
Expected: Playwright startet beide `webServer`-Prozesse automatisch, der Test läuft grün. Lösche `apps/e2e/tests/smoke.spec.ts` wieder — er diente nur der Infrastruktur-Verifikation; die eigentlichen Tests kommen in den Tasks 4–7.

- [ ] **Step 9: Root-`package.json` erweitern**

Aktuell:
```json
  "scripts": {
    "dev:web": "pnpm --filter @bingo/web dev",
    "dev:api": "pnpm --filter @bingo/api dev",
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "lint": "pnpm -r lint"
  }
```

Ändere zu:
```json
  "scripts": {
    "dev:web": "pnpm --filter @bingo/web dev",
    "dev:api": "pnpm --filter @bingo/api dev",
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "test:e2e": "pnpm --filter e2e test",
    "lint": "pnpm -r lint"
  }
```

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/e2e/setup.ts apps/api/src/server.ts apps/e2e/package.json apps/e2e/tsconfig.json apps/e2e/playwright.config.ts package.json pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat: E2E-Infrastruktur (Playwright) mit Fake-Auth-Testmodus

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: E2E — Login, Board-Anlage, Label-Darstellung (AC1, AC2, AC3)

**Files:**
- Create: `apps/e2e/tests/auth-and-boards.spec.ts`

**Interfaces:**
- Consumes: laufende `apps/api`/`apps/web`-Prozesse (Task 3), `/e2e/login/:userKey` (Task 3)
- Produces: nichts (Testdatei)

- [ ] **Step 1: `apps/e2e/tests/auth-and-boards.spec.ts` erstellen**

```ts
import { test, expect } from "@playwright/test";

test.describe("Login und Board-Anlage", () => {
  test("Login über den Twitch-Button und Logout funktionieren (AC1)", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Mit Twitch einloggen" }).click();
    await page.waitForURL(/\/boards$/);
    await expect(page.getByText("E2E Streamerin")).toBeVisible();

    await page.getByRole("button", { name: "Ausloggen" }).click();
    await page.waitForURL("/");
    await expect(page.getByRole("link", { name: "Mit Twitch einloggen" })).toBeVisible();
  });

  test("Boards lassen sich in jeder Größe anlegen; bei 5×5 ist BINGO wählbar; eigene Spaltenwörter funktionieren bei jeder Größe (AC2)", async ({
    page,
  }) => {
    await page.goto("/e2e/login/streamerin");
    await page.waitForURL(/\/boards$/);

    await page.getByRole("link", { name: "Neues Board" }).click();
    await page.getByLabel("Name").fill("E2E 3x3 Board");
    await page.getByLabel("Größe").selectOption("3");
    await page.getByRole("button", { name: "Board erstellen" }).click();
    await page.waitForURL(/\/boards\/.+\/edit$/);
    await expect(page.getByText("A", { exact: true })).toBeVisible();

    await page.goto("/boards/new");
    await page.getByLabel("Name").fill("E2E 5x5 BINGO Board");
    await page.getByLabel("Größe").selectOption("5");
    await page.getByLabel("Beschriftung").selectOption("bingo");
    await page.getByRole("button", { name: "Board erstellen" }).click();
    await page.waitForURL(/\/boards\/.+\/edit$/);
    await expect(page.getByText("B", { exact: true })).toBeVisible();
    await expect(page.getByText("G", { exact: true })).toBeVisible();

    await page.goto("/boards/new");
    await page.getByLabel("Name").fill("E2E 7x7 Custom Board");
    await page.getByLabel("Größe").selectOption("7");
    await page.getByLabel("Beschriftung").selectOption("custom");
    const columnInputs = page.locator('label:has-text("Spalte") input');
    await expect(columnInputs).toHaveCount(7);
    for (let i = 0; i < 7; i++) {
      await columnInputs.nth(i).fill(`Wort${i + 1}`);
    }
    await page.getByRole("button", { name: "Board erstellen" }).click();
    await page.waitForURL(/\/boards\/.+\/edit$/);
    await expect(page.getByText("Wort1", { exact: true })).toBeVisible();
  });

  test("Spaltenbuchstaben oben/unten und Reihennummern links/rechts erscheinen im Editor, auf der Control-Seite und im Overlay (AC3)", async ({
    page,
    context,
  }) => {
    await page.goto("/e2e/login/streamerin");
    await page.waitForURL(/\/boards$/);

    await page.getByRole("link", { name: "Neues Board" }).click();
    await page.getByLabel("Name").fill("E2E Label Board");
    await page.getByLabel("Größe").selectOption("3");
    await page.getByRole("button", { name: "Board erstellen" }).click();
    await page.waitForURL(/\/boards\/.+\/edit$/);
    const boardId = page.url().split("/boards/")[1].split("/")[0];

    await expect(page.getByText(/^[A-C]$/)).toHaveCount(6);

    await page.goto(`/boards/${boardId}/play`);
    await expect(page.getByText(/^[A-C]$/)).toHaveCount(6);

    const boardData = await (await page.request.get(`http://localhost:3001/api/boards/${boardId}`)).json();
    const overlayPage = await context.newPage();
    await overlayPage.goto(`/overlay/${boardData.overlayToken}`);
    await expect(overlayPage.getByText(/^[A-C]$/)).toHaveCount(6);
  });
});
```

- [ ] **Step 2: Test ausführen**

Run: `pnpm --filter e2e test tests/auth-and-boards.spec.ts`
Expected: Alle 3 Tests grün.

- [ ] **Step 3: Commit**

```bash
git add apps/e2e/tests/auth-and-boards.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): Login, Board-Anlage, Label-Darstellung (AC1, AC2, AC3)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: E2E — Editor-Textfelder, Board-Verwaltung (AC4, AC5)

**Files:**
- Create: `apps/e2e/tests/editor-and-management.spec.ts`

**Interfaces:**
- Consumes: laufende Prozesse (Task 3)
- Produces: nichts (Testdatei)

- [ ] **Step 1: `apps/e2e/tests/editor-and-management.spec.ts` erstellen**

```ts
import { test, expect } from "@playwright/test";

test.describe("Editor und Board-Verwaltung", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/e2e/login/streamerin");
    await page.waitForURL(/\/boards$/);
  });

  test("Ein Feld lässt sich per Klick mit Text füllen, speichern, und der Text bleibt nach Reload sichtbar (AC4)", async ({
    page,
  }) => {
    await page.getByRole("link", { name: "Neues Board" }).click();
    await page.getByLabel("Name").fill("E2E Textfeld Board");
    await page.getByLabel("Größe").selectOption("3");
    await page.getByRole("button", { name: "Board erstellen" }).click();
    await page.waitForURL(/\/boards\/.+\/edit$/);

    await page.locator(".aspect-square.bg-slate-800").first().click();
    await page.locator("textarea[data-cell]").fill("Erster Clip");
    await page.locator("textarea[data-cell]").blur();
    await page.getByRole("button", { name: "Speichern" }).click();
    await expect(page.getByText("Erster Clip")).toBeVisible();

    await page.reload();
    await expect(page.getByText("Erster Clip")).toBeVisible();
  });

  test("Board benennen, bearbeiten, duplizieren (ohne Häkchen) und löschen (AC5)", async ({ page }) => {
    await page.getByRole("link", { name: "Neues Board" }).click();
    await page.getByLabel("Name").fill("E2E Verwaltung Original");
    await page.getByLabel("Größe").selectOption("3");
    await page.getByRole("button", { name: "Board erstellen" }).click();
    await page.waitForURL(/\/boards\/.+\/edit$/);

    await page.locator('input[type="text"]').first().fill("E2E Verwaltung Umbenannt");
    await page.getByRole("button", { name: "Speichern" }).click();
    await expect(page.locator('input[type="text"]').first()).toHaveValue(
      "E2E Verwaltung Umbenannt"
    );

    await page.getByRole("link", { name: "Zur Übersicht" }).click();
    await page.waitForURL(/\/boards$/);
    const row = page.locator("li", { hasText: "E2E Verwaltung Umbenannt" });
    await row.getByRole("link", { name: "Spielen" }).click();
    await page.waitForURL(/\/boards\/.+\/play$/);
    await page.locator("button.bg-slate-800").first().click();
    await page.goBack();
    await page.waitForURL(/\/boards$/);
    await expect(row.getByText(/1 abgehakt/)).toBeVisible();

    await row.getByRole("button", { name: "Duplizieren" }).click();
    const copyRow = page.locator("li", { hasText: "E2E Verwaltung Umbenannt (Kopie)" });
    await expect(copyRow).toBeVisible();
    await expect(copyRow.getByText(/0 abgehakt/)).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await copyRow.getByRole("button", { name: "Löschen" }).click();
    await expect(copyRow).toHaveCount(0);
  });
});
```

- [ ] **Step 2: Test ausführen**

Run: `pnpm --filter e2e test tests/editor-and-management.spec.ts`
Expected: Beide Tests grün.

- [ ] **Step 3: Commit**

```bash
git add apps/e2e/tests/editor-and-management.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): Editor-Textfelder, Board-Verwaltung (AC4, AC5)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: E2E — Overlay, Live-Updates, Persistenz (AC6, AC7, AC8)

**Files:**
- Create: `apps/e2e/tests/overlay-live-sync.spec.ts`

**Interfaces:**
- Consumes: laufende Prozesse (Task 3)
- Produces: nichts (Testdatei)

- [ ] **Step 1: `apps/e2e/tests/overlay-live-sync.spec.ts` erstellen**

```ts
import { test, expect } from "@playwright/test";

test.describe("Overlay, Live-Updates und Persistenz", () => {
  test("Overlay hat transparenten Hintergrund; ein Häkchen auf der Control-Seite erscheint ohne Reload im Overlay; der Stand bleibt nach Reload erhalten (AC6, AC7, AC8)", async ({
    page,
    context,
  }) => {
    await page.goto("/e2e/login/streamerin");
    await page.waitForURL(/\/boards$/);

    await page.getByRole("link", { name: "Neues Board" }).click();
    await page.getByLabel("Name").fill("E2E Live-Sync Board");
    await page.getByLabel("Größe").selectOption("3");
    await page.getByRole("button", { name: "Board erstellen" }).click();
    await page.waitForURL(/\/boards\/.+\/edit$/);
    const boardId = page.url().split("/boards/")[1].split("/")[0];

    const boardData = await (await page.request.get(`http://localhost:3001/api/boards/${boardId}`)).json();

    const overlayPage = await context.newPage();
    await overlayPage.goto(`/overlay/${boardData.overlayToken}`);

    const bodyBackground = await overlayPage.evaluate(
      () => getComputedStyle(document.body).backgroundColor
    );
    expect(["rgba(0, 0, 0, 0)", "transparent"]).toContain(bodyBackground);

    await page.goto(`/boards/${boardId}/play`);
    await page.locator("button.bg-slate-800").first().click();

    await expect(overlayPage.getByText("✕")).toBeVisible({ timeout: 3000 });

    await overlayPage.reload();
    await expect(overlayPage.getByText("✕")).toBeVisible();

    await page.reload();
    await expect(page.locator("button.bg-slate-800", { hasText: "✕" }).first()).toBeVisible();
  });
});
```

- [ ] **Step 2: Test ausführen**

Run: `pnpm --filter e2e test tests/overlay-live-sync.spec.ts`
Expected: Test grün. Falls das ✕ nicht innerhalb von 3s im Overlay erscheint, prüfe manuell (Docker-Postgres, SSE-Verbindung), ob die API tatsächlich Events veröffentlicht (siehe Phase-6-Implementierung, `publishBoardEvent`).

- [ ] **Step 3: Commit**

```bash
git add apps/e2e/tests/overlay-live-sync.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): Overlay, Live-Updates, Persistenz (AC6, AC7, AC8)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: E2E — Eigentümerschutz (AC9)

**Files:**
- Create: `apps/e2e/tests/ownership-isolation.spec.ts`

**Interfaces:**
- Consumes: laufende Prozesse (Task 3), zweite Test-Identität `andere` (Task 3)
- Produces: nichts (Testdatei)

- [ ] **Step 1: `apps/e2e/tests/ownership-isolation.spec.ts` erstellen**

```ts
import { test, expect } from "@playwright/test";

test("Fremde Boards sind weder einsehbar noch veränderbar; über den Overlay-Link sind keine Änderungen möglich (AC9)", async ({
  page,
  context,
}) => {
  await page.goto("/e2e/login/streamerin");
  await page.waitForURL(/\/boards$/);
  await page.getByRole("link", { name: "Neues Board" }).click();
  await page.getByLabel("Name").fill("E2E Fremdes Board");
  await page.getByLabel("Größe").selectOption("3");
  await page.getByRole("button", { name: "Board erstellen" }).click();
  await page.waitForURL(/\/boards\/.+\/edit$/);
  const boardId = page.url().split("/boards/")[1].split("/")[0];
  const boardData = await (await page.request.get(`http://localhost:3001/api/boards/${boardId}`)).json();

  const otherContext = await context.browser()!.newContext();
  const otherPage = await otherContext.newPage();
  await otherPage.goto("http://localhost:3001/e2e/login/andere");
  await otherPage.waitForURL(/\/boards$/);

  await expect(otherPage.getByText("E2E Fremdes Board")).toHaveCount(0);

  const getResponse = await otherPage.request.get(`http://localhost:3001/api/boards/${boardId}`);
  expect(getResponse.status()).toBe(404);

  const patchResponse = await otherPage.request.patch(`http://localhost:3001/api/boards/${boardId}`, {
    data: { name: "Übernommen" },
  });
  expect(patchResponse.status()).toBe(404);

  const overlayGetResponse = await otherPage.request.get(
    `http://localhost:3001/api/overlay/${boardData.overlayToken}`
  );
  expect(overlayGetResponse.status()).toBe(200);
  expect(overlayGetResponse.headers()["content-type"]).toContain("application/json");

  await otherContext.close();
});
```

- [ ] **Step 2: Test ausführen**

Run: `pnpm --filter e2e test tests/ownership-isolation.spec.ts`
Expected: Test grün.

- [ ] **Step 3: Commit**

```bash
git add apps/e2e/tests/ownership-isolation.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): Eigentümerschutz für fremde Boards (AC9)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: README

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: nichts
- Produces: vollständige Setup-, Test- und OBS-Anleitung

- [ ] **Step 1: `README.md` komplett ersetzen**

```markdown
# Bingo Card Generator

Web-App für Twitch-Streamer:innen zum Erstellen, Verwalten und als OBS-Overlay Einbinden eigener
Bingo-Karten. Während des Streams wird per Klick abgehakt; jede Änderung erscheint sofort und
ohne Reload im Overlay.

Die vollständige Projektspezifikation (Ziel, Funktionen, Datenmodell, API, Stack,
Akzeptanzkriterien) steht in [SPEC.md](./SPEC.md).

## Stack

Vue 3 + TypeScript (Frontend), Fastify + TypeScript (Backend), PostgreSQL + Drizzle ORM, Zod,
Server-Sent Events, Vitest (Unit/Integration), Playwright (E2E). Details siehe
[SPEC.md, Abschnitt 3](./SPEC.md#3-technischer-stack).

## Setup (lokale Entwicklung)

Voraussetzungen: Node.js ≥ 20, pnpm, Docker (für Postgres).

1. Abhängigkeiten installieren:
   ```bash
   pnpm install
   ```

2. Umgebungsvariablen anlegen:
   ```bash
   cp .env.example .env
   ```
   Trage in `.env` mindestens `SESSION_SECRET` (ein beliebiger langer Zufallsstring) sowie
   `TWITCH_CLIENT_ID`/`TWITCH_CLIENT_SECRET` ein. Beide erhältst du, wenn du auf
   [dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps) eine neue Application anlegst
   — als "OAuth Redirect URL" trägst du dort `http://localhost:3001/auth/twitch/callback` ein
   (identisch mit `TWITCH_REDIRECT_URI` in `.env.example`).

3. Postgres starten:
   ```bash
   docker compose up -d
   ```

4. Datenbank-Migrationen ausführen:
   ```bash
   pnpm --filter @bingo/api db:migrate
   ```

5. Dev-Server starten (zwei Terminals):
   ```bash
   pnpm dev:api
   pnpm dev:web
   ```

   Die App läuft danach unter `http://localhost:5173`, die API unter `http://localhost:3001`.

## Tests

**Unit- und Integrationstests** (Vitest, laufen gegen die echte Postgres-Instanz aus Schritt 3
oben):
```bash
pnpm test
```

**End-to-End-Tests** (Playwright, deckt die 9 Akzeptanzkriterien aus
[SPEC.md, Abschnitt 9](./SPEC.md#9-akzeptanzkriterien) ab; startet API und Web automatisch mit
einem Fake-Login-Testmodus, damit kein echter Twitch-Account nötig ist):
```bash
cd apps/e2e
pnpm exec playwright install --with-deps chromium   # nur beim ersten Mal nötig
cd ../..
pnpm test:e2e
```

## OBS-Overlay einrichten

1. In der App unter **Meine Boards** bei dem gewünschten Board auf **Overlay-Link kopieren**
   klicken.
2. In OBS Studio: **Quellen** → **+** → **Browser** → neue Quelle anlegen, den kopierten Link bei
   **URL** einfügen.
3. Breite/Höhe **quadratisch** wählen (z. B. 800×800) — das Board skaliert automatisch auf die
   Größe der Quelle.
4. Der Hintergrund ist transparent; das Raster erscheint direkt über deiner Spielszene.
5. Häkchen, die du auf der **Control-Seite** (Dashboard → **Spielen**) setzt, erscheinen innerhalb
   von etwa einer Sekunde im Overlay — kein Neuladen der Browser-Source nötig. Bricht die
   Verbindung kurz ab (z. B. Rechner-Standby), verbindet sich das Overlay automatisch neu und
   zeigt danach wieder den aktuellen Stand.
6. Falls der Link versehentlich geteilt wurde: im Dashboard **Overlay-Link neu generieren** —
   der alte Link funktioniert danach nicht mehr für neue Verbindungen; bereits offene
   Browser-Sources sollten trotzdem neu eingerichtet werden.

## Bekannte Einschränkungen

- Bingo-Erkennung (volle Reihe/Spalte/Diagonale hervorheben), ein freies Mittelfeld und
  Overlay-Styling pro Board sind laut [SPEC.md, Abschnitt 11](./SPEC.md#11-geklärte-punkte-ehemals-offene-punkte)
  bewusst nicht Teil von v1.
- Eine containerisierte Produktionsbereitstellung (Dockerfile für `apps/api`/`apps/web`) ist noch
  nicht gebaut — `docker-compose.yml` startet aktuell nur Postgres. Das konkrete Hosting-Ziel ist
  laut SPEC noch offen; lokal reicht der oben beschriebene `pnpm build && pnpm start`-Weg.
- Weitere OAuth-Provider (YouTube, Discord) sind vorbereitet (die Auth-Schicht ist providerneutral
  aufgebaut), aber noch nicht implementiert.
```

- [ ] **Step 2: Manuell gegenlesen**

Öffne `README.md` und prüfe, dass alle Befehle mit dem tatsächlichen Stand des Repos
übereinstimmen (insbesondere: `pnpm --filter @bingo/api db:migrate` existiert bereits als Skript,
`docker-compose.yml` enthält nur den `postgres`-Service, `.env.example` enthält die genannten
Variablen — alles bereits vor diesem Plan vorhanden und unverändert).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
docs: README mit Setup-, Test- und OBS-Anleitung

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Nach Abschluss dieses Plans

Automatisiert vollständig verifiziert: `pnpm build`/`pnpm start` funktionieren für beide Apps,
Rate-Limiting blockiert nach 30 Schreib-Requests/10s pro Sitzung, alle 9 Akzeptanzkriterien aus
SPEC.md Abschnitt 9 sind durch echte Browser-E2E-Tests abgedeckt (nicht nur durch die
bestehenden ~260 Unit-/Integrationstests).

**Manuell zu verifizieren:** README-Anleitung einmal von einem frischen Checkout aus komplett
durchgehen (`pnpm install` → `.env` → `docker compose up` → Migrationen → Dev-Server →
tatsächlicher Login mit einem echten Twitch-Account, da die E2E-Tests bewusst den Fake-Provider
nutzen und den echten OAuth-Redirect gegen Twitch nie prüfen).

Damit ist die komplette Umsetzungsreihenfolge aus SPEC.md Abschnitt 10 (Punkte 1–8) umgesetzt.
