import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createRouter, createWebHistory, RouterView } from "vue-router";
import BoardEditView from "./BoardEditView.vue";

function createTestRouter() {
  return createRouter({
    history: createWebHistory(),
    routes: [{ path: "/boards/:id/edit", name: "board-edit", component: BoardEditView }],
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
    { row: 1, col: 1, text: "", checked: false },
  ],
};

describe("BoardEditView", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("zeigt Name, Spaltenlabels (A/B/C) und Zelltext", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => sampleBoard } as Response);

    const router = createTestRouter();
    router.push("/boards/b1/edit");
    await router.isReady();

    const wrapper = mount(BoardEditView, { global: { plugins: [router] } });
    await flushPromises();

    expect((wrapper.find("input[type=text]").element as HTMLInputElement).value).toBe(
      "Mein Board"
    );
    expect(wrapper.text()).toContain("A");
    expect(wrapper.text()).toContain("C");
    expect(wrapper.text()).toContain("Erste Zelle");
  });

  it("zeigt die BINGO-Option nur bei size=5 aktiviert", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ ...sampleBoard, size: 3 }),
    } as Response);

    const router = createTestRouter();
    router.push("/boards/b1/edit");
    await router.isReady();

    const wrapper = mount(BoardEditView, { global: { plugins: [router] } });
    await flushPromises();

    const bingoOption = wrapper.find("option[value=bingo]");
    expect((bingoOption.element as HTMLOptionElement).disabled).toBe(true);
  });

  it("zeigt 'nicht gefunden' bei 404", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, json: async () => ({}) } as Response);

    const router = createTestRouter();
    router.push("/boards/missing/edit");
    await router.isReady();

    const wrapper = mount(BoardEditView, { global: { plugins: [router] } });
    await flushPromises();

    expect(wrapper.text()).toContain("nicht gefunden");
  });

  it("öffnet beim Klick eine Textarea mit dem aktuellen Zelltext", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => sampleBoard } as Response);
    const router = createTestRouter();
    router.push("/boards/b1/edit");
    await router.isReady();
    const wrapper = mount(BoardEditView, { global: { plugins: [router] } });
    await flushPromises();

    const cells = wrapper.findAll(".bg-slate-800.p-1");
    await cells[0].trigger("click");

    const textarea = wrapper.find("textarea");
    expect((textarea.element as HTMLTextAreaElement).value).toBe("Erste Zelle");
  });

  it("übernimmt den Text beim Blur und schließt die Textarea", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => sampleBoard } as Response);
    const router = createTestRouter();
    router.push("/boards/b1/edit");
    await router.isReady();
    const wrapper = mount(BoardEditView, { global: { plugins: [router] } });
    await flushPromises();

    const cells = wrapper.findAll(".bg-slate-800.p-1");
    await cells[0].trigger("click");
    const textarea = wrapper.find("textarea");
    await textarea.setValue("Neuer Text");
    await textarea.trigger("blur");

    expect(wrapper.find("textarea").exists()).toBe(false);
    expect(wrapper.text()).toContain("Neuer Text");
  });

  it("speichert nur geänderte Felder und Zellen via PATCH", async () => {
    vi.mocked(fetch).mockImplementation(async (_url, options) => {
      const method = ((options as RequestInit)?.method ?? "GET").toUpperCase();
      if (method === "PATCH") {
        return {
          ok: true,
          json: async () => ({
            ...sampleBoard,
            name: "Neuer Name",
            cells: sampleBoard.cells,
          }),
        } as Response;
      }
      return { ok: true, json: async () => sampleBoard } as Response;
    });

    const router = createTestRouter();
    router.push("/boards/b1/edit");
    await router.isReady();
    const wrapper = mount(BoardEditView, { global: { plugins: [router] } });
    await flushPromises();

    await wrapper.find("input[type=text]").setValue("Neuer Name");
    await wrapper.find("button").trigger("click");
    await flushPromises();

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/boards/b1"),
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ name: "Neuer Name" }),
      })
    );
  });

  it("zeigt eine Fehlermeldung, wenn das Speichern fehlschlägt", async () => {
    vi.mocked(fetch).mockImplementation(async (_url, options) => {
      const method = ((options as RequestInit)?.method ?? "GET").toUpperCase();
      if (method === "PATCH") {
        return { ok: false, json: async () => ({ error: "Serverfehler" }) } as Response;
      }
      return { ok: true, json: async () => sampleBoard } as Response;
    });

    const router = createTestRouter();
    router.push("/boards/b1/edit");
    await router.isReady();
    const wrapper = mount(BoardEditView, { global: { plugins: [router] } });
    await flushPromises();

    await wrapper.find("input[type=text]").setValue("Neuer Name");
    await wrapper.find("button").trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("Serverfehler");
  });
});

function createTestRouterWithBoardsList() {
  return createRouter({
    history: createWebHistory(),
    routes: [
      { path: "/boards/:id/edit", name: "board-edit", component: BoardEditView },
      { path: "/boards", name: "boards", component: { template: "<div />" } },
    ],
  });
}

describe("BoardEditView – Verlassen-Warnung", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("erlaubt das Verlassen ohne ungespeicherte Änderungen ohne Bestätigung", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => sampleBoard } as Response);
    const confirmSpy = vi.spyOn(window, "confirm");
    const router = createTestRouterWithBoardsList();
    router.push("/boards/b1/edit");
    await router.isReady();
    // Mounted through <router-view>, not the component directly: onBeforeRouteLeave()
    // only registers its guard on the active route record, which vue-router provides
    // via RouterView's injection. Mounting the component standalone leaves the guard
    // silently unregistered.
    mount({ components: { RouterView }, template: "<router-view />" }, { global: { plugins: [router] } });
    await flushPromises();

    await router.push("/boards");

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(router.currentRoute.value.name).toBe("boards");
  });

  it("fragt bei ungespeicherten Änderungen und respektiert einen Abbruch", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => sampleBoard } as Response);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const router = createTestRouterWithBoardsList();
    router.push("/boards/b1/edit");
    await router.isReady();
    const wrapper = mount(
      { components: { RouterView }, template: "<router-view />" },
      { global: { plugins: [router] } }
    );
    await flushPromises();

    await wrapper.find("input[type=text]").setValue("Geändert");
    await router.push("/boards");

    expect(window.confirm).toHaveBeenCalled();
    expect(router.currentRoute.value.name).toBe("board-edit");
  });

  it("lässt das Verlassen zu, wenn die Bestätigung akzeptiert wird", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => sampleBoard } as Response);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const router = createTestRouterWithBoardsList();
    router.push("/boards/b1/edit");
    await router.isReady();
    const wrapper = mount(
      { components: { RouterView }, template: "<router-view />" },
      { global: { plugins: [router] } }
    );
    await flushPromises();

    await wrapper.find("input[type=text]").setValue("Geändert");
    await router.push("/boards");

    expect(router.currentRoute.value.name).toBe("boards");
  });
});
