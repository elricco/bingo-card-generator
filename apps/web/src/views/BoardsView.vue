<script setup lang="ts">
import { onMounted } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const router = useRouter();

onMounted(async () => {
  if (!auth.user) {
    await auth.fetchMe();
  }
});

async function handleLogout() {
  await auth.logout();
  router.push({ name: "home" });
}
</script>

<template>
  <main class="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-900 text-slate-100">
    <template v-if="auth.user">
      <img
        v-if="auth.user.avatarUrl"
        :src="auth.user.avatarUrl"
        :alt="auth.user.displayName"
        class="h-16 w-16 rounded-full"
      />
      <p class="text-xl">Eingeloggt als {{ auth.user.displayName }}</p>
      <button
        class="rounded bg-purple-600 px-4 py-2 font-semibold hover:bg-purple-700"
        @click="handleLogout"
      >
        Ausloggen
      </button>
    </template>
    <p v-else>Lade...</p>
  </main>
</template>
