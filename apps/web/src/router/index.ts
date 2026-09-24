import { createRouter, createWebHistory, type RouteLocationNormalized } from "vue-router";
import HomeView from "../views/HomeView.vue";
import BoardsView from "../views/BoardsView.vue";
import { useAuthStore } from "../stores/auth";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "home", component: HomeView },
    { path: "/boards", name: "boards", component: BoardsView, meta: { requiresAuth: true } },
  ],
});

export async function requireAuthGuard(to: RouteLocationNormalized) {
  if (!to.meta.requiresAuth) {
    return true;
  }

  const auth = useAuthStore();
  if (!auth.user) {
    await auth.fetchMe();
  }

  return auth.user ? true : { name: "home" };
}

router.beforeEach(requireAuthGuard);
