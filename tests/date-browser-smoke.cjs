const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const emptySnapshot = (startDate = "2026-09-22") => ({
  schemaVersion: 1, academicYear: 2026, collectedAt: "2026-09-29T01:00:00Z",
  courses: [], reports: [], directories: [], timetableSlots: [],
  timetableWeekStart: startDate ? { startDate } : undefined
});
const esc = (value) => String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
const calendar = (slots, { headers, offset = 0, startDate, sparse = false } = {}) => {
  const headings = headers ? `<thead><tr>${offset ? '<th>時限</th>' : ''}${headers.map(label => `<th>${esc(label)}</th>`).join("")}</tr></thead>` : "";
  const rows = Array.from({ length: 6 }, (_, row) => `<tr>${offset ? `<th>${row + 1}限</th>` : ""}${Array.from({ length: 7 }, (_, column) => {
    const slot = slots.find(item => item.rowIndex === row && item.columnIndex === column);
    const link = slot && !slot.continuation ? `<a href="/lms/class/${slot.classId}/${slot.directoryId ? `${slot.directoryId}/` : ''}">${esc(slot.courseName || `科目${slot.classId}`)}</a>` : "";
    return `<td${!sparse || slot ? ' class="top-timetable-table-td"' : ''}${slot?.attributeDate ? ` data-date="${slot.attributeDate}"` : ''}>${slot ? `${esc(slot.rawText || `${row + 1} ${slot.continuation ? '〃' : ''}`)} ${link}` : ''}</td>`;
  }).join("")}</tr>`).join("");
  return `<table id="div-top-timetable1"${startDate ? ` data-start-date="${startDate}"` : ''}>${headings}<tbody>${rows}</tbody></table>`;
};
const exampleSlots = (attendance = "3/0/45", columns = [2, 3, 6]) => Array.from({ length: 3 }, (_, row) => columns.map(column => ({
  classId: String(10000 + column), directoryId: String(170000 + column), courseName: `科目${column}`,
  rowIndex: row, columnIndex: column, period: row + 1, continuation: row > 0,
  rawText: `${row + 1} ${row ? '〃' : `科目${column} 出/公/全 欠/落 ${attendance} 0/12`}`
}))).flat();

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ timezoneId: "Asia/Tokyo" });
    await page.clock.install({ time: new Date("2026-09-29T01:50:00Z") });
    let snapshot = emptySnapshot();
    let markup = "";
    let releaseSchedule;
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
      window.chrome = {
        storage: { local: {
          async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, structuredClone(window.__dateTestState?.[key])])); },
          async set(values) { Object.assign(window.__dateTestState, structuredClone(values)); }
        } },
        runtime: { getURL: file => new URL(`/${file}`, location.origin).href, sendMessage: () => Promise.resolve(), onMessage: { addListener() {} } }
      };
    });
    await page.route("http://127.0.0.1/**", async route => {
      const url = new URL(route.request().url());
      if (url.pathname === "/__fixture") return route.fulfill({ json: snapshot });
      if (url.pathname === "/portal/lmsinc/getScheduleCalendar.php") {
        await new Promise(resolve => { releaseSchedule = resolve; });
        return route.fulfill({ body: "loaded", contentType: "text/plain" });
      }
      if (url.pathname === "/lms/" && route.request().method() === "POST") {
        return route.fulfill({ status: route.request().postData().includes("2026-10-13") ? 500 : 200, body: "loaded", contentType: "text/plain" });
      }
      if (url.pathname.startsWith("/lms/")) {
        const context = url.pathname.match(/\/class\/(\d+)(?:\/(\d+))?/);
        const scripts = ["date-rules.js", "attendance-rules.js", "attendance-watch-rules.js", "digest-rules.js", "task-rules.js", "auto-sync-rules.js", "content.js"];
        return route.fulfill({ contentType: "text/html; charset=utf-8", body: `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/content.css"></head><body>
          <p>関係のない日付 2026年9月1日 1/1/45</p><input id="input-current-class-id" type="hidden" value="${context?.[1] || ''}">
          <div id="div-class-contents" ${context?.[2] ? `directory_id="${context[2]}"` : ''}></div>${markup}
          <script>fetch('/__fixture').then(r=>r.json()).then(s=>{window.__dateTestState={studylogBridgeSnapshotV1:s,studylogDashboardPreferencesV1:{}};return ${JSON.stringify(scripts)}.reduce((p,file)=>p.then(()=>new Promise(resolve=>{const script=document.createElement('script');script.src='/'+file;script.onload=resolve;document.head.append(script);})),Promise.resolve());});</script></body></html>` });
      }
      const file = path.resolve(root, url.pathname.slice(1));
      return file.startsWith(`${root}${path.sep}`) && fs.existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ status: 404 });
    });
    const read = () => page.evaluate(() => chrome.storage.local.get("studylogBridgeSnapshotV1").then(result => result.studylogBridgeSnapshotV1));
    const visit = async (route = "/lms/") => {
      await page.goto(`http://127.0.0.1${route}`);
      await page.waitForFunction(() => document.querySelector("#studylog-bridge-root")?.dataset.ready === "true");
    };
    const waitDates = async dates => page.waitForFunction(expected => {
      const actual = window.__dateTestState?.studylogBridgeSnapshotV1?.timetableSlots?.map(slot => slot.date || null);
      return JSON.stringify(actual) === JSON.stringify(expected);
    }, dates, { timeout: 10000 }).catch(async error => {
      const stored = await read();
      console.error({ expected: dates, actual: stored.timetableSlots.map(slot => slot.date || null), week: stored.timetableWeekStart, errors });
      throw error;
    });

    // 両方の出席表示形式。日付ではなく、週開始日と空の曜日を含む列位置を使う。
    for (const attendance of ["3/0/45", "1/1/45", "出席: 3 公欠: 0 総授業数: 45"]) {
      snapshot = emptySnapshot();
      const slots = exampleSlots(attendance);
      markup = calendar(slots, { sparse: true });
      await visit();
      await waitDates(slots.map(slot => ["2026-09-24", "2026-09-25", "2026-09-28"][[2, 3, 6].indexOf(slot.columnIndex)]));
    }
    snapshot = emptySnapshot();
    markup = calendar(exampleSlots(), { offset: 1, headers: ["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"] });
    await visit();
    await waitDates(exampleSlots().map(slot => ["2026-10-01", "2026-10-02", "2026-10-05"][[2, 3, 6].indexOf(slot.columnIndex)]));
    snapshot = emptySnapshot("2026-12-29");
    markup = calendar(exampleSlots(), { headers: ["12/29", "12/30", "12/31", "1/1", "1/2", "1/3", "1/4"] });
    await visit();
    await waitDates(exampleSlots().map(slot => ["2026-12-31", "2027-01-01", "2027-01-04"][[2, 3, 6].indexOf(slot.columnIndex)]));
    snapshot = emptySnapshot();
    markup = calendar(exampleSlots(), { startDate: "2026-09-29" });
    await visit();
    await waitDates(exampleSlots().map(slot => ["2026-10-01", "2026-10-02", "2026-10-05"][[2, 3, 6].indexOf(slot.columnIndex)]));
    snapshot = emptySnapshot(null);
    markup = calendar(exampleSlots());
    await visit();
    await waitDates(exampleSlots().map(() => null));

    snapshot = emptySnapshot();
    const attributeSlots = exampleSlots("3/0/45", [0]);
    attributeSlots[0].attributeDate = "2026-09-29";
    markup = calendar(attributeSlots);
    await visit();
    await waitDates(["2026-09-29", "2026-09-29", "2026-09-29"]);

    // 切り替え中は旧表を新しい週に付け替えない。成功後に新しいDOMを保存する。
    snapshot = emptySnapshot("2026-09-22");
    markup = calendar(exampleSlots("3/0/45", [0]));
    await visit();
    await waitDates(["2026-09-22", "2026-09-22", "2026-09-22"]);
    await page.waitForFunction(() => window.fetch.toString().includes("notifyIfScheduleRequest"));
    await page.evaluate(() => {
      window.__scheduleEvents = [];
      window.addEventListener("studylog-bridge:schedule-request", event => window.__scheduleEvents.push(event.detail));
      window.__pendingSchedule = fetch(new URL("/portal/lmsinc/getScheduleCalendar.php", location.href), {
        method: "POST", body: new URLSearchParams({ startDate: "2026-09-29" })
      }).then(response => response.text());
    });
    await page.waitForFunction(() => window.__scheduleEvents.length === 1);
    await page.evaluate(() => document.querySelector("#div-top-timetable1 td").append(document.createTextNode(" ")));
    await page.waitForTimeout(600);
    assert.equal((await read()).timetableWeekStart.startDate, "2026-09-22");
    assert.equal((await read()).timetableSlots[0].date, "2026-09-22");
    releaseSchedule();
    await page.evaluate(() => window.__pendingSchedule);
    await page.waitForTimeout(400);
    assert.equal((await read()).timetableWeekStart.startDate, "2026-09-22", "response alone must not date the old DOM");
    await page.evaluate(html => document.querySelector("#div-top-timetable1").outerHTML = html, calendar(exampleSlots("3/0/45", [0])));
    await waitDates(["2026-09-29", "2026-09-29", "2026-09-29"]);
    assert.equal((await read()).timetableWeekStart.startDate, "2026-09-29");

    const xhrSchedule = date => page.evaluate(startDate => new Promise(resolve => {
      const request = new XMLHttpRequest();
      request.open("POST", "/lms/");
      request.onloadend = () => resolve(request.status);
      request.send(new URLSearchParams({ action: "glexa_ajax_schedule_view", startDate }));
    }), date);
    assert.equal(await xhrSchedule("2026-10-06"), 200);
    assert.equal((await read()).timetableWeekStart.startDate, "2026-09-29");
    await page.evaluate(html => document.querySelector("#div-top-timetable1").outerHTML = html, calendar(exampleSlots("3/0/45", [0])));
    await waitDates(["2026-10-06", "2026-10-06", "2026-10-06"]);
    assert.equal(await xhrSchedule("2026-10-13"), 500);
    await page.waitForTimeout(400);
    assert.equal((await read()).timetableWeekStart.startDate, "2026-10-06", "failed requests keep the last displayed week");
    await page.evaluate(() => document.querySelector("#div-top-timetable1").remove());
    await page.waitForTimeout(400);
    assert.equal((await read()).timetableSlots.length, 3, "a loading gap must not erase saved slots");

    // 保存済みの不正な日付は空白の候補にしない。
    snapshot = emptySnapshot();
    snapshot.timetableSlots = [
      { classId: "10237", directoryId: "172242", period: 1, date: "NaN-NaN-NaN" },
      { classId: "10237", directoryId: "172242", period: 2, date: "2026-03-00" }
    ];
    markup = "";
    await visit("/lms/class/10237/172242/");
    assert.equal(await page.locator('#studylog-course-navigation-date option[value]:not([value=""])').count(), 0);
    assert.match(await page.locator("#studylog-course-navigation-status").textContent(), /時間割が未取得/);
    assert.equal((await read()).timetableSlots.some(slot => slot.date), false);

    snapshot = emptySnapshot();
    snapshot.directories = [{ classId: "10237", directoryId: "172242", lessonDate: "2026-09-29", dateSource: "getLessonList" }];
    await visit("/lms/class/10237/172242/");
    await page.evaluate(() => {
      const entry = document.createElement("a");
      entry.className = "a-open-contents";
      entry.setAttribute("directory_id", "172242");
      entry.textContent = "第1回 日付のない見出し";
      document.querySelector("#div-class-contents").append(entry);
    });
    await page.waitForFunction(() => window.__dateTestState.studylogBridgeSnapshotV1.directories[0].title === "第1回 日付のない見出し");
    assert.equal((await read()).directories[0].lessonDate, "2026-09-29", "DOM reads must retain known dates with real storage serialization");
    await page.evaluate(() => document.querySelector(".a-open-contents").textContent = "第1回 2026年9月30日");
    await page.waitForFunction(() => window.__dateTestState.studylogBridgeSnapshotV1.directories[0].lessonDate === "2026-09-30");

    // 実際のエクスポートは任意引数で読むだけにし、リポジトリへ保存しない。
    for (const file of process.argv.slice(2)) {
      snapshot = JSON.parse(fs.readFileSync(file, "utf8"));
      const sourceSlots = structuredClone(snapshot.timetableSlots);
      markup = calendar(sourceSlots);
      await visit();
      const expected = sourceSlots.map(slot => {
        const date = new Date(`${snapshot.timetableWeekStart.startDate}T00:00:00`);
        date.setDate(date.getDate() + slot.columnIndex);
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      });
      await waitDates(expected);
      const stored = await read();
      assert.equal(stored.timetableSlots.length, sourceSlots.length);
      assert(stored.timetableSlots.every(slot => /^20\d{2}-\d{2}-\d{2}$/.test(slot.date)));
      snapshot = stored;
      markup = "";
      const blocks = [...new Set(stored.timetableSlots.map(slot => slot.date))].sort().flatMap(date => {
        const day = stored.timetableSlots.filter(slot => slot.date === date).sort((a, b) => a.period - b.period);
        return day.filter((slot, index) => !index || slot.classId !== day[index - 1].classId || slot.period !== day[index - 1].period + 1);
      });
      for (const [index, block] of blocks.entries()) {
        await visit(`/lms/class/${block.classId}/${block.directoryId ? `${block.directoryId}/` : ''}?studylogDate=${block.date}`);
        for (const [direction, neighbor] of [["previous", blocks[index - 1]], ["next", blocks[index + 1]]]) {
          const link = page.locator(`#studylog-${direction}-course`);
          assert.equal(await link.getAttribute("hidden"), neighbor ? null : "");
          if (neighbor) {
            const destination = new URL(await link.getAttribute("href"), "http://127.0.0.1");
            assert.equal(destination.pathname, `/lms/class/${neighbor.classId}/${neighbor.directoryId ? `${neighbor.directoryId}/` : ''}`);
          }
        }
      }
    }
    assert.deepEqual(errors, []);
    console.log("date collection browser smoke test: ok");
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
