const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const dependencyRoot = process.argv[2];
const { chromium } = require(dependencyRoot ? path.join(dependencyRoot, "playwright") : "playwright");
const root = path.resolve(__dirname, "..");
const mime = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };

const snapshot = {
  schemaVersion: 1,
  academicYear: 2026,
  collectedAt: "2026-09-02T00:00:00.000Z",
  courses: [
    { classId: "10067", name: "Webアプリ基礎S", academicYear: 2026, totalLessons: 30, attended: 12, absent: 2, publicAbsent: 0, period: "4/1-9/30" },
    { classId: "10175", name: "データベース", academicYear: 2026, totalLessons: 30, attended: 14, absent: 1, publicAbsent: 0, period: "4/1-9/30" }
  ],
  reports: [],
  directories: [],
  directoryItems: [],
  visibleTimetable: [],
  timetableSlots: [
    { date: "2026-09-02", period: 1, classId: "10067", room: "603" },
    { date: "2026-09-02", period: 4, classId: "10175", room: "601" }
  ]
};
const preferences = {
  manualCompleted: [],
  attendanceWatch: { enabled: true, mode: "entry", channels: { desktop: true, sound: true, slack: false }, slackWebhookUrl: "", snoozedUntil: 0 }
};
const watchState = {
  blocks: { "2026-09-02:10067:1": { requests: 3, lastCheckedAt: "2026-09-02T00:25:00.000Z" } },
  probes: [{ at: "2026-09-02T00:25:00.000Z", classId: "10067", blockKey: "2026-09-02:10067:1", mode: "entry", screenState: "quiet", outcome: "quiet" }]
};

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
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.addInitScript((data) => {
      localStorage.setItem("studylogBridgeSnapshotV1", JSON.stringify(data.snapshot));
      localStorage.setItem("studylogDashboardPreferencesV1", JSON.stringify(data.preferences));
      localStorage.setItem("studylogAttendanceWatchStateV1", JSON.stringify(data.watchState));
    }, { snapshot, preferences, watchState });

    // 1限は09:00-09:50なので、09:30は監視窓の内側にあたる。
    await page.goto(`http://127.0.0.1:${port}/dashboard.html?now=2026-09-02T09:30:00`, { waitUntil: "networkidle" });
    await page.click("#open-attendance-watch-dialog");
    await page.waitForSelector("#attendance-watch-dialog[open]");

    const watchingText = await page.locator("#attendance-watch-body").innerText();
    assert.match(watchingText, /監視中です/, "a lesson window in progress must be reported as watching");
    assert.match(watchingText, /次の監視は 12:35 から（データベース）/, "the next window opens five minutes before the fourth period");
    assert.equal(await page.locator("#attendance-probe-course option").count(), 2);
    assert.equal(await page.locator("#attendance-rehearse").isEnabled(), true, "the rehearsal is offered whenever a course can be picked");
    assert.equal(await page.locator(".attendance-probe-log tbody tr").count(), 1, "the stored check is listed");
    assert.match(await page.locator(".attendance-probe-log tbody tr").innerText(), /Webアプリ基礎S/);

    // 拡張機能ページ単体ではスタログのタブを探せないため、その旨を伝えて終わる。
    await page.click("#attendance-probe-run");
    await page.waitForFunction(() => document.querySelector("#attendance-probe-output").innerText.trim().length > 0);
    assert.match(await page.locator("#attendance-probe-output").innerText(), /この画面からは確認できません/);

    await page.click("#attendance-watch-snooze");
    await page.waitForFunction(() => document.querySelector("#attendance-watch-body").innerText.includes("今日は停止中です"));
    assert.match(await page.locator("#attendance-watch-snooze").innerText(), /今日の停止を解除/);
    await page.click("#attendance-watch-snooze");
    await page.waitForFunction(() => document.querySelector("#attendance-watch-body").innerText.includes("監視中です"));

    // 授業のない時間帯では、理由と次の予定を示す。
    await page.goto(`http://127.0.0.1:${port}/dashboard.html?now=2026-09-02T07:00:00`, { waitUntil: "networkidle" });
    await page.click("#open-attendance-watch-dialog");
    await page.waitForSelector("#attendance-watch-dialog[open]");
    const idleText = await page.locator("#attendance-watch-body").innerText();
    assert.match(idleText, /いまは授業時間外です/);
    assert.match(idleText, /次の監視は 08:55 から（Webアプリ基礎S）/);

    await page.goto(`http://127.0.0.1:${port}/dashboard.html?now=2026-09-03T09:30:00`, { waitUntil: "networkidle" });
    await page.click("#open-attendance-watch-dialog");
    await page.waitForSelector("#attendance-watch-dialog[open]");
    assert.match(await page.locator("#attendance-watch-body").innerText(), /今日の時間割に授業がありません/);

    assert.deepEqual(errors, [], "the dialog must render without errors");
    console.log("attendance dialog smoke test: ok");
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  server.close();
  process.exitCode = 1;
});
