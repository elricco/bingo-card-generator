import { test, expect } from "@playwright/test";

test("Fremde Boards sind weder einsehbar noch veränderbar; über den Overlay-Link sind keine Änderungen möglich (AC9)", async ({
  page,
  context,
}) => {
  await page.goto("http://localhost:3001/e2e/login/streamerin");
  await page.waitForURL(/\/boards$/);
  await page.getByRole("link", { name: "Neues Board" }).click();
  await page.getByLabel("Name").fill("E2E Fremdes Board");
  await page.getByLabel("Größe").selectOption("3");
  await page.getByRole("button", { name: "Board erstellen" }).click();
  await page.waitForURL(/\/boards\/.+\/edit$/);
  const boardId = page.url().split("/boards/")[1].split("/")[0];
  const boardData = await (await page.request.get(`http://localhost:3001/api/boards/${boardId}`)).json();

  const otherContext = await context.browser()!.newContext();
  const otherPage = await otherContext.newPage();
  await otherPage.goto("http://localhost:3001/e2e/login/andere");
  await otherPage.waitForURL(/\/boards$/);

  await expect(otherPage.getByText("E2E Fremdes Board")).toHaveCount(0);

  const getResponse = await otherPage.request.get(`http://localhost:3001/api/boards/${boardId}`);
  expect(getResponse.status()).toBe(404);

  const patchResponse = await otherPage.request.patch(`http://localhost:3001/api/boards/${boardId}`, {
    data: { name: "Übernommen" },
  });
  expect(patchResponse.status()).toBe(404);

  const overlayGetResponse = await otherPage.request.get(
    `http://localhost:3001/api/overlay/${boardData.overlayToken}`
  );
  expect(overlayGetResponse.status()).toBe(200);
  expect(overlayGetResponse.headers()["content-type"]).toContain("application/json");

  await otherContext.close();
});
