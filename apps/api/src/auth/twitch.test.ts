import { describe, it, expect, vi } from "vitest";
import { createTwitchProvider } from "./twitch";

const CLIENT_ID = "test-client-id";
const CLIENT_SECRET = "test-client-secret";
const REDIRECT_URI = "http://localhost:3001/auth/twitch/callback";

function fakeFetchSequence(responses: Array<{ ok: boolean; status?: number; json: () => unknown }>) {
  let call = 0;
  return vi.fn(async () => {
    const response = responses[call];
    call += 1;
    return response as unknown as Response;
  });
}

describe("createTwitchProvider", () => {
  it("hat den Namen 'twitch'", () => {
    const provider = createTwitchProvider(CLIENT_ID, CLIENT_SECRET);
    expect(provider.name).toBe("twitch");
  });

  describe("getAuthorizationUrl", () => {
    it("baut die Twitch-Autorisierungs-URL mit allen erwarteten Parametern", () => {
      const provider = createTwitchProvider(CLIENT_ID, CLIENT_SECRET);
      const url = new URL(provider.getAuthorizationUrl("state123", REDIRECT_URI));

      expect(url.origin + url.pathname).toBe("https://id.twitch.tv/oauth2/authorize");
      expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
      expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
      expect(url.searchParams.get("response_type")).toBe("code");
      expect(url.searchParams.get("state")).toBe("state123");
    });
  });

  describe("exchangeCode", () => {
    it("tauscht Code gegen Token und liefert gemappte User-Infos", async () => {
      const fetchImpl = fakeFetchSequence([
        { ok: true, json: () => ({ access_token: "abc123" }) },
        {
          ok: true,
          json: () => ({
            data: [
              {
                id: "12345",
                login: "streamerin",
                display_name: "Streamerin",
                profile_image_url: "https://example.com/avatar.png",
              },
            ],
          }),
        },
      ]);

      const provider = createTwitchProvider(CLIENT_ID, CLIENT_SECRET, fetchImpl);
      const result = await provider.exchangeCode("some-code", REDIRECT_URI);

      expect(result).toEqual({
        providerId: "12345",
        login: "streamerin",
        displayName: "Streamerin",
        avatarUrl: "https://example.com/avatar.png",
      });
      expect(fetchImpl).toHaveBeenCalledTimes(2);

      const [tokenUrl, tokenInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
      expect(tokenUrl).toBe("https://id.twitch.tv/oauth2/token");
      expect(tokenInit.method).toBe("POST");

      const [usersUrl, usersInit] = fetchImpl.mock.calls[1] as [string, RequestInit];
      expect(usersUrl).toBe("https://api.twitch.tv/helix/users");
      expect((usersInit.headers as Record<string, string>).Authorization).toBe("Bearer abc123");
      expect((usersInit.headers as Record<string, string>)["Client-Id"]).toBe(CLIENT_ID);
    });

    it("wirft, wenn der Token-Austausch fehlschlägt", async () => {
      const fetchImpl = fakeFetchSequence([{ ok: false, status: 400, json: () => ({}) }]);
      const provider = createTwitchProvider(CLIENT_ID, CLIENT_SECRET, fetchImpl);

      await expect(provider.exchangeCode("bad-code", REDIRECT_URI)).rejects.toThrow(/400/);
    });

    it("wirft, wenn der User-Abruf fehlschlägt", async () => {
      const fetchImpl = fakeFetchSequence([
        { ok: true, json: () => ({ access_token: "abc123" }) },
        { ok: false, status: 401, json: () => ({}) },
      ]);
      const provider = createTwitchProvider(CLIENT_ID, CLIENT_SECRET, fetchImpl);

      await expect(provider.exchangeCode("some-code", REDIRECT_URI)).rejects.toThrow(/401/);
    });

    it("wirft, wenn Twitch keinen User zurückgibt", async () => {
      const fetchImpl = fakeFetchSequence([
        { ok: true, json: () => ({ access_token: "abc123" }) },
        { ok: true, json: () => ({ data: [] }) },
      ]);
      const provider = createTwitchProvider(CLIENT_ID, CLIENT_SECRET, fetchImpl);

      await expect(provider.exchangeCode("some-code", REDIRECT_URI)).rejects.toThrow(/keinen User/);
    });
  });
});
