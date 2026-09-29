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
  laut SPEC noch offen; lokal lässt sich die API separat mit `pnpm --filter @bingo/api build && pnpm --filter @bingo/api start` starten. Für `apps/web` erzeugt `pnpm --filter @bingo/web build` ein statisches `dist/`-Verzeichnis, das noch von einem eigenen Webserver ausgeliefert werden müsste — dafür gibt es aktuell keine vorgefertigte Lösung.
- Weitere OAuth-Provider (YouTube, Discord) sind vorbereitet (die Auth-Schicht ist providerneutral
  aufgebaut), aber noch nicht implementiert.
- Die E2E-Suite setzt die Datenbank zwischen Testläufen nicht zurück — bei wiederholten lokalen
  Läufen können alte Testdaten sich ansammeln; die betroffenen Tests verwenden bereits eindeutige
  Namen, um das abzufedern, aber ein echter Reset-Mechanismus existiert noch nicht.
