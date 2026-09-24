import { describe, it, expect, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import "../env";
import { db } from "./client";
import { users } from "./schema";
import { upsertUserFromTwitch } from "./users";

describe("upsertUserFromTwitch", () => {
  const createdIds: string[] = [];

  afterEach(async () => {
    for (const id of createdIds.splice(0)) {
      await db.delete(users).where(eq(users.id, id));
    }
  });

  it("legt einen neuen User an, wenn twitchId unbekannt ist", async () => {
    const twitchId = `test-${randomUUID()}`;

    const user = await upsertUserFromTwitch({
      providerId: twitchId,
      login: "neuer-user",
      displayName: "Neuer User",
      avatarUrl: "https://example.com/a.png",
    });
    createdIds.push(user.id);

    expect(user.twitchId).toBe(twitchId);
    expect(user.login).toBe("neuer-user");
    expect(user.displayName).toBe("Neuer User");
    expect(user.avatarUrl).toBe("https://example.com/a.png");
  });

  it("aktualisiert den bestehenden User, wenn twitchId schon existiert, statt zu duplizieren", async () => {
    const twitchId = `test-${randomUUID()}`;

    const first = await upsertUserFromTwitch({
      providerId: twitchId,
      login: "alter-name",
      displayName: "Alter Name",
      avatarUrl: null,
    });
    createdIds.push(first.id);

    const second = await upsertUserFromTwitch({
      providerId: twitchId,
      login: "neuer-name",
      displayName: "Neuer Name",
      avatarUrl: "https://example.com/b.png",
    });

    expect(second.id).toBe(first.id);
    expect(second.login).toBe("neuer-name");
    expect(second.displayName).toBe("Neuer Name");
    expect(second.avatarUrl).toBe("https://example.com/b.png");

    const rows = await db.select().from(users).where(eq(users.twitchId, twitchId));
    expect(rows).toHaveLength(1);
  });
});
