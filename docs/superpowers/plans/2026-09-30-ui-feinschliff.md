# UI-Feinschliff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vier optische Anpassungen am bereits vollständig funktionsfähigen Frontend: Header-Layout, Default-Werte beim Board-Anlegen, größere ✕-Markierung auf Control-/Overlay-Seite, und Icon-Buttons mit zweizeiligem Layout im Dashboard.

**Architecture:** Alle vier Änderungen sind rein im Frontend (`apps/web`), betreffen disjunkte Dateimengen und sind unabhängig voneinander umsetzbar. Für die ✕-Markierung wird CSS Container Queries (`container-type: size` + `cqmin`-Einheiten) verwendet, damit die Größe der Markierung sich proportional zur tatsächlichen Zellgröße verhält — unabhängig von Board-Größe (3×3 bis 9×9) und Viewport. Container Queries werden von modernen Browsern (Chrome 105+, das von OBS genutzte Chromium ist deutlich neuer) unterstützt; jsdom (Testumgebung) berechnet kein echtes CSS-Layout und kann Container-Query-Werte nicht sinnvoll auflösen — diese eine Änderung wird daher manuell im laufenden Dev-Server verifiziert statt per automatisiertem Test. Für die Icon-Buttons werden eigene, minimale Inline-SVG-Vue-Komponenten gebaut (kein Icon-Paket im Projekt vorhanden, siehe Global Constraints), da der Nutzer das explizit gewünscht hat.

**Tech Stack:** Vue 3 `<script setup>`, Tailwind CSS 3.4 (inkl. Arbitrary Properties/Values für Container Queries), Vitest + @vue/test-utils.

**Spec:** Kein SPEC.md-Bezug (rein optische Nacharbeit nach Abschluss aller SPEC-Phasen); Anforderungen stammen direkt aus der Chat-Konversation mit dem Nutzer.

## Global Constraints

- Es existiert aktuell **keine Icon-Bibliothek** im Projekt (`apps/web/package.json` geprüft, keine Treffer für heroicons/lucide/iconify/etc.). Icons werden als eigene, minimale Inline-SVG-Vue-Komponenten unter `apps/web/src/components/icons/` gebaut, keine neue Dependency hinzufügen.
- Jeder Icon-Button braucht sowohl `title` als auch `aria-label` mit demselben deutschen Text wie zuvor (z. B. „Löschen") — `title` für den Hover-Tooltip, `aria-label` für Screenreader.
- UI-Sprache Deutsch (bestehende Konvention, unverändert).
- Sowohl `vitest run` als auch `vue-tsc --noEmit` müssen für `apps/web` sauber durchlaufen.
- Arbeit erfolgt direkt auf `main`, kein Worktree (etablierte Projektkonvention).
- Jeder Commit endet mit exakt: `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.

---

## Datei-Übersicht

```
apps/web/src/components/AppHeader.vue          # Layout: User-Info rechts neben Ausloggen-Button
apps/web/src/components/AppHeader.test.ts       # neu

apps/web/src/views/NewBoardView.vue             # Default size=5, label_mode=bingo
apps/web/src/views/NewBoardView.test.ts         # 2 Tests an neue Defaults angepasst

apps/web/src/views/ControlView.vue              # ✕-Markierung via Container Query
apps/web/src/views/OverlayView.vue              # ✕-Markierung via Container Query

apps/web/src/components/icons/IconPlay.vue      # neu
apps/web/src/components/icons/IconLink.vue      # neu
apps/web/src/components/icons/IconPencil.vue    # neu
apps/web/src/components/icons/IconDuplicate.vue # neu
apps/web/src/components/icons/IconClear.vue     # neu
apps/web/src/components/icons/IconRefresh.vue   # neu
apps/web/src/components/icons/IconTrash.vue     # neu
apps/web/src/views/BoardsView.vue               # Icon-Buttons, zweizeiliges Listenelement
apps/web/src/views/BoardsView.test.ts           # 4 Tests auf aria-label statt Text umgestellt
```

---

### Task 1: Header — eingeloggter User rechts neben dem Ausloggen-Button

**Files:**
- Modify: `apps/web/src/components/AppHeader.vue`
- Create: `apps/web/src/components/AppHeader.test.ts`

**Interfaces:**
- Consumes: `useAuthStore()` (bestehend, unverändert)
- Produces: keine neuen Exports — reine Layout-Änderung, genutzt von allen Views, die `<AppHeader />` einbinden (unverändert in ihrer Nutzung)

Aktueller Zustand von `apps/web/src/components/AppHeader.vue` (vollständig):
```vue
<script setup lang="ts">
import { RouterLink, useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth";

defineProps<{ showBack?: boolean }>();

const auth = useAuthStore();
const router = useRouter();

async function handleLogout() {
  await auth.logout();
  router.push({ name: "home" });
}
</script>

<template>
  <header class="flex items-center justify-between border-b border-slate-700 p-4">
    <div class="flex items-center gap-4">
      <RouterLink v-if="showBack" to="/boards" class="text-purple-400 hover:text-purple-300">
        ← Zur Übersicht
      </RouterLink>
      <div v-if="auth.user" class="flex items-center gap-3">
        <img
          v-if="auth.user.avatarUrl"
          :src="auth.user.avatarUrl"
          :alt="auth.user.displayName"
          class="h-10 w-10 rounded-full"
        />
        <span>{{ auth.user.displayName }}</span>
      </div>
    </div>
    <button
      class="rounded bg-purple-600 px-4 py-2 font-semibold hover:bg-purple-700"
      @click="handleLogout"
    >
      Ausloggen
    </button>
  </header>
</template>
```

- [ ] **Step 1: Fehlschlagenden Test schreiben — `apps/web/src/components/AppHeader.test.ts` (neue Datei)**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createRouter, createWebHistory } from "vue-router";
import AppHeader from "./AppHeader.vue";
import { useAuthStore } from "../stores/auth";

function createTestRouter() {
  return createRouter({
    history: createWebHistory(),
    routes: [
      { path: "/", name: "home", component: { template: "<div />" } },
      { path: "/boards", name: "boards", component: { template: "<div />" } },
    ],
  });
}

describe("AppHeader", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("zeigt den eingeloggten User in derselben rechten Gruppe wie der Ausloggen-Button", () => {
    const router = createTestRouter();
    const auth = useAuthStore();
    auth.user = { id: "1", login: "x", displayName: "Streamerin", avatarUrl: null };

    const wrapper = mount(AppHeader, { global: { plugins: [router] } });

    const header = wrapper.find("header");
    const groups = header.element.children;
    expect(groups).toHaveLength(2);

    const rightGroup = groups[1] as HTMLElement;
    expect(rightGroup.textContent).toContain("Streamerin");
    const logoutButton = rightGroup.querySelector("button");
    expect(logoutButton).not.toBeNull();
    expect(logoutButton!.textContent).toContain("Ausloggen");
  });

  it("zeigt den Zurück-Link weiterhin links, wenn showBack gesetzt ist", () => {
    const router = createTestRouter();
    const auth = useAuthStore();
    auth.user = { id: "1", login: "x", displayName: "Streamerin", avatarUrl: null };

    const wrapper = mount(AppHeader, { props: { showBack: true }, global: { plugins: [router] } });

    const header = wrapper.find("header");
    const leftGroup = header.element.children[0] as HTMLElement;
    expect(leftGroup.textContent).toContain("Zur Übersicht");
    expect(leftGroup.textContent).not.toContain("Streamerin");
  });
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag verifizieren**

Run: `pnpm --filter @bingo/web exec vitest run src/components/AppHeader.test.ts`
Expected: FAIL — aktuell steht der User-Block im LINKEN Container zusammen mit dem Zurück-Link, `groups[1]` ist nur der Logout-Button (kein `textContent` mit "Streamerin"), und beim zweiten Test enthält `leftGroup.textContent` fälschlich auch "Streamerin".

- [ ] **Step 3: `AppHeader.vue` anpassen**

Ersetze den `<template>`-Block durch:
```vue
<template>
  <header class="flex items-center justify-between border-b border-slate-700 p-4">
    <div class="flex items-center gap-4">
      <RouterLink v-if="showBack" to="/boards" class="text-purple-400 hover:text-purple-300">
        ← Zur Übersicht
      </RouterLink>
    </div>
    <div class="flex items-center gap-4">
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
    </div>
  </header>
</template>
```

Das `<script setup>` bleibt unverändert.

- [ ] **Step 4: Test ausführen, Erfolg verifizieren**

Run: `pnpm --filter @bingo/web exec vitest run src/components/AppHeader.test.ts`
Expected: PASS — beide Tests grün.

- [ ] **Step 5: Gesamte Web-Testsuite und Typecheck**

Run: `pnpm --filter @bingo/web test` und `pnpm --filter @bingo/web exec vue-tsc --noEmit`
Expected: Alle Tests weiterhin grün (insbesondere `BoardsView.test.ts`s Test „zeigt User-Header und Boardliste", der textbasiert auf „Streamerin" prüft und von der Positionsänderung nicht betroffen ist), Typecheck sauber.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/AppHeader.vue apps/web/src/components/AppHeader.test.ts
git commit -m "$(cat <<'EOF'
fix(web): eingeloggten User rechts neben Ausloggen-Button anzeigen

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Neues Board — Default 5×5 mit BINGO-Beschriftung

**Files:**
- Modify: `apps/web/src/views/NewBoardView.vue`
- Modify: `apps/web/src/views/NewBoardView.test.ts`

**Interfaces:**
- Consumes: keine Änderung
- Produces: keine Änderung — reine Default-Wert-Änderung der beiden `ref`s `size`/`labelMode`

- [ ] **Step 1: `apps/web/src/views/NewBoardView.vue` anpassen**

Aktuell (Zeilen 12-13):
```ts
const size = ref<BoardSize>(3);
const labelMode = ref<LabelMode>("letters");
```

Ändere zu:
```ts
const size = ref<BoardSize>(5);
const labelMode = ref<LabelMode>("bingo");
```

Der Rest der Datei (Template, `canUseBingo`, `watch`, `handleSubmit`) bleibt unverändert — `canUseBingo` ist bei `size.value === 5` sofort `true`, wodurch `labelMode: "bingo"` als Startwert gültig bleibt und nicht vom `watch` zurückgesetzt wird.

- [ ] **Step 2: `apps/web/src/views/NewBoardView.test.ts` anpassen**

Der erste Test prüft aktuell implizit alte Defaults im Testnamen, seine Assertions selbst (Name-Feld-Wert, keine „Spalte"-Texte) bleiben mit den neuen Defaults zufällig weiterhin grün, sind damit aber kein echter Test der Default-Werte mehr. Ersetze den ersten Test (aktuell Zeilen 23-32) komplett:

Alt:
```ts
  it("startet mit Default-Name, size=3 und label_mode=letters, ohne Custom-Felder", () => {
    const router = createTestRouter();
    const wrapper = mount(NewBoardView, { global: { plugins: [router] } });

    expect((wrapper.find("input[type=text]").element as HTMLInputElement).value).toBe(
      "Neues Bingo"
    );
    expect(wrapper.findAll("input[type=text]")).toHaveLength(1);
    expect(wrapper.text()).not.toContain("Spalte");
  });
```

Neu:
```ts
  it("startet mit Default-Name, size=5 und label_mode=bingo, ohne Custom-Felder", () => {
    const router = createTestRouter();
    const wrapper = mount(NewBoardView, { global: { plugins: [router] } });

    expect((wrapper.find("input[type=text]").element as HTMLInputElement).value).toBe(
      "Neues Bingo"
    );
    expect(wrapper.findAll("input[type=text]")).toHaveLength(1);
    expect(wrapper.text()).not.toContain("Spalte");

    const sizeSelect = wrapper.findAll("select")[0].element as HTMLSelectElement;
    expect(sizeSelect.value).toBe("5");
    const labelSelect = wrapper.findAll("select")[1].element as HTMLSelectElement;
    expect(labelSelect.value).toBe("bingo");
  });
```

Der dritte Test (aktuell Zeilen 47-69, „ruft beim Absenden createBoard auf und navigiert zum Editor") sendet das Formular ohne Änderungen an den Selects ab und erwartet dabei bisher `size: 3, label_mode: "letters"` — das muss auf die neuen Defaults angepasst werden. Ersetze:

Alt:
```ts
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
```

Neu:
```ts
  it("ruft beim Absenden createBoard auf und navigiert zum Editor", async () => {
    const router = createTestRouter();
    const boardsStore = useBoardsStore();
    vi.spyOn(boardsStore, "createBoard").mockResolvedValue({
      id: "new-board-id",
      name: "Neues Bingo",
      size: 5,
      checkedCount: 0,
    });
    const pushSpy = vi.spyOn(router, "push");

    const wrapper = mount(NewBoardView, { global: { plugins: [router] } });
    await wrapper.find("form").trigger("submit.prevent");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(boardsStore.createBoard).toHaveBeenCalledWith({
      name: "Neues Bingo",
      size: 5,
      label_mode: "bingo",
      column_labels: undefined,
    });
    expect(pushSpy).toHaveBeenCalledWith("/boards/new-board-id/edit");
  });
```

Der zweite Test („zeigt bei label_mode=custom genau size Spalten-Inputs") und der vierte Test (Fehlermeldung bei fehlschlagendem `createBoard`) setzen ihre benötigten Werte explizit selbst bzw. sind von den Defaults unabhängig — keine Änderung nötig.

- [ ] **Step 3: Tests ausführen, Erfolg verifizieren**

Run: `pnpm --filter @bingo/web exec vitest run src/views/NewBoardView.test.ts`
Expected: Alle 4 Tests grün.

- [ ] **Step 4: Manuell im Dev-Server verifizieren**

Start: `pnpm dev:web` (und `pnpm dev:api` in einem zweiten Terminal), öffne `/boards/new` im Browser eingeloggt.
Expected: „Größe" zeigt initial „5×5" ausgewählt, „Beschriftung" zeigt initial „BINGO" ausgewählt (nicht `disabled`, da Größe bereits 5 ist). Alle anderen Optionen weiterhin auswählbar.

- [ ] **Step 5: Gesamte Web-Testsuite und Typecheck**

Run: `pnpm --filter @bingo/web test` und `pnpm --filter @bingo/web exec vue-tsc --noEmit`
Expected: Alle Tests grün, Typecheck sauber.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/views/NewBoardView.vue apps/web/src/views/NewBoardView.test.ts
git commit -m "$(cat <<'EOF'
fix(web): Default für neue Boards auf 5x5 mit BINGO-Beschriftung setzen

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: ✕-Markierung füllt die ganze Zelle (Control- und Overlay-Seite)

**Files:**
- Modify: `apps/web/src/views/ControlView.vue`
- Modify: `apps/web/src/views/OverlayView.vue`

**Interfaces:**
- Consumes: keine Änderung
- Produces: keine Änderung — reine CSS-Anpassung, keine Template-Logik betroffen

**Hinweis:** jsdom (Vitest-Testumgebung) berechnet kein echtes CSS-Layout und kann `container-type`/`cqmin` nicht auflösen. Die bestehenden Tests prüfen nur, ob „✕" im Text vorkommt bzw. verschwindet (nicht die Schriftgröße) und bleiben daher unverändert grün. Diese Task wird stattdessen manuell im laufenden Dev-Server verifiziert (Step 4).

- [ ] **Step 1: `apps/web/src/views/ControlView.vue` anpassen**

Aktuell (im Grid-Template, Button + Markierung):
```vue
      <button
        v-else
        type="button"
        class="relative flex aspect-square items-center justify-center rounded bg-slate-800 p-1 text-center text-sm hover:bg-slate-700"
        @click="toggleCell(gridCell.row, gridCell.col)"
      >
        <span>{{ cellText(gridCell.row, gridCell.col) }}</span>
        <span
          v-if="checkedState[cellKey(gridCell.row, gridCell.col)]"
          class="pointer-events-none absolute inset-0 flex items-center justify-center text-3xl font-bold text-red-500"
        >
          ✕
        </span>
      </button>
```

Ändere zu:
```vue
      <button
        v-else
        type="button"
        class="relative flex aspect-square items-center justify-center rounded bg-slate-800 p-1 text-center text-sm hover:bg-slate-700 [container-type:size]"
        @click="toggleCell(gridCell.row, gridCell.col)"
      >
        <span>{{ cellText(gridCell.row, gridCell.col) }}</span>
        <span
          v-if="checkedState[cellKey(gridCell.row, gridCell.col)]"
          class="pointer-events-none absolute inset-0 flex items-center justify-center text-[65cqmin] font-bold text-red-500"
        >
          ✕
        </span>
      </button>
```

Zwei Änderungen: `[container-type:size]` am Button ergänzt (macht die Zelle zu einem Size-Container — `aspect-square` liefert dafür bereits definierte Breite/Höhe), und `text-3xl` durch `text-[65cqmin]` ersetzt (Schriftgröße = 65 % der kleineren Container-Dimension, skaliert automatisch mit der tatsächlichen Zellgröße).

- [ ] **Step 2: `apps/web/src/views/OverlayView.vue` anpassen**

Aktuell (Scoped-Style-Block):
```css
.overlay-cell {
  aspect-ratio: 1 / 1;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
}

.overlay-content {
  background: rgba(15, 23, 42, 0.55);
  border-radius: 0.4vmin;
}

.overlay-mark {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ef4444;
  font-size: clamp(1rem, 6vmin, 4rem);
  font-weight: 900;
  text-shadow:
    -1px -1px 0 #000,
    1px -1px 0 #000,
    -1px 1px 0 #000,
    1px 1px 0 #000;
  pointer-events: none;
}
```

Ändere zu:
```css
.overlay-cell {
  aspect-ratio: 1 / 1;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
  container-type: size;
}

.overlay-content {
  background: rgba(15, 23, 42, 0.55);
  border-radius: 0.4vmin;
}

.overlay-mark {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ef4444;
  font-size: 65cqmin;
  font-weight: 900;
  text-shadow:
    -1px -1px 0 #000,
    1px -1px 0 #000,
    -1px 1px 0 #000,
    1px 1px 0 #000;
  pointer-events: none;
}
```

Zwei Änderungen: `container-type: size;` bei `.overlay-cell` ergänzt, `font-size: clamp(1rem, 6vmin, 4rem)` durch `font-size: 65cqmin` ersetzt (identischer Skalierungsfaktor wie ControlView für ein einheitliches Erscheinungsbild zwischen Control- und Overlay-Seite; das feste Maximum von 4rem entfällt, da `cqmin` bereits an die tatsächliche Zellgröße gebunden ist).

- [ ] **Step 3: Bestehende Tests ausführen, Erfolg verifizieren**

Run: `pnpm --filter @bingo/web exec vitest run src/views/ControlView.test.ts src/views/OverlayView.test.ts`
Expected: Alle Tests weiterhin grün (sie prüfen nur Vorhandensein/Abwesenheit von „✕" im Text, nicht die Schriftgröße).

- [ ] **Step 4: Manuell im Dev-Server verifizieren**

Start: `pnpm dev:web` und `pnpm dev:api`, öffne ein Board auf der Control-Seite (`/boards/:id/play`) und die zugehörige Overlay-Seite (`/overlay/:token`) parallel im Browser.
Expected: Beim Anklicken einer Zelle auf der Control-Seite füllt das ✕ sichtbar den Großteil der angeklickten Zelle aus (nicht mehr ein kleines Symbol in der Mitte). Dasselbe gilt für die Overlay-Seite nach Übernahme des Zustands. Test mit mindestens zwei unterschiedlichen Board-Größen (z. B. 3×3 und 9×9), um zu bestätigen, dass die Markierung bei jeder Zellgröße proportional mitskaliert.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @bingo/web exec vue-tsc --noEmit`
Expected: Keine Ausgabe, Exit-Code 0.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/views/ControlView.vue apps/web/src/views/OverlayView.vue
git commit -m "$(cat <<'EOF'
fix(web): X-Markierung füllt per Container Query die ganze Zelle

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Dashboard — Icon-Buttons mit Tooltip/Aria-Label, zweizeiliges Listenelement

**Files:**
- Create: `apps/web/src/components/icons/IconPlay.vue`
- Create: `apps/web/src/components/icons/IconLink.vue`
- Create: `apps/web/src/components/icons/IconPencil.vue`
- Create: `apps/web/src/components/icons/IconDuplicate.vue`
- Create: `apps/web/src/components/icons/IconClear.vue`
- Create: `apps/web/src/components/icons/IconRefresh.vue`
- Create: `apps/web/src/components/icons/IconTrash.vue`
- Modify: `apps/web/src/views/BoardsView.vue`
- Modify: `apps/web/src/views/BoardsView.test.ts`

**Interfaces:**
- Consumes: keine
- Produces: 7 Icon-Komponenten ohne Props, reine Darstellungskomponenten. Jede rendert eine einzelne `<svg viewBox="0 0 24 24">` als Root-Element; `class` (z. B. `h-5 w-5`) wird vom aufrufenden Code per Vue-Fallthrough-Attribute gesetzt. `aria-hidden="true"` auf jedem SVG, da die umgebenden Buttons bereits `aria-label` tragen.

- [ ] **Step 1: Icon-Komponenten erstellen**

`apps/web/src/components/icons/IconPlay.vue`:
```vue
<template>
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M10 8.5v7l6-3.5-6-3.5z" fill="currentColor" stroke="none" />
  </svg>
</template>
```

`apps/web/src/components/icons/IconLink.vue`:
```vue
<template>
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="M9 15l6-6" />
    <path d="M10.5 6.5l1-1a3.54 3.54 0 015 5l-1 1" />
    <path d="M13.5 17.5l-1 1a3.54 3.54 0 01-5-5l1-1" />
  </svg>
</template>
```

`apps/web/src/components/icons/IconPencil.vue`:
```vue
<template>
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
  </svg>
</template>
```

`apps/web/src/components/icons/IconDuplicate.vue`:
```vue
<template>
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <rect x="8" y="8" width="12" height="12" rx="1.5" />
    <path d="M16 8V5.5A1.5 1.5 0 0014.5 4h-9A1.5 1.5 0 004 5.5v9A1.5 1.5 0 005.5 16H8" />
  </svg>
</template>
```

`apps/web/src/components/icons/IconClear.vue`:
```vue
<template>
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <path d="M8 8l8 8M16 8l-8 8" />
  </svg>
</template>
```

`apps/web/src/components/icons/IconRefresh.vue`:
```vue
<template>
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="M4 12a8 8 0 0113.66-5.66M20 12a8 8 0 01-13.66 5.66" />
    <path d="M17 4v4h-4M7 20v-4h4" />
  </svg>
</template>
```

`apps/web/src/components/icons/IconTrash.vue`:
```vue
<template>
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="M4 7h16" />
    <path d="M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2" />
    <path d="M6 7l1 13a1 1 0 001 1h8a1 1 0 001-1l1-13" />
    <path d="M10 11v6M14 11v6" />
  </svg>
</template>
```

- [ ] **Step 2: Fehlschlagende Tests schreiben — `apps/web/src/views/BoardsView.test.ts` anpassen**

Aktuell (Zeile 65-81, Test „zeigt einen Link zur Control-Seite pro Board"):
```ts
  it("zeigt einen Link zur Control-Seite pro Board", async () => {
    const router = createTestRouter();
    const auth = useAuthStore();
    const boardsStore = useBoardsStore();
    auth.user = { id: "1", login: "x", displayName: "Streamerin", avatarUrl: null };
    boardsStore.boards = [
      { id: "b1", name: "Board Eins", size: 3, checkedCount: 2 } as never,
    ];

    const wrapper = mount(BoardsView, { global: { plugins: [router] } });
    await wrapper.vm.$nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const playLink = wrapper.find('a[href="/boards/b1/play"]');
    expect(playLink.exists()).toBe(true);
    expect(playLink.text()).toContain("Spielen");
  });
```

Ändere die letzte Assertion (`playLink.text()`) zu einer Prüfung des `aria-label`, da die Buttons künftig nur noch Icons ohne sichtbaren Text enthalten:
```ts
  it("zeigt einen Link zur Control-Seite pro Board", async () => {
    const router = createTestRouter();
    const auth = useAuthStore();
    const boardsStore = useBoardsStore();
    auth.user = { id: "1", login: "x", displayName: "Streamerin", avatarUrl: null };
    boardsStore.boards = [
      { id: "b1", name: "Board Eins", size: 3, checkedCount: 2 } as never,
    ];

    const wrapper = mount(BoardsView, { global: { plugins: [router] } });
    await wrapper.vm.$nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const playLink = wrapper.find('a[href="/boards/b1/play"]');
    expect(playLink.exists()).toBe(true);
    expect(playLink.attributes("aria-label")).toBe("Spielen");
  });
```

Aktuell (Zeile 103-122, Test „dupliziert ein Board"):
```ts
    const duplicateButton = wrapper.findAll("button").find((b) => b.text() === "Duplizieren");
    await duplicateButton!.trigger("click");
```

Ändere zu:
```ts
    const duplicateButton = wrapper.find('button[aria-label="Duplizieren"]');
    await duplicateButton.trigger("click");
```

(Der Rest dieses Tests bleibt unverändert; `duplicateButton!` wird zu `duplicateButton`, da `find()` immer ein `DOMWrapper` zurückgibt, kein `undefined`.)

Aktuell (Zeile 124-145, Test „setzt Häkchen nach Bestätigung zurück"):
```ts
    const resetButton = wrapper
      .findAll("button")
      .find((b) => b.text() === "Häkchen zurücksetzen");
    await resetButton!.trigger("click");
```

Ändere zu:
```ts
    const resetButton = wrapper.find('button[aria-label="Häkchen zurücksetzen"]');
    await resetButton.trigger("click");
```

Aktuell (Zeile 147-168, Test „generiert den Overlay-Token neu"):
```ts
    const regenButton = wrapper
      .findAll("button")
      .find((b) => b.text() === "Overlay-Link neu generieren");
    await regenButton!.trigger("click");
```

Ändere zu:
```ts
    const regenButton = wrapper.find('button[aria-label="Overlay-Link neu generieren"]');
    await regenButton.trigger("click");
```

Aktuell (Zeile 170-192, Test „bricht die Token-Neugenerierung bei Abbruch der Bestätigung ab"):
```ts
    const regenButton = wrapper
      .findAll("button")
      .find((b) => b.text() === "Overlay-Link neu generieren");
    await regenButton!.trigger("click");
```

Ändere zu:
```ts
    const regenButton = wrapper.find('button[aria-label="Overlay-Link neu generieren"]');
    await regenButton.trigger("click");
```

Die übrigen Tests („zeigt User-Header und Boardliste", „kopiert den Overlay-Link in die Zwischenablage" via `button.bg-slate-700`, „zeigt Leerzustand ohne Boards", „löscht ein Board nach Bestätigung" via `button.bg-red-700`) bleiben unverändert — sie selektieren über Textinhalt der Karte, CSS-Klassen oder Board-Zustand, nicht über den jetzt wegfallenden Button-Text.

- [ ] **Step 3: Tests ausführen, Fehlschlag verifizieren**

Run: `pnpm --filter @bingo/web exec vitest run src/views/BoardsView.test.ts`
Expected: Die vier angepassten Tests FAILEN gegen den aktuellen Stand von `BoardsView.vue` (kein `aria-label` auf den Buttons vorhanden).

- [ ] **Step 4: `apps/web/src/views/BoardsView.vue` anpassen**

Aktuell (Imports, oberer Teil von `<script setup>`):
```ts
<script setup lang="ts">
import { onMounted } from "vue";
import { RouterLink } from "vue-router";
import AppHeader from "../components/AppHeader.vue";
import { useAuthStore } from "../stores/auth";
import { useBoardsStore } from "../stores/boards";
```

Ergänze die 7 Icon-Imports:
```ts
<script setup lang="ts">
import { onMounted } from "vue";
import { RouterLink } from "vue-router";
import AppHeader from "../components/AppHeader.vue";
import { useAuthStore } from "../stores/auth";
import { useBoardsStore } from "../stores/boards";
import IconPlay from "../components/icons/IconPlay.vue";
import IconLink from "../components/icons/IconLink.vue";
import IconPencil from "../components/icons/IconPencil.vue";
import IconDuplicate from "../components/icons/IconDuplicate.vue";
import IconClear from "../components/icons/IconClear.vue";
import IconRefresh from "../components/icons/IconRefresh.vue";
import IconTrash from "../components/icons/IconTrash.vue";
```

Der restliche `<script setup>`-Block (alle `handle*`-Funktionen) bleibt unverändert.

Aktuelles `<li>`-Element im Template (Zeile 76-131):
```vue
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
            <div class="flex flex-wrap gap-2">
              <RouterLink
                :to="`/boards/${board.id}/play`"
                class="rounded bg-slate-700 px-3 py-1 hover:bg-slate-600"
              >
                Spielen
              </RouterLink>
              <button
                class="rounded bg-slate-700 px-3 py-1 hover:bg-slate-600"
                @click="handleCopyOverlayLink(board.overlayToken)"
              >
                Overlay-Link kopieren
              </button>
              <RouterLink
                :to="`/boards/${board.id}/edit`"
                class="rounded bg-slate-700 px-3 py-1 hover:bg-slate-600"
              >
                Bearbeiten
              </RouterLink>
              <button
                class="rounded bg-slate-700 px-3 py-1 hover:bg-slate-600"
                @click="handleDuplicate(board.id)"
              >
                Duplizieren
              </button>
              <button
                class="rounded bg-slate-700 px-3 py-1 hover:bg-slate-600"
                @click="handleResetChecks(board.id)"
              >
                Häkchen zurücksetzen
              </button>
              <button
                class="rounded bg-slate-700 px-3 py-1 hover:bg-slate-600"
                @click="handleRegenerateToken(board.id)"
              >
                Overlay-Link neu generieren
              </button>
              <button
                class="rounded bg-red-700 px-3 py-1 hover:bg-red-600"
                @click="handleDelete(board.id)"
              >
                Löschen
              </button>
            </div>
          </li>
```

Ersetze durch:
```vue
          <li
            v-for="board in boardsStore.boards"
            :key="board.id"
            class="flex flex-col gap-2 rounded bg-slate-800 p-4"
          >
            <div>
              <p class="font-semibold">{{ board.name }}</p>
              <p class="text-sm text-slate-400">
                {{ board.size }}×{{ board.size }} · {{ board.checkedCount }} abgehakt
              </p>
            </div>
            <div class="flex flex-wrap gap-2">
              <RouterLink
                :to="`/boards/${board.id}/play`"
                title="Spielen"
                aria-label="Spielen"
                class="rounded bg-slate-700 p-2 hover:bg-slate-600"
              >
                <IconPlay class="h-5 w-5" />
              </RouterLink>
              <button
                title="Overlay-Link kopieren"
                aria-label="Overlay-Link kopieren"
                class="rounded bg-slate-700 p-2 hover:bg-slate-600"
                @click="handleCopyOverlayLink(board.overlayToken)"
              >
                <IconLink class="h-5 w-5" />
              </button>
              <RouterLink
                :to="`/boards/${board.id}/edit`"
                title="Bearbeiten"
                aria-label="Bearbeiten"
                class="rounded bg-slate-700 p-2 hover:bg-slate-600"
              >
                <IconPencil class="h-5 w-5" />
              </RouterLink>
              <button
                title="Duplizieren"
                aria-label="Duplizieren"
                class="rounded bg-slate-700 p-2 hover:bg-slate-600"
                @click="handleDuplicate(board.id)"
              >
                <IconDuplicate class="h-5 w-5" />
              </button>
              <button
                title="Häkchen zurücksetzen"
                aria-label="Häkchen zurücksetzen"
                class="rounded bg-slate-700 p-2 hover:bg-slate-600"
                @click="handleResetChecks(board.id)"
              >
                <IconClear class="h-5 w-5" />
              </button>
              <button
                title="Overlay-Link neu generieren"
                aria-label="Overlay-Link neu generieren"
                class="rounded bg-slate-700 p-2 hover:bg-slate-600"
                @click="handleRegenerateToken(board.id)"
              >
                <IconRefresh class="h-5 w-5" />
              </button>
              <button
                title="Löschen"
                aria-label="Löschen"
                class="rounded bg-red-700 p-2 hover:bg-red-600"
                @click="handleDelete(board.id)"
              >
                <IconTrash class="h-5 w-5" />
              </button>
            </div>
          </li>
```

Kernänderungen: `<li>` von `flex items-center justify-between` (einzeilig, Titel und Buttons nebeneinander) zu `flex flex-col gap-2` (zweizeilig, Titel-Block über Button-Reihe); jeder Button/Link bekommt `title`+`aria-label` und zeigt nur noch das Icon (Padding von `px-3 py-1` auf einheitliches `p-2` geändert, passend für quadratische Icon-Buttons).

- [ ] **Step 5: Tests ausführen, Erfolg verifizieren**

Run: `pnpm --filter @bingo/web exec vitest run src/views/BoardsView.test.ts`
Expected: Alle Tests grün.

- [ ] **Step 6: Manuell im Dev-Server verifizieren**

Start: `pnpm dev:web` und `pnpm dev:api`, öffne `/boards` mit mindestens einem angelegten Board, dessen Name lang genug ist, um vorher zusammengequetscht zu wirken.
Expected: Titel steht in eigener Zeile über den Buttons, wird nicht mehr durch die Buttons zusammengedrückt. Buttons zeigen nur Icons, beim Hovern erscheint der Tooltip mit dem jeweiligen deutschen Text (z. B. „Löschen").

- [ ] **Step 7: Gesamte Web-Testsuite und Typecheck**

Run: `pnpm --filter @bingo/web test` und `pnpm --filter @bingo/web exec vue-tsc --noEmit`
Expected: Alle Tests grün, Typecheck sauber.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/icons apps/web/src/views/BoardsView.vue apps/web/src/views/BoardsView.test.ts
git commit -m "$(cat <<'EOF'
feat(web): Icon-Buttons mit Tooltip und zweizeiliges Dashboard-Listenelement

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Nach Abschluss dieses Plans

Automatisiert verifiziert: alle 4 Anpassungen per Vitest (bis auf die reine CSS-Skalierung der ✕-Markierung, dafür manuell verifiziert), `vue-tsc --noEmit` sauber.

**Manuell zu verifizieren (zusammengefasst aus den einzelnen Tasks):** Default-Werte im „Neues Board"-Formular optisch prüfen; ✕-Markierung auf Control- und Overlay-Seite bei mindestens zwei Board-Größen visuell prüfen; Dashboard-Buttons inkl. Hover-Tooltips visuell prüfen.
