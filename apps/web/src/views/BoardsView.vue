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

const auth = useAuthStore();
const boardsStore = useBoardsStore();

onMounted(async () => {
  if (!auth.user) {
    await auth.fetchMe();
  }
  await boardsStore.fetchBoards();
});

async function handleDelete(id: string) {
  if (!confirm("Board wirklich löschen? Der Overlay-Link wird dadurch ungültig.")) {
    return;
  }
  await boardsStore.deleteBoard(id);
}

async function handleCopyOverlayLink(token?: string) {
  if (!token) {
    return;
  }
  const url = `${window.location.origin}/overlay/${token}`;
  await navigator.clipboard.writeText(url);
}

async function handleDuplicate(id: string) {
  await boardsStore.duplicateBoard(id);
}

async function handleResetChecks(id: string) {
  if (!confirm("Alle Häkchen auf diesem Board zurücksetzen?")) {
    return;
  }
  await boardsStore.resetBoardChecks(id);
}

async function handleRegenerateToken(id: string) {
  if (
    !confirm(
      "Overlay-Link neu generieren? Der alte Link funktioniert danach nicht mehr (z. B. in OBS eingetragene Quellen)."
    )
  ) {
    return;
  }
  await boardsStore.regenerateOverlayToken(id);
}
</script>

<template>
  <main class="min-h-screen bg-slate-900 text-slate-100">
    <AppHeader />

    <div class="mx-auto max-w-3xl p-6">
      <div class="mb-4 flex items-center justify-between">
        <h1 class="text-2xl font-bold">Meine Boards</h1>
        <RouterLink
          to="/boards/new"
          class="rounded bg-purple-600 px-4 py-2 font-semibold hover:bg-purple-700"
        >
          Neues Board
        </RouterLink>
      </div>

      <p v-if="boardsStore.isLoading">Lade...</p>
      <p v-else-if="boardsStore.boards.length === 0" class="text-slate-400">
        Noch keine Boards vorhanden.
      </p>
      <ul v-else class="flex flex-col gap-2">
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
      </ul>
    </div>
  </main>
</template>
