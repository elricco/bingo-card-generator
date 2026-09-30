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
