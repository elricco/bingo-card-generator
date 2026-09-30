# Deployment auf einem eigenen Docker-Host (Design)

## Ziel

Eine generische, wiederverwendbare Möglichkeit schaffen, das Bingo Card Generator-Projekt auf einem beliebigen eigenen Docker-Host mit Traefik als Reverse Proxy zu betreiben — z. B. einem VPS, der über Portainer verwaltet wird, oder auch per einfachem `docker compose up`. Alles, was zur eigenen Domain/Infrastruktur gehört, kommt ausschließlich aus Umgebungsvariablen, die **nicht** ins Repository committet werden — damit ist das Setup für jeden Nutzer dieses Repos direkt verwendbar, ohne Repo-Inhalte anpassen zu müssen.

## Kontext

- Frontend (`apps/web`): Vue 3 SPA, gebaut mit Vite zu statischen Dateien (`dist/`).
- Backend (`apps/api`): Fastify, läuft laut Phase-8-Build-Fix über `tsx` (kein kompilierter Build), benötigt `packages/shared` zur Laufzeit (dessen `package.json` bewusst auf TS-Quellcode zeigt).
- Datenbank: PostgreSQL, lokal bereits per `docker-compose.yml` (nur `postgres`-Service, Port 5433) betrieben.
- Niemand (weder Claude Code noch dieses Repository) hat Zugriff auf den tatsächlichen Ziel-Host — alle in diesem Plan erzeugten Artefakte (Dockerfile, Compose-Datei, Anleitung) werden vom jeweiligen Nutzer selbst mit seinen eigenen Werten (Domain, Traefik-Netzwerk, Secrets) angewendet.
- Repository ist öffentlich — keine Domain-, Anbieter- oder Infrastruktur-spezifischen Angaben in irgendeiner committeten Datei.

## Architekturentscheidung: ein Container liefert Frontend + Backend gemeinsam aus

Statt Frontend und Backend als zwei Container mit CORS dazwischen zu betreiben, liefert der Fastify-Server das gebaute Frontend (`apps/web/dist`) direkt mit aus (`@fastify/static`, SPA-Fallback auf `index.html` für alle nicht-API-Pfade). Ergebnis: ein Container (`app`), eine Domain, kein CORS-Bedarf in Produktion.

**Warum eine neue `docker-compose.prod.yml` statt die bestehende `docker-compose.yml` zu erweitern:** Die bestehende Datei wird weiterhin für die lokale Entwicklung gebraucht (Postgres mit auf den Host gemapptem Port 5433, damit `pnpm dev:api` sich lokal verbinden kann). Eine separate Produktions-Compose-Datei vermeidet jedes Risiko, den bestehenden lokalen Entwicklungs-Workflow zu stören.

## Komponente 1: `apps/api/src/server.ts` — statisches Frontend ausliefern

Neue Abhängigkeit `@fastify/static` (kompatibel mit Fastify v4, das dieses Projekt nutzt). Registrierung **nur wenn `apps/web/dist` tatsächlich existiert** (`existsSync`-Guard) — dadurch bleibt das Verhalten in Tests und lokaler Entwicklung (wo `dist/` nicht existiert) exakt wie bisher, ohne eine der 115 bestehenden API-Tests zu berühren.

```ts
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import staticPlugin from "@fastify/static";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDistPath = path.join(__dirname, "../../web/dist");
const API_ROUTE_PREFIXES = ["/api/", "/auth/", "/overlay/", "/health", "/e2e/"];
```

Nach der Registrierung der bestehenden Routen (Auth/Boards/Overlay), am Ende von `buildServer()`, vor dem `return app;`:

```ts
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
```

`webDistPath` wird relativ zu `server.ts`s eigenem Verzeichnis berechnet (`apps/api/src` → zwei Ebenen hoch zu `apps/` → `web/dist`), was voraussetzt, dass das Docker-Image die Monorepo-Struktur (`apps/api`, `apps/web/dist` als Geschwister unter `apps/`) beibehält — siehe Dockerfile unten.

Fastifys Router prüft spezifische Routen (z. B. `/api/boards`) unabhängig von der Registrierungsreihenfolge vor dem `setNotFoundHandler` — es gibt daher kein Risiko, dass die SPA-Fallback-Logik echte API-Routen überschreibt.

## Komponente 2: `Dockerfile` (Repo-Root, Multi-Stage)

Zwei Stufen, jede mit einer eigenständigen, kompletten `pnpm install` (bewusst keine Node-Modules-Kopie zwischen Stufen — pnpms symlink-basierte `node_modules`-Struktur ist über Docker-Layer-Grenzen fragil; zwei vollständige Installs sind langsamer, aber robust und einfach nachvollziehbar):

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

`pnpm --filter @bingo/api start` führt (identisch zu Phase 8s verifiziertem lokalem Build-Fix) `tsx src/server.ts` im Kontext von `apps/api` aus. Diese Datei enthält keinerlei domain- oder hostingspezifische Angaben.

## Komponente 3: `.dockerignore` (Repo-Root)

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

Verhindert, dass lokale `node_modules`, `.env`/`.env.prod` mit echten Secrets, oder Build-Artefakte in den Docker-Build-Kontext gelangen.

## Komponente 4: `docker-compose.prod.yml` (Repo-Root, neu, separat von der bestehenden `docker-compose.yml`)

Vollständig generisch — Domain, Traefik-Netzwerk und Certresolver kommen ausschließlich aus Umgebungsvariablen (mit sinnvollen, verbreiteten Defaults für Traefik-Netzwerk/Certresolver, damit es bei vielen Standard-Traefik-Setups ohne Anpassung funktioniert):

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

`DOMAIN` hat bewusst **keinen** Default-Wert — Docker Compose bricht das Deployment mit einer klaren Fehlermeldung ab, wenn die Variable fehlt, statt versehentlich mit einem Platzhalter-Wert zu starten. `TRAEFIK_NETWORK` und `TRAEFIK_CERTRESOLVER` haben verbreitete Standardwerte (`traefik-public`, `letsencrypt`), lassen sich aber überschreiben, falls das eigene Traefik-Setup andere Namen verwendet. Wer keinen Traefik-Reverse-Proxy nutzt, entfernt die `labels:`-Sektion und die `traefik`-Netzwerk-Zeile und mappt stattdessen einen Host-Port auf Container-Port 3001.

## Komponente 5: `.env.prod.example` (Repo-Root, neu)

Dokumentiert alle für `docker-compose.prod.yml` benötigten Variablen mit generischen Platzhaltern — **keine echten Werte**, keine Beispiel-Domain, die auf echte Infrastruktur schließen lässt:

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

## Komponente 6: Deployment-Anleitung (README-Ergänzung, generisch)

Neuer README-Abschnitt „Deployment" mit generischer, providerunabhängiger Anleitung:
1. `.env.prod.example` nach `.env.prod` kopieren, eigene Werte eintragen (niemals committen — bereits in `.gitignore`/`.dockerignore`).
2. Twitch-Developer-Konsole: registrierte Redirect-URL auf `https://<eigene-domain>/auth/twitch/callback` aktualisieren.
3. Deployment über `docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build` — funktioniert identisch, ob manuell per SSH ausgeführt oder als Stack in Portainer (Datei-Upload oder Git-Repository-Verweis) eingerichtet.
4. Einmalig (und nach künftigen Schema-Änderungen) Migrationen ausführen: `docker compose -f docker-compose.prod.yml --env-file .env.prod exec app pnpm --filter @bingo/api db:migrate`.
5. DNS-Eintrag der eigenen Domain auf den Ziel-Host setzen (außerhalb des Repos, beim jeweiligen Domain-Provider).

## Testabdeckung dieser Änderung

- Bestehende 115 API-Tests: dürfen sich nicht ändern, da `existsSync`-Guard die neue Logik in Tests/Dev inaktiv hält (kein `apps/web/dist` vorhanden) — wird durch einen vollständigen Testlauf nach der Änderung verifiziert.
- Neuer Test: `buildServer()` mit einem simulierten/temporären `dist`-Verzeichnis verifiziert, dass (a) eine existierende statische Datei ausgeliefert wird, (b) eine unbekannte Frontend-Route `index.html` liefert (SPA-Fallback), (c) eine unbekannte API-Route weiterhin JSON-404 liefert.
- Docker-Build selbst kann nicht in der bestehenden Vitest-Suite getestet werden (kein Docker in der CI/Testumgebung dieses Projekts) — wird stattdessen, sofern lokal Docker verfügbar ist, manuell per `docker build` verifiziert.

## Nicht Teil dieses Plans (bewusst abgegrenzt)

- Automatisierte Migrationen bei jedem Deploy (Risiko bei gleichzeitigen Container-Neustarts) — bleibt expliziter manueller Schritt.
- CI/CD-Pipeline (GitHub Actions o. Ä.) — bleibt jedem Nutzer selbst überlassen.
- DNS-Konfiguration — außerhalb des Repositories, rein beim jeweiligen Domain-Provider.
- Unterstützung für andere Reverse-Proxy-Lösungen als Traefik (z. B. nginx-proxy-manager, Caddy) — die Compose-Datei ist so gestaltet, dass die Traefik-spezifischen Teile leicht entfernt/ersetzt werden können, eine generische Abstraktion für beliebige Reverse Proxies wäre aber deutlich komplexer und nicht Teil dieses Plans.
