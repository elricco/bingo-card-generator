import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { RouteLocationNormalized } from "vue-router";
import { requireAuthGuard } from "./index";

function fakeRoute(requiresAuth: boolean): RouteLocationNormalized {
  return { meta: { requiresAuth } } as unknown as RouteLocationNormalized;
}

describe("requireAuthGuard", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lässt Routen ohne requiresAuth ohne Fetch durch", async () => {
    const result = await requireAuthGuard(fakeRoute(false));
    expect(result).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("lässt geschützte Routen durch, wenn der User eingeloggt ist", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ id: "1", login: "x", displayName: "X", avatarUrl: null }),
    } as Response);

    const result = await requireAuthGuard(fakeRoute(true));
    expect(result).toBe(true);
  });

  it("leitet zu 'home' um, wenn der User nicht eingeloggt ist", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, json: async () => ({}) } as Response);

    const result = await requireAuthGuard(fakeRoute(true));
    expect(result).toEqual({ name: "home" });
  });
});
