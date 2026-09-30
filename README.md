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

## Bekannte Einschränkungen

- Bingo-Erkennung (volle Reihe/Spalte/Diagonale hervorheben), ein freies Mittelfeld und
  Overlay-Styling pro Board sind laut [SPEC.md, Abschnitt 11](./SPEC.md#11-geklärte-punkte-ehemals-offene-punkte)
  bewusst nicht Teil von v1.
- Eine containerisierte Produktionsbereitstellung existiert (siehe Abschnitt „Deployment" oben),
  setzt aber einen eigenen Docker-Host mit Traefik als Reverse Proxy voraus — andere
  Reverse-Proxy-Lösungen (z. B. nginx-proxy-manager, Caddy) werden nicht direkt unterstützt,
  lassen sich aber durch Anpassen der `labels:`-Sektion in `docker-compose.prod.yml` einbinden.
- Weitere OAuth-Provider (YouTube, Discord) sind vorbereitet (die Auth-Schicht ist providerneutral
  aufgebaut), aber noch nicht implementiert.
- Die E2E-Suite setzt die Datenbank zwischen Testläufen nicht zurück — bei wiederholten lokalen
  Läufen können alte Testdaten sich ansammeln; die betroffenen Tests verwenden bereits eindeutige
  Namen, um das abzufedern, aber ein echter Reset-Mechanismus existiert noch nicht.
