# Docker-Deployment (generisch, Traefik-fähig) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine generische, wiederverwendbare Docker-Deployment-Konfiguration bauen, mit der das Projekt auf einem beliebigen eigenen Docker-Host mit Traefik als Reverse Proxy betrieben werden kann — ohne Domain- oder Hosting-Anbieter-Details im (öffentlichen) Repository.

**Architecture:** Ein einzelner `app`-Container liefert sowohl die Fastify-API als auch das gebaute Vue-Frontend aus (`@fastify/static` mit SPA-Fallback), wodurch in Produktion kein CORS zwischen zwei Diensten nötig ist. Eine neue, separate `docker-compose.prod.yml` ergänzt die bestehende, weiterhin für lokale Entwicklung genutzte `docker-compose.yml`. Domain, Traefik-Netzwerkname und Certresolver-Name kommen ausschließlich aus Umgebungsvariablen (`.env.prod`, nie committet).

**Tech Stack:** `@fastify/static` (neue Abhängigkeit), Docker Multi-Stage-Build, Docker Compose, Traefik-Labels (optional entfernbar für andere Reverse Proxies).

**Spec:** `docs/superpowers/specs/2026-09-30-vps-deployment-design.md`

## Global Constraints

- Keine Domain-, Hosting-Anbieter- oder sonstigen Infrastruktur-spezifischen Werte in irgendeiner committeten Datei — alles über Umgebungsvariablen ohne (oder mit generischem) Default.
- Bestehende `docker-compose.yml` (lokale Entwicklung) bleibt unverändert.
- Die neue statische-Ausliefer-Logik darf keine der 115 bestehenden `apps/api`-Tests verändern oder brechen (Guard: nur aktiv, wenn das Frontend-`dist`-Verzeichnis tatsächlich existiert).
- Sowohl `vitest run` als auch `tsc --noEmit` müssen für `apps/api` sauber durchlaufen.
- `.env.prod` (echte Werte) wird niemals committet — bereits über `.dockerignore` und die bestehende `.gitignore` abgesichert, wird in dieser Plan-Ausführung zusätzlich verifiziert.
- UI-Sprache Deutsch (für alle neuen, nutzersichtbaren Fehlermeldungen — hier: die JSON-404-Antwort für unbekannte API-Routen).
- Jeder Commit endet mit exakt: `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.

---

## Datei-Übersicht

```
apps/api/package.json                       # + @fastify/static
apps/api/src/server.ts                       # statisches Frontend + SPA-Fallback
apps/api/src/server.test.ts                  # 4 neue Tests

Dockerfile                                   # neu, Repo-Root
.dockerignore                                # neu, Repo-Root
docker-compose.prod.yml                      # neu, Repo-Root
.env.prod.example                            # neu, Repo-Root

README.md                                    # neuer Abschnitt "Deployment", Bekannte-Einschränkungen-Bullet aktualisiert
```

---

### Task 1: Statisches Frontend + SPA-Fallback im Fastify-Server (TDD)

**Files:**
- Modify: `apps/api/package.json`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/server.test.ts`

**Interfaces:**
- Consumes: `@fastify/static` (neue Dependency)
- Produces: `buildServer()` liefert bei vorhandenem `dist`-Verzeichnis (Pfad überschreibbar per `WEB_DIST_PATH`-Env-Var, Default relativ zu `server.ts`) statische Dateien aus und fällt für unbekannte Nicht-API-Routen auf `index.html` zurück; genutzt vom Dockerfile (Task 2), das `apps/web/dist` in exakt den vom Default-Pfad erwarteten Ort kopiert.

- [ ] **Step 1: `apps/api/package.json` — Dependency ergänzen**

Aktuell (Auszug `dependencies`):
```json
    "@bingo/shared": "workspace:*",
    "@fastify/cookie": "^9.4.0",
    "@fastify/cors": "^9.0.1",
    "@fastify/rate-limit": "^9.1.0",
    "fastify": "^4.28.1",
```

Ändere zu:
```json
    "@bingo/shared": "workspace:*",
    "@fastify/cookie": "^9.4.0",
    "@fastify/cors": "^9.0.1",
    "@fastify/rate-limit": "^9.1.0",
    "@fastify/static": "^7.0.4",
    "fastify": "^4.28.1",
```

Run: `pnpm install`
Expected: Lockfile aktualisiert sich, keine Fehler.

- [ ] **Step 2: Fehlschlagende Tests schreiben — `apps/api/src/server.test.ts` ergänzen**

Aktuelle Datei (vollständig, 26 Zeilen):
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

Ergänze am Ende der Datei:
```ts

import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("statisches Frontend", () => {
  let tempDir: string | undefined;

  afterEach(() => {
    delete process.env.WEB_DIST_PATH;
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  function createFixtureDist(): string {
    const dir = mkdtempSync(path.join(tmpdir(), "bingo-web-dist-"));
    writeFileSync(path.join(dir, "index.html"), "<!doctype html><html><body>App</body></html>");
    writeFileSync(path.join(dir, "app.js"), "console.log('app');");
    return dir;
  }

  it("liefert eine existierende Datei aus dem dist-Verzeichnis aus", async () => {
    tempDir = createFixtureDist();
    process.env.WEB_DIST_PATH = tempDir;
    const app = await buildServer();

    const response = await app.inject({ method: "GET", url: "/app.js" });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("console.log");
  });

  it("liefert index.html als SPA-Fallback für unbekannte Frontend-Routen", async () => {
    tempDir = createFixtureDist();
    process.env.WEB_DIST_PATH = tempDir;
    const app = await buildServer();

    const response = await app.inject({ method: "GET", url: "/boards/some-id/edit" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("App");
  });

  it("liefert weiterhin JSON-404 für unbekannte API-Routen, statt index.html", async () => {
    tempDir = createFixtureDist();
    process.env.WEB_DIST_PATH = tempDir;
    const app = await buildServer();

    const response = await app.inject({ method: "GET", url: "/api/does-not-exist" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Nicht gefunden" });
  });

  it("registriert kein statisches Ausliefern, wenn das dist-Verzeichnis nicht existiert", async () => {
    process.env.WEB_DIST_PATH = path.join(tmpdir(), "bingo-web-dist-does-not-exist-12345");
    const app = await buildServer();

    const response = await app.inject({ method: "GET", url: "/does-not-exist-at-all" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).not.toEqual({ error: "Nicht gefunden" });
  });
});
```

Ergänze außerdem `afterEach` im Import von vitest am Dateianfang — die erste Zeile der Datei ändert sich von:
```ts
import { describe, it, expect } from "vitest";
```
zu:
```ts
import { describe, it, expect, afterEach } from "vitest";
```

- [ ] **Step 3: Tests ausführen, Fehlschlag verifizieren**

Run: `pnpm --filter @bingo/api exec vitest run src/server.test.ts`
Expected: Die 4 neuen Tests FAILEN (kein `WEB_DIST_PATH`-Handling, kein `@fastify/static` registriert, `setNotFoundHandler` liefert überall Fastifys Standard-404 statt der erwarteten Werte).

- [ ] **Step 4: `apps/api/src/server.ts` anpassen**

Aktuell (vollständig, 68 Zeilen):
```ts
import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import "./env";
import { registerAuthRoutes } from "./auth/routes";
import { registerBoardRoutes } from "./boards/routes";
import { registerOverlayRoutes } from "./overlay/routes";
import type { OAuthProvider } from "./auth/types";
import { createE2EProvider, registerE2ERoutes } from "./e2e/setup";

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
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: "Zu viele Anfragen — bitte kurz warten.",
    }),
  });

  app.get("/health", async () => ({ status: "ok" }));

  await registerAuthRoutes(app, { provider: options.authProvider });
  await registerBoardRoutes(app);
  await registerOverlayRoutes(app);

  return app;
}

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

const isDirectRun = process.argv[1] === new URL(import.meta.url).pathname;
if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

Ändere die Import-Zeilen (nach `import rateLimit from "@fastify/rate-limit";` ergänzen, vor `import "./env";`):
```ts
import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import staticPlugin from "@fastify/static";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "./env";
import { registerAuthRoutes } from "./auth/routes";
import { registerBoardRoutes } from "./boards/routes";
import { registerOverlayRoutes } from "./overlay/routes";
import type { OAuthProvider } from "./auth/types";
import { createE2EProvider, registerE2ERoutes } from "./e2e/setup";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_ROUTE_PREFIXES = ["/api/", "/auth/", "/overlay/", "/health", "/e2e/"];
```

Ändere den Rückgabeblock von `buildServer` — füge vor `return app;` (nach `await registerOverlayRoutes(app);`) ein:
```ts
  await registerAuthRoutes(app, { provider: options.authProvider });
  await registerBoardRoutes(app);
  await registerOverlayRoutes(app);

  const webDistPath = process.env.WEB_DIST_PATH ?? path.join(__dirname, "../../web/dist");
  if (existsSync(webDistPath)) {
    await app.register(staticPlugin, { root: webDistPath });

    app.setNotFoundHandler((request, reply) => {
      const isApiRoute = API_ROUTE_PREFIXES.some((prefix) => request.url.startsWith(prefix));
      if (isApiRoute) {
        return reply.status(404).send({ error: "Nicht gefunden" });
      }
      return reply.sendFile("index.html");
    });
  }

  return app;
```

Der Rest der Datei (`main()`, der `isDirectRun`-Block) bleibt unverändert.

- [ ] **Step 5: Tests ausführen, Erfolg verifizieren**

Run: `pnpm --filter @bingo/api exec vitest run src/server.test.ts`
Expected: Alle Tests grün (die 2 bestehenden + die 4 neuen).

- [ ] **Step 6: Gesamte API-Testsuite und Typecheck**

Run: `pnpm --filter @bingo/api test` und `pnpm --filter @bingo/api exec tsc --noEmit`
Expected: Alle 119 Tests grün (115 bestehende + 4 neue), Typecheck sauber. Explizit verifizieren, dass keiner der bestehenden 115 Tests durch diese Änderung beeinflusst wurde (der `existsSync`-Guard hält die neue Logik inaktiv, solange `WEB_DIST_PATH` nicht gesetzt ist UND kein reales `apps/web/dist` existiert — falls auf der Ausführungsmaschine zufällig bereits ein `apps/web/dist` aus einem früheren `pnpm --filter @bingo/web build`-Lauf vorhanden ist, prüfen, dass auch dann keiner der 115 bestehenden Tests fehlschlägt, da diese ausschließlich API-Pfade ansprechen, die vom SPA-Fallback nicht betroffen sind).

- [ ] **Step 7: Commit**

```bash
git add apps/api/package.json apps/api/src/server.ts apps/api/src/server.test.ts pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat(api): statisches Frontend mit SPA-Fallback ausliefern

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Docker-Deployment-Artefakte (Dockerfile, Compose, Env-Beispiel)

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `docker-compose.prod.yml`
- Create: `.env.prod.example`

**Interfaces:**
- Consumes: `apps/api/src/server.ts`s `WEB_DIST_PATH`-Default (Task 1) — das Dockerfile muss die Monorepo-Struktur (`apps/api`, `apps/web/dist` als Geschwister unter `apps/`) beibehalten, damit der in Task 1 fest codierte relative Default-Pfad (`../../web/dist`) im Container korrekt auf das gebaute Frontend zeigt.
- Produces: ein lauffähiges Docker-Image; genutzt von `docker-compose.prod.yml` (`build: context: .`) und von der README-Anleitung (Task 3).

- [ ] **Step 1: `Dockerfile` erstellen (Repo-Root)**

```dockerfile
FROM node:20-alpine AS frontend-build
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @bingo/web build

FROM node:20-alpine AS runtime
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
COPY --from=frontend-build /app/apps/web/dist ./apps/web/dist
ENV NODE_ENV=production
EXPOSE 3001
CMD ["pnpm", "--filter", "@bingo/api", "start"]
```

- [ ] **Step 2: `.dockerignore` erstellen (Repo-Root)**

```
node_modules
**/node_modules
.git
.superpowers
docs
apps/web/dist
apps/api/dist
*.log
.env
.env.prod
```

- [ ] **Step 3: `docker-compose.prod.yml` erstellen (Repo-Root)**

```yaml
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    restart: unless-stopped
    environment:
      DATABASE_URL: postgres://${POSTGRES_USER:-bingo}:${POSTGRES_PASSWORD:-bingo}@postgres:5432/${POSTGRES_DB:-bingo}
      SESSION_SECRET: ${SESSION_SECRET}
      WEB_ORIGIN: https://${DOMAIN}
      TWITCH_CLIENT_ID: ${TWITCH_CLIENT_ID}
      TWITCH_CLIENT_SECRET: ${TWITCH_CLIENT_SECRET}
      TWITCH_REDIRECT_URI: https://${DOMAIN}/auth/twitch/callback
      PORT: 3001
      NODE_ENV: production
    depends_on:
      postgres:
        condition: service_healthy
    networks:
      - default
      - traefik
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.bingo.rule=Host(`${DOMAIN}`)"
      - "traefik.http.routers.bingo.entrypoints=websecure"
      - "traefik.http.routers.bingo.tls.certresolver=${TRAEFIK_CERTRESOLVER:-letsencrypt}"
      - "traefik.http.services.bingo.loadbalancer.server.port=3001"

  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-bingo}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-bingo}
      POSTGRES_DB: ${POSTGRES_DB:-bingo}
    volumes:
      - bingo_postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-bingo}"]
      interval: 5s
      timeout: 5s
      retries: 5
    networks:
      - default

networks:
  default:
  traefik:
    external: true
    name: ${TRAEFIK_NETWORK:-traefik-public}

volumes:
  bingo_postgres_data:
```

- [ ] **Step 4: `.env.prod.example` erstellen (Repo-Root)**

```
# Eigene Domain, unter der die App erreichbar sein soll
DOMAIN=example.com

# Postgres
POSTGRES_USER=bingo
POSTGRES_PASSWORD=change-me
POSTGRES_DB=bingo

# API
SESSION_SECRET=change-me-to-a-random-64-char-string

# Twitch OAuth (siehe https://dev.twitch.tv/console/apps)
TWITCH_CLIENT_ID=
TWITCH_CLIENT_SECRET=

# Nur nötig, falls Name/Certresolver des eigenen Traefik-Setups von den
# Standardwerten (traefik-public / letsencrypt) abweichen
TRAEFIK_NETWORK=traefik-public
TRAEFIK_CERTRESOLVER=letsencrypt
```

- [ ] **Step 5: Docker-Image bauen und verifizieren**

Run:
```bash
docker build -t bingo-deploy-test .
```
Expected: Build läuft ohne Fehler durch (beide Stufen: `frontend-build` erzeugt `apps/web/dist`, `runtime` installiert alle Dependencies und kopiert das gebaute Frontend hinein). Das kann mehrere Minuten dauern (zwei vollständige `pnpm install`-Durchläufe plus Vite-Build).

- [ ] **Step 6: Gebautes Image gegen die bestehende lokale Postgres-Instanz starten**

Run (Docker Postgres aus der bestehenden `docker-compose.yml` muss laufen — `docker compose up -d`, `pg_isready` abwarten):
```bash
docker run --rm -d --name bingo-deploy-test \
  --network host \
  -e DATABASE_URL="postgres://bingo:bingo@localhost:5433/bingo" \
  -e SESSION_SECRET="test-secret-für-lokalen-smoke-test-1234567890" \
  -e WEB_ORIGIN="http://localhost:3002" \
  -e TWITCH_CLIENT_ID="test" \
  -e TWITCH_CLIENT_SECRET="test" \
  -e TWITCH_REDIRECT_URI="http://localhost:3002/auth/twitch/callback" \
  -e PORT="3002" \
  bingo-deploy-test
sleep 2
curl -s -o /dev/null -w "health: %{http_code}\n" http://localhost:3002/health
curl -s -o /dev/null -w "frontend: %{http_code}\n" http://localhost:3002/
docker logs bingo-deploy-test
docker stop bingo-deploy-test
```
Expected: `health: 200`, `frontend: 200` (liefert `index.html` des gebauten Vue-Frontends aus), keine Fehler in den Logs. Hinweis: `--network host` funktioniert nur unter Linux direkt; unter macOS/Windows (Docker Desktop) stattdessen `-p 3002:3002` verwenden und `DATABASE_URL` auf `host.docker.internal` statt `localhost` zeigen lassen (`postgres://bingo:bingo@host.docker.internal:5433/bingo`) — je nach lokalem Docker-Setup die passende Variante wählen und in der Ausführung dokumentieren, welche verwendet wurde.

- [ ] **Step 7: Compose-Datei auf Syntaxfehler prüfen**

Run:
```bash
DOMAIN=example.com \
POSTGRES_USER=bingo POSTGRES_PASSWORD=bingo POSTGRES_DB=bingo \
SESSION_SECRET=test TWITCH_CLIENT_ID=test TWITCH_CLIENT_SECRET=test \
docker compose -f docker-compose.prod.yml config
```
Expected: Gibt die vollständig interpolierte, gültige YAML-Konfiguration aus (kein Fehler) — validiert Syntax und Variablen-Interpolation, ohne dass das externe `traefik`-Netzwerk tatsächlich existieren muss (reiner Konfigurations-Check, kein Start).

- [ ] **Step 8: `.gitignore` prüfen — `.env.prod` darf niemals committet werden**

Run: `grep -n "\.env" .gitignore`
Expected: Ein Muster wie `.env*` oder explizit `.env.prod` ist bereits vorhanden (die bestehende `.gitignore` deckt vermutlich schon `.env` generisch ab — falls `.env.prod` davon NICHT erfasst wird, `.gitignore` um eine Zeile `.env.prod` ergänzen und mit committen).

- [ ] **Step 9: Aufräumen**

Run: `docker rmi bingo-deploy-test` (Test-Image entfernen, nicht Teil des Commits)

- [ ] **Step 10: Commit**

```bash
git add Dockerfile .dockerignore docker-compose.prod.yml .env.prod.example
# .gitignore nur hinzufügen, falls in Step 8 angepasst:
git add .gitignore
git commit -m "$(cat <<'EOF'
feat: generisches Docker-Deployment (Dockerfile, Compose, Traefik-Labels)

Domain, Traefik-Netzwerk und Certresolver kommen ausschließlich aus
Umgebungsvariablen (.env.prod, nie committet) - keine Infrastruktur-
Details im öffentlichen Repository.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: README — Deployment-Anleitung

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: die exakten Datei-/Variablennamen aus Task 1 und Task 2
- Produces: keine — reine Dokumentation

- [ ] **Step 1: Neuen Abschnitt "Deployment" einfügen**

Füge nach dem bestehenden Abschnitt „## OBS-Overlay einrichten" (endet mit „...sollten trotzdem neu eingerichtet werden.") und vor „## Bekannte Einschränkungen" folgenden neuen Abschnitt ein:

```markdown
## Deployment

Die App lässt sich als einzelnes Docker-Image auf einem beliebigen eigenen Docker-Host
betreiben, der Traefik als Reverse Proxy nutzt (z. B. ein VPS, verwaltet per Portainer oder
direkt per SSH). Frontend und Backend laufen dabei in einem Container — der Fastify-Server
liefert das gebaute Vue-Frontend direkt mit aus, es ist kein separates Hosting dafür nötig.

1. `.env.prod.example` nach `.env.prod` kopieren und eigene Werte eintragen (Domain, Postgres-
   Zugangsdaten, `SESSION_SECRET`, Twitch-OAuth-Zugangsdaten). `.env.prod` wird **niemals**
   committet.
2. In der Twitch-Developer-Konsole ([dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps))
   die registrierte Redirect-URL auf `https://<eigene-domain>/auth/twitch/callback` setzen.
3. Deployen:
   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
   ```
   Das funktioniert identisch, ob manuell per SSH ausgeführt oder als Stack in Portainer
   eingerichtet (per Datei-Upload oder per Verweis auf ein Git-Repository).
4. Einmalig (und nach künftigen Datenbank-Schema-Änderungen) Migrationen ausführen:
   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.prod exec app pnpm --filter @bingo/api db:migrate
   ```
5. DNS-Eintrag der eigenen Domain auf den Ziel-Host setzen (außerhalb dieses Repositories, beim
   jeweiligen Domain-Provider).

Falls das eigene Traefik-Setup andere Namen für Netzwerk oder Certresolver verwendet als die
Standardwerte (`traefik-public` / `letsencrypt`), `TRAEFIK_NETWORK`/`TRAEFIK_CERTRESOLVER` in
`.env.prod` entsprechend anpassen. Wird kein Traefik genutzt, die `labels:`-Sektion und die
`traefik`-Netzwerk-Zeile in `docker-compose.prod.yml` entfernen und stattdessen einen Host-Port
auf Container-Port 3001 mappen.
```

- [ ] **Step 2: „Bekannte Einschränkungen" aktualisieren**

Aktuell (der veraltete Bullet zur fehlenden Produktionsbereitstellung):
```markdown
- Eine containerisierte Produktionsbereitstellung (Dockerfile für `apps/api`/`apps/web`) ist noch
  nicht gebaut — `docker-compose.yml` startet aktuell nur Postgres. Das konkrete Hosting-Ziel ist
  laut SPEC noch offen; lokal lässt sich die API separat mit `pnpm --filter @bingo/api build && pnpm --filter @bingo/api start` starten. Für `apps/web` erzeugt `pnpm --filter @bingo/web build` ein statisches `dist/`-Verzeichnis, das noch von einem eigenen Webserver ausgeliefert werden müsste — dafür gibt es aktuell keine vorgefertigte Lösung.
```

Ersetze durch:
```markdown
- Eine containerisierte Produktionsbereitstellung existiert (siehe Abschnitt „Deployment" oben),
  setzt aber einen eigenen Docker-Host mit Traefik als Reverse Proxy voraus — andere
  Reverse-Proxy-Lösungen (z. B. nginx-proxy-manager, Caddy) werden nicht direkt unterstützt,
  lassen sich aber durch Anpassen der `labels:`-Sektion in `docker-compose.prod.yml` einbinden.
```

- [ ] **Step 3: Manuell gegenlesen**

Öffne `README.md` und prüfe, dass der neue Abschnitt korrekt zwischen „OBS-Overlay einrichten" und
„Bekannte Einschränkungen" eingefügt ist, die Markdown-Formatierung (Code-Blöcke, Nummerierung)
sauber gerendert wird, und keine der in Task 1/2 erstellten Dateien (`Dockerfile`,
`docker-compose.prod.yml`, `.env.prod.example`) falsch benannt referenziert wird.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
docs: Deployment-Anleitung für generisches Docker-Setup ergänzen

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Nach Abschluss dieses Plans

Automatisiert verifiziert: die neue statische-Ausliefer-Logik per Vitest (4 neue + 115 bestehende
API-Tests grün), das Docker-Image baut und startet erfolgreich mit einem lokalen Smoke-Test gegen
`/health` und `/`, die Compose-Datei ist syntaktisch gültig.

**Manuell zu verifizieren (nicht Teil dieses Plans, da außerhalb des Repository-Zugriffs):** ein
echtes Deployment auf dem eigenen Docker-Host hinter Traefik, inkl. TLS-Zertifikat-Ausstellung und
tatsächlicher Erreichbarkeit unter der eigenen Domain.
