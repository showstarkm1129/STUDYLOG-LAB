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

(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const browser = cdpEndpoint
    ? await chromium.connectOverCDP(cdpEndpoint)
    : await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.addInitScript((data) => {
    localStorage.setItem("stalogBridgeSnapshotV1", JSON.stringify(data));
  }, snapshot);
  await page.goto(`http://127.0.0.1:${port}/dashboard.html`, { waitUntil: "networkidle" });
  await page.waitForSelector(".metric");
  assert.match(await page.locator("body").innerText(), /11科目/);
  assert.equal(await page.locator(".nav-item").count(), 8);

  if (screenshotDir) {
    fs.mkdirSync(screenshotDir, { recursive: true });
    await page.screenshot({ path: path.join(screenshotDir, "stalog-lab-home.png"), fullPage: true });
  }

  for (const view of ["tasks", "attendance", "results", "timetable", "courses", "insights", "lab"]) {
    await page.click(`[data-view="${view}"]`);
    await page.waitForSelector(".page-header h1");
    assert((await page.locator("#app-view").innerText()).length > 100, `${view} should contain rendered content`);
  }

  await page.click('[data-view="courses"]');
  await page.click("[data-course-open]");
  assert(await page.locator("#course-dialog").evaluate((dialog) => dialog.open));
  await page.click('[data-close-dialog="course-dialog"]');

  await page.click('[data-view="lab"]');
  await page.click('[data-candidate="daily-brief"]');
  assert.equal(await page.locator("#review-counter strong").textContent(), "1");

  await page.fill("#global-search", snapshot.courses[0].name.slice(0, 3));
  await page.waitForSelector("#search-panel:not([hidden]) .search-result");

  assert.deepEqual(errors, [], `browser errors:\n${errors.join("\n")}`);
  await browser.close();
  server.close();
  console.log("dashboard smoke test: ok");
})().catch((error) => {
  server.close();
  console.error(error);
  process.exitCode = 1;
});
