const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const fixturePath = process.argv[2];
const dependencyRoot = process.argv[3];
const screenshotPath = process.argv[4];
const { chromium } = require(dependencyRoot ? path.join(dependencyRoot, "playwright") : "playwright");
assert(fixturePath, "usage: companion-smoke.cjs <snapshot.json> [dependency-root]");

const root = path.resolve(__dirname, "..");
const mime = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json" };
const portalRoute = (pathname) => pathname === "/lms" || pathname.startsWith("/lms/") || pathname.startsWith("/portal/lmsinc/");
let browser;

const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (pathname === "/__fixture") {
    response.writeHead(200, { "Content-Type": mime[".json"] });
    fs.createReadStream(fixturePath).pipe(response);
    return;
  }
  const relative = portalRoute(pathname) ? "tests/companion.html" : pathname.replace(/^\/+/, "");
  const filename = path.resolve(root, relative);
  if (!filename.startsWith(`${root}${path.sep}`) || !fs.existsSync(filename)) {
    response.writeHead(404).end("not found");
    return;
  }
  response.writeHead(200, { "Content-Type": mime[path.extname(filename)] || "application/octet-stream" });
  fs.createReadStream(filename).pipe(response);
});

(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  const visit = async (route, expectedTitle) => {
    await page.goto(`http://127.0.0.1:${port}${route}`);
    await page.waitForSelector("#stalog-bridge-root");
    await page.waitForFunction(() => !document.querySelector("#stalog-bridge-toggle")?.textContent.includes("読み込み中"));
    assert.equal(await page.locator("#stalog-context-title").textContent(), expectedTitle);
    assert.equal(await page.locator("body").getAttribute("data-page-mode"), "normal");
  };

  await visit("/lms/", "今日のブリーフ");
  if (screenshotPath) {
    await page.locator("#stalog-bridge-toggle").click();
    await page.screenshot({ path: screenshotPath, fullPage: true });
  }
  await visit("/lms/schedule/", "時間割");
  await visit("/portal/lmsinc/sMyPage.php", "課題状況");
  assert.match(await page.locator("#stalog-context-body").innerText(), /スタログ上の未完了/);
  const compactBefore = await page.locator("#stalog-bridge-toggle").innerText();
  await page.locator("#stalog-bridge-toggle").click();
  await page.locator("[data-context-manual]").first().click();
  await page.waitForFunction(() => document.body.dataset.manualCompleted === "1");
  assert.notEqual(await page.locator("#stalog-bridge-toggle").innerText(), compactBefore);
  assert.equal(await page.locator('[data-context-manual][data-checked="true"]').count(), 1);
  if (screenshotPath) await page.screenshot({ path: screenshotPath.replace(/(\.png)?$/, "-checked.png"), fullPage: true });
  await page.locator('[data-context-manual][data-checked="true"]').click();
  await page.waitForFunction(() => document.body.dataset.manualCompleted === "0");
  assert.equal(await page.locator('[data-context-manual][data-checked="true"]').count(), 0);
  assert.equal(await page.locator("#stalog-bridge-toggle").innerText(), compactBefore);

  await visit("/lms/class/10183/", "科目の状況");
  assert.match(await page.locator("#stalog-bridge-toggle").innerText(), /Javaプログラミング/);
  await visit("/lms/class/10183/153094/", "この授業回");
  const directoryText = await page.locator("#stalog-context-body").innerText();
  assert.match(directoryText, /この回の未整理/);
  assert.match(directoryText, /同じ科目のほかの未整理/);
  assert.match(directoryText, /\(H\)ダイジェスト_01補講/);
  assert.match(directoryText, /\(H\)ダイジェスト_02補講/);

  for (const route of [
    "/lms/content/10183/quiz/123/",
    "/lms/plugin/quiz/result/",
    "/lms/content/other/?module=quiz",
    "/lms/content/other/?quizDom=1"
  ]) {
    await page.goto(`http://127.0.0.1:${port}${route}`);
    await page.waitForFunction(() => document.body.dataset.pageMode === "quiz");
    assert.equal(await page.locator("#stalog-bridge-root").count(), 0, `companion must not exist on ${route}`);
  }

  await visit("/lms/", "今日のブリーフ");
  await page.evaluate(() => history.pushState({}, "", "/lms/content/10183/quiz/999/"));
  await page.waitForFunction(() => document.body.dataset.pageMode === "quiz" && !document.querySelector("#stalog-bridge-root"));
  await page.evaluate(() => history.pushState({}, "", "/lms/"));
  await page.waitForSelector("#stalog-bridge-root");
  assert.equal(await page.locator("body").getAttribute("data-page-mode"), "normal");

  assert.deepEqual(errors, [], `browser errors:\n${errors.join("\n")}`);
  await browser.close();
  server.close();
  console.log("context companion smoke test: ok");
})().catch((error) => {
  server.close();
  browser?.close();
  console.error(error);
  process.exitCode = 1;
});
