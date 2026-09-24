import { describe, it, expect, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import "../env";
import { db } from "../db/client";
import { sessions, users } from "../db/schema";
import { createSession, getUserBySessionId, deleteSession, SESSION_TTL_MS } from "./session";

async function createTestUser() {
  const [user] = await db
    .insert(users)
    .values({
      twitchId: `test-${randomUUID()}`,
      login: "test-user",
      displayName: "Test User",
      avatarUrl: null,
    })
    .returning();
  return user;
}

describe("session-Helfer", () => {
  const createdUserIds: string[] = [];

  afterEach(async () => {
    for (const userId of createdUserIds.splice(0)) {
      await db.delete(users).where(eq(users.id, userId));
    }
  });

  it("createSession legt eine Session mit 64-stelliger Hex-ID und korrektem Ablaufdatum an", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);

    const before = Date.now();
    const session = await createSession(user.id);
    const after = Date.now();

    expect(session.id).toMatch(/^[0-9a-f]{64}$/);
    expect(session.expiresAt.getTime()).toBeGreaterThanOrEqual(before + SESSION_TTL_MS - 1000);
    expect(session.expiresAt.getTime()).toBeLessThanOrEqual(after + SESSION_TTL_MS + 1000);

    const [row] = await db.select().from(sessions).where(eq(sessions.id, session.id));
    expect(row).toBeDefined();
    expect(row.userId).toBe(user.id);
  });

  it("getUserBySessionId liefert den User für eine gültige Session", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const session = await createSession(user.id);

    const result = await getUserBySessionId(session.id);

    expect(result?.id).toBe(user.id);
    expect(result?.login).toBe("test-user");
  });

  it("getUserBySessionId liefert null für eine unbekannte Session-ID", async () => {
    const result = await getUserBySessionId("nonexistent".repeat(8));
    expect(result).toBeNull();
  });

  it("getUserBySessionId liefert null und löscht eine abgelaufene Session", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const expiredId = randomUUID().replace(/-/g, "").repeat(2).slice(0, 64);
    await db.insert(sessions).values({
      id: expiredId,
      userId: user.id,
      expiresAt: new Date(Date.now() - 1000),
    });

    const result = await getUserBySessionId(expiredId);
    expect(result).toBeNull();

    const [row] = await db.select().from(sessions).where(eq(sessions.id, expiredId));
    expect(row).toBeUndefined();
  });

  it("deleteSession entfernt die Session, danach liefert getUserBySessionId null", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const session = await createSession(user.id);

    await deleteSession(session.id);

    const result = await getUserBySessionId(session.id);
    expect(result).toBeNull();
  });
});
