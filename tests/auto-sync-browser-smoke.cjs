const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const dependencyRoot = process.argv[2];
const { chromium } = require(dependencyRoot ? path.join(dependencyRoot, "playwright") : "playwright");
const root = path.resolve(__dirname, "..");
const mime = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };
const counts = { reports: 0, subjects: 0, directories: 0, lessons: 0 };
const oldAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
const snapshot = {
  schemaVersion: 1,
  academicYear: 2026,
  collectedAt: oldAt,
  lessonListCollectedAt: oldAt,
  courses: [{ classId: "10183", name: "Javaプログラミング", academicYear: 2026 }],
  reports: [{ classId: "10183", directoryId: "153094", title: "提出テスト", status: "未完了", kind: "課題", href: "/lms/class/10183/153094/", academicYear: 2026 }],
  directories: [],
  directoryItems: [],
  visibleTimetable: [],
  timetableSlots: []
};

const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, "http://portal.iwasaki.ac.jp").pathname;
  if (pathname === "/__fixture") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(snapshot));
    return;
  }
  if (pathname === "/portal/lmsinc/myReportStatus.php") {
    counts.reports += 1;
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end('<table><tr><td>課題</td><td><a href="/lms/class/10183/153094/">提出テスト</a></td><td>提出済</td></tr></table>');
    return;
  }
  if (pathname === "/portal/lmsinc/mySubjectStatus.php") {
    counts.subjects += 1;
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end('<table><tr><td>前期</td><td><a href="/lms/class/10183/">Javaプログラミング</a></td><td>4/1-7/31</td><td>15</td><td>5</td><td>0</td><td>0</td></tr></table>');
    return;
  }
  if (pathname === "/portal/lmsinc/getLessonList.php") {
    counts.lessons += 1;
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end('<a href="/lms/class/10183/153094/">第1回 4/1</a>');
    return;
  }
  if (pathname === "/lms/" && request.method === "POST") {
    counts.directories += 1;
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end('<a class="a-open-contents" directory_id="153094">第1回 4/1</a>');
    return;
  }
  const relative = pathname === "/lms/" ? "tests/companion.html" : pathname.replace(/^\/+/, "");
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
  const browser = await chromium.launch({ headless: true, args: ["--host-resolver-rules=MAP portal.iwasaki.ac.jp 127.0.0.1"] });
  try {
    const page = await browser.newPage();
    await page.goto(`http://portal.iwasaki.ac.jp:${port}/lms/`);
    for (let attempt = 0; attempt < 100 && (counts.reports === 0 || counts.lessons === 0); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.deepEqual(counts, { reports: 1, subjects: 1, directories: 1, lessons: 1 }, "one automatic cycle should fetch two summaries and only one course");
    const collectedSnapshot = await page.evaluate(async () => (await chrome.storage.local.get("studylogBridgeSnapshotV1")).studylogBridgeSnapshotV1);
    assert.equal(collectedSnapshot.timetableSlots.find((slot) => slot.classId === "10175")?.teacherName, "中山先生", "the timetable should retain its registered teacher");
    assert.equal(collectedSnapshot.visibleTimetable.find((slot) => slot.classId === "10175")?.teacherName, "中山先生", "the visible timetable should retain its registered teacher");
    const state = await page.evaluate(async () => (await chrome.storage.local.get("studylogBridgeAutoCollectV1")).studylogBridgeAutoCollectV1);
    assert(state.years[2026].reportStatusCollectedAt);
    assert(state.years[2026].subjectStatusCollectedAt);
    assert(state.years[2026].directoriesByClass["10183"]);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("studylog-bridge:learning-write", { detail: { phase: "submitted" } })));
    for (let attempt = 0; attempt < 100 && counts.reports < 2; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.deepEqual(counts, { reports: 2, subjects: 1, directories: 1, lessons: 1 }, "a learning submission should refresh report status immediately");
    for (let attempt = 0; attempt < 180 && counts.reports < 3; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.deepEqual(counts, { reports: 3, subjects: 1, directories: 1, lessons: 1 }, "a learning submission should refresh report status again after the delay");
    console.log("automatic collection browser smoke test: ok");
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  server.close();
  process.exitCode = 1;
});
