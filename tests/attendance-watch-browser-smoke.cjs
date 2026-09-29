const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const dependencyRoot = process.argv[2];
const { chromium } = require(dependencyRoot ? path.join(dependencyRoot, "playwright") : "playwright");
const root = path.resolve(__dirname, "..");
const mime = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };
const counts = { classPage: 0, attendanceScreen: 0, entryState: 0 };
let receptionOpen = false;
let entryPayloadOverride = null;

const CLOSED_SCREEN = "<html><body><h1>出席確認</h1><p>現在、出席確認の受付を行っていません。</p></body></html>";
const OPEN_SCREEN = "<html><body><h1>出席確認</h1><p>コードを入力してください</p><form><input name=\"code\"></form></body></html>";

const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, "http://portal.iwasaki.ac.jp").pathname;
  if (pathname === "/lms/entry-state") {
    counts.entryState += 1;
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    // スタログと同じ意味づけ。'1' は「受付済み＝新たな受付なし」を表す。
    response.end(JSON.stringify(entryPayloadOverride ?? { is_accepted: receptionOpen ? "0" : "1" }));
    return;
  }
  if (pathname === "/lms/attendance/10175/") {
    counts.attendanceScreen += 1;
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(receptionOpen ? OPEN_SCREEN : CLOSED_SCREEN);
    return;
  }
  if (pathname === "/lms/class/10175/") {
    counts.classPage += 1;
    const fixture = fs.readFileSync(path.resolve(root, "tests/attendance.html"), "utf8");
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    // 受付中は学校側がボタンの見た目を変える、という想定を再現する。
    response.end(receptionOpen ? fixture.replace('class="btn btn-attendance"', 'class="btn btn-attendance is-open"') : fixture);
    return;
  }
  // 自動収集がついでに読む一覧は、この試験では空で返す。
  if (pathname.startsWith("/portal/lmsinc/") || (pathname === "/lms/" && request.method === "POST")) {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end("<table></table>");
    return;
  }
  const filename = path.resolve(root, pathname.replace(/^\/+/, ""));
  if (!filename.startsWith(`${root}${path.sep}`) || !fs.existsSync(filename) || fs.statSync(filename).isDirectory()) {
    response.writeHead(404).end("not found");
    return;
  }
  response.writeHead(200, { "Content-Type": mime[path.extname(filename)] || "application/octet-stream" });
  fs.createReadStream(filename).pipe(response);
});

const notices = (page) => page.evaluate(() => JSON.parse(document.body.dataset.attendanceNotices || "[]"));
const watchState = (page) => page.evaluate(() => window.studylogTestState.studylogAttendanceWatchStateV1 || null);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, message, attempts = 120) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await check()) return;
    await wait(100);
  }
  throw new Error(`timed out: ${message} (counts=${JSON.stringify(counts)})`);
}

// 次の確認までの待ち時間を消して、監視ループをもう一度回す。
async function forceNextCheck(page) {
  await page.evaluate(() => {
    const stored = window.studylogTestState.studylogAttendanceWatchStateV1;
    for (const block of Object.values(stored.blocks)) block.lastCheckedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true, args: ["--host-resolver-rules=MAP portal.iwasaki.ac.jp 127.0.0.1"] });
  try {
    const page = await browser.newPage();
    page.on("pageerror", (error) => console.log("[pageerror]", error.message));
    await page.goto(`http://portal.iwasaki.ac.jp:${port}/lms/class/10175/`);

    await waitFor(async () => counts.entryState >= 1, "the watch should ask for the reception state during the lesson window");
    await waitFor(async () => (await watchState(page))?.probes?.length >= 1, "the first check should be recorded");
    assert.deepEqual(await notices(page), [], "a settled reception must not notify");
    const firstState = await watchState(page);
    assert.equal(firstState.probes.at(-1).screenState, "quiet");
    assert.equal(firstState.probes.at(-1).mode, "entry");
    assert.equal(firstState.blocks[Object.keys(firstState.blocks)[0]].requests, 1);
    assert.equal(counts.classPage, 1, "the entry check never downloads the whole course page");

    receptionOpen = true;
    await forceNextCheck(page);
    await waitFor(async () => (await notices(page)).length >= 1, "an open reception should be announced");

    const announced = await notices(page);
    assert.equal(announced.length, 1);
    assert.equal(announced[0].courseName, "データベース");
    assert.equal(announced[0].periodLabel, "1限");
    assert.match(announced[0].url, /\/lms\/class\/10175\/$/);
    assert.deepEqual(announced[0].channels, ["badge"], "the student is looking at this very course page, so only the badge is used");
    assert.equal(announced[0].quiet, true);

    const entryCall = await page.evaluate(() => window.glexa.entryCalls.at(-1));
    assert.equal(entryCall.action, "glexa_modal_entry_form", "the watch reuses the site's own question");
    assert.equal(String(entryCall.params.class_id), "10175");
    assert.equal(entryCall.params.is_ajax, 1);
    assert.equal(entryCall.withoutLoading, true, "the check must stay invisible to the student");

    const detected = await watchState(page);
    const blockKey = Object.keys(detected.blocks)[0];
    assert.ok(detected.blocks[blockKey].detectedAt, "the window records that the reception was found");
    assert.ok(detected.blocks[blockKey].notifiedAt);

    const checksSoFar = counts.entryState;
    await forceNextCheck(page);
    await wait(600);
    assert.equal(counts.entryState, checksSoFar, "once detected, the window stops asking");
    assert.equal((await notices(page)).length, 1, "the same window never announces twice");
    await page.close();

    // ボタンが表示中の画面にしかなく、押すとページ側の関数を呼ぶ場合。
    const handlerPage = await browser.newPage();
    await handlerPage.goto(`http://portal.iwasaki.ac.jp:${port}/lms/class/10175/?handler=1`);
    await handlerPage.waitForFunction(() => typeof window.studylogSendMessage === "function");
    const handlerProbe = await handlerPage.evaluate(() => window.studylogSendMessage({ type: "studylog-bridge:attendance-probe", classId: "10175" }));
    assert.equal(handlerProbe.ok, true, handlerProbe.error);
    assert.equal(handlerProbe.result.live.entry.id, "checkEntryBtn");
    assert.equal(handlerProbe.result.live.entry.onclick, "checkAttendEntry(10175);");
    assert.equal(handlerProbe.result.entryUrl, null, "a JavaScript button has no address to read");
    assert.equal(handlerProbe.result.screen, null);
    assert.match(handlerProbe.result.handlers.checkAttendEntry, /glexa_ajax_attend_entry_check/, "the handler source reveals where the state is asked for");
    assert.ok(handlerProbe.result.handlers.openAttendanceDialog, "functions called by the handler are followed one level");
    assert.equal(handlerProbe.result.entryCheck.ok, true, "the diagnostic also asks for the reception state");
    assert.equal(handlerProbe.result.entryCheck.state, "open");
    assert.equal(handlerProbe.result.entryCheck.isAccepted, "0");

    // 受付状態の問い合わせが持ち帰る中身を、ページ側の橋渡しごと確かめる。
    const askEntry = (target) => target.evaluate(() => new Promise((resolve) => {
      const requestId = "probe-shape";
      window.addEventListener("studylog-bridge:attendance-entry-result", (event) => {
        if (event.detail?.requestId === requestId) resolve(event.detail);
      });
      window.dispatchEvent(new CustomEvent("studylog-bridge:attendance-entry-request", { detail: { requestId, classId: "10175" } }));
    }));

    const shaped = await askEntry(handlerPage);
    assert.equal(shaped.ok, true);
    assert.equal(shaped.hasData, true, "a normal answer is reported as carrying data");
    assert.equal(shaped.isAccepted, "0");

    // スタログ本体は is_accepted が無い応答でも受付フォームを開くので、こちらも受付中として扱う。
    entryPayloadOverride = {};
    const flagless = await askEntry(handlerPage);
    entryPayloadOverride = null;
    assert.equal(flagless.hasData, true, "the answer still had a data object");
    assert.equal(flagless.isAccepted, "");
    assert.equal(
      await handlerPage.evaluate((detail) => StudylogAttendanceWatchRules.classifyEntry(detail), flagless),
      "open",
      "a missing flag must be read the same way the site reads it"
    );

    // 予行演習は、本番と同じ通知経路を通しつつ、見張りの記録には検知を書かない。
    // 見張り自体を止めた画面で試すことで、通知が予行演習によるものだと確実に言える。
    const drillPage = await browser.newPage();
    await drillPage.goto(`http://portal.iwasaki.ac.jp:${port}/lms/class/10175/?watch=off`);
    await drillPage.waitForFunction(() => typeof window.studylogSendMessage === "function");
    receptionOpen = false;

    const drill = await drillPage.evaluate(() => window.studylogSendMessage({ type: "studylog-bridge:attendance-rehearse", classId: "10175" }));
    assert.equal(drill.ok, true, drill.error);
    assert.equal(drill.result.notify, true, "a rehearsal must actually deliver a notice");
    assert.equal(drill.result.scheduledToday, true, "the course is on today's timetable, so the period is known");
    assert.equal(drill.result.screenState, "quiet", "the real question is still asked, and its real answer reported");

    const drillNotices = await notices(drillPage);
    assert.equal(drillNotices.length, 1, "the drill notifies even though the reception is closed");
    assert.match(drillNotices[0].courseName, /^【予行演習】/, "the notice says plainly that this is a drill");
    assert.equal(drillNotices[0].periodLabel, "1限");

    const drillState = await watchState(drillPage);
    assert.deepEqual(Object.keys(drillState.blocks), [], "a rehearsal must not mark the real window as detected or notified");
    assert.equal(drillState.probes.at(-1).outcome, "rehearsal", "the drill is visible in the log");
    await drillPage.close();

    // 学校ごとのボタンの作りの違いを、実際のDOMで確かめる。
    const variants = await handlerPage.evaluate(() => {
      const parse = (html) => new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
      const entry = (html) => StudylogAttendanceWatchRules.entryFrom(parse(html));
      return {
        anchor: entry('<a href="/lms/attendance/1/">出席確認</a>'),
        nestedSpan: entry('<a href="/lms/attendance/2/" class="btn"><span>出席確認</span></a>'),
        divButton: entry('<div class="btn" onclick="openAttendance()">出席確認</div>'),
        inputButton: entry('<input type="button" value="出席確認">'),
        bareText: entry("<div><span>出席確認</span></div>"),
        announcementOnly: entry("<p>出席確認については担当教員へ問い合わせてください。</p>"),
        missing: entry("<p>お知らせ</p>")
      };
    });
    assert.equal(variants.anchor.via, "clickable");
    assert.equal(variants.nestedSpan.tag, "a", "the clickable ancestor is used, not the inner span");
    assert.equal(variants.nestedSpan.label, "出席確認");
    assert.equal(variants.divButton.tag, "div", "a div with onclick counts as the button");
    assert.equal(variants.divButton.via, "clickable");
    assert.equal(variants.inputButton.label, "出席確認", "the value attribute carries the label");
    assert.equal(variants.bareText.via, "text", "plain markup still yields an entry to compare");
    assert.equal(variants.bareText.tag, "span");
    assert.equal(variants.announcementOnly, null, "prose mentioning the words is not treated as the button");
    assert.equal(variants.missing, null);
    await handlerPage.close();

    console.log("attendance watch browser smoke test: ok");
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  server.close();
  process.exitCode = 1;
});
