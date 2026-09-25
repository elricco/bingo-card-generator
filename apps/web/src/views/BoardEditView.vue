<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute } from "vue-router";

interface BoardDetail {
  id: string;
  name: string;
  size: number;
}

const route = useRoute();
const board = ref<BoardDetail | null>(null);
const notFound = ref(false);

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:3001";

onMounted(async () => {
  const response = await fetch(`${API_BASE_URL}/api/boards/${route.params.id}`, {
    credentials: "include",
  });
  if (!response.ok) {
    notFound.value = true;
    return;
  }
  board.value = (await response.json()) as BoardDetail;
});
</script>

<template>
  <main class="flex min-h-screen items-center justify-center bg-slate-900 text-slate-100">
    <div v-if="notFound">Board nicht gefunden.</div>
    <div v-else-if="board">
      <h1 class="text-2xl font-bold">{{ board.name }}</h1>
      <p class="text-slate-400">{{ board.size }}×{{ board.size }} — Editor folgt in einer späteren Phase.</p>
    </div>
    <p v-else>Lade...</p>
  </main>
</template>
