import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useAuthStore } from "./auth";

describe("useAuthStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetchMe setzt user bei erfolgreicher Antwort", async () => {
    const mockUser = { id: "1", login: "test", displayName: "Test", avatarUrl: null };
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => mockUser } as Response);

    const store = useAuthStore();
    await store.fetchMe();

    expect(store.user).toEqual(mockUser);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/me"),
      expect.objectContaining({ credentials: "include" })
    );
  });

  it("fetchMe setzt user auf null bei 401", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, json: async () => ({}) } as Response);

    const store = useAuthStore();
    await store.fetchMe();

    expect(store.user).toBeNull();
  });

  it("logout ruft /auth/logout auf und setzt user auf null", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({}) } as Response);

    const store = useAuthStore();
    store.user = { id: "1", login: "test", displayName: "Test", avatarUrl: null };

    await store.logout();

    expect(store.user).toBeNull();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/auth/logout"),
      expect.objectContaining({ method: "POST", credentials: "include" })
    );
  });

  it("loginUrl liefert die Twitch-Login-URL der API", () => {
    const store = useAuthStore();
    expect(store.loginUrl()).toContain("/auth/twitch");
  });
});
