# Bingo Card Generator – Projektspezifikation

> Diese Datei beschreibt das Projekt vollständig und dient als Arbeitsgrundlage für Claude Code.
> Bei Unklarheiten: zuerst Abschnitt „Geklärte Punkte" prüfen, dann nachfragen statt raten.

## 1. Ziel

Eine Web-App, mit der Streamer eigene Bingo-Karten erstellen, verwalten und als **OBS-Overlay** (Browser Source) einbinden können. Der Streamer hakt während des Streams Felder ab; jeder Klick wird sofort gespeichert und live im Overlay angezeigt.

## 2. Kernfunktionen

### 2.1 Login
- Login ausschließlich per **Twitch OAuth** (Authorization Code Flow, serverseitig).
- Benötigter Scope: keiner über die Basisdaten hinaus (nur User-ID, Login-Name, Display-Name, Avatar).
- Sessions per HttpOnly-, Secure-, SameSite=Lax-Cookie. Kein Token im LocalStorage.
- Auth-Logik so kapseln, dass später weitere Provider (z. B. YouTube, Discord) ergänzt werden können.

### 2.2 Layouts (Board-Größen)
- Verfügbare Größen: **3×3, 5×5, 7×7, 9×9**.
- Die Größe wird beim Anlegen gewählt und ist danach fest (siehe Abschnitt 11).

### 2.3 Beschriftung
- **Spalten:** Buchstaben, **oben und unten** angezeigt.
  - Standard: `A, B, C, …` (3×3 → A–C, 5×5 → A–E, 7×7 → A–G, 9×9 → A–I).
  - Nur bei 5×5 zusätzlich wählbar: klassisch `B I N G O`.
  - Bei allen Größen zusätzlich wählbar: **eigene Spaltenwörter** (`label_mode = 'custom'`), frei editierbar im Editor, Länge = Spaltenanzahl, je Wort max. 20 Zeichen (Konstante, siehe `packages/shared`).
- **Reihen:** Zahlen `1…n`, **links und rechts** angezeigt (nicht anpassbar).
- Die Beschriftungs-Variante ist pro Board gespeichert (`label_mode`); bei `custom` zusätzlich die Wörter selbst (`column_labels`).

### 2.4 Board-Editor
- Nach Wahl des Layouts wird ein leeres Raster angezeigt.
- Klick auf ein Feld → Inline-Bearbeitung des Textes (Textarea, Enter = Zeilenumbruch, Klick außerhalb / Esc = übernehmen).
- Max. **80 Zeichen** pro Feld (Konstante, leicht änderbar).
- Board-Name frei vergebbar (Pflichtfeld, max. 60 Zeichen, Default: „Neues Bingo").
- Speichern per Button; bei ungespeicherten Änderungen Warnung beim Verlassen.
- Leere Felder sind erlaubt.

### 2.5 Board-Verwaltung (Dashboard)
Liste aller Boards des Users mit Name, Größe, Anzahl abgehakter Felder, zuletzt geändert.
Aktionen pro Board:
- **Bearbeiten** (Name, Texte, Beschriftungs-Variante)
- **Spielen / Steuern** (Control-Seite öffnen)
- **Overlay-Link kopieren**
- **Duplizieren** → neues Board mit Name `"<Name> (Kopie)"`, gleiche Größe, Texte und Beschriftung; **alle Häkchen zurückgesetzt**; neuer Overlay-Token.
- **Löschen** → mit Bestätigungsdialog; Overlay-Link wird dadurch ungültig.
- **Häkchen zurücksetzen** (alle Kreuze entfernen, mit Bestätigung).
- **Overlay-Link neu generieren** (alter Link wird ungültig – nützlich, falls der Link geleakt ist).

### 2.6 Control-Seite (Interaktion)
- Nur für eingeloggten Besitzer erreichbar.
- Zeigt das Board wie das Overlay, Klick auf ein Feld setzt/entfernt ein **Kreuz (X)**.
- Jede Interaktion wird **sofort** gespeichert (optimistic UI, bei Fehler zurückrollen + Hinweis).
- Der Request sendet den **Zielzustand** (`checked: true/false`), kein Toggle → idempotent, keine Race Conditions bei Doppelklick.

### 2.7 Overlay-Seite (OBS)
- Öffentliche URL: `/overlay/<token>`; Token ist zufällig und nicht erratbar (mind. 128 Bit, URL-safe).
- **Read-only**: Zuschauer bzw. Personen mit dem Link können nichts verändern.
- Kein App-Chrome (keine Navigation, kein Login-Hinweis), **transparenter Hintergrund**.
- Board skaliert auf die Größe der Browser Source (quadratisch, zentriert).
- Texte skalieren automatisch, damit sie ins Feld passen (Auto-Fit), gut lesbar über Spielszenen (Kontur/Schatten).
- **Live-Updates** per Server-Sent Events (SSE): Änderungen an Häkchen und Texten erscheinen ohne Reload. Automatischer Reconnect bei Verbindungsabbruch; nach Reconnect kompletten Stand neu laden.
- Ungültiger/gelöschter Token → Overlay zeigt nichts (leer, transparent), damit im Stream keine Fehlermeldung auftaucht.

## 3. Technischer Stack

| Bereich | Wahl |
|---|---|
| Frontend | Vue 3 (Composition API, `<script setup>`), TypeScript, Vite, Vue Router, Pinia |
| Styling | Tailwind CSS |
| Backend | Node.js, TypeScript, Fastify |
| Datenbank | PostgreSQL |
| ORM / Migrationen | Drizzle ORM (inkl. Migrationen) |
| Validierung | Zod (Schemas zwischen Frontend und Backend geteilt) |
| Realtime | Server-Sent Events |
| Tests | Vitest (Unit), Playwright (E2E für Kern-Flows) |
| Deployment | Docker Compose (app + postgres) |

Repo-Struktur (pnpm Workspaces):

```
/apps/web        Vue-Frontend
/apps/api        Fastify-Backend
/packages/shared Zod-Schemas, Typen, Konstanten (Größen, Zeichenlimits, Label-Logik)
```

## 4. Datenmodell

```
users
  id              uuid PK
  twitch_id       text UNIQUE NOT NULL
  login           text NOT NULL
  display_name    text NOT NULL
  avatar_url      text
  created_at      timestamptz
  updated_at      timestamptz

boards
  id              uuid PK
  user_id         uuid FK -> users.id ON DELETE CASCADE
  name            text NOT NULL (max 60)
  size            smallint NOT NULL CHECK (size IN (3,5,7,9))  -- nach Anlage nicht mehr änderbar
  label_mode      text NOT NULL CHECK (label_mode IN ('letters','bingo','custom'))  -- 'bingo' nur bei size=5
  column_labels   jsonb NULL  -- Array von Strings, Länge = size, je Eintrag max. 20 Zeichen; nur gesetzt wenn label_mode='custom'
  overlay_token   text UNIQUE NOT NULL
  created_at      timestamptz
  updated_at      timestamptz

board_cells
  board_id        uuid FK -> boards.id ON DELETE CASCADE
  row             smallint NOT NULL  -- 0-basiert
  col             smallint NOT NULL  -- 0-basiert
  text            text NOT NULL DEFAULT '' (max 80)
  checked         boolean NOT NULL DEFAULT false
  checked_at      timestamptz NULL
  PRIMARY KEY (board_id, row, col)

sessions
  id              text PK
  user_id         uuid FK -> users.id ON DELETE CASCADE
  expires_at      timestamptz
```

Beim Anlegen eines Boards werden alle `size × size` Zellen direkt erzeugt.

## 5. API

Alle `/api/*`-Routen außer `/api/overlay/*` erfordern Login und prüfen, dass das Board dem User gehört (sonst 404, nicht 403).

```
GET    /auth/twitch                         -> Redirect zu Twitch (mit state-Parameter gegen CSRF)
GET    /auth/twitch/callback                -> User anlegen/aktualisieren, Session setzen
POST   /auth/logout
GET    /api/me

GET    /api/boards                          -> Liste (inkl. checked_count)
POST   /api/boards                          {name, size, label_mode, column_labels?}
GET    /api/boards/:id                      -> Board inkl. Zellen
PATCH  /api/boards/:id                      {name?, label_mode?, column_labels?, cells?: [{row,col,text}]}
DELETE /api/boards/:id
POST   /api/boards/:id/duplicate            -> neues Board
PUT    /api/boards/:id/cells/:row/:col/checked   {checked: boolean}
POST   /api/boards/:id/reset                -> alle checked = false
POST   /api/boards/:id/regenerate-token

GET    /api/overlay/:token                  -> öffentliche Board-Daten (ohne user_id, ohne interne IDs)
GET    /api/overlay/:token/events           -> SSE-Stream
```

Nach jeder Änderung an Texten, Häkchen, Beschriftung oder Reset wird ein Event an alle SSE-Clients des Boards gesendet. Für den Start reicht ein In-Memory-Pub/Sub im API-Prozess; so kapseln, dass später Postgres `LISTEN/NOTIFY` oder Redis eingesetzt werden kann.

Rate Limiting auf Schreib-Endpoints (z. B. 30 Requests / 10 s pro User).

## 6. Frontend-Routen

```
/                       Landing mit „Mit Twitch einloggen"
/boards                 Dashboard (Login erforderlich)
/boards/new             Größe + Beschriftung + Name wählen
/boards/:id/edit        Editor
/boards/:id/play        Control-Seite
/overlay/:token         OBS-Overlay (öffentlich, eigenes minimales Layout)
```

## 7. Darstellung

- Raster als CSS Grid: `(size + 2) × (size + 2)` Zellen, äußerer Ring = Beschriftungen (Ecken leer).
- Kreuz als SVG über dem Feldtext (zwei diagonale Linien, gut sichtbare Farbe, leichte Animation beim Setzen).
- Text bleibt unter dem Kreuz lesbar.
- Label-Logik zentral in `packages/shared` (`getColumnLabels(size, labelMode, columnLabels?)`, `getRowLabels(size)`).
- UI-Sprache: Deutsch; Texte zentral ablegen (vue-i18n), damit Englisch später leicht ergänzt werden kann.

## 8. Sicherheit

- OAuth `state`-Parameter prüfen.
- Twitch Client-ID/Secret, Session-Secret, DB-URL nur über Umgebungsvariablen (`.env.example` bereitstellen).
- Alle Eingaben serverseitig mit Zod validieren (Größen, Zeichenlimits, Zellkoordinaten im gültigen Bereich).
- Zelltexte nur als Text rendern (kein `v-html`).
- Overlay-Endpoint gibt keine personenbezogenen Daten außer dem Nötigsten heraus.

## 9. Akzeptanzkriterien

1. User kann sich per Twitch einloggen und ausloggen.
2. User kann Boards in 3×3, 5×5, 7×7, 9×9 anlegen; bei 5×5 zwischen `A–E` und `BINGO` wählen; bei allen Größen alternativ eigene Spaltenwörter vergeben.
3. Spaltenbuchstaben erscheinen oben und unten, Reihennummern links und rechts – im Editor, auf der Control-Seite und im Overlay.
4. Felder lassen sich per Klick mit Text füllen und speichern.
5. Boards können benannt, bearbeitet, dupliziert (ohne Häkchen) und gelöscht werden.
6. Overlay-Link funktioniert als OBS Browser Source mit transparentem Hintergrund.
7. Kreuz auf der Control-Seite erscheint innerhalb von ~1 s im Overlay, ohne Reload.
8. Nach Neuladen der Control-Seite oder des Overlays ist der zuletzt gespeicherte Stand sichtbar.
9. Fremde Boards sind weder einsehbar noch veränderbar; über den Overlay-Link sind keine Änderungen möglich.

## 10. Umsetzungsreihenfolge

1. Monorepo-Setup, Docker Compose, DB-Schema + Migrationen, shared-Package.
2. Twitch-Login + Sessions.
3. Board-CRUD (API + Dashboard).
4. Editor inkl. Beschriftungslogik.
5. Control-Seite mit Häkchen-Persistenz.
6. Overlay-Seite + SSE-Live-Updates.
7. Duplizieren, Reset, Token neu generieren.
8. Tests (Unit + E2E der Akzeptanzkriterien), README mit Setup- und OBS-Anleitung.

## 11. Geklärte Punkte (ehemals „Offene Punkte")

Entschieden am 2026-09-24 in Abstimmung mit dem Projektinhaber:

- **Größe nachträglich ändern?** → **Nein.** Größe ist nach Anlage fix (siehe Datenmodell, `size`).
- **Freies Mittelfeld („FREE")?** → **Nicht in v1.** Kann als spätere Erweiterung ergänzt werden.
- **Eigene Spaltenwörter** statt nur A–Z bzw. BINGO? → **Ja**, umgesetzt über `label_mode = 'custom'` und `boards.column_labels` (siehe Abschnitte 2.3, 4, 5).
- **Overlay-Styling** pro Board konfigurierbar? → **Nein.** Ein festes, gut lesbares Default-Design für v1; spätere Erweiterung möglich.
- **Bingo-Erkennung** (volle Reihe/Spalte/Diagonale hervorheben)? → **Nicht in v1.**
- **Hosting-Ziel?** → **Noch offen.** Docker-Compose-Setup bleibt plattformagnostisch (App + Postgres), konkrete Zielplattform wird später gewählt.
