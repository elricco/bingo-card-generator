import "../env";
import { db } from "./client";
import { users } from "./schema";
import type { OAuthUserInfo } from "../auth/types";

export async function upsertUserFromTwitch(info: OAuthUserInfo) {
  const [user] = await db
    .insert(users)
    .values({
      twitchId: info.providerId,
      login: info.login,
      displayName: info.displayName,
      avatarUrl: info.avatarUrl,
    })
    .onConflictDoUpdate({
      target: users.twitchId,
      set: {
        login: info.login,
        displayName: info.displayName,
        avatarUrl: info.avatarUrl,
        updatedAt: new Date(),
      },
    })
    .returning();

  return user;
}
