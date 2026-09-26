import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createWebHistory } from "vue-router";
import OverlayView from "./OverlayView.vue";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners: Record<string, Array<(event: MessageEvent) => void>> = {};
  closed = false;

  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    (this.listeners[type] ??= []).push(listener);
  }

  close() {
    this.closed = true;
  }

  emit(type: string, data: unknown) {
    for (const listener of this.listeners[type] ?? []) {
      listener({ data: JSON.stringify(data) } as MessageEvent);
    }
  }
}

function createTestRouter() {
  return createRouter({
    history: createWebHistory(),
    routes: [{ path: "/overlay/:token", name: "overlay", component: OverlayView }],
  });
}

const samplePublicBoard = {
  size: 3,
  labelMode: "letters",
  columnLabels: null,
  cells: [
    { row: 0, col: 0, text: "Erste Zelle", checked: false },
    { row: 1, col: 1, text: "Mitte", checked: true },
  ],
};

describe("OverlayView", () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lädt den initialen Zustand und zeigt Labels, Text und Kreuz", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => samplePublicBoard,
    } as Response);

    const router = createTestRouter();
    router.push("/overlay/token123");
    await router.isReady();
    const wrapper = mount(OverlayView, { global: { plugins: [router] } });
    await flushPromises();

    expect(wrapper.text()).toContain("A");
    expect(wrapper.text()).toContain("Erste Zelle");
    expect(wrapper.text()).toContain("✕");
  });

  it("öffnet eine EventSource-Verbindung zum richtigen Pfad", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => samplePublicBoard,
    } as Response);

    const router = createTestRouter();
    router.push("/overlay/token123");
    await router.isReady();
    mount(OverlayView, { global: { plugins: [router] } });
    await flushPromises();

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toContain("/api/overlay/token123/events");
  });

  it("aktualisiert den Zustand bei einem board-update-Event", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => samplePublicBoard,
    } as Response);

    const router = createTestRouter();
    router.push("/overlay/token123");
    await router.isReady();
    const wrapper = mount(OverlayView, { global: { plugins: [router] } });
    await flushPromises();

    FakeEventSource.instances[0].emit("board-update", {
      ...samplePublicBoard,
      cells: [
        { row: 0, col: 0, text: "Geändert", checked: true },
        { row: 1, col: 1, text: "Mitte", checked: true },
      ],
    });
    await flushPromises();

    expect(wrapper.text()).toContain("Geändert");
  });

  it("schließt die EventSource-Verbindung beim Unmount", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => samplePublicBoard,
    } as Response);

    const router = createTestRouter();
    router.push("/overlay/token123");
    await router.isReady();
    const wrapper = mount(OverlayView, { global: { plugins: [router] } });
    await flushPromises();

    wrapper.unmount();

    expect(FakeEventSource.instances[0].closed).toBe(true);
  });

  it("zeigt nichts bei ungültigem Token", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, json: async () => ({}) } as Response);

    const router = createTestRouter();
    router.push("/overlay/invalid");
    await router.isReady();
    const wrapper = mount(OverlayView, { global: { plugins: [router] } });
    await flushPromises();

    expect(wrapper.find(".overlay-grid").exists()).toBe(false);
  });
});
