# Twitch-Login & Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Twitch-OAuth-Login (Authorization Code Flow) mit serverseitigen Sessions bauen: Login-Link → Twitch-Consent → Callback legt/aktualisiert User an, setzt eine HttpOnly-Session-Cookie → `/api/me` liefert den eingeloggten User → geschützte `/boards`-Platzhalterseite beweist den vollständigen Roundtrip → `/auth/logout` beendet die Session.

**Architecture:** Die Twitch-Anbindung ist hinter einem `OAuthProvider`-Interface gekapselt (SPEC 2.1: spätere Provider wie YouTube/Discord sollen andocken können), sodass Routen- und Session-Logik den Provider nur über diese Schnittstelle ansprechen und in Tests durch einen Fake-Provider ersetzbar sind. Sessions sind zufällige, serverseitig gespeicherte Tokens (kein JWT) in der bereits existierenden `sessions`-Tabelle; die Session-ID wird als signiertes, HttpOnly-Cookie übertragen. `users`/`sessions`-Tabellen existieren bereits aus Phase 1 — diese Phase braucht keine neue Migration.

**Tech Stack:** Fastify-Plugins `@fastify/cookie` (signierte Cookies), `@fastify/cors` (Credentials für die getrennte Frontend-Origin), natives `fetch` für Twitch-HTTP-Aufrufe, Drizzle ORM gegen die bestehenden Tabellen, Pinia-Store im Frontend, Vue-Router-Guard.

**Spec:** `SPEC.md` (Abschnitte 2.1 „Login", 5 „API" Auth-Routen, 6 „Frontend-Routen", 8 „Sicherheit"); Vorgänger-Plan `docs/superpowers/plans/2026-09-24-foundation-monorepo.md` (Datenmodell/Grundgerüst, bereits umgesetzt)

## Global Constraints

- Login ausschließlich per Twitch OAuth (Authorization Code Flow, serverseitig); kein Token im LocalStorage (SPEC 2.1).
- Sessions per HttpOnly-, SameSite=Lax-Cookie; `Secure`-Flag nur wenn `NODE_ENV=production` (lokale Entwicklung läuft über `http://localhost`, ein strikt "Secure"-Cookie würde dort vom Browser verworfen — bewusste, dokumentierte Abweichung von der wörtlichen SPEC-Formulierung für die Dev-Umgebung).
- OAuth `state`-Parameter gegen CSRF prüfen (SPEC 8).
- Auth-Logik hinter einem Provider-Interface kapseln, damit spätere Provider ergänzt werden können (SPEC 2.1).
- Twitch Client-ID/Secret, Session-Secret, DB-URL ausschließlich über Umgebungsvariablen (SPEC 8) — niemals hart codiert.
- **Die lokale `.env`-Datei enthält bereits echte, vom Nutzer eingetragene Twitch-Credentials. Kein Task darf `.env` löschen, überschreiben oder inhaltlich verändern — nur lesen.**
- Alle Datenbank-Tests laufen gegen die echte, laufende Postgres-Instanz aus Phase 1 (Docker Compose, Port 5433) — kein Mocken der eigenen DB-Logik. Twitch selbst wird nie aus einem automatisierten Test heraus wirklich kontaktiert — Provider-Aufrufe werden über eine injizierbare `fetch`-Implementierung bzw. einen Fake-`OAuthProvider` gestubbt.
- Kein `"packageManager"`-Feld irgendwo im Repo (siehe Phase-1-Ruling).
- Jeder Commit endet mit exakt: `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- UI-Sprache Deutsch.

---

## Datei-Übersicht

```
apps/api/src/env.ts                       # Lädt Root-.env via process.loadEnvFile(), falls vorhanden
apps/api/src/env.test.ts
apps/api/src/auth/types.ts                # OAuthProvider- und OAuthUserInfo-Interfaces
apps/api/src/auth/twitch.ts               # Twitch-Implementierung von OAuthProvider
apps/api/src/auth/twitch.test.ts
apps/api/src/auth/session.ts              # createSession / getUserBySessionId / deleteSession
apps/api/src/auth/session.test.ts
apps/api/src/auth/current-user.ts         # Session-Cookie-Helfer + getCurrentUser(request)
apps/api/src/auth/routes.ts               # /auth/twitch, /auth/twitch/callback, /auth/logout, /api/me
apps/api/src/auth/routes.test.ts
apps/api/src/db/users.ts                  # upsertUserFromTwitch()
apps/api/src/db/users.test.ts
apps/api/src/server.ts                    # erweitert: env-Import, CORS/Cookie-Plugins, Auth-Routen
apps/api/src/server.test.ts               # erweitert: await buildServer(), CORS-Test
apps/api/src/db/client.ts                 # erweitert: env-Import
apps/api/src/db/migrate.ts                # erweitert: env-Import
apps/api/package.json                     # + @fastify/cookie, @fastify/cors

apps/web/src/env.d.ts                     # ImportMetaEnv-Typisierung für VITE_API_BASE_URL
apps/web/src/stores/auth.ts               # Pinia-Store: user, fetchMe, logout, loginUrl
apps/web/src/stores/auth.test.ts
apps/web/src/router/index.ts              # erweitert: /boards-Route + requireAuthGuard
apps/web/src/router/index.test.ts
apps/web/src/views/HomeView.vue           # erweitert: Twitch-Login-Link
apps/web/src/views/HomeView.test.ts       # ersetzt apps/web/src/App.test.ts (umbenannt, korrekter Name)
apps/web/src/views/BoardsView.vue         # neu: geschützte Platzhalter-Dashboard-Seite
apps/web/src/views/BoardsView.test.ts
apps/web/vite.config.ts                   # erweitert: envDir zeigt auf Repo-Root

.env.example                               # + WEB_ORIGIN, VITE_API_BASE_URL
```

---

### Task 1: `apps/api` – Zentrales `.env`-Laden

**Files:**
- Create: `apps/api/src/env.ts`
- Create: `apps/api/src/env.test.ts`
- Modify: `apps/api/src/db/client.ts`
- Modify: `apps/api/src/db/migrate.ts`

**Interfaces:**
- Consumes: nichts Neues
- Produces: Seiteneffekt (lädt Root-`.env` in `process.env`, sofern noch nicht vorhanden) — importiert als allererste Zeile von `client.ts`, `migrate.ts` und (Task 5) `server.ts`, sodass `pnpm dev:api`/`pnpm test`/`pnpm db:migrate` ohne manuelles `source .env` funktionieren

- [ ] **Step 1: `apps/api/src/env.ts` anlegen**

```ts
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const envPath = fileURLToPath(new URL("../../../.env", import.meta.url));

if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}
```

- [ ] **Step 2: `apps/api/src/db/client.ts` erweitern (Import ganz oben ergänzen)**

```ts
import "../env";
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

- [ ] **Step 3: `apps/api/src/db/migrate.ts` erweitern (Import ganz oben ergänzen)**

```ts
import "../env";
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

- [ ] **Step 4: Test schreiben — `apps/api/src/env.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import "./env";

describe("env-Laden", () => {
  it("hat DATABASE_URL aus der Root-.env-Datei geladen", () => {
    expect(process.env.DATABASE_URL).toBeTruthy();
  });
});
```

- [ ] **Step 5: Test ausführen**

Run: `pnpm --filter @bingo/api test`
Expected: PASS (nutzt die bereits vorhandene, unveränderte `.env` aus Phase 1 — diese Datei wird nur gelesen, nicht verändert).

- [ ] **Step 6: Zusätzlich verifizieren, dass wirklich von Platte geladen wird (nicht nur eine bereits gesetzte Shell-Variable gelesen wird)**

Run: `env -u DATABASE_URL -u PORT -u TWITCH_CLIENT_ID -u TWITCH_CLIENT_SECRET -u TWITCH_REDIRECT_URI -u SESSION_SECRET -u WEB_ORIGIN pnpm --filter @bingo/api exec tsx -e "import('./src/env.ts').then(() => console.log('DATABASE_URL geladen:', Boolean(process.env.DATABASE_URL)))"`
Expected: Ausgabe `DATABASE_URL geladen: true`, obwohl die übergeordnete Shell-Umgebung diese Variablen nicht gesetzt hatte (`env -u` entfernt sie nur für den Kindprozess, die echte `.env`-Datei bleibt unangetastet).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/env.ts apps/api/src/env.test.ts apps/api/src/db/client.ts apps/api/src/db/migrate.ts
git commit -m "$(cat <<'EOF'
feat(api): .env automatisch laden statt manuellem source

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `apps/api` – Twitch-OAuth-Provider (TDD)

**Files:**
- Create: `apps/api/src/auth/types.ts`
- Create: `apps/api/src/auth/twitch.test.ts`
- Create: `apps/api/src/auth/twitch.ts`

**Interfaces:**
- Consumes: nichts (reine, netzwerkfreie Logik dank injizierbarem `fetch`)
- Produces: `OAuthProvider`, `OAuthUserInfo` (Typen aus `./types`); `createTwitchProvider(clientId: string, clientSecret: string, fetchImpl?: typeof fetch): OAuthProvider` — wird von Task 6 (`auth/routes.ts`) als Standard-Provider genutzt

- [ ] **Step 1: `apps/api/src/auth/types.ts` anlegen**

```ts
export interface OAuthUserInfo {
  providerId: string;
  login: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface OAuthProvider {
  name: string;
  getAuthorizationUrl(state: string, redirectUri: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<OAuthUserInfo>;
}
```

- [ ] **Step 2: Fehlschlagenden Test schreiben — `apps/api/src/auth/twitch.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { createTwitchProvider } from "./twitch";

const CLIENT_ID = "test-client-id";
const CLIENT_SECRET = "test-client-secret";
const REDIRECT_URI = "http://localhost:3001/auth/twitch/callback";

function fakeFetchSequence(responses: Array<{ ok: boolean; status?: number; json: () => unknown }>) {
  let call = 0;
  return vi.fn(async (_url: string, _init?: RequestInit) => {
    const response = responses[call];
    call += 1;
    return response as unknown as Response;
  });
}

> **Korrektur (während Task 4 entdeckt):** `fakeFetchSequence`s Mock braucht explizite
> Parameter (`_url`, `_init`), sonst inferiert TypeScript die Aufrufsignatur als
> `() => ...` (nullstellig). `fetchImpl.mock.calls[0] as [string, RequestInit]` schlägt
> dann bei `tsc --noEmit` fehl (Tupel-Arität 0 vs. 2), obwohl `vitest run` (kein
> Type-Check) grün bleibt. Ursprünglicher Code hatte keine Parameter — hier bereits
> korrigiert.

describe("createTwitchProvider", () => {
  it("hat den Namen 'twitch'", () => {
    const provider = createTwitchProvider(CLIENT_ID, CLIENT_SECRET);
    expect(provider.name).toBe("twitch");
  });

  describe("getAuthorizationUrl", () => {
    it("baut die Twitch-Autorisierungs-URL mit allen erwarteten Parametern", () => {
      const provider = createTwitchProvider(CLIENT_ID, CLIENT_SECRET);
      const url = new URL(provider.getAuthorizationUrl("state123", REDIRECT_URI));

      expect(url.origin + url.pathname).toBe("https://id.twitch.tv/oauth2/authorize");
      expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
      expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
      expect(url.searchParams.get("response_type")).toBe("code");
      expect(url.searchParams.get("state")).toBe("state123");
    });
  });

  describe("exchangeCode", () => {
    it("tauscht Code gegen Token und liefert gemappte User-Infos", async () => {
      const fetchImpl = fakeFetchSequence([
        { ok: true, json: () => ({ access_token: "abc123" }) },
        {
          ok: true,
          json: () => ({
            data: [
              {
                id: "12345",
                login: "streamerin",
                display_name: "Streamerin",
                profile_image_url: "https://example.com/avatar.png",
              },
            ],
          }),
        },
      ]);

      const provider = createTwitchProvider(CLIENT_ID, CLIENT_SECRET, fetchImpl);
      const result = await provider.exchangeCode("some-code", REDIRECT_URI);

      expect(result).toEqual({
        providerId: "12345",
        login: "streamerin",
        displayName: "Streamerin",
        avatarUrl: "https://example.com/avatar.png",
      });
      expect(fetchImpl).toHaveBeenCalledTimes(2);

      const [tokenUrl, tokenInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
      expect(tokenUrl).toBe("https://id.twitch.tv/oauth2/token");
      expect(tokenInit.method).toBe("POST");

      const [usersUrl, usersInit] = fetchImpl.mock.calls[1] as [string, RequestInit];
      expect(usersUrl).toBe("https://api.twitch.tv/helix/users");
      expect((usersInit.headers as Record<string, string>).Authorization).toBe("Bearer abc123");
      expect((usersInit.headers as Record<string, string>)["Client-Id"]).toBe(CLIENT_ID);
    });

    it("wirft, wenn der Token-Austausch fehlschlägt", async () => {
      const fetchImpl = fakeFetchSequence([{ ok: false, status: 400, json: () => ({}) }]);
      const provider = createTwitchProvider(CLIENT_ID, CLIENT_SECRET, fetchImpl);

      await expect(provider.exchangeCode("bad-code", REDIRECT_URI)).rejects.toThrow(/400/);
    });

    it("wirft, wenn der User-Abruf fehlschlägt", async () => {
      const fetchImpl = fakeFetchSequence([
        { ok: true, json: () => ({ access_token: "abc123" }) },
        { ok: false, status: 401, json: () => ({}) },
      ]);
      const provider = createTwitchProvider(CLIENT_ID, CLIENT_SECRET, fetchImpl);

      await expect(provider.exchangeCode("some-code", REDIRECT_URI)).rejects.toThrow(/401/);
    });

    it("wirft, wenn Twitch keinen User zurückgibt", async () => {
      const fetchImpl = fakeFetchSequence([
        { ok: true, json: () => ({ access_token: "abc123" }) },
        { ok: true, json: () => ({ data: [] }) },
      ]);
      const provider = createTwitchProvider(CLIENT_ID, CLIENT_SECRET, fetchImpl);

      await expect(provider.exchangeCode("some-code", REDIRECT_URI)).rejects.toThrow(/keinen User/);
    });
  });
});
```

- [ ] **Step 3: Test ausführen, Fehlschlag verifizieren**

Run: `pnpm --filter @bingo/api test`
Expected: FAIL — `twitch.ts` existiert nicht.

- [ ] **Step 4: Minimale Implementierung — `apps/api/src/auth/twitch.ts`**

```ts
import type { OAuthProvider, OAuthUserInfo } from "./types";

interface TwitchTokenResponse {
  access_token: string;
}

interface TwitchUsersResponse {
  data: Array<{
    id: string;
    login: string;
    display_name: string;
    profile_image_url: string;
  }>;
}

export function createTwitchProvider(
  clientId: string,
  clientSecret: string,
  fetchImpl: typeof fetch = fetch
): OAuthProvider {
  return {
    name: "twitch",

    getAuthorizationUrl(state, redirectUri) {
      const url = new URL("https://id.twitch.tv/oauth2/authorize");
      url.searchParams.set("client_id", clientId);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", "");
      url.searchParams.set("state", state);
      return url.toString();
    },

    async exchangeCode(code, redirectUri): Promise<OAuthUserInfo> {
      const tokenResponse = await fetchImpl("https://id.twitch.tv/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          grant_type: "authorization_code",
          redirect_uri: redirectUri,
        }),
      });

      if (!tokenResponse.ok) {
        throw new Error(`Twitch-Token-Austausch fehlgeschlagen: ${tokenResponse.status}`);
      }

      const tokenData = (await tokenResponse.json()) as TwitchTokenResponse;

      const usersResponse = await fetchImpl("https://api.twitch.tv/helix/users", {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          "Client-Id": clientId,
        },
      });

      if (!usersResponse.ok) {
        throw new Error(`Twitch-User-Abruf fehlgeschlagen: ${usersResponse.status}`);
      }

      const usersData = (await usersResponse.json()) as TwitchUsersResponse;
      const twitchUser = usersData.data[0];

      if (!twitchUser) {
        throw new Error("Twitch hat keinen User zurückgegeben");
      }

      return {
        providerId: twitchUser.id,
        login: twitchUser.login,
        displayName: twitchUser.display_name,
        avatarUrl: twitchUser.profile_image_url || null,
      };
    },
  };
}
```

- [ ] **Step 5: Test ausführen, Erfolg verifizieren**

Run: `pnpm --filter @bingo/api test`
Expected: PASS — alle 6 Tests grün.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/auth/types.ts apps/api/src/auth/twitch.ts apps/api/src/auth/twitch.test.ts
git commit -m "$(cat <<'EOF'
feat(api): Twitch-OAuth-Provider hinter OAuthProvider-Interface

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `apps/api` – Session-Helfer (TDD, echte DB)

**Files:**
- Create: `apps/api/src/auth/session.test.ts`
- Create: `apps/api/src/auth/session.ts`

**Interfaces:**
- Consumes: `db` aus `../db/client` (Task 1), `sessions`/`users` aus `../db/schema` (Phase 1)
- Produces: `SESSION_TTL_MS: number`, `createSession(userId: string): Promise<{id: string; expiresAt: Date}>`, `getUserBySessionId(sessionId: string): Promise<UserRow | null>`, `deleteSession(sessionId: string): Promise<void>` — genutzt von Task 6 (`auth/routes.ts`, `auth/current-user.ts`)

Voraussetzung: Docker-Compose-Postgres läuft (`docker compose up -d postgres`), `.env` ist vorhanden.

- [ ] **Step 1: Fehlschlagenden Test schreiben — `apps/api/src/auth/session.test.ts`**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import "../env";
import { db } from "../db/client";
import { sessions, users } from "../db/schema";
import { createSession, getUserBySessionId, deleteSession, SESSION_TTL_MS } from "./session";

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

describe("session-Helfer", () => {
  const createdUserIds: string[] = [];

  afterEach(async () => {
    for (const userId of createdUserIds.splice(0)) {
      await db.delete(users).where(eq(users.id, userId));
    }
  });

  it("createSession legt eine Session mit 64-stelliger Hex-ID und korrektem Ablaufdatum an", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);

    const before = Date.now();
    const session = await createSession(user.id);
    const after = Date.now();

    expect(session.id).toMatch(/^[0-9a-f]{64}$/);
    expect(session.expiresAt.getTime()).toBeGreaterThanOrEqual(before + SESSION_TTL_MS - 1000);
    expect(session.expiresAt.getTime()).toBeLessThanOrEqual(after + SESSION_TTL_MS + 1000);

    const [row] = await db.select().from(sessions).where(eq(sessions.id, session.id));
    expect(row).toBeDefined();
    expect(row.userId).toBe(user.id);
  });

  it("getUserBySessionId liefert den User für eine gültige Session", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const session = await createSession(user.id);

    const result = await getUserBySessionId(session.id);

    expect(result?.id).toBe(user.id);
    expect(result?.login).toBe("test-user");
  });

  it("getUserBySessionId liefert null für eine unbekannte Session-ID", async () => {
    const result = await getUserBySessionId("nonexistent".repeat(8));
    expect(result).toBeNull();
  });

  it("getUserBySessionId liefert null und löscht eine abgelaufene Session", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const expiredId = randomUUID().replace(/-/g, "").repeat(2).slice(0, 64);
    await db.insert(sessions).values({
      id: expiredId,
      userId: user.id,
      expiresAt: new Date(Date.now() - 1000),
    });

    const result = await getUserBySessionId(expiredId);
    expect(result).toBeNull();

    const [row] = await db.select().from(sessions).where(eq(sessions.id, expiredId));
    expect(row).toBeUndefined();
  });

  it("deleteSession entfernt die Session, danach liefert getUserBySessionId null", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const session = await createSession(user.id);

    await deleteSession(session.id);

    const result = await getUserBySessionId(session.id);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag verifizieren**

Run: `pnpm --filter @bingo/api test`
Expected: FAIL — `session.ts` existiert nicht.

- [ ] **Step 3: Minimale Implementierung — `apps/api/src/auth/session.ts`**

```ts
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { sessions, users } from "../db/schema";

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 Tage

export async function createSession(userId: string): Promise<{ id: string; expiresAt: Date }> {
  const id = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessions).values({ id, userId, expiresAt });
  return { id, expiresAt };
}

export async function getUserBySessionId(sessionId: string) {
  const [row] = await db
    .select({ user: users, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, sessionId));

  if (!row) {
    return null;
  }

  if (row.expiresAt.getTime() < Date.now()) {
    await deleteSession(sessionId);
    return null;
  }

  return row.user;
}

export async function deleteSession(sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}
```

- [ ] **Step 4: Test ausführen, Erfolg verifizieren**

Run: `pnpm --filter @bingo/api test`
Expected: PASS — alle 5 Tests grün, echte Postgres-Verbindung genutzt.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth/session.ts apps/api/src/auth/session.test.ts
git commit -m "$(cat <<'EOF'
feat(api): Session-Helfer (create/get/delete) gegen die sessions-Tabelle

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `apps/api` – User-Upsert-Helfer (TDD, echte DB)

**Files:**
- Create: `apps/api/src/db/users.test.ts`
- Create: `apps/api/src/db/users.ts`

**Interfaces:**
- Consumes: `db` aus `./client` (Task 1), `users` aus `./schema` (Phase 1), `OAuthUserInfo` aus `../auth/types` (Task 2)
- Produces: `upsertUserFromTwitch(info: OAuthUserInfo): Promise<UserRow>` — genutzt von Task 6 (`auth/routes.ts`)

Voraussetzung: Docker-Compose-Postgres läuft, `.env` ist vorhanden.

- [ ] **Step 1: Fehlschlagenden Test schreiben — `apps/api/src/db/users.test.ts`**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import "../env";
import { db } from "./client";
import { users } from "./schema";
import { upsertUserFromTwitch } from "./users";

describe("upsertUserFromTwitch", () => {
  const createdIds: string[] = [];

  afterEach(async () => {
    for (const id of createdIds.splice(0)) {
      await db.delete(users).where(eq(users.id, id));
    }
  });

  it("legt einen neuen User an, wenn twitchId unbekannt ist", async () => {
    const twitchId = `test-${randomUUID()}`;

    const user = await upsertUserFromTwitch({
      providerId: twitchId,
      login: "neuer-user",
      displayName: "Neuer User",
      avatarUrl: "https://example.com/a.png",
    });
    createdIds.push(user.id);

    expect(user.twitchId).toBe(twitchId);
    expect(user.login).toBe("neuer-user");
    expect(user.displayName).toBe("Neuer User");
    expect(user.avatarUrl).toBe("https://example.com/a.png");
  });

  it("aktualisiert den bestehenden User, wenn twitchId schon existiert, statt zu duplizieren", async () => {
    const twitchId = `test-${randomUUID()}`;

    const first = await upsertUserFromTwitch({
      providerId: twitchId,
      login: "alter-name",
      displayName: "Alter Name",
      avatarUrl: null,
    });
    createdIds.push(first.id);

    const second = await upsertUserFromTwitch({
      providerId: twitchId,
      login: "neuer-name",
      displayName: "Neuer Name",
      avatarUrl: "https://example.com/b.png",
    });

    expect(second.id).toBe(first.id);
    expect(second.login).toBe("neuer-name");
    expect(second.displayName).toBe("Neuer Name");
    expect(second.avatarUrl).toBe("https://example.com/b.png");

    const rows = await db.select().from(users).where(eq(users.twitchId, twitchId));
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag verifizieren**

Run: `pnpm --filter @bingo/api test`
Expected: FAIL — `users.ts` existiert nicht.

- [ ] **Step 3: Minimale Implementierung — `apps/api/src/db/users.ts`**

```ts
import "../env";
import { db } from "./client";
import { users } from "./schema";
import type { OAuthUserInfo } from "../auth/types";

export async function upsertUserFromTwitch(info: OAuthUserInfo) {
  const [user] = await db
    .insert(users)
    .values({
      twitchId: info.providerId,
      login: info.login,
      displayName: info.displayName,
      avatarUrl: info.avatarUrl,
    })
    .onConflictDoUpdate({
      target: users.twitchId,
      set: {
        login: info.login,
        displayName: info.displayName,
        avatarUrl: info.avatarUrl,
        updatedAt: new Date(),
      },
    })
    .returning();

  return user;
}
```

- [ ] **Step 4: Test ausführen, Erfolg verifizieren**

Run: `pnpm --filter @bingo/api test`
Expected: PASS — beide Tests grün.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/db/users.ts apps/api/src/db/users.test.ts
git commit -m "$(cat <<'EOF'
feat(api): upsertUserFromTwitch – User anlegen/aktualisieren per twitch_id

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `apps/api` – Cookie-/CORS-Plugins in `server.ts`

**Files:**
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/server.test.ts`
- Modify: `apps/api/package.json`
- Modify: `.env.example`

**Interfaces:**
- Consumes: nichts Neues
- Produces: `buildServer()` registriert `@fastify/cors` (Origin = `WEB_ORIGIN`, `credentials: true`) und `@fastify/cookie` (signiert mit `SESSION_SECRET`) — Grundlage für Task 6, das darauf `reply.setCookie`/`request.cookies`/`request.unsignCookie` aufbaut. `buildServer()` ist ab jetzt `async`.

- [ ] **Step 1: `apps/api/package.json` erweitern (Dependencies ergänzen)**

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
    "@fastify/cookie": "^9.4.0",
    "@fastify/cors": "^9.0.1",
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

- [ ] **Step 2: `.env.example` erweitern (im Abschnitt „API")**

```
# Postgres
POSTGRES_USER=bingo
POSTGRES_PASSWORD=bingo
POSTGRES_DB=bingo
DATABASE_URL=postgres://bingo:bingo@localhost:5433/bingo

# API
PORT=3001
SESSION_SECRET=change-me-to-a-random-64-char-string
WEB_ORIGIN=http://localhost:5173

# Twitch OAuth (wird in einem Folgeplan benötigt)
TWITCH_CLIENT_ID=
TWITCH_CLIENT_SECRET=
TWITCH_REDIRECT_URI=http://localhost:3001/auth/twitch/callback
```

- [ ] **Step 3: `apps/api/src/server.ts` erweitern**

```ts
import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import "./env";

export async function buildServer() {
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

- [ ] **Step 4: `apps/api/src/server.test.ts` erweitern**

```ts
import { describe, it, expect } from "vitest";
import { buildServer } from "./server";

describe("GET /health", () => {
  it("antwortet mit status ok", async () => {
    const app = await buildServer();
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });
});

describe("CORS", () => {
  it("erlaubt die konfigurierte WEB_ORIGIN mit Credentials", async () => {
    const app = await buildServer();
    const origin = process.env.WEB_ORIGIN ?? "http://localhost:5173";
    const response = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin },
    });

    expect(response.headers["access-control-allow-origin"]).toBe(origin);
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
  });
});
```

- [ ] **Step 5: Abhängigkeiten installieren und Tests ausführen**

Run: `pnpm install && pnpm --filter @bingo/api test`
Expected: PASS — beide Test-Dateien grün (Health-Test funktioniert weiterhin mit `await buildServer()`, neuer CORS-Test grün).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/server.ts apps/api/src/server.test.ts apps/api/package.json .env.example pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat(api): CORS- und Cookie-Plugins registrieren, buildServer() async

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `apps/api` – Auth-Routen

**Files:**
- Create: `apps/api/src/auth/current-user.ts`
- Create: `apps/api/src/auth/routes.ts`
- Create: `apps/api/src/auth/routes.test.ts`
- Modify: `apps/api/src/server.ts`

**Interfaces:**
- Consumes: `OAuthProvider`/`OAuthUserInfo` (Task 2), `createTwitchProvider` (Task 2), `createSession`/`deleteSession`/`getUserBySessionId` (Task 3), `upsertUserFromTwitch` (Task 4), CORS/Cookie-Plugins (Task 5)
- Produces: Routen `GET /auth/twitch`, `GET /auth/twitch/callback`, `POST /auth/logout`, `GET /api/me`; `getCurrentUser(request): Promise<AuthUser | null>` aus `current-user.ts` — wiederverwendbar für geschützte Board-Routen in einem späteren Plan; `buildServer(options?: { authProvider?: OAuthProvider })` — Test-Override-Punkt

- [ ] **Step 1: `apps/api/src/auth/current-user.ts` anlegen**

```ts
import type { FastifyReply, FastifyRequest } from "fastify";
import { getUserBySessionId } from "./session";

export const SESSION_COOKIE_NAME = "session";

export interface AuthUser {
  id: string;
  login: string;
  displayName: string;
  avatarUrl: string | null;
}

export function setSessionCookie(reply: FastifyReply, sessionId: string, expiresAt: Date): void {
  reply.setCookie(SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
    signed: true,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
}

export function getSessionIdFromRequest(request: FastifyRequest): string | null {
  const raw = request.cookies[SESSION_COOKIE_NAME];
  if (!raw) {
    return null;
  }
  const unsigned = request.unsignCookie(raw);
  return unsigned.valid && unsigned.value ? unsigned.value : null;
}

export async function getCurrentUser(request: FastifyRequest): Promise<AuthUser | null> {
  const sessionId = getSessionIdFromRequest(request);
  if (!sessionId) {
    return null;
  }

  const user = await getUserBySessionId(sessionId);
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    login: user.login,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
  };
}
```

- [ ] **Step 2: `apps/api/src/auth/routes.ts` anlegen**

```ts
import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { OAuthProvider } from "./types";
import { createTwitchProvider } from "./twitch";
import { createSession, deleteSession } from "./session";
import { upsertUserFromTwitch } from "../db/users";
import {
  clearSessionCookie,
  getCurrentUser,
  getSessionIdFromRequest,
  setSessionCookie,
} from "./current-user";

const STATE_COOKIE_NAME = "oauth_state";
const STATE_COOKIE_MAX_AGE_SECONDS = 600;

export interface RegisterAuthRoutesOptions {
  provider?: OAuthProvider;
}

function createDefaultTwitchProvider(): OAuthProvider {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("TWITCH_CLIENT_ID und TWITCH_CLIENT_SECRET müssen gesetzt sein");
  }
  return createTwitchProvider(clientId, clientSecret);
}

function getRedirectUri(): string {
  const redirectUri = process.env.TWITCH_REDIRECT_URI;
  if (!redirectUri) {
    throw new Error("TWITCH_REDIRECT_URI muss gesetzt sein");
  }
  return redirectUri;
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  options: RegisterAuthRoutesOptions = {}
): Promise<void> {
  const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:5173";
  const getProvider = (): OAuthProvider => options.provider ?? createDefaultTwitchProvider();

  app.get("/auth/twitch", async (_request, reply) => {
    const provider = getProvider();
    const redirectUri = getRedirectUri();
    const state = randomBytes(16).toString("hex");

    reply.setCookie(STATE_COOKIE_NAME, state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: STATE_COOKIE_MAX_AGE_SECONDS,
    });

    return reply.redirect(provider.getAuthorizationUrl(state, redirectUri));
  });

  app.get<{ Querystring: { code?: string; state?: string } }>(
    "/auth/twitch/callback",
    async (request, reply) => {
      const provider = getProvider();
      const redirectUri = getRedirectUri();
      const { code, state } = request.query;
      const cookieState = request.cookies[STATE_COOKIE_NAME];

      reply.clearCookie(STATE_COOKIE_NAME, { path: "/" });

      if (!code || !state || !cookieState || state !== cookieState) {
        return reply.redirect(`${webOrigin}/?error=oauth_state`);
      }

      let userInfo;
      try {
        userInfo = await provider.exchangeCode(code, redirectUri);
      } catch (err) {
        request.log.error(err);
        return reply.redirect(`${webOrigin}/?error=oauth_exchange`);
      }

      const user = await upsertUserFromTwitch(userInfo);
      const session = await createSession(user.id);
      setSessionCookie(reply, session.id, session.expiresAt);

      return reply.redirect(`${webOrigin}/boards`);
    }
  );

  app.post("/auth/logout", async (request, reply) => {
    const sessionId = getSessionIdFromRequest(request);
    if (sessionId) {
      await deleteSession(sessionId);
    }
    clearSessionCookie(reply);
    return reply.status(204).send();
  });

  app.get("/api/me", async (request, reply) => {
    const user = await getCurrentUser(request);
    if (!user) {
      return reply.status(401).send({ error: "Nicht eingeloggt" });
    }
    return user;
  });
}
```

- [ ] **Step 3: `apps/api/src/server.ts` erweitern (Auth-Routen registrieren, Provider-Override für Tests)**

```ts
import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import "./env";
import { registerAuthRoutes } from "./auth/routes";
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

- [ ] **Step 4: Test schreiben — `apps/api/src/auth/routes.test.ts`**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import "../env";
import { buildServer } from "../server";
import { db } from "../db/client";
import { users } from "../db/schema";
import type { OAuthProvider, OAuthUserInfo } from "./types";

function createFakeProvider(userInfo: OAuthUserInfo): OAuthProvider {
  return {
    name: "fake",
    getAuthorizationUrl: (state, redirectUri) =>
      `https://fake-provider.test/authorize?state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`,
    exchangeCode: async () => userInfo,
  };
}

function extractCookie(setCookieHeader: string | string[] | undefined, name: string): string | undefined {
  const headers = Array.isArray(setCookieHeader) ? setCookieHeader : setCookieHeader ? [setCookieHeader] : [];
  const match = headers.find((h) => h.startsWith(`${name}=`));
  return match?.split(";")[0].split("=")[1];
}

describe("Auth-Routen", () => {
  const createdUserIds: string[] = [];

  afterEach(async () => {
    for (const id of createdUserIds.splice(0)) {
      await db.delete(users).where(eq(users.id, id));
    }
  });

  it("GET /auth/twitch leitet zur Autorisierungs-URL weiter und setzt ein State-Cookie", async () => {
    const app = await buildServer({
      authProvider: createFakeProvider({ providerId: "x", login: "x", displayName: "x", avatarUrl: null }),
    });

    const response = await app.inject({ method: "GET", url: "/auth/twitch" });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toContain("fake-provider.test/authorize");
    expect(extractCookie(response.headers["set-cookie"], "oauth_state")).toBeTruthy();
  });

  it("GET /auth/twitch/callback legt User+Session an und redirected zu /boards", async () => {
    const twitchId = `routes-test-${Date.now()}`;
    const app = await buildServer({
      authProvider: createFakeProvider({
        providerId: twitchId,
        login: "routes-tester",
        displayName: "Routes Tester",
        avatarUrl: "https://example.com/a.png",
      }),
    });

    const stateResponse = await app.inject({ method: "GET", url: "/auth/twitch" });
    const stateCookie = extractCookie(stateResponse.headers["set-cookie"], "oauth_state");
    const state = new URL(stateResponse.headers.location as string).searchParams.get("state");

    const callbackResponse = await app.inject({
      method: "GET",
      url: `/auth/twitch/callback?code=whatever&state=${state}`,
      cookies: { oauth_state: stateCookie ?? "" },
    });

    expect(callbackResponse.statusCode).toBe(302);
    expect(callbackResponse.headers.location).toContain("/boards");
    expect(extractCookie(callbackResponse.headers["set-cookie"], "session")).toBeTruthy();

    const [user] = await db.select().from(users).where(eq(users.twitchId, twitchId));
    expect(user).toBeDefined();
    createdUserIds.push(user.id);
  });

  it("GET /auth/twitch/callback lehnt ein falsches state ab und redirected mit Fehler", async () => {
    const app = await buildServer({
      authProvider: createFakeProvider({ providerId: "x", login: "x", displayName: "x", avatarUrl: null }),
    });

    const response = await app.inject({
      method: "GET",
      url: "/auth/twitch/callback?code=whatever&state=falsch",
      cookies: { oauth_state: "richtig" },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toContain("error=oauth_state");
  });

  it("GET /api/me liefert 401 ohne Session", async () => {
    const app = await buildServer();
    const response = await app.inject({ method: "GET", url: "/api/me" });
    expect(response.statusCode).toBe(401);
  });

  it("GET /api/me liefert den User nach erfolgreichem Login, POST /auth/logout beendet die Session", async () => {
    const twitchId = `routes-test-${Date.now()}-2`;
    const app = await buildServer({
      authProvider: createFakeProvider({
        providerId: twitchId,
        login: "me-tester",
        displayName: "Me Tester",
        avatarUrl: null,
      }),
    });

    const stateResponse = await app.inject({ method: "GET", url: "/auth/twitch" });
    const stateCookie = extractCookie(stateResponse.headers["set-cookie"], "oauth_state");
    const state = new URL(stateResponse.headers.location as string).searchParams.get("state");

    const callbackResponse = await app.inject({
      method: "GET",
      url: `/auth/twitch/callback?code=whatever&state=${state}`,
      cookies: { oauth_state: stateCookie ?? "" },
    });
    const sessionCookie = extractCookie(callbackResponse.headers["set-cookie"], "session");

    const [user] = await db.select().from(users).where(eq(users.twitchId, twitchId));
    createdUserIds.push(user.id);

    const meResponse = await app.inject({
      method: "GET",
      url: "/api/me",
      cookies: { session: sessionCookie ?? "" },
    });
    expect(meResponse.statusCode).toBe(200);
    expect(meResponse.json()).toEqual({
      id: user.id,
      login: "me-tester",
      displayName: "Me Tester",
      avatarUrl: null,
    });

    const logoutResponse = await app.inject({
      method: "POST",
      url: "/auth/logout",
      cookies: { session: sessionCookie ?? "" },
    });
    expect(logoutResponse.statusCode).toBe(204);

    const meAfterLogout = await app.inject({
      method: "GET",
      url: "/api/me",
      cookies: { session: sessionCookie ?? "" },
    });
    expect(meAfterLogout.statusCode).toBe(401);
  });
});
```

- [ ] **Step 5: Test ausführen, Erfolg verifizieren**

Run: `pnpm --filter @bingo/api test`
Expected: PASS — alle Tests grün, inklusive der 5 neuen Auth-Routen-Tests. Kein einziger Test kontaktiert echtes Twitch (Fake-Provider), aber alle DB-Effekte (User-Anlage, Session-Anlage/-Löschung) laufen echt gegen Postgres.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/auth/current-user.ts apps/api/src/auth/routes.ts apps/api/src/auth/routes.test.ts apps/api/src/server.ts
git commit -m "$(cat <<'EOF'
feat(api): Auth-Routen /auth/twitch, /auth/twitch/callback, /auth/logout, /api/me

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `apps/web` – Auth-Store + API-Basis-Konfiguration (TDD)

**Files:**
- Create: `apps/web/src/env.d.ts`
- Create: `apps/web/src/stores/auth.ts`
- Create: `apps/web/src/stores/auth.test.ts`
- Modify: `apps/web/vite.config.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: nichts Neues
- Produces: `useAuthStore()` (Pinia) mit State `user: AuthUser | null`, `isLoading: boolean` und Actions `fetchMe()`, `logout()`, `loginUrl(): string` — genutzt von Task 8 (`HomeView.vue`, `BoardsView.vue`, Router-Guard)

- [ ] **Step 1: `.env.example` erweitern (neuer Abschnitt „Web")**

```
# Postgres
POSTGRES_USER=bingo
POSTGRES_PASSWORD=bingo
POSTGRES_DB=bingo
DATABASE_URL=postgres://bingo:bingo@localhost:5433/bingo

# API
PORT=3001
SESSION_SECRET=change-me-to-a-random-64-char-string
WEB_ORIGIN=http://localhost:5173

# Web (Vite)
VITE_API_BASE_URL=http://localhost:3001

# Twitch OAuth (wird in einem Folgeplan benötigt)
TWITCH_CLIENT_ID=
TWITCH_CLIENT_SECRET=
TWITCH_REDIRECT_URI=http://localhost:3001/auth/twitch/callback
```

- [ ] **Step 2: `apps/web/vite.config.ts` erweitern (Root-.env statt app-lokaler .env lesen)**

```ts
/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  envDir: "../../",
  plugins: [vue()],
  server: {
    port: 5173,
  },
  test: {
    environment: "jsdom",
  },
});
```

- [ ] **Step 3: `apps/web/src/env.d.ts` anlegen**

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
}
```

- [ ] **Step 4: Fehlschlagenden Test schreiben — `apps/web/src/stores/auth.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useAuthStore } from "./auth";

describe("useAuthStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetchMe setzt user bei erfolgreicher Antwort", async () => {
    const mockUser = { id: "1", login: "test", displayName: "Test", avatarUrl: null };
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => mockUser } as Response);

    const store = useAuthStore();
    await store.fetchMe();

    expect(store.user).toEqual(mockUser);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/me"),
      expect.objectContaining({ credentials: "include" })
    );
  });

  it("fetchMe setzt user auf null bei 401", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, json: async () => ({}) } as Response);

    const store = useAuthStore();
    await store.fetchMe();

    expect(store.user).toBeNull();
  });

  it("logout ruft /auth/logout auf und setzt user auf null", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({}) } as Response);

    const store = useAuthStore();
    store.user = { id: "1", login: "test", displayName: "Test", avatarUrl: null };

    await store.logout();

    expect(store.user).toBeNull();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/auth/logout"),
      expect.objectContaining({ method: "POST", credentials: "include" })
    );
  });

  it("loginUrl liefert die Twitch-Login-URL der API", () => {
    const store = useAuthStore();
    expect(store.loginUrl()).toContain("/auth/twitch");
  });
});
```

- [ ] **Step 5: Test ausführen, Fehlschlag verifizieren**

Run: `pnpm --filter @bingo/web test`
Expected: FAIL — `stores/auth.ts` existiert nicht.

- [ ] **Step 6: Minimale Implementierung — `apps/web/src/stores/auth.ts`**

```ts
import { defineStore } from "pinia";

export interface AuthUser {
  id: string;
  login: string;
  displayName: string;
  avatarUrl: string | null;
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:3001";

export const useAuthStore = defineStore("auth", {
  state: () => ({
    user: null as AuthUser | null,
    isLoading: false,
  }),
  actions: {
    async fetchMe() {
      this.isLoading = true;
      try {
        const response = await fetch(`${API_BASE_URL}/api/me`, {
          credentials: "include",
        });
        this.user = response.ok ? ((await response.json()) as AuthUser) : null;
      } finally {
        this.isLoading = false;
      }
    },
    async logout() {
      await fetch(`${API_BASE_URL}/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
      this.user = null;
    },
    loginUrl(): string {
      return `${API_BASE_URL}/auth/twitch`;
    },
  },
});
```

- [ ] **Step 7: Test ausführen, Erfolg verifizieren**

Run: `pnpm --filter @bingo/web test`
Expected: PASS — alle 4 Store-Tests grün.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/env.d.ts apps/web/src/stores/auth.ts apps/web/src/stores/auth.test.ts apps/web/vite.config.ts .env.example
git commit -m "$(cat <<'EOF'
feat(web): Auth-Store (fetchMe/logout/loginUrl) + VITE_API_BASE_URL

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: `apps/web` – Login-Link + geschützte Boards-Platzhalterseite

**Files:**
- Modify: `apps/web/src/views/HomeView.vue`
- Create: `apps/web/src/views/HomeView.test.ts`
- Delete: `apps/web/src/App.test.ts` (Inhalt zieht nach `HomeView.test.ts` um — der alte Dateiname testete `HomeView`, obwohl er `App.test.ts` hieß)
- Create: `apps/web/src/views/BoardsView.vue`
- Create: `apps/web/src/views/BoardsView.test.ts`
- Modify: `apps/web/src/router/index.ts`
- Create: `apps/web/src/router/index.test.ts`

**Interfaces:**
- Consumes: `useAuthStore` (Task 7)
- Produces: Route `/boards` (geschützt via `meta: { requiresAuth: true }` + `requireAuthGuard`); `requireAuthGuard` exportiert für Tests und für spätere geschützte Routen (Editor, Control-Seite) wiederverwendbar

- [ ] **Step 1: `apps/web/src/views/HomeView.vue` erweitern**

```vue
<script setup lang="ts">
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
</script>

<template>
  <main class="flex min-h-screen items-center justify-center bg-slate-900 text-slate-100">
    <div class="flex flex-col items-center gap-4">
      <h1 class="text-3xl font-bold">Bingo Card Generator</h1>
      <a
        :href="auth.loginUrl()"
        class="rounded bg-purple-600 px-4 py-2 font-semibold hover:bg-purple-700"
      >
        Mit Twitch einloggen
      </a>
    </div>
  </main>
</template>
```

- [ ] **Step 2: Alte Testdatei entfernen, neue anlegen — `apps/web/src/App.test.ts` löschen, `apps/web/src/views/HomeView.test.ts` anlegen**

```bash
git rm apps/web/src/App.test.ts
```

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import HomeView from "./HomeView.vue";

describe("HomeView", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("zeigt den Titel an", () => {
    const wrapper = mount(HomeView);
    expect(wrapper.text()).toContain("Bingo Card Generator");
  });

  it("zeigt einen Twitch-Login-Link", () => {
    const wrapper = mount(HomeView);
    const link = wrapper.find("a");
    expect(link.text()).toContain("Mit Twitch einloggen");
    expect(link.attributes("href")).toContain("/auth/twitch");
  });
});
```

- [ ] **Step 3: `apps/web/src/views/BoardsView.vue` anlegen**

```vue
<script setup lang="ts">
import { onMounted } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const router = useRouter();

onMounted(async () => {
  if (!auth.user) {
    await auth.fetchMe();
  }
});

async function handleLogout() {
  await auth.logout();
  router.push({ name: "home" });
}
</script>

<template>
  <main class="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-900 text-slate-100">
    <template v-if="auth.user">
      <img
        v-if="auth.user.avatarUrl"
        :src="auth.user.avatarUrl"
        :alt="auth.user.displayName"
        class="h-16 w-16 rounded-full"
      />
      <p class="text-xl">Eingeloggt als {{ auth.user.displayName }}</p>
      <button
        class="rounded bg-purple-600 px-4 py-2 font-semibold hover:bg-purple-700"
        @click="handleLogout"
      >
        Ausloggen
      </button>
    </template>
    <p v-else>Lade...</p>
  </main>
</template>
```

- [ ] **Step 4: `apps/web/src/router/index.ts` erweitern**

```ts
import { createRouter, createWebHistory, type RouteLocationNormalized } from "vue-router";
import HomeView from "../views/HomeView.vue";
import BoardsView from "../views/BoardsView.vue";
import { useAuthStore } from "../stores/auth";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "home", component: HomeView },
    { path: "/boards", name: "boards", component: BoardsView, meta: { requiresAuth: true } },
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

- [ ] **Step 5: Test schreiben — `apps/web/src/router/index.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { RouteLocationNormalized } from "vue-router";
import { requireAuthGuard } from "./index";

function fakeRoute(requiresAuth: boolean): RouteLocationNormalized {
  return { meta: { requiresAuth } } as unknown as RouteLocationNormalized;
}

> **Korrektur (während Task 8 entdeckt):** Doppel-Cast über `unknown` nötig — ein
> direkter `as RouteLocationNormalized`-Cast eines Objekts, das nur `meta` besitzt,
> scheitert bei `vue-tsc --noEmit` mit TS2352 (zu geringe Typüberschneidung zum
> vollständigen `RouteLocationNormalized`-Typ). `requireAuthGuard` liest ausschließlich
> `to.meta.requiresAuth`, daher ist der Fake für den getesteten Codepfad vollständig —
> der Doppel-Cast ist rein typseitig, keine Verhaltensänderung.

describe("requireAuthGuard", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lässt Routen ohne requiresAuth ohne Fetch durch", async () => {
    const result = await requireAuthGuard(fakeRoute(false));
    expect(result).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("lässt geschützte Routen durch, wenn der User eingeloggt ist", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ id: "1", login: "x", displayName: "X", avatarUrl: null }),
    } as Response);

    const result = await requireAuthGuard(fakeRoute(true));
    expect(result).toBe(true);
  });

  it("leitet zu 'home' um, wenn der User nicht eingeloggt ist", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, json: async () => ({}) } as Response);

    const result = await requireAuthGuard(fakeRoute(true));
    expect(result).toEqual({ name: "home" });
  });
});
```

- [ ] **Step 6: Test schreiben — `apps/web/src/views/BoardsView.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createRouter, createWebHistory } from "vue-router";
import BoardsView from "./BoardsView.vue";
import { useAuthStore } from "../stores/auth";

function createTestRouter() {
  return createRouter({
    history: createWebHistory(),
    routes: [{ path: "/", name: "home", component: { template: "<div />" } }],
  });
}

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("BoardsView", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("zeigt den eingeloggten User inkl. Ausloggen-Button", async () => {
    const router = createTestRouter();
    const auth = useAuthStore();
    auth.user = { id: "1", login: "streamerin", displayName: "Streamerin", avatarUrl: null };

    const wrapper = mount(BoardsView, { global: { plugins: [router] } });
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain("Streamerin");
    expect(wrapper.find("button").text()).toContain("Ausloggen");
  });

  it("ruft beim Klick auf Ausloggen den Logout-Store-Action auf und navigiert zu Home", async () => {
    const router = createTestRouter();
    const auth = useAuthStore();
    auth.user = { id: "1", login: "streamerin", displayName: "Streamerin", avatarUrl: null };
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({}) } as Response);

    const wrapper = mount(BoardsView, { global: { plugins: [router] } });
    await wrapper.find("button").trigger("click");
    await flushPromises();

    expect(auth.user).toBeNull();
    expect(router.currentRoute.value.name).toBe("home");
  });
});
```

- [ ] **Step 7: Abhängigkeiten prüfen und alle Tests ausführen**

Run: `pnpm --filter @bingo/web test`
Expected: PASS — `HomeView.test.ts`, `BoardsView.test.ts`, `router/index.test.ts` und `stores/auth.test.ts` alle grün (kein `App.test.ts` mehr vorhanden).

- [ ] **Step 8: Dev-Server manuell prüfen**

Run: `pnpm --filter @bingo/web dev`
Expected: Vite startet auf `http://localhost:5173`, Startseite zeigt Titel + „Mit Twitch einloggen"-Link. Danach Server mit Strg+C beenden.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/views apps/web/src/router/index.ts apps/web/src/router/index.test.ts
git commit -m "$(cat <<'EOF'
feat(web): Login-Link, geschützte Boards-Platzhalterseite, Router-Guard

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Nach Abschluss dieses Plans

Automatisiert vollständig verifiziert: OAuth-Provider-Logik (gefakter HTTP-Verkehr), Session-Lebenszyklus, User-Upsert, alle vier Auth-Routen (gefakter Provider + echte DB), Frontend-Store/-Guard/-Views.

**Manuell zu verifizieren, sobald echte Twitch-Client-ID/-Secret in `.env` stehen** (kann nicht automatisiert/durch einen Subagenten getestet werden, da es einen echten Twitch-Consent-Screen im Browser mit einem echten Twitch-Account erfordert):
1. `docker compose up -d postgres`, `pnpm dev:api`, `pnpm dev:web` starten.
2. `http://localhost:5173` öffnen, „Mit Twitch einloggen" klicken.
3. Twitch-Consent bestätigen → Redirect zu `http://localhost:5173/boards` mit Anzeige des echten Twitch-Anzeigenamens/Avatars.
4. „Ausloggen" klicken → Redirect/Zustand zeigt ausgeloggt, erneuter Aufruf von `/boards` leitet zurück zu `/`.
5. `GET http://localhost:3001/api/me` ohne Cookie → 401.

Nächster Schritt laut SPEC.md Abschnitt 10: **Board-CRUD (API + Dashboard)**. Vor diesem Plan außerdem aus der Foundation-Phase zurückgestellte Punkte aufgreifen (siehe Foundation-Plan, Abschnitt „Nach Abschluss"): `pnpm build`/`start` reparieren, DB-Schema an Shared-Types koppeln (`$type<BoardSize>()`/`$type<LabelMode>()`), Indizes auf `boards.user_id`/`sessions.user_id`.
