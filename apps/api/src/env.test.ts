import { describe, it, expect } from "vitest";
import "./env";

describe("env-Laden", () => {
  it("hat DATABASE_URL aus der Root-.env-Datei geladen", () => {
    expect(process.env.DATABASE_URL).toBeTruthy();
  });
});
