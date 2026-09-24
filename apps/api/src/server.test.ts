import { describe, it, expect } from "vitest";
import { buildServer } from "./server";

describe("GET /health", () => {
  it("antwortet mit status ok", async () => {
    const app = buildServer();
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });
});
