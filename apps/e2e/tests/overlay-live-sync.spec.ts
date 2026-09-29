import { test, expect } from "@playwright/test";
import { readPngPixel } from "../utils/png";

test.describe("Overlay, Live-Updates und Persistenz", () => {
  test("Overlay hat transparenten Hintergrund; ein Häkchen auf der Control-Seite erscheint ohne Reload im Overlay; der Stand bleibt nach Reload erhalten (AC6, AC7, AC8)", async ({
    page,
    context,
  }) => {
    await page.goto("http://localhost:3001/e2e/login/streamerin");
    await page.waitForURL(/\/boards$/);

    await page.getByRole("link", { name: "Neues Board" }).click();
    await page.getByLabel("Name").fill("E2E Live-Sync Board");
    await page.getByLabel("Größe").selectOption("3");
    await page.getByRole("button", { name: "Board erstellen" }).click();
    await page.waitForURL(/\/boards\/.+\/edit$/);
    const boardId = page.url().split("/boards/")[1].split("/")[0];

    const boardData = await (await page.request.get(`http://localhost:3001/api/boards/${boardId}`)).json();

    const overlayPage = await context.newPage();
    await overlayPage.goto(`/overlay/${boardData.overlayToken}`);
    await expect(overlayPage.locator(".overlay-grid")).toBeVisible();

    // Ein bloßer getComputedStyle(document.body).backgroundColor-Check wäre
    // tautologisch: "transparent" (rgba(0, 0, 0, 0)) ist der CSS-Initialwert von
    // background-color für JEDES Element ohne jede CSS-Regel — das gilt auch für
    // html/body/.overlay-root selbst ganz ohne die expliziten "background:
    // transparent"-Regeln in OverlayView.vue, weil dieses Projekt (Tailwind-Preflight
    // + keine globale body-Hintergrundfarbe) nichts anderes vorgibt. Ein Löschen der
    // Regel würde diesen Check also nicht zum Scheitern bringen.
    //
    // Stattdessen wird ein echter Screenshot mit omitBackground:true genommen: nur
    // wenn Chromium beim Rendern tatsächlich Transparenz komponiert (statt z. B.
    // eines dunklen App-Hintergrunds, wie ihn der Rest der App über bg-slate-900
    // verwendet), ist der Alpha-Kanal an einer Stelle außerhalb des Grids 0. Das
    // deckt den realistischen Regressionsfall ab (versehentlich ein undurchsichtiger
    // Hintergrund wie im Rest der App), nicht nur ein wortwörtliches Löschen der Regel.
    const screenshot = await overlayPage.screenshot({ omitBackground: true });
    // Bei Standard-Viewport (1280x720) und einem 3x3-Board ist das Grid
    // min(100vw,100vh)=720px breit und horizontal zentriert (Rand links/rechts
    // 280px) — (5, 5) liegt damit sicher im Hintergrundbereich von .overlay-root,
    // außerhalb jeder Grid-Zelle.
    const backgroundCorner = readPngPixel(screenshot, 5, 5);
    expect(backgroundCorner.a).toBe(0);

    await page.goto(`/boards/${boardId}/play`);
    await page.locator("button.bg-slate-800").first().click();

    await expect(overlayPage.getByText("✕")).toBeVisible({ timeout: 3000 });

    await overlayPage.reload();
    await expect(overlayPage.getByText("✕")).toBeVisible();

    await page.reload();
    await expect(page.locator("button.bg-slate-800", { hasText: "✕" }).first()).toBeVisible();
  });
});
