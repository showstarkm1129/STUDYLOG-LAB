const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const slot = (period, classId, directoryId) => ({ date: today, period, classId, directoryId, courseName: `科目${classId}` });
const schedule = [slot(1, "10183", "153094"), slot(2, "10183", "153094"), slot(3, "10183", "153094"), slot(4, "10175", "153362"), slot(5, "10175", "153362")];
let slots = schedule;
let directories = [];
let importedSnapshot;

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, timezoneId: "Asia/Tokyo" });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("http://127.0.0.1/**", async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === "/__fixture") {
        return route.fulfill({ json: importedSnapshot || { collectedAt: new Date().toISOString(), academicYear: 2026, courses: [], reports: [], directories, timetableSlots: slots } });
      }
      const relative = (pathname.startsWith("/lms/") || pathname.startsWith("/portal/lmsinc/")) ? "tests/companion.html" : pathname.slice(1);
      const filename = path.resolve(root, relative);
      if (!filename.startsWith(`${root}${path.sep}`) || !fs.existsSync(filename)) return route.fulfill({ status: 404 });
      return route.fulfill({ path: filename });
    });
    const shortcut = page.locator("#studylog-next-course");
    const previous = page.locator("#studylog-previous-course");
    const openMenu = async () => {
      await page.waitForFunction(() => document.querySelector("#studylog-bridge-root")?.dataset.ready === "true");
      const toggle = page.locator("#studylog-bridge-toggle");
      assert.equal(await toggle.innerText(), "", "launcher has no expanded label");
      await page.waitForFunction(() => { const icon = document.querySelector("#studylog-bridge-toggle img"); return icon?.complete && icon.naturalWidth > 0; });
      const box = await toggle.boundingBox();
      assert.equal(box.width, 44);
      assert.equal(box.height, 44);
      assert.equal(await shortcut.isVisible(), false, "navigation is hidden while the menu is closed");
      assert.equal(await previous.isVisible(), false);
      assert.equal(await toggle.getAttribute("aria-expanded"), "false");
      await toggle.click();
      assert.equal(await toggle.getAttribute("aria-expanded"), "true");
      assert.equal(await page.locator("#studylog-bridge-panel").isVisible(), true);
      assert.equal(await page.locator("body").getAttribute("data-dashboard-view"), null, "S opens the menu, not the dashboard");
      assert.equal(await shortcut.evaluate(el => el.closest("#studylog-bridge-panel") !== null), true);
      assert.equal(await shortcut.evaluate(el => Boolean(document.querySelector("#studylog-bridge-status").compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)), true, "lesson navigation follows the menu content and footer actions");
    };
    const visit = async (url = "/lms/class/10183/153094/") => {
      await page.goto(`http://127.0.0.1${url}`);
      await openMenu();
    };

    await visit();
    assert.equal(await previous.isVisible(), false, "first block has no previous lesson");
    assert.equal(await shortcut.isVisible(), true, "shortcut is available inside the open panel");
    assert.match(await shortcut.innerText(), /次の授業へ.*4・5限 科目10175/);
    assert.equal(await shortcut.getAttribute("href"), "/lms/class/10175/153362/");
    await shortcut.click();
    await page.waitForURL("**/lms/class/10175/153362/");
    await page.waitForFunction(() => document.querySelector("#studylog-next-course")?.hidden);
    assert.equal(await shortcut.isVisible(), false, "last block has no next lesson");
    await openMenu();
    assert.equal(await previous.isVisible(), true, "last block can return to the previous lesson");
    assert.match(await previous.innerText(), /前の授業へ.*1・2・3限 科目10183/);
    assert.equal(await previous.getAttribute("href"), "/lms/class/10183/153094/");
    await previous.click();
    await page.waitForURL("**/lms/class/10183/153094/");
    await page.waitForFunction(() => document.querySelector("#studylog-previous-course")?.hidden);

    await visit("/lms/class/10183/");
    assert.equal(await shortcut.isVisible(), true, "course top also offers the shortcut");
    await page.setViewportSize({ width: 375, height: 667 });
    await shortcut.scrollIntoViewIfNeeded();
    const linkBox = await shortcut.boundingBox();
    const panelBox = await page.locator("#studylog-bridge-panel").boundingBox();
    assert(linkBox.x >= 0 && linkBox.x + linkBox.width <= 375, "shortcut fits mobile width");
    assert(linkBox.y >= panelBox.y && linkBox.y + linkBox.height <= panelBox.y + panelBox.height, "shortcut is inside the menu");
    assert(panelBox.y >= 18, "panel stays inside the viewport with the shortcut visible");
    if (process.env.STUDYLOG_SCREENSHOT) await page.screenshot({ path: process.env.STUDYLOG_SCREENSHOT });

    // DOM-driven lesson changes must clear the old destination even without a page load.
    await page.evaluate(() => {
      document.querySelector("#input-current-class-id").value = "10175";
      document.querySelector("#div-class-contents").setAttribute("directory_id", "153362");
    });
    await page.waitForFunction(() => document.querySelector("#studylog-next-course").hidden);
    assert.equal(await shortcut.getAttribute("href"), null);
    assert.equal(await previous.getAttribute("href"), "/lms/class/10183/153094/", "DOM changes update the previous destination");

    slots = [...schedule, slot(6, "10019", "160001")];
    await visit("/lms/class/10175/153362/");
    assert.equal(await previous.isVisible(), true);
    assert.equal(await shortcut.getAttribute("href"), "/lms/class/10019/160001/", "middle block offers both directions");
    await shortcut.scrollIntoViewIfNeeded();
    const previousBox = await previous.boundingBox();
    const nextBox = await shortcut.boundingBox();
    const bothPanelBox = await page.locator("#studylog-bridge-panel").boundingBox();
    assert(previousBox.x >= 0 && previousBox.x + previousBox.width <= 375);
    assert(bothPanelBox.y >= 18 && previousBox.y >= bothPanelBox.y && nextBox.y + nextBox.height <= bothPanelBox.y + bothPanelBox.height);
    assert(previousBox.y + previousBox.height <= nextBox.y, "navigation links do not overlap on mobile");
    if (process.env.STUDYLOG_SCREENSHOT) await page.screenshot({ path: process.env.STUDYLOG_SCREENSHOT });
    await page.evaluate(() => {
      document.querySelector("#input-current-class-id").value = "10183";
      document.querySelector("#div-class-contents").setAttribute("directory_id", "153094");
    });
    await page.waitForFunction(() => document.querySelector("#studylog-previous-course").hidden);
    assert.equal(await previous.getAttribute("href"), null, "previous link is cleared on returning to the first block");

    // The next saved day follows today's final block, even with an unscheduled day between them.
    const laterDate = new Date(`${today}T12:00:00+09:00`);
    laterDate.setDate(laterDate.getDate() + 2);
    const nextDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(laterDate);
    slots = [...schedule, { date: nextDay, period: 1, classId: "10019", directoryId: "160001", courseName: "科目10019" }];
    await visit("/lms/class/10175/153362/");
    assert.equal(await shortcut.getAttribute("href"), `/lms/class/10019/160001/?studylogDate=${nextDay}`);
    assert.match(await shortcut.innerText(), new RegExp(`次の授業へ.*${Number(nextDay.slice(5, 7))}/${Number(nextDay.slice(8))}`));
    await shortcut.click();
    await page.waitForURL(`**/lms/class/10019/160001/?studylogDate=${nextDay}`);
    await openMenu();
    assert.equal(await previous.getAttribute("href"), "/lms/class/10175/153362/");
    await previous.click();
    await page.waitForURL("**/lms/class/10175/153362/");
    await openMenu();
    assert.equal(await shortcut.getAttribute("href"), `/lms/class/10019/160001/?studylogDate=${nextDay}`);

    slots = schedule.map(({ directoryId, ...item }) => item);
    await visit();
    assert.equal(await shortcut.getAttribute("href"), "/lms/class/10175/", "missing directory links fall back to the course top");
    await visit("/lms/class/10175/");
    assert.equal(await previous.getAttribute("href"), "/lms/class/10183/", "previous link also falls back to the course top");
    directories = [{ classId: "10183", directoryId: "153094", lessonDate: "2020-01-01" }];
    await visit();
    assert.equal(await shortcut.isVisible(), false, "an old lesson must not use today's schedule");
    directories = [];
    slots = [];
    await visit();
    assert.equal(await shortcut.isVisible(), false, "missing timetable has no guessed destination");
    assert.equal(await previous.isVisible(), false);

    slots = [slot(1, "10183"), slot(3, "10183"), slot(4, "10175")];
    await visit();
    assert.equal(await shortcut.isVisible(), false, "separate blocks of the same course are ambiguous without a directory");
    assert.equal(await previous.isVisible(), false);
    slots = [slot(1, "10183", "153094"), slot(3, "10183", "153095"), slot(4, "10175", "153362")];
    await visit();
    assert.equal(await shortcut.getAttribute("href"), "/lms/class/10183/153095/", "a gap starts a new block even for the same course");
    await visit("/lms/class/10183/153095/");
    assert.equal(await previous.getAttribute("href"), "/lms/class/10183/153094/", "previous block can be the same course after a gap");
    slots = schedule;
    await visit("/lms/class/10183/999999/");
    assert.equal(await shortcut.isVisible(), false, "a different known lesson must not match by course alone");
    assert.equal(await previous.isVisible(), false);
    await visit("/lms/schedule/");
    assert.equal(await shortcut.isVisible(), false, "shortcut belongs to course pages only");
    assert.equal(await previous.isVisible(), false);
    await page.goto("http://127.0.0.1/lms/class/10183/153094/?module=quiz");
    await page.waitForFunction(() => document.body.dataset.pageMode === "quiz");
    assert.equal(await shortcut.count(), 0, "quiz screens remain free of navigation controls");
    assert.equal(await previous.count(), 0);

    // Regression: a future course exists in the timetable, but its directory has no date.
    await page.clock.install({ time: new Date("2026-09-25T05:58:43Z") });
    const regression = process.argv[2] ? JSON.parse(fs.readFileSync(process.argv[2], "utf8")) : {
      academicYear: 2026, collectedAt: "2026-09-25T05:58:43Z", courses: [], reports: [],
      directories: [
        { classId: "10019", directoryId: "154691", title: "第１回" },
        { classId: "10246", directoryId: "170273", title: "第1回" },
        { classId: "10236", directoryId: "171005", title: "第1回" }
      ],
      timetableSlots: [
        ...[1, 2, 3].map(period => ({ date: "2026-09-29", period, classId: "10246" })),
        ...[4, 5].map(period => ({ date: "2026-09-29", period, classId: "10943" })),
        { date: "2026-09-29", period: 6, classId: "10176" },
        { date: "2026-09-28", period: 1, classId: "10248" },
        ...[4, 5].map(period => ({ date: "2026-09-28", period, classId: "10236" })),
        { date: "2026-09-28", period: 6, classId: "10176", directoryId: "170730" }
      ]
    };
    // Use only navigation data from an optional real export, never write the export into the repo.
    importedSnapshot = { academicYear: regression.academicYear, collectedAt: regression.collectedAt,
      courses: regression.courses.map(({ classId, name }) => ({ classId, name })), reports: [],
      directories: regression.directories, timetableSlots: regression.timetableSlots };
    await visit("/lms/class/10246/170273/");
    assert.equal(await shortcut.isVisible(), true, "undated future directory uses the unique scheduled course date");
    assert.match(await shortcut.innerText(), /9\/29/);
    assert.equal(await shortcut.getAttribute("href"), "/lms/class/10943/?studylogDate=2026-09-29");
    await shortcut.click();
    await page.waitForURL("**/lms/class/10943/?studylogDate=2026-09-29");
    await page.waitForFunction(() => document.querySelector("#studylog-previous-course")?.getAttribute("href")?.includes("10246"));
    await openMenu();
    assert.equal(await previous.getAttribute("href"), "/lms/class/10246/?studylogDate=2026-09-29");
    await shortcut.click();
    await page.waitForURL("**/lms/class/10176/?studylogDate=2026-09-29");
    await page.waitForFunction(() => document.querySelector("#studylog-previous-course")?.getAttribute("href")?.includes("10943"));
    await openMenu();
    assert.equal(await previous.getAttribute("href"), "/lms/class/10943/?studylogDate=2026-09-29", "date survives navigation to a course scheduled on multiple days");

    await visit("/lms/class/10236/171005/");
    assert.match(await previous.getAttribute("href"), /^\/lms\/class\/10248\//);
    assert.match(await shortcut.getAttribute("href"), /^\/lms\/class\/10176\/170730\//);
    await visit("/lms/class/10019/154691/");
    assert.equal(await shortcut.isVisible(), false);
    assert.equal(await previous.isVisible(), false);
    assert.match(await page.locator("#studylog-course-navigation-status").innerText(), /時間割.*取得/);

    await visit("/lms/class/10176/");
    const dateSelect = page.locator("#studylog-course-navigation-date");
    assert.equal(await dateSelect.isVisible(), true, "ambiguous dates can be selected explicitly");
    assert.equal(await previous.isVisible(), false, "do not silently substitute today");
    await dateSelect.selectOption("2026-09-29");
    await page.waitForFunction(() => document.querySelector("#studylog-previous-course")?.getAttribute("href")?.includes("10943"));
    const regressionPanel = await page.locator("#studylog-bridge-panel").boundingBox();
    assert(regressionPanel.y >= 18, "date selector and panel fit mobile viewport");
    if (process.env.STUDYLOG_SCREENSHOT) await page.screenshot({ path: process.env.STUDYLOG_SCREENSHOT });

    // An explicit date for an old directory must beat a conflicting navigation hint.
    importedSnapshot.directories.push({ classId: "10246", directoryId: "999999", title: "Old lesson", lessonDate: "2026-04-01" });
    await visit("/lms/class/10246/999999/?studylogDate=2026-09-29");
    assert.equal(await shortcut.isVisible(), false);
    await page.evaluate(() => {
      const entry = document.createElement("a");
      entry.className = "a-open-contents";
      entry.setAttribute("directory_id", "999999");
      entry.textContent = "第9回 日付のない見出し";
      document.querySelector("#portal-fixture").append(entry);
    });
    await page.waitForFunction(async () => {
      const stored = (await chrome.storage.local.get("studylogBridgeSnapshotV1")).studylogBridgeSnapshotV1;
      return stored.directories.find(item => item.classId === "10246" && item.directoryId === "999999")?.title === "第9回 日付のない見出し";
    });
    const savedDate = await page.evaluate(async () => (await chrome.storage.local.get("studylogBridgeSnapshotV1"))
      .studylogBridgeSnapshotV1.directories.find(item => item.classId === "10246" && item.directoryId === "999999").lessonDate);
    assert.equal(savedDate, "2026-04-01", "reading an undated heading must not erase a previously collected lesson date");
    assert.equal(await shortcut.isVisible(), false, "DOM refresh must not remap a known old lesson onto a future timetable");

    // Walk every saved block in both directions, including transitions between saved dates.
    const savedDates = [...new Set(regression.timetableSlots.map(item => item.date))].sort();
    const allBlocks = savedDates.flatMap((date) => {
      const day = regression.timetableSlots.filter(item => item.date === date).sort((a, b) => a.period - b.period);
      return day.filter((item, index) => !index || item.classId !== day[index - 1].classId || Number(item.period) !== Number(day[index - 1].period) + 1);
    });
    for (const [index, block] of allBlocks.entries()) {
      await visit(`/lms/class/${block.classId}/${block.directoryId ? `${block.directoryId}/` : ""}?studylogDate=${block.date}`);
      for (const [link, neighbor] of [[previous, allBlocks[index - 1]], [shortcut, allBlocks[index + 1]]]) {
        assert.equal(await link.isVisible(), Boolean(neighbor), `${block.date} period ${block.period}: correct navigation boundary`);
        if (neighbor) {
          const destination = new URL(await link.getAttribute("href"), "http://127.0.0.1");
          assert.equal(destination.pathname,
            `/lms/class/${neighbor.classId}/${neighbor.directoryId ? `${neighbor.directoryId}/` : ""}`, `${block.date} period ${block.period}: correct destination`);
          const neighborDates = new Set(regression.timetableSlots.filter(item => item.classId === neighbor.classId).map(item => item.date));
          assert.equal(destination.searchParams.get("studylogDate"), neighbor.date !== "2026-09-25" || neighborDates.size > 1 ? neighbor.date : null,
            "destination preserves its own date when needed");
        }
      }
    }
    for (const route of ["/lms/", "/lms/schedule/", "/portal/lmsinc/sMyPage.php", "/lms/class/10246/", "/lms/content/other/"]) {
      await visit(route);
      await page.locator('[data-action="close"]').click();
      assert.equal(await page.locator("#studylog-bridge-toggle").getAttribute("aria-expanded"), "false");
      assert.equal(await page.locator("#studylog-bridge-panel").isVisible(), false);
      await openMenu();
      await page.mouse.click(1, 1);
      assert.equal(await page.locator("#studylog-bridge-toggle").getAttribute("aria-expanded"), "false");
      assert.equal(await page.locator("#studylog-bridge-panel").isVisible(), false);
    }
    assert.deepEqual(errors, []);
    console.log("previous/next course browser smoke test: ok");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
