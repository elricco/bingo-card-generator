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
  // "Lade..." verschwindet bereits, bevor die Boardliste überhaupt zu rendern begonnen
  // hat (isLoading startet mit false, der Router-Guard verzögert das Mounten) - ein
  // reines Warten auf das Verschwinden dieses Texts wäre daher ein Blindflug und würde
  // auch dann grün bleiben, wenn die Liste fremde Boards leaken würde. Stattdessen auf
  // den echten Leerzustand warten, den "andere" (ohne eigene Boards) tatsächlich sieht.
  await expect(otherPage.getByText("Noch keine Boards vorhanden.")).toBeVisible();

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

  // "Read-only" heißt: über den Overlay-Token ist ausschließlich Lesen möglich. Das
  // GET oben beweist das allein nicht — erst ein tatsächlicher Schreibversuch (und
  // dessen Ablehnung) tut das. Die Overlay-Routen registrieren nur GET-Handler, ein
  // PATCH/PUT auf denselben bzw. einen abgeleiteten Pfad trifft daher Fastifys
  // Standard-404-Handler für "Route nicht gefunden" (empirisch bestätigt).
  const overlayPatchResponse = await otherPage.request.patch(
    `http://localhost:3001/api/overlay/${boardData.overlayToken}`,
    { data: { name: "Hack" } }
  );
  expect(overlayPatchResponse.status()).toBe(404);

  const overlayPutResponse = await otherPage.request.put(
    `http://localhost:3001/api/overlay/${boardData.overlayToken}/cells/0/0/checked`,
    { data: { checked: true } }
  );
  expect(overlayPutResponse.status()).toBe(404);

  // Beweisen, dass die Schreibversuche wirklich nichts verändert haben: als
  // tatsächliche Eigentümerin (Session in `page`) den echten Board-Zustand erneut
  // abrufen und prüfen, dass Name und Zellstatus unverändert sind.
  const ownerCheckResponse = await page.request.get(`http://localhost:3001/api/boards/${boardId}`);
  const ownerCheckData = await ownerCheckResponse.json();
  expect(ownerCheckData.name).toBe("E2E Fremdes Board");
  const cellZeroZero = ownerCheckData.cells.find(
    (c: { row: number; col: number; checked: boolean }) => c.row === 0 && c.col === 0
  );
  expect(cellZeroZero.checked).toBe(false);

  await otherContext.close();
});
