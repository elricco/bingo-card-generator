import { test, expect } from "@playwright/test";

test.describe("Editor und Board-Verwaltung", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("http://localhost:3001/e2e/login/streamerin");
    await page.waitForURL(/\/boards$/);
  });

  test("Ein Feld lässt sich per Klick mit Text füllen, speichern, und der Text bleibt nach Reload sichtbar (AC4)", async ({
    page,
  }) => {
    await page.getByRole("link", { name: "Neues Board" }).click();
    await page.getByLabel("Name").fill("E2E Textfeld Board");
    await page.getByLabel("Größe").selectOption("3");
    await page.getByRole("button", { name: "Board erstellen" }).click();
    await page.waitForURL(/\/boards\/.+\/edit$/);

    await page.locator(".aspect-square.bg-slate-800").first().click();
    await page.locator("textarea[data-cell]").fill("Erster Clip");
    await page.locator("textarea[data-cell]").blur();
    const cellSavePatch = page.waitForResponse(
      (response) =>
        response.url().includes("/api/boards/") &&
        response.request().method() === "PATCH" &&
        response.ok()
    );
    await page.getByRole("button", { name: "Speichern" }).click();
    // Erst nachdem die Speicher-PATCH tatsächlich bestätigt ist, weiterprüfen — sonst
    // zeigt die folgende Sichtbarkeitsprüfung ggf. nur den lokalen Vue-State, und der
    // direkt danach folgende Reload könnte mit dem Speichern race'n.
    await cellSavePatch;
    await expect(page.getByText("Erster Clip")).toBeVisible();

    await page.reload();
    await expect(page.getByText("Erster Clip")).toBeVisible();
  });

  test("Board benennen, bearbeiten, duplizieren (ohne Häkchen) und löschen (AC5)", async ({ page }) => {
    // Eindeutiges Suffix, damit der Test bei wiederholten Läufen gegen dieselbe
    // (nicht zurückgesetzte) lokale DB nicht mit gleichnamigen Boards früherer
    // Läufe kollidiert.
    const uniqueSuffix = Date.now();
    const originalName = `E2E Verwaltung Original ${uniqueSuffix}`;
    const renamedName = `E2E Verwaltung Umbenannt ${uniqueSuffix}`;

    await page.getByRole("link", { name: "Neues Board" }).click();
    await page.getByLabel("Name").fill(originalName);
    await page.getByLabel("Größe").selectOption("3");
    await page.getByRole("button", { name: "Board erstellen" }).click();
    await page.waitForURL(/\/boards\/.+\/edit$/);
    // Board wurde mit dem vergebenen Namen angelegt (AC5: "benannt").
    await expect(page.locator('input[type="text"]').first()).toHaveValue(originalName);

    await page.locator('input[type="text"]').first().fill(renamedName);
    const renamePatch = page.waitForResponse(
      (response) =>
        response.url().includes("/api/boards/") &&
        response.request().method() === "PATCH" &&
        response.ok()
    );
    await page.getByRole("button", { name: "Speichern" }).click();
    await renamePatch;
    // Ein toHaveValue(renamedName) direkt nach .fill()+Klick wäre tautologisch (es
    // prüft nur den gerade selbst eingetippten Wert erneut). Erst ein Reload nach
    // bestätigter Speicherung beweist, dass der Name wirklich persistiert wurde.
    await page.reload();
    await expect(page.locator('input[type="text"]').first()).toHaveValue(renamedName);

    await page.getByRole("link", { name: "Zur Übersicht" }).click();
    await page.waitForURL(/\/boards$/);
    const row = page.locator("li", { hasText: renamedName });
    await row.getByRole("link", { name: "Spielen" }).click();
    await page.waitForURL(/\/boards\/.+\/play$/);
    const checkPut = page.waitForResponse(
      (response) =>
        response.url().includes("/cells/") &&
        response.request().method() === "PUT" &&
        response.ok()
    );
    await page.locator("button.bg-slate-800").first().click();
    // Erst nach bestätigtem PUT zurücknavigieren — sonst kann die Boardliste geladen
    // werden, bevor der Häkchen-Status serverseitig committed ist, was "1 abgehakt"
    // gelegentlich verschwinden lässt.
    await checkPut;
    await page.goBack();
    await page.waitForURL(/\/boards$/);
    await expect(row.getByText(/1 abgehakt/)).toBeVisible();

    await row.getByRole("button", { name: "Duplizieren" }).click();
    const copyRow = page.locator("li", { hasText: `${renamedName} (Kopie)` });
    await expect(copyRow).toBeVisible();
    await expect(copyRow.getByText(/0 abgehakt/)).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await copyRow.getByRole("button", { name: "Löschen" }).click();
    await expect(copyRow).toHaveCount(0);
  });
});
