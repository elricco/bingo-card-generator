import { describe, it, expect } from "vitest";
import { buildServer } from "./server";

describe("GET /health", () => {
  it("antwortet mit status ok", async () => {
    const app = await buildServer();
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });
});

describe("CORS", () => {
  it("erlaubt die konfigurierte WEB_ORIGIN mit Credentials", async () => {
    const app = await buildServer();
    const origin = process.env.WEB_ORIGIN ?? "http://localhost:5173";
    const response = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin },
    });

    expect(response.headers["access-control-allow-origin"]).toBe(origin);
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
  });
});
