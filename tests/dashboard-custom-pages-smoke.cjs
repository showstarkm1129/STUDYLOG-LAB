const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const dependencyRoot = process.argv[2];
const { chromium } = require(dependencyRoot ? path.join(dependencyRoot, "playwright") : "playwright");
const root = process.cwd();
const mime = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };
const snapshot = {
  schemaVersion: 3,
  academicYear: 2026,
  collectedAt: "2026-07-30T08:30:00+09:00",
  courses: [
    { classId: "1001", name: "Webアプリ基礎", totalLessons: 15, attended: 8, absent: 1, publicAbsent: 0, period: "2026/04/01 - 2026/09/30", term: "前期" },
    { classId: "1002", name: "データベース設計", totalLessons: 15, attended: 7, absent: 2, publicAbsent: 1, period: "2026/04/01 - 2026/09/30", term: "前期" },
    { classId: "1003", name: "データベース（30コマ）", totalLessons: 30, attended: 0, absent: 0, publicAbsent: 0, period: "2026/04/01 - 2026/09/30", term: "前期" }
  ],
  reports: [
    { classId: "1001", directoryId: "d1", title: "フォーム実装", status: "未完了", kind: "課題", scheduledAt: "2026-07-30" },
    { classId: "1002", directoryId: "d2", title: "ER図の提出", status: "提出済", kind: "課題", scheduledAt: "2026-07-30" }
  ],
  directories: [
    { classId: "1001", directoryId: "d1", title: "第8回", lessonDate: "2026-07-30" },
    { classId: "1002", directoryId: "d2", title: "第8回", lessonDate: "2026-07-30" }
  ],
  timetableSlots: [
    { classId: "1001", courseName: "Webアプリ基礎", date: "2026-07-30", period: 1, room: "201" },
    { classId: "1002", courseName: "データベース設計", date: "2026-07-30", period: 3, room: "205" }
  ]
};

const server = http.createServer((request, response) => {
  const pathname = request.url === "/" ? "/dashboard.html" : new URL(request.url, "http://localhost").pathname;
  const filename = path.join(root, pathname.replace(/^\/+/, ""));
  if (!filename.startsWith(root) || !fs.existsSync(filename)) return response.writeHead(404).end("not found");
  response.writeHead(200, { "Content-Type": mime[path.extname(filename)] || "application/octet-stream" });
  fs.createReadStream(filename).pipe(response);
});

let browser;
(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.addInitScript((data) => localStorage.setItem("studylogBridgeSnapshotV1", JSON.stringify(data)), snapshot);
  await page.goto(`http://127.0.0.1:${server.address().port}/dashboard.html?now=2026-07-30T08:30:00`, { waitUntil: "networkidle" });

  assert.equal(await page.locator(".nav-item").count(), 4, "the four built-in pages should remain");
  await page.click('[data-view="attendance"]');
  const simulatorHead = page.locator(".card:has(.simulator) .card-head");
  assert(await simulatorHead.isVisible(), "the simulator tab name should remain visible");
  assert(await simulatorHead.locator('[data-feature-info="absence-simulator"]').isVisible(), "the simulator information button should remain visible");
  assert.equal(await page.locator("#sim-absence").getAttribute("type"), "number", "the simulator should allow direct numeric input");
  assert.equal(await page.locator("[data-sim-course]").count(), 3, "courses should be directly tappable");
  const roundedCourseRow = page.locator('tr[data-course-open="1003"]');
  assert.equal(await roundedCourseRow.locator("td").last().textContent(), "8回", "30コマでは8コマ欠席可能と表示する");
  await page.click(".sim-course-picker > summary");
  await page.click('[data-sim-course="1003"]');
  await page.click('[data-sim-step="1"]');
  assert.equal(await page.locator("#sim-absence").inputValue(), "1", "the plus button should increase the count");
  await page.click('[data-sim-step="-1"]');
  assert.equal(await page.locator("#sim-absence").inputValue(), "0", "the minus button should decrease the count");
  await page.locator("#sim-absence").fill("8");
  assert.equal(await page.locator("#sim-rate").textContent(), "73%");
  assert.equal(await page.locator("#sim-judgement").textContent(), "基準内", "22/30は端数を生徒に有利にして基準内");
  await page.locator("#sim-absence").fill("9");
  assert.equal(await page.locator("#sim-judgement").textContent(), "基準未満");

  await page.click('[data-view="courses"]');
  const firstCourse = page.locator(".course-card").first();
  assert.equal(await firstCourse.locator(".course-card-metrics > div").count(), 2, "course cards should retain only attendance and pending-task metrics");
  await firstCourse.click();
  assert.equal(await page.locator("#course-dialog .metric-row.three .metric").count(), 3, "course details should retain the three actionable metrics");
  await page.click('[data-close-dialog="course-dialog"]');

  await page.click('[data-view="home"]');
  await page.click("#add-custom-page");
  await page.click('[data-icon-choice="tasks"]');
  await page.fill("#page-settings-name", "今日やること");
  await page.click('#page-settings-form button[type="submit"]');
  await page.waitForSelector(".custom-page-empty");
  assert.match(await page.locator(".page-header h1").innerText(), /今日やること/);
  assert.equal(await page.locator(".nav-item").count(), 5);
  const firstCustomId = await page.locator(".nav-entry.is-active").getAttribute("data-page-entry");

  await page.click("[data-toggle-layout-edit]");
  await page.click("[data-open-card-catalog]");
  assert.equal(await page.locator(".widget-catalog-item").count(), 9);
  assert.equal(await page.locator('[data-add-card="course-health"]').count(), 0, "retired health widget must not be offered");
  await page.click('[data-add-card="today-summary"]');
  await page.waitForSelector('.custom-widget[data-custom-card="today-summary"].custom-widget-medium');
  assert(await page.locator('[data-custom-card="today-summary"] [data-card-size="large"]').isDisabled(), "unsupported sizes must be disabled");
  await page.click('[data-custom-card="today-summary"] [data-card-size="small"]');
  await page.waitForSelector('.custom-widget[data-custom-card="today-summary"].custom-widget-small');

  await page.click("[data-open-card-catalog]");
  await page.click('[data-add-card="next-course"]');
  await page.waitForFunction(() => document.querySelectorAll("[data-custom-card]").length === 2);
  await page.dragAndDrop('[data-custom-card="next-course"]', ".custom-grid", { targetPosition: { x: 500, y: 720 } });
  await page.waitForFunction(() => Number(document.querySelector('[data-custom-card="next-course"]')?.style.gridRowStart) >= 3);

  await page.click("#add-custom-page");
  await page.click('[data-icon-choice="attendance"]');
  await page.fill("#page-settings-name", "出席管理");
  await page.click('#page-settings-form button[type="submit"]');
  await page.waitForSelector(".custom-page-empty");
  assert.equal(await page.locator(".nav-item").count(), 6, "multiple custom pages should be supported");
  const secondCustomId = await page.locator(".nav-entry.is-active").getAttribute("data-page-entry");

  if (!await page.locator("[data-open-card-catalog]").count()) await page.click("[data-toggle-layout-edit]");
  await page.click("[data-open-card-catalog]");
  await page.click('[data-add-card="absence-simulator"]');
  await page.waitForSelector('.custom-widget[data-custom-card="absence-simulator"].custom-widget-small');
  await page.click("[data-toggle-layout-edit]");
  const simulatorBounds = await page.locator('[data-custom-card="absence-simulator"]').evaluate((card) => {
    const cardRect = card.getBoundingClientRect();
    const simulatorRect = card.querySelector(".simulator").getBoundingClientRect();
    const contentRect = card.querySelector(".custom-widget-content").getBoundingClientRect();
    const headingRect = card.querySelector(".card-head").getBoundingClientRect();
    const resultRect = card.querySelector(".sim-result").getBoundingClientRect();
    return {
      cardTop: cardRect.top,
      cardBottom: cardRect.bottom,
      cardLeft: cardRect.left,
      cardRight: cardRect.right,
      contentTop: contentRect.top,
      contentBottom: contentRect.bottom,
      contentLeft: contentRect.left,
      contentRight: contentRect.right,
      headingBottom: headingRect.bottom,
      simulatorTop: simulatorRect.top,
      simulatorBottom: simulatorRect.bottom,
      simulatorLeft: simulatorRect.left,
      simulatorRight: simulatorRect.right,
      resultTop: resultRect.top,
      resultBottom: resultRect.bottom
    };
  });
  assert(simulatorBounds.simulatorBottom <= simulatorBounds.contentBottom, `small simulator must not overflow below its content area: ${JSON.stringify(simulatorBounds)}`);
  assert(simulatorBounds.simulatorLeft >= simulatorBounds.contentLeft && simulatorBounds.simulatorRight <= simulatorBounds.contentRight, `small simulator must stay within the card content width: ${JSON.stringify(simulatorBounds)}`);

  await page.click("#organize-pages");
  for (let index = 0; index < 5; index += 1) await page.click(`[data-page-entry="${secondCustomId}"] [data-page-shift="-1"]`);
  assert.equal(await page.locator("[data-page-entry]").first().getAttribute("data-page-entry"), secondCustomId, "custom pages should move ahead of built-in pages");
  await page.click(`[data-page-entry="${firstCustomId}"] [data-set-start-page]`);
  assert.equal(await page.locator(`[data-page-entry="${firstCustomId}"] [data-set-start-page]`).getAttribute("aria-pressed"), "true");

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector('[data-custom-card="next-course"]');
  assert.match(await page.locator(".page-header h1").innerText(), /今日やること/, "the selected start page should open independently of the last page");
  assert.equal(await page.locator("[data-page-entry]").first().getAttribute("data-page-entry"), secondCustomId, "page order should persist");
  assert(Number(await page.locator('[data-custom-card="next-course"]').evaluate((card) => card.style.gridRowStart)) >= 3, "free card coordinates should persist");

  await page.click("[data-toggle-layout-edit]");
  await page.click(`[data-edit-custom-page="${firstCustomId}"]`);
  await page.click('[data-icon-choice="star"]');
  await page.fill("#page-settings-name", "学習チェック");
  await page.click('#page-settings-form button[type="submit"]');
  await page.waitForFunction(() => document.querySelector(".page-header h1")?.textContent.includes("学習チェック"));

  const downloadPromise = page.waitForEvent("download");
  await page.click("#topbar-data-button");
  await page.click("#json-export");
  const download = await downloadPromise;
  const exported = JSON.parse(fs.readFileSync(await download.path(), "utf8"));
  assert.equal(exported.studylogDashboard.schemaVersion, 4);
  assert.equal(exported.studylogDashboard.layoutSchemaVersion, 2);
  assert.equal(exported.studylogDashboard.customPages.length, 2);
  assert.equal(exported.studylogDashboard.pageOrder[0], secondCustomId);
  assert.equal(exported.studylogDashboard.startPageId, firstCustomId);

  page.once("dialog", (dialog) => dialog.accept());
  await page.click("#data-dialog button[value=cancel]");
  await page.click(`[data-view="${secondCustomId}"]`);
  await page.click("[data-toggle-layout-edit]");
  await page.click(`[data-edit-custom-page="${secondCustomId}"]`);
  await page.click("#delete-custom-page");
  await page.waitForFunction(() => document.querySelectorAll(".nav-item").length === 5);

  assert.deepEqual(errors, [], `browser errors:\n${errors.join("\n")}`);
  await browser.close();
  server.close();
  console.log("dashboard custom pages smoke test: ok");
})().catch((error) => {
  server.close();
  browser?.close();
  console.error(error);
  process.exitCode = 1;
});
