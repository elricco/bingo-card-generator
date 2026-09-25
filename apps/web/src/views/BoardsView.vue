<script setup lang="ts">
import { onMounted } from "vue";
import { useRouter, RouterLink } from "vue-router";
import { useAuthStore } from "../stores/auth";
import { useBoardsStore } from "../stores/boards";

const auth = useAuthStore();
const boardsStore = useBoardsStore();
const router = useRouter();

onMounted(async () => {
  if (!auth.user) {
    await auth.fetchMe();
  }
  await boardsStore.fetchBoards();
});

async function handleLogout() {
  await auth.logout();
  router.push({ name: "home" });
}

async function handleDelete(id: string) {
  if (!confirm("Board wirklich löschen? Der Overlay-Link wird dadurch ungültig.")) {
    return;
  }
  await boardsStore.deleteBoard(id);
}
</script>

<template>
  <main class="min-h-screen bg-slate-900 text-slate-100">
    <header class="flex items-center justify-between border-b border-slate-700 p-4">
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
    </header>

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
          <div class="flex gap-2">
            <RouterLink
              :to="`/boards/${board.id}/edit`"
              class="rounded bg-slate-700 px-3 py-1 hover:bg-slate-600"
            >
              Bearbeiten
            </RouterLink>
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
