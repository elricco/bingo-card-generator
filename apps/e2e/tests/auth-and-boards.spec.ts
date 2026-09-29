import { test, expect } from "@playwright/test";

test.describe("Login und Board-Anlage", () => {
  test("Login über den Twitch-Button und Logout funktionieren (AC1)", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Mit Twitch einloggen" }).click();
    await page.waitForURL(/\/boards$/);
    await expect(page.getByText("E2E Streamerin")).toBeVisible();

    await page.getByRole("button", { name: "Ausloggen" }).click();
    await page.waitForURL("/");
    await expect(page.getByRole("link", { name: "Mit Twitch einloggen" })).toBeVisible();
  });

  test("Boards lassen sich in jeder Größe anlegen; bei 5×5 ist BINGO wählbar; eigene Spaltenwörter funktionieren bei jeder Größe (AC2)", async ({
    page,
  }) => {
    await page.goto("http://localhost:3001/e2e/login/streamerin");
    await page.waitForURL(/\/boards$/);

    await page.getByRole("link", { name: "Neues Board" }).click();
    await page.getByLabel("Name").fill("E2E 3x3 Board");
    await page.getByLabel("Größe").selectOption("3");
    await page.getByRole("button", { name: "Board erstellen" }).click();
    await page.waitForURL(/\/boards\/.+\/edit$/);
    await expect(page.getByText("A", { exact: true }).first()).toBeVisible();

    await page.goto("/boards/new");
    await page.getByLabel("Name").fill("E2E 5x5 BINGO Board");
    await page.getByLabel("Größe").selectOption("5");
    await page.getByLabel("Beschriftung").selectOption("bingo");
    await page.getByRole("button", { name: "Board erstellen" }).click();
    await page.waitForURL(/\/boards\/.+\/edit$/);
    await expect(page.getByText("B", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("G", { exact: true }).first()).toBeVisible();

    await page.goto("/boards/new");
    await page.getByLabel("Name").fill("E2E 7x7 Custom Board");
    await page.getByLabel("Größe").selectOption("7");
    await page.getByLabel("Beschriftung").selectOption("custom");
    const columnInputs = page.locator('label:has-text("Spalte") input');
    await expect(columnInputs).toHaveCount(7);
    for (let i = 0; i < 7; i++) {
      await columnInputs.nth(i).fill(`Wort${i + 1}`);
    }
    await page.getByRole("button", { name: "Board erstellen" }).click();
    await page.waitForURL(/\/boards\/.+\/edit$/);
    await expect(page.getByText("Wort1", { exact: true }).first()).toBeVisible();

    await page.goto("/boards/new");
    await page.getByLabel("Name").fill("E2E 9x9 Board");
    await page.getByLabel("Größe").selectOption("9");
    await page.getByRole("button", { name: "Board erstellen" }).click();
    await page.waitForURL(/\/boards\/.+\/edit$/);
    await expect(page.getByText("I", { exact: true }).first()).toBeVisible();
  });

  test("Spaltenbuchstaben oben/unten und Reihennummern links/rechts erscheinen im Editor, auf der Control-Seite und im Overlay (AC3)", async ({
    page,
    context,
  }) => {
    await page.goto("http://localhost:3001/e2e/login/streamerin");
    await page.waitForURL(/\/boards$/);

    await page.getByRole("link", { name: "Neues Board" }).click();
    await page.getByLabel("Name").fill("E2E Label Board");
    await page.getByLabel("Größe").selectOption("3");
    await page.getByRole("button", { name: "Board erstellen" }).click();
    await page.waitForURL(/\/boards\/.+\/edit$/);
    const boardId = page.url().split("/boards/")[1].split("/")[0];

    await expect(page.getByText(/^[A-C]$/)).toHaveCount(6);
    await expect(page.getByText(/^[1-3]$/)).toHaveCount(6);

    await page.goto(`/boards/${boardId}/play`);
    await expect(page.getByText(/^[A-C]$/)).toHaveCount(6);
    await expect(page.getByText(/^[1-3]$/)).toHaveCount(6);

    const boardData = await (await page.request.get(`http://localhost:3001/api/boards/${boardId}`)).json();
    const overlayPage = await context.newPage();
    await overlayPage.goto(`/overlay/${boardData.overlayToken}`);
    await expect(overlayPage.getByText(/^[A-C]$/)).toHaveCount(6);
    await expect(overlayPage.getByText(/^[1-3]$/)).toHaveCount(6);
  });
});
