import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createRouter, createWebHistory } from "vue-router";
import ControlView from "./ControlView.vue";

function createTestRouter() {
  return createRouter({
    history: createWebHistory(),
    routes: [{ path: "/boards/:id/play", name: "board-play", component: ControlView }],
  });
}

const sampleBoard = {
  id: "b1",
  name: "Mein Board",
  size: 3,
  labelMode: "letters",
  columnLabels: null,
  overlayToken: "token",
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
  cells: [
    { row: 0, col: 0, text: "Erste Zelle", checked: false },
    { row: 1, col: 1, text: "Mitte", checked: true },
  ],
};

describe("ControlView", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("zeigt Name, Labels und Zelltext, mit X auf bereits abgehakten Feldern", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => sampleBoard } as Response);

    const router = createTestRouter();
    router.push("/boards/b1/play");
    await router.isReady();

    const wrapper = mount(ControlView, { global: { plugins: [router] } });
    await flushPromises();

    expect(wrapper.text()).toContain("Mein Board");
    expect(wrapper.text()).toContain("Erste Zelle");
    expect(wrapper.text()).toContain("✕");
  });

  it("setzt beim Klick auf eine unabgehakte Zelle optimistisch ein Kreuz und sendet PUT checked:true", async () => {
    vi.mocked(fetch).mockImplementation(async (url, options) => {
      const method = ((options as RequestInit)?.method ?? "GET").toUpperCase();
      if (method === "PUT") {
        return {
          ok: true,
          json: async () => ({ row: 0, col: 0, text: "Erste Zelle", checked: true, checkedAt: "2024-01-01T00:00:00Z" }),
        } as Response;
      }
      return { ok: true, json: async () => sampleBoard } as Response;
    });

    const router = createTestRouter();
    router.push("/boards/b1/play");
    await router.isReady();
    const wrapper = mount(ControlView, { global: { plugins: [router] } });
    await flushPromises();

    const buttons = wrapper.findAll("button");
    await buttons[0].trigger("click");
    await flushPromises();

    expect(wrapper.findAll("button")[0].text()).toContain("✕");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/boards/b1/cells/0/0/checked"),
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ checked: true }) })
    );
  });

  it("setzt beim Klick auf eine abgehakte Zelle das Kreuz zurück und sendet PUT checked:false", async () => {
    vi.mocked(fetch).mockImplementation(async (url, options) => {
      const method = ((options as RequestInit)?.method ?? "GET").toUpperCase();
      if (method === "PUT") {
        return {
          ok: true,
          json: async () => ({ row: 1, col: 1, text: "Mitte", checked: false, checkedAt: null }),
        } as Response;
      }
      return { ok: true, json: async () => sampleBoard } as Response;
    });

    const router = createTestRouter();
    router.push("/boards/b1/play");
    await router.isReady();
    const wrapper = mount(ControlView, { global: { plugins: [router] } });
    await flushPromises();

    const middleButton = wrapper
      .findAll("button")
      .find((b) => b.text().includes("Mitte"));
    await middleButton!.trigger("click");
    await flushPromises();

    expect(middleButton!.text()).not.toContain("✕");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/boards/b1/cells/1/1/checked"),
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ checked: false }) })
    );
  });

  it("rollt bei Fehler zurück und zeigt eine Fehlermeldung", async () => {
    vi.mocked(fetch).mockImplementation(async (url, options) => {
      const method = ((options as RequestInit)?.method ?? "GET").toUpperCase();
      if (method === "PUT") {
        return { ok: false, json: async () => ({ error: "Serverfehler" }) } as Response;
      }
      return { ok: true, json: async () => sampleBoard } as Response;
    });

    const router = createTestRouter();
    router.push("/boards/b1/play");
    await router.isReady();
    const wrapper = mount(ControlView, { global: { plugins: [router] } });
    await flushPromises();

    const buttons = wrapper.findAll("button");
    await buttons[0].trigger("click");
    await flushPromises();

    expect(wrapper.findAll("button")[0].text()).not.toContain("✕");
    expect(wrapper.text()).toContain("Serverfehler");
  });

  it("zeigt 'nicht gefunden' bei 404", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, json: async () => ({}) } as Response);

    const router = createTestRouter();
    router.push("/boards/missing/play");
    await router.isReady();

    const wrapper = mount(ControlView, { global: { plugins: [router] } });
    await flushPromises();

    expect(wrapper.text()).toContain("nicht gefunden");
  });
});
