import type { OAuthProvider, OAuthUserInfo } from "./types";

interface TwitchTokenResponse {
  access_token: string;
}

interface TwitchUsersResponse {
  data: Array<{
    id: string;
    login: string;
    display_name: string;
    profile_image_url: string;
  }>;
}

export function createTwitchProvider(
  clientId: string,
  clientSecret: string,
  fetchImpl: typeof fetch = fetch
): OAuthProvider {
  return {
    name: "twitch",

    getAuthorizationUrl(state, redirectUri) {
      const url = new URL("https://id.twitch.tv/oauth2/authorize");
      url.searchParams.set("client_id", clientId);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", "");
      url.searchParams.set("state", state);
      return url.toString();
    },

    async exchangeCode(code, redirectUri): Promise<OAuthUserInfo> {
      const tokenResponse = await fetchImpl("https://id.twitch.tv/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          grant_type: "authorization_code",
          redirect_uri: redirectUri,
        }),
      });

      if (!tokenResponse.ok) {
        throw new Error(`Twitch-Token-Austausch fehlgeschlagen: ${tokenResponse.status}`);
      }

      const tokenData = (await tokenResponse.json()) as TwitchTokenResponse;

      const usersResponse = await fetchImpl("https://api.twitch.tv/helix/users", {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          "Client-Id": clientId,
        },
      });

      if (!usersResponse.ok) {
        throw new Error(`Twitch-User-Abruf fehlgeschlagen: ${usersResponse.status}`);
      }

      const usersData = (await usersResponse.json()) as TwitchUsersResponse;
      const twitchUser = usersData.data[0];

      if (!twitchUser) {
        throw new Error("Twitch hat keinen User zurückgegeben");
      }

      return {
        providerId: twitchUser.id,
        login: twitchUser.login,
        displayName: twitchUser.display_name,
        avatarUrl: twitchUser.profile_image_url || null,
      };
    },
  };
}
