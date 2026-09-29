const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const fixturePath = process.argv[2];
const dependencyRoot = process.argv[3];
const screenshotPath = process.argv[4];
const { chromium } = require(dependencyRoot ? path.join(dependencyRoot, "playwright") : "playwright");
assert(fixturePath, "usage: companion-smoke.cjs <snapshot.json> [dependency-root]");
const fixtureSnapshot = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const todayIso = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const todayClassIds = new Set((fixtureSnapshot.timetableSlots || []).filter((slot) => slot.date === todayIso).map((slot) => String(slot.classId)));

const root = path.resolve(__dirname, "..");
const mime = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json" };
const portalRoute = (pathname) => pathname === "/lms" || pathname.startsWith("/lms/") || pathname.startsWith("/portal/lmsinc/");
const quizSaveBodies = [];
const quizCommitBodies = [];
let browser;

const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (pathname === "/__fixture") {
    response.writeHead(200, { "Content-Type": mime[".json"] });
    fs.createReadStream(fixturePath).pipe(response);
    return;
  }
  if (pathname === "/__quiz-save-requests") {
    response.writeHead(200, { "Content-Type": mime[".json"] });
    response.end(JSON.stringify({ ajax: quizSaveBodies, commits: quizCommitBodies }));
    return;
  }
  if (pathname === "/lms/" && request.method === "POST") {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      quizSaveBodies.push(Buffer.concat(chunks).toString("utf8"));
      response.writeHead(200, { "Content-Type": mime[".json"] });
      response.end('{"ok":true}');
    });
    return;
  }
  if (pathname.startsWith("/lms/plugin/quiz/view/") && request.method === "POST") {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      quizCommitBodies.push(Buffer.concat(chunks).toString("utf8"));
      response.writeHead(200, { "Content-Type": mime[".html"] });
      response.end("<!doctype html><title>saved</title>");
    });
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
    await page.waitForSelector("#studylog-bridge-root");
    await page.waitForFunction(() => document.querySelector("#studylog-bridge-root")?.dataset.ready === "true");
    assert.equal(await page.locator("#studylog-context-title").textContent(), expectedTitle);
    assert.equal(await page.locator("body").getAttribute("data-page-mode"), "normal");
  };
  const readQuizSaves = () => page.evaluate(() => fetch("/__quiz-save-requests").then((response) => response.json()));
  const waitForQuizSaves = async (minimumCommits) => {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const requests = await readQuizSaves();
      if (requests.commits.length >= minimumCommits) return requests;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`quiz auto-save did not reach ${minimumCommits} commits`);
  };

  await visit("/lms/", "今日のブリーフ");
  const topText = await page.locator("#studylog-context-body").innerText();
  assert.doesNotMatch(topText, /欠席余裕/);
  assert.doesNotMatch(topText, /今日の科目の整理率/);
  const topCandidateIds = await page.locator("#studylog-context-body [data-context-manual]").evaluateAll((buttons) => buttons.map((button) => button.dataset.contextManual.split("::")[0]));
  assert(topCandidateIds.length > 0, "today brief should contain today's unfinished items");
  assert(topCandidateIds.every((classId) => todayClassIds.has(classId)), "today brief candidates must belong to today's courses");
  assert.equal(await page.locator('#studylog-context-body [data-checked="true"]').count(), 0);
  assert.match(topText, /重要：単位認定試験/);
  assert.equal(await page.locator(".top-timetable-table-td.studylog-unit-exam-cell").count(), 4, "exact date matches and direct calendar directory links should change calendar color");
  assert.equal(await page.locator(".studylog-unit-exam-calendar-badge").count(), 0, "calendar emphasis must not inject text that shifts the timetable layout");
  assert.equal(await page.locator('a[href="/lms/class/10019/"]').locator("..").evaluate((cell) => cell.classList.contains("studylog-unit-exam-cell")), false, "an exam title without a date must not be emphasized");
  assert.equal(await page.locator('a[href="/lms/class/10175/153362/"]').locator("..").evaluate((cell) => cell.classList.contains("studylog-unit-exam-cell")), true, "a calendar link with an exact directory id should be emphasized without inferring a date");
  assert.equal(await page.locator("th.studylog-unit-exam-day").count(), 3, "exam dates should be emphasized in the calendar header");
  await page.locator("#studylog-bridge-toggle").click();
  const completedFromBrief = await page.locator("#studylog-context-body [data-context-manual]").first().getAttribute("data-context-manual");
  await page.locator("#studylog-context-body [data-context-manual]").first().click();
  await page.waitForFunction(() => document.body.dataset.manualCompleted === "1");
  assert.equal(await page.locator("#studylog-context-body [data-context-manual]").evaluateAll((buttons, key) => buttons.filter((button) => button.dataset.contextManual === key).length, completedFromBrief), 0, "checked items must disappear from today's candidates");
  if (screenshotPath) {
    await page.screenshot({ path: screenshotPath, fullPage: true });
  }
  await visit("/lms/schedule/", "時間割");
  await visit("/portal/lmsinc/sMyPage.php", "課題状況");
  assert.match(await page.locator("#studylog-context-body").innerText(), /スタログ上の未完了/);
  const compactBefore = await page.locator("#studylog-bridge-toggle").getAttribute("title");
  await page.locator("#studylog-bridge-toggle").click();
  await page.mouse.click(5, 5);
  assert.notEqual(await page.locator("#studylog-bridge-panel").getAttribute("data-open"), "true", "companion should close from an outside click");
  await page.locator("#studylog-bridge-toggle").click();
  await page.waitForFunction(() => document.querySelector("#studylog-bridge-panel")?.dataset.open === "true");
  await page.locator("[data-context-manual]").first().click();
  await page.waitForFunction(() => document.body.dataset.manualCompleted === "1");
  assert.notEqual(await page.locator("#studylog-bridge-toggle").getAttribute("title"), compactBefore);
  assert.equal(await page.locator('[data-context-manual][data-checked="true"]').count(), 1);
  if (screenshotPath) await page.screenshot({ path: screenshotPath.replace(/(\.png)?$/, "-checked.png"), fullPage: true });
  await page.locator('[data-context-manual][data-checked="true"]').click();
  await page.waitForFunction(() => document.body.dataset.manualCompleted === "0");
  assert.equal(await page.locator('[data-context-manual][data-checked="true"]').count(), 0);
  assert.equal(await page.locator("#studylog-bridge-toggle").getAttribute("title"), compactBefore);

  await visit("/lms/class/10183/", "科目の状況");
  assert.match(await page.locator("#studylog-bridge-toggle").getAttribute("title"), /Javaプログラミング/);
  await visit("/lms/class/10183/153094/", "この授業回");
  await page.waitForFunction(() => document.querySelectorAll(".studylog-inline-task-control").length === 2);
  const inlineLayout = await page.locator(".studylog-inline-task-control").first().evaluate((element) => {
    const style = getComputedStyle(element);
    return { display: style.display, flexWrap: style.flexWrap, position: style.position };
  });
  assert.deepEqual(inlineLayout, { display: "inline-flex", flexWrap: "wrap", position: "static" }, "inline actions must follow title width without fixed positioning");
  await page.locator("[data-inline-not-required]").first().click();
  await page.waitForFunction(() => document.body.dataset.notRequired === "1");
  assert.equal(await page.locator(".studylog-inline-possible").count(), 1, "a similar pending item should be labelled without changing its status");
  assert.match(await page.locator(".studylog-inline-possible").innerText(), /対応不要の可能性/);
  await page.locator("[data-inline-manual]").last().click();
  await page.waitForFunction(() => document.body.dataset.manualCompleted === "1");
  assert.equal(await page.locator('.studylog-inline-state[data-state="manual"]').count(), 1, "manual completion must be available in the portal list");
  if (screenshotPath) await page.screenshot({ path: screenshotPath.replace(/(\.png)?$/, "-inline-controls.png"), fullPage: true });
  await page.locator('.studylog-inline-state[data-state="manual"]').locator("..").locator("[data-inline-manual]").click();
  await page.waitForFunction(() => document.body.dataset.manualCompleted === "0");
  const directoryText = await page.locator("#studylog-context-body").innerText();
  assert.doesNotMatch(directoryText, /この回の未整理/);
  assert.match(directoryText, /同じ授業のほかの回/);
  assert.doesNotMatch(directoryText, /\(H\)ダイジェスト_01補講/);
  assert.doesNotMatch(directoryText, /\(H\)ダイジェスト_02補講/);
  assert((await page.locator("#studylog-context-body [data-context-manual]").evaluateAll((buttons) => buttons.map((button) => button.dataset.contextManual.split("::")[1]))).every((directoryId) => directoryId !== "153094"));
  assert.match(directoryText, /日付表示の確認[\s\S]*7(?:月|\/)31/);
  assert.doesNotMatch(directoryText, /授業日 7月31日/);

  await visit("/lms/class/10183/990001/", "この授業回");
  const unattemptedDigestText = await page.locator("#studylog-context-body").innerText();
  assert.doesNotMatch(unattemptedDigestText, /\(D\)テスト用ダイジェスト未実施/);
  assert.doesNotMatch(unattemptedDigestText, /\(H\)テスト用ダイジェスト未実施補講/);
  assert((await page.locator("#studylog-context-body [data-context-manual]").evaluateAll((buttons) => buttons.map((button) => button.dataset.contextManual.split("::")[1]))).every((directoryId) => directoryId !== "990001"));

  await visit("/lms/class/10183/990002/", "この授業回");
  const failedDigestText = await page.locator("#studylog-context-body").innerText();
  assert.doesNotMatch(failedDigestText, /\(H\)テスト用ダイジェスト59点補講/);
  assert.doesNotMatch(failedDigestText, /\(D\)テスト用ダイジェスト59点/);
  assert((await page.locator("#studylog-context-body [data-context-manual]").evaluateAll((buttons) => buttons.map((button) => button.dataset.contextManual.split("::")[1]))).every((directoryId) => directoryId !== "990002"));

  await visit("/lms/class/10183/990003/", "この授業回");
  const passedDigestText = await page.locator("#studylog-context-body").innerText();
  assert.doesNotMatch(passedDigestText, /テスト用ダイジェスト60点補講/);
  assert((await page.locator("#studylog-context-body [data-context-manual]").evaluateAll((buttons) => buttons.map((button) => button.dataset.contextManual.split("::")[1]))).every((directoryId) => directoryId !== "990003"));

  for (const route of [
    "/lms/content/10183/quiz/123/",
    "/lms/plugin/quiz/result/",
    "/lms/content/other/?module=quiz",
    "/lms/content/other/?quizDom=1"
  ]) {
    await page.goto(`http://127.0.0.1:${port}${route}`);
    await page.waitForFunction(() => document.body.dataset.pageMode === "quiz");
    assert.equal(await page.locator("#studylog-bridge-root").count(), 0, `companion must not exist on ${route}`);
    assert.equal(await page.locator("#studylog-quiz-inspector-root").count(), 0, `quiz UI must not exist on ${route}`);
  }

  await page.goto(`http://127.0.0.1:${port}/lms/content/other/?module=quiz&studylogBridgeDebug=1`);
  await page.waitForSelector("#studylog-quiz-inspector-root");
  const quizUrlBeforeAutoSave = page.url();
  await page.evaluate(() => {
    const quizForm = document.createElement("form");
    quizForm.method = "post";
    quizForm.action = "/lms/plugin/quiz/view/67810";
    quizForm.innerHTML = [
      '<input name="action" value="original_action">',
      '<input name="quiz_id" value="67810">',
      '<input name="content_id" value="321705">',
      '<input name="plugin_id" value="quiz">',
      '<input name="page_number" value="5">',
      '<input name="prev_page_number" value="4">',
      '<input name="csrf_token" value="synthetic-csrf">',
      '<input name="question_ids[700237]" value="700237">',
      '<input type="radio" name="answers[700237]" value="synthetic-answer">',
      '<input name="question_ids[700238]" value="700238">',
      '<textarea name="answers[700238]"></textarea>'
    ].join("");
    document.body.append(quizForm);
  });

  await page.locator('input[name="answers[700237]"]').check();
  let saveRequests = await waitForQuizSaves(1);
  let automaticSave = new URLSearchParams(saveRequests.commits.at(-1));
  assert.equal(automaticSave.get("action"), "plugin_quiz_student_page_view_accept");
  assert.equal(automaticSave.get("page_number"), "5");
  assert.equal(automaticSave.get("prev_page_number"), "5");
  assert.equal(automaticSave.get("answers[700237]"), "synthetic-answer");
  assert.equal(page.url(), quizUrlBeforeAutoSave, "choice auto-save must not navigate away from the quiz page");

  const commitsBeforeTyping = saveRequests.commits.length;
  await page.locator('textarea[name="answers[700238]"]').pressSequentially("rapid text", { delay: 20 });
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.equal((await readQuizSaves()).commits.length, commitsBeforeTyping, "typing must not save while the text control remains focused");
  await page.locator('textarea[name="answers[700238]"]').press("Tab");
  saveRequests = await waitForQuizSaves(commitsBeforeTyping + 1);
  automaticSave = new URLSearchParams(saveRequests.commits.at(-1));
  assert.equal(automaticSave.get("answers[700238]"), "rapid text");
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.equal((await readQuizSaves()).commits.length, commitsBeforeTyping + 1, "leaving a changed text control must produce only one auto-save");
  assert.equal(page.url(), quizUrlBeforeAutoSave, "text auto-save must not navigate away from the quiz page");

  const inspectorAfterAutoSave = await page.locator("#studylog-quiz-inspector-root").innerText();
  assert.match(inspectorAfterAutoSave, /action=plugin_quiz_student_page_view_accept/);
  assert.doesNotMatch(inspectorAfterAutoSave, /synthetic-answer|synthetic-csrf|rapid text/);
  if (screenshotPath) await page.screenshot({ path: screenshotPath.replace(/(\.png)?$/, "-quiz-debug.png"), fullPage: true });
  await page.reload();
  await page.waitForSelector("#studylog-quiz-inspector-root");
  const restoredInspectorText = await page.locator("#studylog-quiz-inspector-root").innerText();
  assert.match(restoredInspectorText, /plugin_quiz_student_page_view_accept/, "anonymous trace should survive a same-tab navigation");
  assert.doesNotMatch(restoredInspectorText, /synthetic-answer|synthetic-csrf|rapid text/);

  await visit("/lms/", "今日のブリーフ");
  await page.evaluate(() => history.pushState({}, "", "/lms/content/10183/quiz/999/"));
  await page.waitForFunction(() => document.body.dataset.pageMode === "quiz" && !document.querySelector("#studylog-bridge-root") && !document.querySelector("#studylog-quiz-inspector-root"));
  await page.evaluate(() => history.pushState({}, "", "/lms/"));
  await page.waitForFunction(() => document.querySelector("#studylog-bridge-root") && !document.querySelector("#studylog-quiz-inspector-root"));
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
