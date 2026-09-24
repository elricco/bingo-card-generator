<script setup lang="ts">
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
</script>

<template>
  <main class="flex min-h-screen items-center justify-center bg-slate-900 text-slate-100">
    <div class="flex flex-col items-center gap-4">
      <h1 class="text-3xl font-bold">Bingo Card Generator</h1>
      <a
        :href="auth.loginUrl()"
        class="rounded bg-purple-600 px-4 py-2 font-semibold hover:bg-purple-700"
      >
        Mit Twitch einloggen
      </a>
    </div>
  </main>
</template>
