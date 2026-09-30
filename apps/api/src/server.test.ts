import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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

describe("statisches Frontend", () => {
  let tempDir: string | undefined;

  afterEach(() => {
    delete process.env.WEB_DIST_PATH;
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  function createFixtureDist(): string {
    const dir = mkdtempSync(path.join(tmpdir(), "bingo-web-dist-"));
    writeFileSync(path.join(dir, "index.html"), "<!doctype html><html><body>App</body></html>");
    writeFileSync(path.join(dir, "app.js"), "console.log('app');");
    return dir;
  }

  it("liefert eine existierende Datei aus dem dist-Verzeichnis aus", async () => {
    tempDir = createFixtureDist();
    process.env.WEB_DIST_PATH = tempDir;
    const app = await buildServer();

    const response = await app.inject({ method: "GET", url: "/app.js" });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("console.log");
  });

  it("liefert index.html als SPA-Fallback für unbekannte Frontend-Routen", async () => {
    tempDir = createFixtureDist();
    process.env.WEB_DIST_PATH = tempDir;
    const app = await buildServer();

    const response = await app.inject({ method: "GET", url: "/boards/some-id/edit" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("App");
  });

  it("liefert weiterhin JSON-404 für unbekannte API-Routen, statt index.html", async () => {
    tempDir = createFixtureDist();
    process.env.WEB_DIST_PATH = tempDir;
    const app = await buildServer();

    const response = await app.inject({ method: "GET", url: "/api/does-not-exist" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Nicht gefunden" });
  });

  it("liefert index.html für /overlay/:token (Frontend-Route), nicht die API-404-Antwort", async () => {
    tempDir = createFixtureDist();
    process.env.WEB_DIST_PATH = tempDir;
    const app = await buildServer();

    const response = await app.inject({ method: "GET", url: "/overlay/some-token" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("App");
  });

  it("liefert 404 statt index.html für nicht-GET/HEAD-Anfragen auf unbekannte Routen", async () => {
    tempDir = createFixtureDist();
    process.env.WEB_DIST_PATH = tempDir;
    const app = await buildServer();

    const response = await app.inject({ method: "POST", url: "/some-unknown-route" });

    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).not.toContain("text/html");
  });

  it("registriert kein statisches Ausliefern, wenn das dist-Verzeichnis nicht existiert", async () => {
    process.env.WEB_DIST_PATH = path.join(tmpdir(), "bingo-web-dist-does-not-exist-12345");
    const app = await buildServer();

    const response = await app.inject({ method: "GET", url: "/does-not-exist-at-all" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).not.toEqual({ error: "Nicht gefunden" });
    expect(response.headers["content-type"]).not.toContain("text/html");
  });
});
