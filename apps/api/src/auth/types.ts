export interface OAuthUserInfo {
  providerId: string;
  login: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface OAuthProvider {
  name: string;
  getAuthorizationUrl(state: string, redirectUri: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<OAuthUserInfo>;
}
