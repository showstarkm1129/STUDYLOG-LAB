const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const fixturePath = process.argv[2];
const screenshotDir = process.argv[3];
const dependencyRoot = process.argv[4];
const cdpEndpoint = process.argv[5];
const { chromium } = require(dependencyRoot ? path.join(dependencyRoot, "playwright") : "playwright");
assert(fixturePath, "usage: dashboard-smoke.cjs <snapshot.json> [screenshot-dir]");

const root = process.cwd();
const snapshot = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const mime = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };

const server = http.createServer((request, response) => {
  const pathname = request.url === "/" ? "/dashboard.html" : new URL(request.url, "http://localhost").pathname;
  const filename = path.join(root, pathname.replace(/^\/+/, ""));
  if (!filename.startsWith(root) || !fs.existsSync(filename)) {
    response.writeHead(404).end("not found");
    return;
  }
  response.writeHead(200, { "Content-Type": mime[path.extname(filename)] || "application/octet-stream" });
  fs.createReadStream(filename).pipe(response);
});
let browser;

(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  browser = cdpEndpoint
    ? await chromium.connectOverCDP(cdpEndpoint)
    : await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.addInitScript((data) => {
    localStorage.setItem("stalogBridgeSnapshotV1", JSON.stringify(data));
  }, snapshot);
  await page.goto(`http://127.0.0.1:${port}/dashboard.html?now=2026-07-29T09:30:00`, { waitUntil: "networkidle" });
  await page.waitForSelector(".metric");
  assert.match(await page.locator("body").innerText(), /11\/11/);
  assert.equal(await page.locator(".nav-item").count(), 4);

  if (screenshotDir) {
    fs.mkdirSync(screenshotDir, { recursive: true });
    await page.screenshot({ path: path.join(screenshotDir, "stalog-lab-home.png"), fullPage: true });
  }

  for (const view of ["tasks", "attendance", "courses"]) {
    await page.click(`[data-view="${view}"]`);
    await page.waitForSelector(".page-header h1");
    assert((await page.locator("#app-view").innerText()).length > 100, `${view} should contain rendered content`);
  }

  await page.click('[data-view="tasks"]');
  const pendingBefore = await page.locator(".task-row").count();
  await page.locator("[data-manual-toggle]:not([disabled])").first().click();
  assert((await page.locator(".task-row").count()) < pendingBefore, "manual completion should remove a pending row");
  await page.click('[data-task-filter="manual"]');
  assert((await page.locator(".task-row").count()) >= 1, "manual completion should be reversible");

  await page.click('[data-view="attendance"]');
  const rateBefore = await page.locator("#sim-rate").textContent();
  await page.click('[data-sim-step="1"]');
  const rateAfter = await page.locator("#sim-rate").textContent();
  assert.notEqual(rateAfter, rateBefore, "simulator stepper should update the projected rate");

  await page.click('[data-view="courses"]');
  await page.click("[data-course-open]");
  assert(await page.locator("#course-dialog").evaluate((dialog) => dialog.open));
  assert.match(await page.locator("#course-dialog").innerText(), /課題を実施して完了/);
  assert.match(await page.locator("#course-dialog").innerText(), /提出済|完了 \(/);
  const dialogChecks = page.locator('#course-dialog [data-manual-toggle]:not([disabled])');
  const dialogManualBefore = await page.locator("#course-dialog .task-check.is-manual").count();
  await dialogChecks.first().click();
  await page.waitForFunction((count) => document.querySelectorAll("#course-dialog .task-check.is-manual").length > count, dialogManualBefore);
  assert.match(await page.locator("#course-dialog").innerText(), /手動で完了/);
  if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, "stalog-course-dialog.png"), fullPage: true });
  await page.locator("#course-dialog .task-check.is-manual").first().click();
  await page.waitForFunction((count) => document.querySelectorAll("#course-dialog .task-check.is-manual").length === count, dialogManualBefore);
  await page.mouse.click(5, 5);
  assert.equal(await page.locator("#course-dialog").evaluate((dialog) => dialog.open), false, "course dialog should close from a backdrop click");

  await page.click("#topbar-data-button");
  assert(await page.locator("#data-dialog").evaluate((dialog) => dialog.open));
  await page.mouse.click(5, 5);
  assert.equal(await page.locator("#data-dialog").evaluate((dialog) => dialog.open), false, "data dialog should close from a backdrop click");

  assert.deepEqual(errors, [], `browser errors:\n${errors.join("\n")}`);
  await browser.close();
  server.close();
  console.log("dashboard smoke test: ok");
})().catch((error) => {
  server.close();
  browser?.close();
  console.error(error);
  process.exitCode = 1;
});
