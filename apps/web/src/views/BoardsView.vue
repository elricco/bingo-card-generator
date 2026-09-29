<script setup lang="ts">
import { onMounted } from "vue";
import { RouterLink } from "vue-router";
import AppHeader from "../components/AppHeader.vue";
import { useAuthStore } from "../stores/auth";
import { useBoardsStore } from "../stores/boards";

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
      </ul>
    </div>
  </main>
</template>
