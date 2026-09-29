import { test, expect } from "@playwright/test";

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

    const bodyBackground = await overlayPage.evaluate(
      () => getComputedStyle(document.body).backgroundColor
    );
    expect(["rgba(0, 0, 0, 0)", "transparent"]).toContain(bodyBackground);

    await page.goto(`/boards/${boardId}/play`);
    await page.locator("button.bg-slate-800").first().click();

    await expect(overlayPage.getByText("✕")).toBeVisible({ timeout: 3000 });

    await overlayPage.reload();
    await expect(overlayPage.getByText("✕")).toBeVisible();

    await page.reload();
    await expect(page.locator("button.bg-slate-800", { hasText: "✕" }).first()).toBeVisible();
  });
});
