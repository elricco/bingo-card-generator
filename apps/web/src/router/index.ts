import { createRouter, createWebHistory, type RouteLocationNormalized } from "vue-router";
import HomeView from "../views/HomeView.vue";
import BoardsView from "../views/BoardsView.vue";
import NewBoardView from "../views/NewBoardView.vue";
import BoardEditView from "../views/BoardEditView.vue";
import ControlView from "../views/ControlView.vue";
import OverlayView from "../views/OverlayView.vue";
import { useAuthStore } from "../stores/auth";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "home", component: HomeView },
    { path: "/boards", name: "boards", component: BoardsView, meta: { requiresAuth: true } },
    { path: "/boards/new", name: "board-new", component: NewBoardView, meta: { requiresAuth: true } },
    {
      path: "/boards/:id/edit",
      name: "board-edit",
      component: BoardEditView,
      meta: { requiresAuth: true },
    },
    {
      path: "/boards/:id/play",
      name: "board-play",
      component: ControlView,
      meta: { requiresAuth: true },
    },
    {
      path: "/overlay/:token",
      name: "overlay",
      component: OverlayView,
    },
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
