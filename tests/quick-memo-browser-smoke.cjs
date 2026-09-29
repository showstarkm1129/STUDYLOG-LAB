const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const prefix = "studylogQuickMemoV1:";
const scripts = ["date-rules.js", "attendance-rules.js", "attendance-watch-rules.js", "digest-rules.js", "task-rules.js", "auto-sync-rules.js", "content.js"];
const calendar = (startDate = "2026-09-28", headings = true) => `<table id="div-top-timetable1" data-start-date="${startDate}">
  ${headings ? '<thead><tr><th>時限</th><th>月曜日</th><th>火曜日</th><th>水曜日</th></tr></thead>' : ""}
  <tbody><tr><th>1限</th><td class="top-timetable-table-td"><a href="/lms/class/10019/">簿記</a></td><td class="top-timetable-table-td"><a href="/lms/class/10019/">簿記</a></td><td class="top-timetable-table-td"><a href="/lms/class/20019/">簿記</a></td></tr>
  <tr><th>2限</th><td class="top-timetable-table-td">2 〃</td><td class="top-timetable-table-td"></td><td class="top-timetable-table-td"><a href="/lms/class/30001/">数学</a></td></tr></tbody></table>`;

// 実ページの別表、年度select、時限の絶対配置、Tree Ivy、glexa.cssのfooter共通指定。
const portalCalendar = () => `<style>
  body { margin: 16px; font: 14px/1.45 Arial, sans-serif; color: #333; }
  footer { height:50px; width:100%; position:absolute; bottom:0; margin:0 auto; }
  @media screen and (max-width:767px) { footer { height:auto; position:static; margin-top:10px; } }
  .portal-category { display:flex; justify-content:flex-end; align-items:center; gap:8px; margin-bottom:12px; }
  .table-responsive { overflow-x:auto; }
  .top-timetable-table { table-layout:fixed; width:100%; border-collapse:collapse; }
  .top-timetable-table td { border:1px solid #ddd; }
  .week-data { padding:8px; text-align:center; background:#fffbe8; }
  .week-data > a { margin-left:8px; color:#446d38; }
  .top-timetable-table-td { position:relative; height:35px; padding:0; vertical-align:top; }
  .div-unit-index { position:absolute; z-index:1; width:20px; top:0; bottom:0; left:0; text-align:center; background:#efefef; border-right:1px solid #ddd; }
  .div-unit-index-body { display:table; width:100%; height:100%; }
  .div-unit-index-body span { display:table-cell; vertical-align:middle; }
  .div-class-name { padding:7px 7px 7px 27px; }
  .div-class-name, .div-class-name > section { height:100%; }
  .div-class-name > section { display:flex; flex-direction:column; }
  /* Tree Ivy 2.0.6 の schedule_layout.css / simpleAttendanceView.js と同じ処理。 */
  .attendance-hidden { position:absolute; color:transparent; transform:translate(-0.7em,0); pointer-events:none; height:100%; top:0; width:0.4em; user-select:none; }
  .div-class-name section > a { color:#2c9ab0; font-weight:bold; }
  .text-right { text-align:right; }
  .ivy-section { margin-top:12px; }
  .ivy-attendance-button { width:100%; margin-bottom:5px; padding:4px 8px; background:#b2f0e6; border:0; border-radius:4px; }
  .ivy-bar { height:40px; background:#edfafa; }
  @media(max-width:600px) { .top-timetable-table { min-width:770px; } }
</style><div class="portal-category"><span>カテゴリ</span><select class="form-control select-class-archive a-load-timetable-select"><option>2026年度</option><option>2025年度</option></select></div>
<div class="table-responsive"><table class="top-timetable-table"><tr>${Array.from({length:7}, (_,index) => {
  const day = new Date(2026, 8, 29 + index);
  const iso = `${day.getFullYear()}-${String(day.getMonth()+1).padStart(2,"0")}-${String(day.getDate()).padStart(2,"0")}`;
  return `<td class="week-data">${day.getMonth()+1}/${day.getDate()}（${"日月火水木金土"[day.getDay()]}）<a href="${index === 1 ? 'https://portal.iwasaki.ac.jp' : ''}/lms/schedule/form/0/${iso}" aria-label="予定を追加">✎</a></td>`;
}).join("")}</tr></table><div id="div-top-timetable2"><table class="top-timetable-table" id="overrided-schedule"><tbody>${Array.from({length:3}, (_,row) => `<tr>${Array.from({length:7}, (_,column) => {
  const classId = column === 0 || column === 1 ? "10019" : String(20000 + column);
  const name = column === 0 || column === 1 ? "簿記" : "長い科目名のクラウドコンピューティングⅠ";
  return `<td class="top-timetable-table-td"><div class="div-unit-index"><div class="div-unit-index-body"><span>${row+1}</span></div></div> <div class="div-class-name"><section>${row && column !== 1 ? '<div style="text-align:center">〃</div>' : `<a href="/lms/class/${classId}/" style="max-height:1.2em">${name}</a><br><div class="text-right"><small>先生</small></div><div class="text-right"><small>教室 :</small> 601</div><div class="ivy-section"><button class="ivy-attendance-button" type="button">出席確認</button><div class="ivy-bar"></div></div>`}</section></div></td>`;
}).join("")}</tr>`).join("")}</tbody></table></div></div>`;

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, timezoneId: "Asia/Tokyo" });
    await context.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        const timetable = document.querySelector('#div-top-timetable2 > table > tbody');
        if (!timetable) return;
        const applyIvyAttendanceView = () => timetable.querySelectorAll('.div-class-name span').forEach(span => span.classList.add('attendance-hidden'));
        new MutationObserver(applyIvyAttendanceView).observe(timetable, {childList:true, subtree:true});
        applyIvyAttendanceView();
      });
      const listeners = [];
      window.__memoFailSave = false;
      window.__memoSaveDelay = 0;
      window.__memoWrites = 0;
      const emit = changes => listeners.forEach(listener => listener(changes, "local"));
      window.addEventListener("storage", event => {
        if (event.key) emit({ [event.key]: { newValue: event.newValue === null ? undefined : JSON.parse(event.newValue) } });
      });
      window.chrome = {
        storage: {
          onChanged: { addListener(listener) { listeners.push(listener); } },
          local: {
            async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, JSON.parse(localStorage.getItem(key) || "null")])); },
            async set(values) {
              if (Object.keys(values).some(key => key.startsWith("studylogQuickMemoV1:"))) {
                if (window.__memoSaveDelay) await new Promise(resolve => setTimeout(resolve, window.__memoSaveDelay));
                if (window.__memoFailSave) throw new Error("storage unavailable");
                window.__memoWrites += 1;
              }
              Object.entries(values).forEach(([key, value]) => localStorage.setItem(key, JSON.stringify(value)));
              emit(Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { newValue: value }])));
            }
          }
        },
        runtime: { getURL: file => new URL(`/${file}`, location.origin).href, sendMessage: () => Promise.resolve(), onMessage: { addListener() {} } }
      };
    });
    await context.route("http://127.0.0.1/**", async route => {
      const url = new URL(route.request().url());
      if (url.pathname === "/lms/") {
        return route.fulfill({ contentType: "text/html; charset=utf-8", body: `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>Quick memo fixture</title><link rel="stylesheet" href="/content.css"></head><body>
          <h1>時間割</h1><input id="input-current-class-id" type="hidden"><div id="div-class-contents"></div>${url.searchParams.has("portal") ? portalCalendar() : calendar()}
          <script>
            if (!localStorage.getItem('studylogBridgeSnapshotV1')) localStorage.setItem('studylogBridgeSnapshotV1', JSON.stringify({schemaVersion:1,academicYear:2026,collectedAt:'2026-09-29T01:00:00Z',courses:[],reports:[],directories:[],timetableSlots:[],timetableWeekStart:{startDate:'2026-09-28'}}));
            ${JSON.stringify(scripts)}.reduce((promise,file)=>promise.then(()=>new Promise(resolve=>{const script=document.createElement('script');script.src='/'+file;script.onload=resolve;document.head.append(script);})),Promise.resolve());
          </script></body></html>` });
      }
      const filename = path.resolve(root, url.pathname.slice(1));
      return filename.startsWith(`${root}${path.sep}`) && fs.existsSync(filename) ? route.fulfill({ path: filename }) : route.fulfill({ status: 404 });
    });
    const page = await context.newPage();
    const errors = [];
    context.on("page", tab => tab.on("pageerror", error => errors.push(error.message)));
    page.on("pageerror", error => errors.push(error.message));
    const visit = async (tab, query = "") => {
      await tab.goto(`http://127.0.0.1/lms/${query}`);
      await tab.waitForFunction(() => document.querySelector("#studylog-bridge-root")?.dataset.ready === "true");
    };
    const button = (key, tab = page) => tab.locator(`.studylog-memo-button[data-memo-key="${prefix}${key}"]`);
    const dialog = page.locator("#studylog-quick-memo");
    const input = dialog.locator("textarea");
    const saved = async (key, value, tab = page) => tab.waitForFunction(({ key, value }) => JSON.parse(localStorage.getItem(key) || "null") === value, { key: prefix + key, value });
    const close = async () => {
      await dialog.locator("header [data-memo-close]").click();
      await dialog.waitFor({ state: "detached" });
    };

    await visit(page);
    assert.equal(await button("weekday:1").count(), 1, "weekday-only headings get a memo control");
    assert.equal(await button("course:10019").count(), 2, "each day's starting period has a button for the shared course");
    assert.equal(await page.locator('tbody tr:nth-child(2) .top-timetable-table-td').first().locator('.studylog-memo-button').count(), 0, "continuation periods have no memo button");
    assert.equal(await button("course:20019").count(), 1, "same name with a different course id has its own memo");
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("studylogBridgeSnapshotV1"))?.timetableSlots?.[0]?.date === "2026-09-28");
    const originalDates = await page.evaluate(() => chrome.storage.local.get("studylogBridgeSnapshotV1").then(result => result.studylogBridgeSnapshotV1.timetableSlots.map(slot => [slot.date, slot.period, slot.courseName])));

    await page.evaluate(() => {
      document.querySelector('.studylog-memo-button[data-memo-key="studylogQuickMemoV1:weekday:1"]').click();
      document.querySelector('.studylog-memo-button[data-memo-key="studylogQuickMemoV1:weekday:2"]').click();
    });
    await dialog.waitFor();
    assert.equal(await dialog.count(), 1, "rapid clicks only open one editor");
    assert.equal(await dialog.locator("h2").innerText(), "火曜日", "the last clicked note wins");
    await close();

    await button("weekday:1").click();
    await input.fill("# 月曜の持ち物\n- **電卓**\n- [ ] 教科書\n> 毎週確認\n`仕訳` と *復習*\n[参考](https://example.com/)\n1. ノート\n```\n<script>alert(1)</script>\n```\n<img src=x onerror=alert(1)>\n[危険](javascript:alert)");
    await saved("weekday:1", await input.inputValue());
    const mondayMemo = await input.inputValue();
    await dialog.locator('[data-memo-mode="preview"]').click();
    assert.equal(await dialog.locator(".studylog-memo-preview h1").innerText(), "月曜の持ち物");
    assert.equal(await dialog.locator(".studylog-memo-preview strong").innerText(), "電卓");
    assert.equal(await dialog.locator('.studylog-memo-preview input[type="checkbox"]').isChecked(), false);
    assert.equal(await dialog.locator(".studylog-memo-preview em").innerText(), "復習");
    assert.equal(await dialog.locator(".studylog-memo-preview ol li").innerText(), "ノート");
    assert.equal(await dialog.locator(".studylog-memo-preview pre code").innerText(), "<script>alert(1)</script>");
    assert.equal(await dialog.locator(".studylog-memo-preview img, .studylog-memo-preview script").count(), 0);
    assert.equal(await dialog.locator(".studylog-memo-preview a").count(), 1, "javascript links render as text");
    assert.equal(await dialog.locator(".studylog-memo-preview a").getAttribute("rel"), "noopener noreferrer");
    await close();
    assert.equal(await button("weekday:1").getAttribute("data-has-memo"), "true");
    await button("weekday:2").click();
    assert.equal(await input.inputValue(), "", "weekday notes do not leak into other days");
    await close();

    await button("course:10019").first().click();
    await input.fill("**簿記共通**\n- [x] 電卓を用意");
    await close(); // Closing flushes the debounce immediately.
    await saved("course:10019", "**簿記共通**\n- [x] 電卓を用意");
    assert.equal(await button("course:10019").last().getAttribute("data-has-memo"), "true");
    await button("course:10019").last().click();
    assert.equal(await dialog.locator(".studylog-memo-preview strong").innerText(), "簿記共通");
    assert.equal(await dialog.locator('.studylog-memo-preview input[type="checkbox"]').isChecked(), true);
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    assert.equal(await button("course:10019").last().evaluate(el => el === document.activeElement), true, "Escape returns focus to the button");
    await button("course:20019").click();
    assert.equal(await input.inputValue(), "");
    await close();

    await page.evaluate(markup => { document.querySelector("#div-top-timetable1").outerHTML = markup; }, calendar("2026-10-05"));
    await button("weekday:1").waitFor();
    await page.waitForFunction(() => document.querySelector('.studylog-memo-button[data-memo-key="studylogQuickMemoV1:weekday:1"]')?.dataset.hasMemo === "true");
    await button("weekday:1").click();
    assert.equal(await input.inputValue(), mondayMemo, "the next Monday reuses the memo");
    await close();
    await page.reload();
    await button("weekday:1").waitFor();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("studylogBridgeSnapshotV1"))?.timetableSlots?.[0]?.date === "2026-09-28");
    await button("weekday:1").click();
    assert.equal(await input.inputValue(), mondayMemo, "notes survive a reload");
    await close();
    assert.deepEqual(await page.evaluate(() => chrome.storage.local.get("studylogBridgeSnapshotV1").then(result => result.studylogBridgeSnapshotV1.timetableSlots.map(slot => [slot.date, slot.period, slot.courseName]))), originalDates, "memo controls do not contaminate date, period or course collection");
    assert.match(page.url(), /\/lms\/$/, "memo editing keeps the calendar URL");

    // A second calendar tab receives changes without reloading.
    const other = await context.newPage();
    await visit(other);
    await button("course:10019", other).first().click();
    await button("course:10019").first().click();
    await dialog.locator('[data-memo-mode="edit"]').click();
    await input.fill("別タブへ反映");
    await saved("course:10019", "別タブへ反映");
    await other.waitForFunction(() => document.querySelector("#studylog-quick-memo textarea")?.value === "別タブへ反映");
    await other.locator('[data-memo-mode="edit"]').click();
    await other.evaluate(() => { window.__memoFailSave = true; });
    await other.locator("#studylog-quick-memo textarea").fill("別タブで入力中の本文");
    await other.locator("[data-memo-retry]").waitFor({ state: "visible" });
    await input.fill("外部から新しい保存");
    await saved("course:10019", "外部から新しい保存");
    await other.waitForFunction(() => document.querySelector('.studylog-memo-button[data-memo-key="studylogQuickMemoV1:course:10019"]')?.title.includes("外部から新しい保存"));
    assert.equal(await other.locator("#studylog-quick-memo textarea").inputValue(), "別タブで入力中の本文", "storage changes do not overwrite a dirty draft");
    await other.evaluate(() => { window.__memoFailSave = false; });
    await other.locator("[data-memo-retry]").click();
    await saved("course:10019", "別タブで入力中の本文", other);
    await close();
    await other.close();

    // Save failures keep the draft and prevent a close until retry succeeds.
    await button("course:10019").first().click();
    await dialog.locator('[data-memo-mode="edit"]').click();
    await page.evaluate(() => { window.__memoFailSave = true; });
    await input.fill("保存失敗でも残る本文");
    await dialog.locator("[data-memo-retry]").waitFor({ state: "visible" });
    await dialog.locator("header [data-memo-close]").click();
    assert.equal(await dialog.isVisible(), true);
    assert.equal(await input.inputValue(), "保存失敗でも残る本文");
    await page.evaluate(() => { window.__memoFailSave = false; });
    await dialog.locator("[data-memo-retry]").click();
    await saved("course:10019", "保存失敗でも残る本文");
    await close();

    // Edits made during a slow write must be persisted by the same save loop.
    await button("course:10019").first().click();
    await dialog.locator('[data-memo-mode="edit"]').click();
    await page.evaluate(() => { window.__memoSaveDelay = 250; });
    await input.fill("途中の本文");
    await dialog.locator("[data-memo-retry]").evaluate(el => el.click());
    await input.fill("最後の本文");
    await close();
    await saved("course:10019", "最後の本文");
    await page.evaluate(() => { window.__memoSaveDelay = 0; });

    // Clearing a memo removes its marker everywhere.
    await button("course:10019").first().click();
    await dialog.locator('[data-memo-mode="edit"]').click();
    await input.fill("");
    await close();
    assert.equal(await button("course:10019").first().getAttribute("data-has-memo"), "false");
    assert.equal(await button("course:10019").last().getAttribute("data-has-memo"), "false");

    // A calendar without heading cells still offers weekday memos above the table.
    await page.evaluate(markup => { document.querySelector("#div-top-timetable1").outerHTML = markup; }, calendar("2026-10-05", false));
    await page.locator(".studylog-memo-day-bar").waitFor();
    assert.equal(await page.locator(".studylog-memo-day-bar button").count(), 3);
    await page.setViewportSize({ width: 375, height: 667 });
    await button("weekday:1").click();
    await dialog.locator('[data-memo-mode="edit"]').click();
    const box = await dialog.boundingBox();
    assert(box.x >= 0 && box.y >= 0 && box.x + box.width <= 375 && box.y + box.height <= 667, "editor stays within the mobile viewport");
    await dialog.locator("summary").click();
    await page.waitForFunction(() => {
      const rect = document.querySelector("#studylog-quick-memo").getBoundingClientRect();
      return rect.bottom <= innerHeight;
    });
    if (process.env.STUDYLOG_MEMO_SCREENSHOT) {
      await input.fill("# 月曜の持ち物\n- **電卓**\n- [ ] 教科書\n> 朝、家を出る前に確認");
      await dialog.locator('[data-memo-mode="preview"]').click();
      await page.screenshot({ path: process.env.STUDYLOG_MEMO_SCREENSHOT });
    }
    await page.evaluate(() => history.pushState({}, "", "/lms/content/10019/quiz/999/"));
    await page.waitForFunction(() => document.querySelector("#studylog-quick-memo")?.hidden && !document.querySelector(".studylog-memo-button"));
    await page.evaluate(() => history.pushState({}, "", "/lms/"));
    await page.waitForFunction(() => !document.querySelector("#studylog-quick-memo")?.hidden && document.querySelector(".studylog-memo-button"));
    await page.locator("body > h1").click();
    await dialog.waitFor({ state: "detached" });

    const portal = await context.newPage();
    await visit(portal, "?portal=1");
    const nativeMemo = portal.locator('.week-data a[href*="/lms/schedule/form/"]');
    assert.equal(await nativeMemo.count(), 7, "native memo links are retained");
    assert.equal(await portal.locator('.week-data a[href*="/lms/schedule/form/"]:visible').count(), 0, "native memo buttons are hidden by default, including absolute URLs");
    await portal.evaluate(() => {
      const event = document.createElement('a');
      event.id = 'existing-schedule-link';
      event.href = '/lms/schedule/form/91';
      event.textContent = '予定を編集';
      document.body.append(event);
    });
    assert.equal(await portal.locator('#existing-schedule-link').isVisible(), true, "existing schedule links outside weekday headings stay visible");
    const dashboard = await context.newPage();
    await dashboard.goto('http://127.0.0.1/dashboard.html');
    await dashboard.locator('#open-display-settings-dialog').click();
    const nativeMemoToggle = dashboard.locator('#show-portal-schedule-memo');
    assert.equal(await nativeMemoToggle.isChecked(), false);
    await nativeMemoToggle.check();
    await portal.waitForFunction(() => [...document.querySelectorAll('.week-data a[href*="/lms/schedule/form/"]')].every(link => getComputedStyle(link).display !== 'none'));
    assert.equal(await portal.locator('.week-data a[href*="/lms/schedule/form/"]:visible').count(), 7, "dashboard changes update all native buttons in an already-open calendar");
    await dashboard.reload();
    await dashboard.locator('#open-display-settings-dialog').click();
    assert.equal(await nativeMemoToggle.isChecked(), true, "display preference survives a dashboard reload");
    await portal.reload();
    await portal.waitForFunction(() => document.querySelector('#studylog-bridge-root')?.dataset.ready === 'true');
    assert.equal(await nativeMemo.first().isVisible(), true, "the calendar restores the saved preference");
    await nativeMemoToggle.uncheck();
    await portal.waitForFunction(() => [...document.querySelectorAll('.week-data a[href*="/lms/schedule/form/"]')].every(link => getComputedStyle(link).display === 'none'));
    assert.equal(await portal.locator('.week-data > .studylog-memo-button').count(), 7, "hiding native buttons keeps weekday quick memos accessible");
    await dashboard.setViewportSize({width:375,height:667});
    const settingsBounds = await dashboard.locator('#display-settings-dialog').boundingBox();
    assert(settingsBounds.x >= 0 && settingsBounds.y >= 0 && settingsBounds.x + settingsBounds.width <= 375 && settingsBounds.y + settingsBounds.height <= 667, "display settings fit the mobile viewport");
    if (process.env.STUDYLOG_DISPLAY_SETTINGS_SCREENSHOT) await dashboard.screenshot({path:process.env.STUDYLOG_DISPLAY_SETTINGS_SCREENSHOT});
    await dashboard.close();
    const portalDialog = portal.locator("#studylog-quick-memo");
    const checkMemoLayout = async label => {
      const violations = await portalDialog.evaluate(dialog => {
        const errors = [];
        const content = dialog.querySelector('textarea:not([hidden]), .studylog-memo-preview:not([hidden])').getBoundingClientRect();
        const details = dialog.querySelector('details').getBoundingClientRect();
        const footer = dialog.querySelector('footer').getBoundingClientRect();
        const status = dialog.querySelector('[role="status"]').getBoundingClientRect();
        const bounds = dialog.getBoundingClientRect();
        if (content.bottom + 4 > details.top) errors.push('Markdown help overlaps the input/preview');
        if (details.bottom + 4 > footer.top) errors.push('footer overlaps the input or Markdown help');
        if (footer.left < bounds.left || footer.right > bounds.right) errors.push('footer escapes the dialog');
        if (dialog.scrollWidth > dialog.clientWidth) errors.push('dialog has horizontal overflow');
        dialog.querySelectorAll('footer button:not([hidden])').forEach(button => {
          const rect = button.getBoundingClientRect();
          if (Math.min(rect.right, status.right) > Math.max(rect.left, status.left) && Math.min(rect.bottom, status.bottom) > Math.max(rect.top, status.top)) errors.push('save status overlaps a footer button');
        });
        return errors;
      });
      assert.deepEqual(violations, [], label);
    };
    assert.equal(await portal.locator(".portal-category .studylog-memo-button").count(), 0, "the academic-year select never gets a weekday memo");
    assert.equal(await portal.locator(".week-data > .studylog-memo-button").count(), 7, "all weekday memos belong to the real date headings");
    assert.equal(await portal.locator(".studylog-memo-day-bar").count(), 0, "split date/course tables do not create a duplicate day bar");
    assert.equal(await portal.locator('#overrided-schedule .studylog-memo-button').count(), 7, "three consecutive periods have only one memo button per day");
    assert.equal(await button("course:10019", portal).count(), 2, "starting periods on different days still share the memo");
    for (const width of [1280, 800, 375]) {
      await portal.setViewportSize({ width, height:800 });
      const violations = await portal.evaluate(() => {
        const errors = [];
        document.querySelectorAll(".top-timetable-table-td").forEach((cell,index) => {
          const memo = cell.querySelector(".studylog-memo-button");
          const period = Number(cell.querySelector('.div-unit-index span').textContent);
          if (period > 1) {
            if (memo) errors.push(`cell ${index}: continuation period has a memo button`);
            return;
          }
          if (!memo) { errors.push(`cell ${index}: starting period has no memo button`); return; }
          const target = cell.querySelector('.studylog-memo-course-row > a');
          const bounds = cell.getBoundingClientRect(), button = memo.getBoundingClientRect(), label = target.getBoundingClientRect();
          if (button.left < bounds.left || button.right > bounds.right || button.top < bounds.top || button.bottom > bounds.bottom) errors.push(`cell ${index}: button escaped its cell`);
          if (Math.min(button.right,label.right) > Math.max(button.left,label.left) && Math.min(button.bottom,label.bottom) > Math.max(button.top,label.top)) errors.push(`cell ${index}: button overlaps course/continuation`);
          if (button.top < label.bottom + 4) errors.push(`cell ${index}: memo is not below the course name`);
          if (button.width < 64 || button.height < 44) errors.push(`cell ${index}: memo target is too small`);
          if (memo.textContent.trim() !== 'メモ') errors.push(`cell ${index}: memo has no visible label`);
          if (getComputedStyle(memo).pointerEvents === 'none') errors.push(`cell ${index}: Tree Ivy disabled memo clicks`);
          for (const [x,y] of [[button.left+4,button.top+4], [button.right-4,button.bottom-4], [button.left+button.width/2,button.top+button.height/2]]) {
            if (x >= 0 && x < innerWidth && y >= 0 && y < innerHeight && document.elementFromPoint(x,y)?.closest('.studylog-memo-button') !== memo) errors.push(`cell ${index}: memo click target is covered`);
          }
        });
        const headers = [...document.querySelectorAll('.week-data')], cells = [...document.querySelector('#overrided-schedule').rows[0].cells];
        headers.forEach((header,index) => {
          const heading=header.getBoundingClientRect(), cell=cells[index].getBoundingClientRect();
          if (Math.abs(heading.left-cell.left)>1 || Math.abs(heading.width-cell.width)>1) errors.push(`column ${index}: weekday and course columns are misaligned`);
        });
        return errors;
      });
      assert.deepEqual(violations, [], `layout at ${width}px`);
      await button("course:10019", portal).first().click();
      await portalDialog.waitFor({ state:"visible" });
      assert.equal(await portalDialog.locator("h2").innerText(), "簿記");
      assert.match(portal.url(), /\/lms\/\?portal=1$/, "course memo click does not open the course or attendance page");
      const memoBox=await portalDialog.boundingBox();
      assert(memoBox.x>=0 && memoBox.y>=0 && memoBox.x+memoBox.width<=width && memoBox.y+memoBox.height<=800);
      await portalDialog.locator('[data-memo-mode="edit"]').click();
      await portalDialog.locator('textarea').fill('# 持ち物\n- 教科書\n- **電卓**');
      await checkMemoLayout(`focused editor and collapsed Markdown help at ${width}px`);
      await portalDialog.locator('summary').click();
      await checkMemoLayout(`editor and expanded Markdown help at ${width}px`);
      await saved("course:10019", '# 持ち物\n- 教科書\n- **電卓**', portal);
      await portalDialog.locator('[data-memo-mode="preview"]').click();
      await checkMemoLayout(`preview and expanded Markdown help at ${width}px`);
      if (process.env.STUDYLOG_MEMO_LAYOUT_SCREENSHOT && width === 1280) await portal.screenshot({path:process.env.STUDYLOG_MEMO_LAYOUT_SCREENSHOT});
      await portalDialog.locator("header [data-memo-close]").click();
      await portalDialog.waitFor({state:"detached"});
      await button("course:10019", portal).last().click();
      await portalDialog.waitFor({state:"visible"});
      await portalDialog.locator("header [data-memo-close]").click();
      await portalDialog.waitFor({state:"detached"});
      await button("weekday:1", portal).click();
      await portalDialog.waitFor({state:"visible"});
      assert.equal(await portalDialog.locator("h2").innerText(), "月曜日");
      await portalDialog.locator("header [data-memo-close]").click();
      await portalDialog.waitFor({state:"detached"});
    }
    // 時間割更新で別科目・空き時限・連続授業へ変わった場合も、開始ボタンを作り直す。
    const laterCell = portal.locator('#overrided-schedule tr').nth(2).locator('td').first();
    await laterCell.locator('.div-class-name').evaluate(element => { element.innerHTML = '<section><a href="/lms/class/90001/">数学</a></section>'; });
    await button("course:90001", portal).waitFor();
    await laterCell.locator('.div-class-name').evaluate(element => { element.innerHTML = '<section><a href="/lms/class/10019/">簿記</a></section>'; });
    await laterCell.locator('.studylog-memo-button').waitFor({state:"detached"});
    await portal.locator('#overrided-schedule tr').nth(1).locator('td').first().locator('.div-class-name').evaluate(element => { element.replaceChildren(); });
    await laterCell.locator('.studylog-memo-button').waitFor();
    assert.equal(await button("course:10019", portal).count(), 3, "a later lesson after a free period gets its own button");
    await portal.locator('#overrided-schedule tr').nth(1).locator('td').first().locator('.div-class-name').evaluate(element => { element.innerHTML = '<section><a href="/lms/class/10019/">簿記</a></section>'; });
    await laterCell.locator('.studylog-memo-button').waitFor({state:"detached"});
    assert.equal(await button("course:10019", portal).count(), 2, "obsolete buttons are removed when lessons become consecutive");
    await portal.close();
    assert.deepEqual(errors, []);
    console.log("quick memo browser smoke: passed (dashboard/native memo visibility sync + persistence, shared memos, starting periods only, timetable updates, markdown safety, split portal tables + Tree Ivy + global footer CSS, layout at 1280/800/375px)");
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
