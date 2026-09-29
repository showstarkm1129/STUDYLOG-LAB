(() => {
  "use strict";

  const SNAPSHOT_KEY = "studylogBridgeSnapshotV1";
  const PREFS_KEY = "studylogDashboardPreferencesV1";
  const AUTO_COLLECT_STATE_KEY = "studylogBridgeAutoCollectV1";
  const PORTAL_ORIGIN = "https://portal.iwasaki.ac.jp";
  const BUILTIN_PAGES = StudylogDashboardLayout.BUILTIN_PAGES;
  const SIZE_SPECS = StudylogDashboardLayout.SIZE_SPECS;
  const DASHBOARD_ICONS = StudylogDashboardIcons.ICONS;
  // Keep these home widgets reversible, but do not mount them while the home
  // screen is focused on the next action.
  const SHOW_HOME_INSIGHTS = false;
  const DAY = 86_400_000;
  const COURSE_COLORS = ["#3157d5", "#ef6b4d", "#23865f", "#7758c9", "#c18a18", "#cb4f82", "#2787a8"];
  const PERIOD_TIMES = Object.freeze({
    1: { start: "09:00", end: "09:50" },
    2: { start: "10:00", end: "10:50" },
    3: { start: "11:00", end: "11:50" },
    4: { start: "12:40", end: "13:30" },
    5: { start: "13:40", end: "14:30" },
    6: { start: "14:40", end: "15:30" }
  });
  const FEATURE_HELP = Object.freeze({
    "today-brief": { name: "今日のブリーフ", description: "今日の時間割にある科目だけを対象に、未完了の数・整理率・手動完了の数をまとめます。まず今日やることの量をつかむための入口です。" },
    "next-course": { name: "次の科目", description: "現在時刻と収集済みの時間割から、次に始まる科目を表示します。同じ科目が連続する場合はひとまとまりとして扱い、次の別科目を案内します。" },
    "next-candidates": { name: "次に確認する候補", description: "今日の科目にある未完了項目を、期限や種類などから付けた優先度順に最大3件表示します。提出期限そのものではなく、確認順の目安です。" },
    "completion-ring": { name: "課題の整理率リング", description: "選択した今日の科目にある課題のうち、スタログで完了したもの・Dで60%以上のもの・手動完了を整理済みとして集計します。「対応不要」は分母から除きます。" },
    "attendance-alert": { name: "出席アラート", description: "出席と公欠を出席扱いとして全科目の割合をまとめ、欠席できる余裕が2回以下の科目数も示します。必要出席数は総授業数の75%を生徒に有利な整数へ切り捨てます。" },
    "pending-inbox": { name: "未完了インボックス", description: "スタログで未完了の課題やテストを一か所に集めた一覧です。チェックで手動完了にでき、不要な項目は「対応不要」にして一覧と整理率から外せます。" },
    "absence-safety": { name: "欠席セーフティ残量", description: "各科目で今後あと何回休めるかを示します。必要出席数は総授業数の75%を切り捨て、公欠は出席扱い、休講は授業数に含めない前提です。" },
    "absence-simulator": { name: "欠席シミュレーター", description: "科目と今後休む回数を選ぶと、残りをすべて出席した場合の最終的な出席扱い率と、端数を生徒に有利にした必要出席数を満たすかを試算します。実際の出席記録は変更しません。" },
    "course-file": { name: "科目カルテ", description: "科目ごとの出席扱い率・欠席余裕・未整理の課題・授業回をまとめて確認できます。科目カードを押すと詳しい内容が開きます。" },
    "data-quality": { name: "データ品質", description: "科目名、出席状況、授業日など、必要なデータがどこまで取得できているかを確認します。不足がある場合は、どの機能の表示や計算に影響するかも示します。" }
  });

  // null means that every current and future course participates. An empty array
  // is intentional: the user chose to exclude every course from this metric.
  const defaultPreferences = {
    manualCompleted: [],
    notRequired: [],
    completionIncludedCourseIds: null,
    customPages: [],
    pageOrder: BUILTIN_PAGES.map((page) => page.id),
    lastPageId: "home",
    startPageId: "home",
    attendanceWatch: {
      enabled: false,
      mode: "entry",
      channels: { desktop: true, sound: true, slack: false, discord: false },
      slack: null,
      slackClientId: "",
      slackWebhookUrl: "",
      discord: null,
      discordWebhookUrl: "",
      snoozedUntil: 0
    }
  };
  const state = {
    snapshot: null,
    prefs: { ...defaultPreferences },
    view: "home",
    taskFilter: "pending",
    showArchivedAttendance: false,
    showArchivedCourses: false,
    simulatorCourseId: null,
    simulatorAbsences: 0,
    pageManageMode: false,
    layoutEditMode: false
  };
  let activeFeatureInfoButton = null;
  let draggedPageId = null;
  let draggedCardIndex = null;
  let draggedCardOffset = { x: 0, y: 0 };
  let cardDropPreview = null;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const array = (value) => Array.isArray(value) ? value : [];
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
  const normalize = (value) => String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
  const sum = (items, getter = (item) => item) => items.reduce((total, item) => total + (Number(getter(item)) || 0), 0);
  const pad = (value) => String(value).padStart(2, "0");
  const isoDay = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

  async function storageGet(keys) {
    if (globalThis.chrome?.storage?.local) return chrome.storage.local.get(keys);
    return Object.fromEntries(keys.map((key) => {
      try { return [key, JSON.parse(localStorage.getItem(key))]; }
      catch { return [key, null]; }
    }));
  }

  async function storageSet(values) {
    if (globalThis.chrome?.storage?.local) return chrome.storage.local.set(values);
    Object.entries(values).forEach(([key, value]) => localStorage.setItem(key, JSON.stringify(value)));
  }

  function normalizePreferences(storedPreferences = {}) {
    const normalized = StudylogDashboardLayout.normalizePreferences({ ...defaultPreferences, ...storedPreferences }, cardDefinitions());
    return {
      ...defaultPreferences,
      ...normalized,
      manualCompleted: array(normalized.manualCompleted),
      notRequired: array(normalized.notRequired),
      completionIncludedCourseIds: Array.isArray(normalized.completionIncludedCourseIds)
        ? normalized.completionIncludedCourseIds.map(String)
        : null,
      attendanceWatch: normalizeAttendanceWatch(normalized.attendanceWatch)
    };
  }

  function normalizeAttendanceWatch(stored = {}) {
    const channels = stored?.channels || {};
    // 連携情報が本体で、Webhook URL はそこから写す。以前の手貼りだけが残っている場合は連携情報に起こす。
    const link = StudylogSlackLinkRules.normalizeLink(stored?.slack) || StudylogSlackLinkRules.linkFromWebhookUrl(stored?.slackWebhookUrl);
    const discord = StudylogDiscordWebhookRules.normalizeLink(stored?.discord) || StudylogDiscordWebhookRules.linkFromWebhookUrl(stored?.discordWebhookUrl);
    return {
      enabled: Boolean(stored?.enabled),
      mode: stored?.mode === "screen" ? "screen" : "entry",
      channels: {
        desktop: channels.desktop !== false,
        sound: channels.sound !== false,
        slack: Boolean(channels.slack) && Boolean(link),
        discord: Boolean(channels.discord) && Boolean(discord)
      },
      slack: link,
      // Client ID は秘密ではないため、次に連携し直す時のために残す。Client Secret は保存しない。
      slackClientId: StudylogSlackLinkRules.normalizeClientId(stored?.slackClientId),
      slackWebhookUrl: link ? link.webhookUrl : "",
      discord,
      discordWebhookUrl: discord ? discord.webhookUrl : "",
      snoozedUntil: Number(stored?.snoozedUntil || 0)
    };
  }

  async function savePreferences({ rerender = false } = {}) {
    state.prefs = normalizePreferences(state.prefs);
    await storageSet({ [PREFS_KEY]: state.prefs });
    if (rerender) render();
  }

  function customPage(pageId = state.view) {
    return state.prefs.customPages.find((page) => page.id === pageId) || null;
  }

  function pageMetadata(pageId) {
    return BUILTIN_PAGES.find((page) => page.id === pageId) || customPage(pageId);
  }

  function pageExists(pageId) {
    return Boolean(pageMetadata(pageId));
  }

  function dashboardIcon(value) {
    return StudylogDashboardIcons.resolve(value);
  }

  function iconGlyph(value) {
    return dashboardIcon(value).glyph;
  }

  function renderPageIconPicker(selectedValue) {
    const selected = dashboardIcon(selectedValue);
    $("#page-settings-icon").value = selected.id;
    $("#page-icon-picker").innerHTML = DASHBOARD_ICONS.map((icon) => `<button class="icon-choice${icon.id === selected.id ? " is-selected" : ""}" data-icon-choice="${esc(icon.id)}" type="button" role="radio" aria-checked="${icon.id === selected.id}" aria-label="${esc(icon.label)}" title="${esc(icon.label)}"><span aria-hidden="true">${esc(icon.glyph)}</span></button>`).join("");
  }

  function dashboardNow() {
    const override = location.hostname === "127.0.0.1" ? new URLSearchParams(location.search).get("now") : null;
    const parsed = override ? new Date(override) : null;
    return parsed && !Number.isNaN(parsed.valueOf()) ? parsed : new Date();
  }

  function parseDate(value, fallbackYear) {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.valueOf()) ? null : new Date(value);
    const direct = new Date(value);
    if (!Number.isNaN(direct.valueOf())) return direct;
    const match = String(value).normalize("NFKC").match(/(?:(20\d{2})\D+)?(\d{1,2})\D+(\d{1,2})(?:\D+(\d{1,2})[:時](\d{1,2})?)?/);
    if (!match) return null;
    const year = Number(match[1] || fallbackYear || state.snapshot?.academicYear || new Date().getFullYear());
    const result = new Date(year, Number(match[2]) - 1, Number(match[3]), Number(match[4] || 0), Number(match[5] || 0));
    return Number.isNaN(result.valueOf()) ? null : result;
  }

  function formatDate(value, long = false) {
    const date = parseDate(value);
    if (!date) return "日付なし";
    return new Intl.DateTimeFormat("ja-JP", long
      ? { year: "numeric", month: "long", day: "numeric", weekday: "short" }
      : { month: "numeric", day: "numeric", weekday: "short" }).format(date);
  }

  function formatDateTime(value) {
    const date = parseDate(value);
    return date ? new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date) : "未取得";
  }

  function relativeDate(value) {
    const date = parseDate(value);
    if (!date) return "日付なし";
    const today = dashboardNow();
    today.setHours(0, 0, 0, 0);
    date.setHours(0, 0, 0, 0);
    const days = Math.round((date - today) / DAY);
    if (days === 0) return "今日";
    if (days === 1) return "明日";
    if (days === -1) return "昨日";
    return days > 0 ? `${days}日後` : `${Math.abs(days)}日前`;
  }

  function snapshotReady() {
    return Boolean(state.snapshot && (array(state.snapshot.courses).length || array(state.snapshot.reports).length || state.snapshot.collectedAt));
  }

  function isPortalPending(report) { return /未完了|未提出|未回答|未受験|未実施/.test(report?.status || ""); }
  function isWaiting(report) { return /未採点|採点待/.test(report?.status || ""); }
  function isPortalDone(report) { return !isPortalPending(report) && /完了|提出済|回答済|受験済/.test(report?.status || ""); }

  function reportKey(report) {
    return StudylogTaskRules.reportKey(report);
  }

  function manualSet() { return new Set(state.prefs.manualCompleted); }
  function isManualComplete(report) { return manualSet().has(reportKey(report)); }
  function isNotRequired(report) { return isPortalPending(report) && StudylogTaskRules.isNotRequired(report, state.prefs); }
  function notRequiredMatch(report) { return StudylogTaskRules.notRequiredMatch(report, array(state.snapshot?.reports), state.prefs); }
  function digestResolution(report) { return StudylogDigestRules.resolution(report, array(state.snapshot?.reports)); }
  function isDigestAutoComplete(report) { return digestResolution(report).state === "auto-complete"; }
  function isDigestDeferred(report) { return digestResolution(report).state === "deferred"; }
  function isEffectivelyDone(report) { return !isNotRequired(report) && (isPortalDone(report) || isManualComplete(report) || isDigestAutoComplete(report)); }
  function isEffectivelyPending(report) { return isPortalPending(report) && !isManualComplete(report) && !isNotRequired(report) && !isDigestAutoComplete(report) && !isDigestDeferred(report); }
  function isCountedReport(report) { return !isDigestDeferred(report) && !isNotRequired(report); }
  function isCompletionCourseIncluded(classId) {
    const selected = state.prefs.completionIncludedCourseIds;
    return !Array.isArray(selected) || selected.includes(String(classId));
  }

  function completionStats(reports) {
    const portalDone = reports.filter(isPortalDone).length;
    const digestDone = reports.filter(isDigestAutoComplete).length;
    const manualDone = reports.filter((report) => !isPortalDone(report) && isManualComplete(report) && !isDigestAutoComplete(report)).length;
    const effectiveDone = reports.filter(isEffectivelyDone).length;
    const pending = reports.filter(isEffectivelyPending).length;
    const other = reports.length - portalDone - digestDone - manualDone - pending;
    return { portalDone, digestDone, manualDone, effectiveDone, pending, other, completion: reports.length ? Math.round(effectiveDone / reports.length * 100) : 0 };
  }

  function courseMap() {
    return new Map(array(state.snapshot?.courses).map((course) => [String(course.classId), course]));
  }

  function courseName(classId) {
    return courseMap().get(String(classId))?.name || `科目 ${classId || "不明"}`;
  }

  function colorForCourse(classId) {
    const hash = [...String(classId || "0")].reduce((total, character) => total + character.charCodeAt(0), 0);
    return COURSE_COLORS[hash % COURSE_COLORS.length];
  }

  function directoryMap() {
    return new Map(array(state.snapshot?.directories).map((item) => [`${item.classId}:${item.directoryId}`, item]));
  }

  function reportContext(report) {
    const scheduled = parseDate(report.scheduledAt, report.academicYear);
    if (scheduled) return { date: scheduled, source: "scheduled", label: "実施日" };
    const directory = directoryMap().get(`${report.classId}:${report.directoryId}`);
    const lesson = parseDate(directory?.lessonDate, directory?.academicYear || report.academicYear);
    return lesson ? { date: lesson, source: "lesson", label: "授業日" } : { date: null, source: "none", label: "日付なし" };
  }

  function attendanceRate(course) {
    const attended = Number(course.attended || 0);
    const absent = Number(course.absent || 0);
    const publicAbsent = Number(course.publicAbsent || 0);
    const observed = attended + absent + publicAbsent;
    return observed ? (attended + publicAbsent) / observed : 0;
  }

  function absenceMargin(course) {
    return StudylogAttendanceRules.absenceMargin(course);
  }

  function courseEndDate(course) {
    const matches = [...String(course.period || "").normalize("NFKC").matchAll(/(?:(20\d{2})\s*[\/年.\-]\s*)?(\d{1,2})\s*[\/月.\-]\s*(\d{1,2})/g)];
    const last = matches.at(-1);
    if (last) {
      const month = Number(last[2]);
      const day = Number(last[3]);
      const academicYear = Number(course?.academicYear || state.snapshot?.academicYear || dashboardNow().getFullYear());
      const year = Number(last[1] || academicYear + (month <= 3 ? 1 : 0));
      const date = new Date(year, month - 1, day);
      if (date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day) return date;
    }
    const lessonDates = array(state.snapshot?.directories)
      .filter((item) => String(item.classId) === String(course.classId))
      .map((item) => parseDate(item.lessonDate, item.academicYear || course?.academicYear))
      .filter(Boolean)
      .sort((a, b) => b - a);
    return lessonDates[0] || null;
  }

  function isCourseArchived(course, now = dashboardNow()) {
    const endDate = courseEndDate(course);
    if (!endDate) return false;
    const archiveAt = new Date(endDate);
    archiveAt.setDate(archiveAt.getDate() + 1);
    archiveAt.setHours(0, 0, 0, 0);
    return now >= archiveAt;
  }

  function courseStats() {
    const reports = array(state.snapshot?.reports);
    const directories = array(state.snapshot?.directories);
    return array(state.snapshot?.courses).map((course) => {
      const ownReports = reports.filter((report) => String(report.classId) === String(course.classId));
      const countedReports = ownReports.filter(isCountedReport);
      const portalDone = countedReports.filter(isPortalDone).length;
      const digestDone = countedReports.filter(isDigestAutoComplete).length;
      const manualDone = countedReports.filter((report) => isPortalPending(report) && isManualComplete(report) && !isDigestAutoComplete(report)).length;
      const effectiveDone = countedReports.filter(isEffectivelyDone).length;
      const completion = countedReports.length ? effectiveDone / countedReports.length : 1;
      const attendance = attendanceRate(course);
      const hasTotalLessons = Number(course.totalLessons || 0) > 0;
      const minimumAttendanceRate = hasTotalLessons ? StudylogAttendanceRules.minimumAttendanceRate(course.totalLessons) : StudylogAttendanceRules.threshold;
      const endDate = courseEndDate(course);
      return {
        ...course,
        ownReports,
        portalDone,
        digestDone,
        manualDone,
        effectiveDone,
        reportsTotal: countedReports.length,
        pending: countedReports.filter(isEffectivelyPending).length,
        completion,
        attendance,
        minimumAttendanceRate,
        margin: absenceMargin(course),
        endDate,
        archived: isCourseArchived(course),
        directories: directories.filter((item) => String(item.classId) === String(course.classId))
      };
    });
  }

  function archiveToggle(scope, archivedCount, showing) {
    if (!archivedCount) return "";
    return `<button class="secondary-button" data-toggle-archives="${esc(scope)}" type="button">${showing ? "アーカイブを隠す" : `アーカイブ ${archivedCount}科目を表示`}</button>`;
  }

  function enrichReport(report) {
    const context = reportContext(report);
    let score = 0;
    const reasons = [];
    if (/未提出/.test(report.status || "")) { score += 20; reasons.push("未提出表示"); }
    if (/レポート|report/i.test(report.kind || "")) { score += 10; reasons.push("レポート"); }
    if (context.source === "scheduled") {
      const days = Math.ceil((context.date - dashboardNow()) / DAY);
      if (days < 0) { score += 50; reasons.unshift("実施日を経過"); }
      else if (days <= 3) { score += 35; reasons.unshift(days === 0 ? "今日の日付" : `${days}日以内`); }
    }
    const possibleNotRequired = notRequiredMatch(report);
    if (possibleNotRequired) {
      score -= possibleNotRequired.score === 1 ? 35 : 20;
      reasons.push("対応不要の項目と類似");
    }
    const level = score >= 45 ? "high" : score >= 20 ? "medium" : "low";
    return { ...report, key: reportKey(report), context, priority: { score, level, reasons }, possibleNotRequired };
  }

  function pendingTasks() {
    return array(state.snapshot?.reports)
      .filter(isEffectivelyPending)
      .map(enrichReport)
      .sort((a, b) => b.priority.score - a.priority.score || (b.context.date?.valueOf() || 0) - (a.context.date?.valueOf() || 0));
  }

  function manualTasks() {
    return array(state.snapshot?.reports).filter(isManualComplete).map(enrichReport);
  }

  function notRequiredTasks() {
    return array(state.snapshot?.reports).filter(isNotRequired).map(enrichReport);
  }

  function reportLink(report) {
    const path = String(report.href || "");
    return path.startsWith("/") ? `${PORTAL_ORIGIN}${path}` : "";
  }

  function priorityPill(priority) {
    const labels = { high: "優先度 高", medium: "優先度 中", low: "優先度 低" };
    return `<span class="priority-pill ${priority.level}">${labels[priority.level]}</span>`;
  }

  function priorityBadges(report) {
    const possible = report.possibleNotRequired
      ? `<span class="possible-not-required-pill" title="${esc(report.possibleNotRequired.reason)}">対応不要の可能性</span>`
      : "";
    return `<span class="task-badges">${priorityPill(report.priority)}${possible}</span>`;
  }

  function reportStatus(report) {
    const manual = isManualComplete(report);
    if (isNotRequired(report)) return `<span class="completion-state"><span class="not-required-pill">対応不要</span><small>候補・整理率から除外</small></span>`;
    const digest = digestResolution(report);
    if (digest.state === "auto-complete") return `<span class="completion-state"><span class="digest-pill">Dで補講完了</span><small>ダイジェスト ${Math.round(digest.scoreRate * 100)}%</small></span>`;
    if (digest.state === "deferred") return `<span class="completion-state"><span class="deferred-pill">補講は判定待ち</span><small>先にダイジェストを実施</small></span>`;
    if (isPortalDone(report)) return `<span class="completion-state"><span class="status-pill done">課題を実施して完了</span><small>${esc(report.status || "完了")}${manual ? " · 手動チェックあり" : ""}</small></span>`;
    if (manual) return `<span class="completion-state"><span class="manual-pill">手動で完了</span><small>スタログ: ${esc(report.status || "未完了")}</small></span>`;
    const type = isPortalPending(report) ? "pending" : isWaiting(report) ? "waiting" : "done";
    return `<span class="status-pill ${type}">${esc(report.status || "状態なし")}</span>`;
  }

  function renderTaskRows(items, { limit = Infinity, showPriority = true } = {}) {
    if (!items.length) return `<div class="empty-inline">該当する項目はありません。</div>`;
    return `<div class="task-list">${items.slice(0, limit).map((rawReport) => {
      const report = rawReport.priority ? rawReport : enrichReport(rawReport);
      const manual = isManualComplete(report);
      const notRequired = isNotRequired(report);
      const portalDone = isPortalDone(report);
      const digest = digestResolution(report);
      const digestDone = digest.state === "auto-complete";
      const deferred = digest.state === "deferred";
      const locked = portalDone || digestDone || deferred || notRequired;
      const link = reportLink(report);
      const contextLabel = report.context.date ? `${report.context.label} ${formatDate(report.context.date)}` : "日付なし";
      const reason = report.priority.reasons[0] ? `<span class="task-reason"> · ${esc(report.priority.reasons[0])}</span>` : "";
      const actionLabel = manual ? "チェックを外して未整理へ戻す" : notRequired ? "対応不要のため完了操作はできません" : digestDone ? "ダイジェスト6割以上のため完了" : deferred ? "ダイジェスト実施後に補講の要否を判定" : portalDone ? "スタログ上で完了済み" : "チェックして手動完了にする";
      const notRequiredLabel = notRequired ? "対応不要を解除" : "対応不要にする";
      return `<div class="task-row${manual ? " is-manual" : ""}${notRequired ? " is-not-required" : ""}">
        <button class="task-check${manual ? " is-manual" : digestDone ? " is-digest-done" : deferred ? " is-deferred" : portalDone ? " is-portal-done" : ""}" data-manual-toggle="${esc(report.key)}" type="button" aria-pressed="${manual}" aria-label="${actionLabel}" title="${actionLabel}"${locked && !manual ? " disabled" : ""}>✓</button>
        ${showPriority && !manual && !notRequired && !portalDone && !digestDone && !deferred ? priorityBadges(report) : `<span class="kind-pill">${esc(report.kind || "項目")}</span>`}
        <div class="row-main"><strong>${esc(report.title || "名称なし")}</strong><span>${esc(courseName(report.classId))} · ${esc(report.kind || "項目")} · ${esc(contextLabel)}${reason}</span></div>
        ${reportStatus(report)}
        <div class="task-actions">${!portalDone && !digestDone && !deferred ? `<button class="not-required-button${notRequired ? " is-active" : ""}" data-not-required-toggle="${esc(report.key)}" type="button">${notRequiredLabel}</button>` : ""}${link ? `<a class="secondary-button" href="${esc(link)}" target="_blank" rel="noreferrer">開く</a>` : ""}</div>
      </div>`;
    }).join("")}</div>`;
  }

  function featureInfo(key) {
    const feature = FEATURE_HELP[key];
    if (!feature) return "";
    const id = `feature-info-${key}`;
    return `<span class="feature-info" data-feature-info="${esc(key)}"><button class="feature-info-button" type="button" aria-label="${esc(feature.name)}の説明" aria-describedby="${id}">i</button><span class="feature-info-popover" id="${id}" role="tooltip"><strong>${esc(feature.name)}</strong><span>${esc(feature.description)}</span></span></span>`;
  }

  function pageHeader(eyebrow, title, subtitle, actions = "", infoKey = "") {
    return `<div class="page-header"><div><p class="eyebrow">${esc(eyebrow)}</p><div class="feature-title-row"><h1>${esc(title)}</h1>${featureInfo(infoKey)}</div><p>${esc(subtitle)}</p></div>${actions ? `<div class="header-actions">${actions}</div>` : ""}</div>`;
  }

  function cardHead(title, subtitle = "", infoKey = "", actions = "") {
    return `<div class="card-head"><div><div class="feature-title-row"><h2>${esc(title)}</h2>${featureInfo(infoKey)}</div>${subtitle ? `<p>${esc(subtitle)}</p>` : ""}</div>${actions ? `<div class="card-tools">${actions}</div>` : ""}</div>`;
  }

  function progressBar(value, type = "") {
    return `<div class="progress-track"><div class="progress-fill ${type}" style="width:${clamp(value, 0, 100)}%"></div></div>`;
  }

  function clockMinutes(value) {
    const [hour, minute] = String(value || "").split(":").map(Number);
    return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : null;
  }

  function slotStart(slot) {
    const time = PERIOD_TIMES[Number(slot?.period)]?.start;
    return slot?.date && time ? new Date(`${slot.date}T${time}:00`) : null;
  }

  function orderedTimetableSlots() {
    return array(state.snapshot?.timetableSlots)
      .filter((slot) => slot.date && PERIOD_TIMES[Number(slot.period)])
      .sort((a, b) => String(a.date).localeCompare(String(b.date)) || Number(a.period) - Number(b.period));
  }

  function unitExamDirectoryDate(directory) {
    if (directory?.lessonDate) return String(directory.lessonDate);
    const title = String(directory?.title || "").normalize("NFKC");
    const compact = title.match(/(?:^|[_\s(（])(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?=$|[_\s)）])/);
    if (!compact) return null;
    const month = Number(compact[1]);
    const day = Number(compact[2]);
    const academicYear = Number(directory?.academicYear || state.snapshot?.academicYear || dashboardNow().getFullYear());
    const year = academicYear + (month < 4 ? 1 : 0);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return isoDay(date);
  }

  function isUnitExamTitle(value) {
    const title = String(value || "").normalize("NFKC");
    return title.includes("単位認定試験") && !/(練習|模擬|対策|弱点|過去)/.test(title);
  }

  function unitExamForSlot(slot) {
    if (!slot?.date || !slot?.classId) return null;
    if (slot.directoryId) {
      return array(state.snapshot?.directories).find((directory) =>
        String(directory.classId) === String(slot.classId)
        && String(directory.directoryId) === String(slot.directoryId)
        && isUnitExamTitle(directory.title)
      ) || null;
    }
    return array(state.snapshot?.directories).find((directory) =>
      String(directory.classId) === String(slot.classId)
      && isUnitExamTitle(directory.title)
      && unitExamDirectoryDate(directory) === slot.date
    ) || null;
  }

  function unitExamBadge() {
    return '<span class="unit-exam-badge">重要：単位認定試験</span>';
  }

  function firstDifferentCourse(slots, startIndex, classId) {
    return slots.slice(startIndex).find((slot) => String(slot.classId) !== String(classId));
  }

  function nextDifferentCourse(now = dashboardNow(), { todayOnly = false } = {}) {
    const slots = orderedTimetableSlots();
    const today = isoDay(now);
    const todaysSlots = slots.filter((slot) => slot.date === today);
    const laterDateSlot = todayOnly ? null : slots.find((slot) => slot.date > today);
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const activeIndex = todaysSlots.findIndex((slot) => {
      const period = PERIOD_TIMES[Number(slot.period)];
      return clockMinutes(period.start) <= currentMinutes && currentMinutes < clockMinutes(period.end);
    });
    if (activeIndex >= 0) {
      const active = todaysSlots[activeIndex];
      const next = firstDifferentCourse(todaysSlots, activeIndex + 1, active.classId) || laterDateSlot;
      return next ? { slot: next, startsAt: slotStart(next) } : null;
    }
    const futureIndex = todaysSlots.findIndex((slot) => clockMinutes(PERIOD_TIMES[Number(slot.period)].start) > currentMinutes);
    if (futureIndex >= 0) {
      const future = todaysSlots[futureIndex];
      const previous = [...todaysSlots.slice(0, futureIndex)].reverse().find((slot) => clockMinutes(PERIOD_TIMES[Number(slot.period)].end) <= currentMinutes);
      const sameContinuation = previous && Number(future.period) === Number(previous.period) + 1 && String(future.classId) === String(previous.classId);
      if (sameContinuation) {
        const next = firstDifferentCourse(todaysSlots, futureIndex + 1, future.classId) || laterDateSlot;
        return next ? { slot: next, startsAt: slotStart(next) } : null;
      }
      return { slot: future, startsAt: slotStart(future) };
    }
    return laterDateSlot ? { slot: laterDateSlot, startsAt: slotStart(laterDateSlot) } : null;
  }

  function nextCourseTiming(nextCourse, now = dashboardNow()) {
    if (!nextCourse?.startsAt) return "開始時刻不明";
    const minutes = Math.max(0, Math.ceil((nextCourse.startsAt - now) / 60_000));
    if (nextCourse.slot.date === isoDay(now)) {
      if (minutes < 60) return `あと${minutes}分`;
      const hours = Math.floor(minutes / 60);
      return minutes % 60 ? `あと${hours}時間${minutes % 60}分` : `あと${hours}時間`;
    }
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return nextCourse.slot.date === isoDay(tomorrow) ? "明日" : formatDate(nextCourse.slot.date);
  }

  function todayCourseBlocks() {
    const today = isoDay(dashboardNow());
    const slots = orderedTimetableSlots().filter((slot) => slot.date === today);
    return slots.filter((slot, index) => index === 0 || String(slot.classId) !== String(slots[index - 1].classId));
  }

  function todayWidgetContext() {
    const today = todayCourseBlocks();
    const todayClassIds = new Set(today.map((slot) => String(slot.classId)));
    const selectedTodayClassIds = new Set([...todayClassIds].filter(isCompletionCourseIncluded));
    const reports = array(state.snapshot?.reports).filter((report) => selectedTodayClassIds.has(String(report.classId)) && isCountedReport(report));
    const tasks = pendingTasks().filter((report) => todayClassIds.has(String(report.classId)));
    return { today, todayClassIds, selectedTodayClassIds, reports, tasks, stats: completionStats(reports) };
  }

  function compactTaskRows(tasks, limit, actionable = false) {
    const rows = tasks.slice(0, limit).map((report, index) => {
      const context = reportContext(report);
      if (actionable) {
        const link = reportLink(report);
        return `<div class="widget-list-row candidate-task-row" data-report-key="${esc(report.key)}">
          <button class="task-check" data-manual-toggle="${esc(report.key)}" type="button" aria-pressed="false" aria-label="チェックして手動完了にする" title="チェックして手動完了にする">✓</button>
          <span class="kind-pill">${esc(report.kind || "項目")}</span>
          <div><strong>${esc(report.title || "名称なし")}</strong><span>${esc(courseName(report.classId))} · ${esc(context.date ? relativeDate(context.date) : "日付なし")}</span></div>
          ${reportStatus(report)}
          <div class="task-actions"><button class="not-required-button" data-not-required-toggle="${esc(report.key)}" type="button">対応不要</button>${link ? `<a class="secondary-button" href="${esc(link)}" target="_blank" rel="noreferrer">開く</a>` : ""}</div>
        </div>`;
      }
      return `<button class="widget-list-row widget-row-button" data-course-open="${esc(report.classId)}" data-report-key="${esc(report.key)}" type="button"><span class="widget-row-index">${index + 1}</span><div><strong>${esc(report.title || "名称なし")}</strong><span>${esc(courseName(report.classId))} · ${esc(context.date ? relativeDate(context.date) : "日付なし")}</span></div><span class="kind-pill">${esc(report.kind || "項目")}</span></button>`;
    }).join("");
    return `<div class="widget-list">${rows || `<div class="empty-inline">未完了の候補はありません。</div>`}</div>`;
  }

  function renderTodaySummaryWidget(size) {
    const { tasks, reports, stats } = todayWidgetContext();
    if (size === "small") return `${cardHead("今日のブリーフ", "今日の科目だけを集計", "today-brief")}<div class="widget-primary-number">${tasks.length}<small>未完了</small></div><p class="widget-footnote">整理済み ${stats.completion}% · ${stats.effectiveDone}/${reports.length}件</p>`;
    return `${cardHead("今日の科目の全体像", "未完了・整理率・手動完了", "today-brief")}<div class="metric-row three"><div class="metric"><strong>${tasks.length}</strong><span>未完了</span></div><div class="metric"><strong>${stats.completion}<small>%</small></strong><span>整理済み</span></div><div class="metric"><strong>${stats.manualDone}</strong><span>手動完了</span></div></div>`;
  }

  function renderNextCourseWidget(size) {
    const nextCourse = nextDifferentCourse(dashboardNow(), { todayOnly: true });
    if (!nextCourse) return `${cardHead("次の科目", "今日の時間割から判定", "next-course")}<div class="widget-next-course"><div><h3>次の授業はありません</h3><p>今日の授業はすべて終了しています。</p></div><span class="widget-period">--</span></div>`;
    const slot = nextCourse.slot;
    const time = PERIOD_TIMES[Number(slot.period)];
    const teacher = esc(slot.teacherName || "教師未取得");
    const detail = size === "medium" ? `<p>${esc(nextCourseTiming(nextCourse))} · ${esc(time?.start || "時刻不明")}開始 · ${teacher}${slot.room ? ` · ${esc(slot.room)}教室` : ""}</p>` : `<p>${esc(time?.start || "時刻不明")}開始 · ${teacher}</p>`;
    const exam = unitExamForSlot(slot);
    const href = slot.classId ? `${PORTAL_ORIGIN}/lms/class/${encodeURIComponent(slot.classId)}/` : "";
    return `${cardHead("次の科目", size === "medium" ? "同じ科目の連続時限は飛ばして表示" : "今日の時間割", "next-course")}<div class="widget-next-course${exam ? " is-unit-exam" : ""}"><div>${exam ? unitExamBadge() : ""}<h3>${href ? `<a class="widget-course-link" href="${esc(href)}" target="_blank" rel="noreferrer">${esc(slot.courseName || courseName(slot.classId))}</a>` : esc(slot.courseName || courseName(slot.classId))}</h3>${detail}</div><span class="widget-period">${esc(slot.period)}<small>限</small></span></div>`;
  }

  function renderCompletionWidget(size) {
    const { reports, selectedTodayClassIds, todayClassIds, stats } = todayWidgetContext();
    const details = size === "large"
      ? `<div class="widget-progress-list"><div><span>スタログ上で完了</span><strong>${stats.portalDone}</strong></div>${progressBar(reports.length ? stats.portalDone / reports.length * 100 : 0, "good")}<div><span>D判定で補講完了</span><strong>${stats.digestDone}</strong></div>${progressBar(reports.length ? stats.digestDone / reports.length * 100 : 0, "good")}<div><span>手動で完了</span><strong>${stats.manualDone}</strong></div>${progressBar(reports.length ? stats.manualDone / reports.length * 100 : 0, "warn")}</div>`
      : `<div class="widget-completion-panel"><div class="widget-completion-summary"><strong>${stats.effectiveDone}/${reports.length}件</strong><span>未完了候補 ${stats.pending}件</span></div><div class="widget-completion-actions"><button class="secondary-button" data-view-target="tasks" type="button">課題を確認</button><button class="secondary-button" data-open-completion-settings type="button">判定・科目</button></div></div>`;
    return `${cardHead("課題の整理率", `選択した今日の科目 · ${selectedTodayClassIds.size}/${todayClassIds.size}科目`, "completion-ring", size === "large" ? `<button class="secondary-button" data-open-completion-settings type="button">判定・科目を確認</button>` : "")}<div class="widget-ring-layout"><div class="ring" style="--value:${stats.completion}"><div class="ring-label"><strong>${stats.completion}%</strong><span>整理済み</span></div></div>${details}</div>`;
  }

  function renderTodayLessonsWidget() {
    const { today } = todayWidgetContext();
    const limit = 3;
    return `${cardHead("今日の授業", today.length ? `${today.length}科目` : "時間割から確認")}<div class="widget-list">${today.slice(0, limit).map((slot) => `<div class="widget-list-row"><span class="widget-row-index">${esc(slot.period)}</span><div><strong>${esc(slot.courseName || courseName(slot.classId))}</strong><span>${esc(PERIOD_TIMES[Number(slot.period)]?.start || "時刻不明")} · ${esc(slot.teacherName || "教師未取得")} · ${esc(slot.room ? `${slot.room}教室` : "教室未取得")}</span></div><span class="kind-pill">${esc(slot.period)}限</span></div>`).join("") || `<div class="empty-inline">今日の時間割はありません。</div>`}</div>`;
  }

  function renderNextCandidatesWidget(size) {
    const { tasks } = todayWidgetContext();
    return `${cardHead("次に確認する候補", "今日の科目にある未完了", "next-candidates")}${compactTaskRows(tasks, size === "large" ? 7 : 3, true)}`;
  }

  function attendanceWidgetContext() {
    const courses = courseStats().filter((course) => state.showArchivedAttendance || !course.archived).sort((a, b) => (a.margin ?? 999) - (b.margin ?? 999));
    const attended = sum(courses, (course) => Number(course.attended || 0) + Number(course.publicAbsent || 0));
    const absent = sum(courses, (course) => course.absent);
    return { courses, attended, absent, overall: attended + absent ? attended / (attended + absent) : 0 };
  }

  function renderAttendanceSummaryWidget(size) {
    const { courses, attended, absent, overall } = attendanceWidgetContext();
    const percent = Math.round(overall * 100);
    const alertCount = courses.filter((course) => course.margin !== null && course.margin <= 2).length;
    if (size === "small") return `${cardHead("出席アラート", "欠席余裕2回以下", "attendance-alert")}<div class="widget-primary-number">${alertCount}<small>科目</small></div><p class="widget-footnote">全科目の出席扱い率 ${percent}%</p>`;
    return `${cardHead("全科目の出席扱い率", `出席＋公欠 ${attended} / 欠席 ${absent}`, "attendance-alert")}<div class="widget-ring-layout"><div class="ring tint" style="--value:${percent}"><div class="ring-label"><strong>${percent}%</strong><span>現在</span></div></div><div class="widget-completion-summary"><strong>${alertCount}科目</strong><span>欠席余裕2回以下</span></div></div>`;
  }

  function renderAbsenceSimulatorWidget() {
    return `${cardHead("欠席シミュレーター", "今後休む回数を簡単計算", "absence-simulator")}${renderSimulator()}`;
  }

  function renderAbsenceSafetyWidget() {
    const { courses } = attendanceWidgetContext();
    return `${cardHead("科目別セーフティ残量", "欠席余裕が少ない科目から表示", "absence-safety")}<div class="widget-table-scroll"><table class="attendance-table"><thead><tr><th>科目</th><th>出席扱い率</th><th>欠席</th><th>欠席余裕</th></tr></thead><tbody>${courses.map((course) => `<tr data-course-open="${esc(course.classId)}"><td class="table-course">${esc(course.name)}</td><td>${Math.round(course.attendance * 100)}%</td><td>${course.absent || 0}</td><td><strong class="${course.margin < 0 ? "text-danger" : course.margin <= 2 ? "text-warn" : "text-good"}">${course.margin === null ? "—" : `${course.margin}回`}</strong></td></tr>`).join("")}</tbody></table></div>`;
  }

  function renderPendingOverviewWidget(size) {
    if (size === "large") return renderTaskInboxContent();
    const tasks = pendingTasks();
    if (size === "small") return `${cardHead("未完了インボックス", "全科目", "pending-inbox")}<div class="widget-primary-number">${tasks.length}<small>件</small></div><p class="widget-footnote">課題ページですべて確認できます</p>`;
    return `${cardHead("未完了インボックス", "全科目から優先度順", "pending-inbox")}${compactTaskRows(tasks, 3)}`;
  }

  function baseCardDefinitions() {
    return [
      { id: "today-summary", icon: "brief", name: "今日のブリーフ", description: "今日の未完了数と整理率をまとめます。", allowedSizes: ["small", "medium"], defaultSize: "medium", tone: "tint-brand", render: renderTodaySummaryWidget },
      { id: "next-course", icon: "clock", name: "次の科目", description: "今日これから始まる科目を表示します。", allowedSizes: ["small", "medium"], defaultSize: "small", tone: "hero-widget", render: renderNextCourseWidget },
      { id: "completion", icon: "progress", name: "課題の整理率", description: "今日の課題がどこまで整理済みか表示します。", allowedSizes: ["medium", "large"], defaultSize: "medium", tone: "tint-good", render: renderCompletionWidget },
      { id: "today-lessons", icon: "calendar", name: "今日の授業", description: "今日の時間割を一覧表示します。", allowedSizes: ["medium"], defaultSize: "medium", render: renderTodayLessonsWidget },
      { id: "next-candidates", icon: "priority", name: "次に確認する候補", description: "今日の未完了項目を優先度順に表示します。", allowedSizes: ["medium", "large"], defaultSize: "medium", render: renderNextCandidatesWidget },
      { id: "attendance-summary", icon: "attendance", name: "出席アラート", description: "全科目の出席率と欠席余裕を表示します。", allowedSizes: ["small", "medium"], defaultSize: "small", tone: "tint-accent", render: renderAttendanceSummaryWidget },
      { id: "absence-simulator", icon: "calculator", name: "欠席シミュレーター", description: "今後休んだ場合の最終出席率を試算します。", allowedSizes: ["large"], defaultSize: "large", render: renderAbsenceSimulatorWidget },
      { id: "absence-safety", icon: "shield", name: "科目別セーフティ残量", description: "科目ごとの欠席余裕を一覧表示します。", allowedSizes: ["medium"], defaultSize: "medium", render: renderAbsenceSafetyWidget },
      { id: "pending-overview", icon: "inbox", name: "未完了インボックス", description: "全科目の未完了課題を表示し、大サイズでは整理できます。", allowedSizes: ["small", "medium", "large"], defaultSize: "medium", render: renderPendingOverviewWidget }
    ];
  }

  function cardDefinitions() {
    return baseCardDefinitions().map((definition) => definition.id === "absence-simulator"
      ? { ...definition, allowedSizes: ["small", "medium", "large"], defaultSize: "small" }
      : definition);
  }

  function cardDefinition(cardId) {
    return cardDefinitions().find((definition) => definition.id === cardId) || null;
  }

  function qualityItems() {
    const courses = array(state.snapshot?.courses);
    const reports = array(state.snapshot?.reports);
    const directories = array(state.snapshot?.directories);
    const slots = array(state.snapshot?.timetableSlots);
    return [
      { name: "科目情報", value: courses.filter((item) => item.name && item.totalLessons !== undefined).length, total: courses.length, impact: "科目カルテと出席計算" },
      { name: "課題の状態", value: reports.filter((item) => item.status).length, total: reports.length, impact: "完了率と課題一覧" },
      { name: "授業回の日付", value: directories.filter((item) => item.lessonDate).length, total: directories.length, impact: "課題候補の日付表示" },
      { name: "時間割の日付", value: slots.filter((item) => item.date && item.period).length, total: slots.length, impact: "次の科目" },
      { name: "教室", value: slots.filter((item) => item.room).length, total: slots.length, impact: "次の科目の教室表示" }
    ].map((item) => ({ ...item, rate: item.total ? Math.round(item.value / item.total * 100) : 0 }));
  }

  function renderQuality() {
    return `<div class="quality-impact">${qualityItems().map((item) => `<div class="quality-impact-row"><span>${item.rate >= 90 ? "✓" : "!"}</span><div><strong>${esc(item.name)} ${item.rate}%</strong><small>影響: ${esc(item.impact)}</small></div><span class="${item.rate >= 90 ? "text-good" : "text-warn"}">${item.value}/${item.total}</span></div>`).join("")}</div>`;
  }

  function renderCompletionSettingsDialog() {
    const dialog = $("#completion-settings-dialog");
    const courses = courseStats().sort((a, b) => a.name.localeCompare(b.name, "ja"));
    const selectedCount = courses.filter((course) => isCompletionCourseIncluded(course.classId)).length;
    const todayClassIds = new Set(todayCourseBlocks().map((slot) => String(slot.classId)));
    const reports = array(state.snapshot?.reports).filter((report) => todayClassIds.has(String(report.classId)) && isCompletionCourseIncluded(report.classId) && isCountedReport(report));
    const stats = completionStats(reports);
    $("#completion-settings-dialog-body").innerHTML = `
      <section class="completion-rules">
        <h3>現在の集計範囲</h3>
        <p>ホームの整理率は、<strong>選択中かつ今日の時間割にある科目</strong>の課題だけを集計します。いまは ${selectedCount}/${courses.length}科目を選択中で、今日の対象は ${reports.length}件です。</p>
        <div class="metric-row completion-rule-summary"><div class="metric"><strong>${stats.portalDone}</strong><span>スタログ上で完了</span></div><div class="metric"><strong>${stats.digestDone}</strong><span>D判定で補講完了</span></div><div class="metric"><strong>${stats.manualDone}</strong><span>手動完了</span></div><div class="metric"><strong>${stats.pending}</strong><span>未完了候補</span></div></div>
      </section>
      <section class="completion-rules">
        <h3>判定ルール</h3>
        <ol class="rule-list">
          <li>状態が「完了・提出済・回答済・受験済」の項目は完了です。</li>
          <li>同じ授業回の(D)が60%以上なら、未実施の(H)補講を完了として数えます。</li>
          <li>利用者がチェックした項目は手動完了として数えます。</li>
          <li>「対応不要」と、D未実施のため判定保留中の(H)補講は分母から除外します。</li>
        </ol>
        ${stats.other ? `<p class="help-text">「未採点」など、完了・未完了のいずれにも一致しない状態が ${stats.other}件あります。分母には含まれますが、未完了候補には表示しません。</p>` : ""}
      </section>
      <section class="completion-rules">
        <div class="completion-course-heading"><div><h3>判定に含める科目</h3><p>この選択は課題の整理率だけに反映します。課題一覧・確認候補は変わりません。</p></div><div class="modal-actions"><button class="secondary-button" data-completion-selection="all" type="button">全選択</button><button class="secondary-button" data-completion-selection="none" type="button">全解除</button></div></div>
        <div class="completion-course-list">${courses.map((course) => `<label class="completion-course-option"><input data-completion-course="${esc(course.classId)}" type="checkbox"${isCompletionCourseIncluded(course.classId) ? " checked" : ""}><span><strong>${esc(course.name)}</strong><small>${course.reportsTotal}件 · 整理率 ${Math.round(course.completion * 100)}%</small></span></label>`).join("") || `<p class="help-text">選択できる科目がありません。</p>`}</div>
      </section>`;
    if (!dialog.open) dialog.showModal();
  }

  async function setCompletionCourseSelection(classId, included) {
    const allIds = array(state.snapshot?.courses).map((course) => String(course.classId));
    const selected = new Set(Array.isArray(state.prefs.completionIncludedCourseIds) ? state.prefs.completionIncludedCourseIds : allIds);
    if (included) selected.add(String(classId));
    else selected.delete(String(classId));
    state.prefs.completionIncludedCourseIds = [...selected];
    await storageSet({ [PREFS_KEY]: state.prefs });
    render();
    renderCompletionSettingsDialog();
  }

  async function setAllCompletionCourses(included) {
    state.prefs.completionIncludedCourseIds = included ? null : [];
    await storageSet({ [PREFS_KEY]: state.prefs });
    render();
    renderCompletionSettingsDialog();
  }

  function renderHome() {
    const today = todayCourseBlocks();
    const actions = `<button class="primary-button" data-view-target="tasks" type="button">課題を確認</button>`;
    return pageHeader("TODAY", new Intl.DateTimeFormat("ja-JP", { month: "long", day: "numeric", weekday: "long" }).format(dashboardNow()), `${formatDateTime(state.snapshot.collectedAt)}に更新 · 今日の${today.length}科目だけを表示`, actions) +
      `<div class="standard-grid">
        ${SHOW_HOME_INSIGHTS ? renderDashboardCard({ cardId: "today-summary", size: "medium" }) : ""}
        ${renderDashboardCard({ cardId: "next-course", size: "medium" })}
        ${SHOW_HOME_INSIGHTS ? renderDashboardCard({ cardId: "completion", size: "large" }) + renderDashboardCard({ cardId: "today-lessons", size: "medium" }) : ""}
        ${renderDashboardCard({ cardId: "next-candidates", size: "medium" })}
      </div>`;
  }

  function renderTaskInboxContent() {
    const pending = pendingTasks();
    const possibleNotRequiredCount = pending.filter((report) => report.possibleNotRequired).length;
    const manual = manualTasks();
    const notRequired = notRequiredTasks();
    const items = state.taskFilter === "manual" ? manual : state.taskFilter === "not-required" ? notRequired : pending;
    const headings = {
      pending: ["スタログ上で未完了の項目", "チェックで手動完了、対応不要で候補と整理率から除外できます"],
      manual: ["手動で完了した項目", "チェックを外すと未完了一覧へ戻ります"],
      "not-required": ["対応不要にした項目", "解除すると未完了候補へ戻ります"]
    };
    const heading = headings[state.taskFilter] || headings.pending;
    const filter = `<div class="filter-bar"><button class="filter-chip${state.taskFilter === "pending" ? " is-active" : ""}" data-task-filter="pending" type="button">未完了 ${pending.length}</button><button class="filter-chip${state.taskFilter === "manual" ? " is-active" : ""}" data-task-filter="manual" type="button">手動完了 ${manual.length}</button><button class="filter-chip${state.taskFilter === "not-required" ? " is-active" : ""}" data-task-filter="not-required" type="button">対応不要 ${notRequired.length}</button>${state.taskFilter === "pending" && possibleNotRequiredCount ? `<button class="secondary-button" data-mark-possible-not-required type="button">候補を一括で対応不要にする（${possibleNotRequiredCount}件）</button>` : ""}</div>`;
    return `${cardHead(heading[0], heading[1], "pending-inbox")}${filter}<div class="widget-task-scroll">${renderTaskRows(items, { showPriority: state.taskFilter === "pending" })}</div>`;
  }

  function renderTasks() {
    return pageHeader("TASKS", "課題を整理する", "完了・手動完了・対応不要を区別し、優先度順に確認できます") +
      `<div class="standard-grid">${renderDashboardCard({ cardId: "pending-overview", size: "large" })}</div>`;
  }

  function simulatorCourse() {
    const courses = courseStats().filter((course) => state.showArchivedAttendance || !course.archived);
    return courses.find((course) => String(course.classId) === String(state.simulatorCourseId)) || courses[0] || null;
  }

  function simulatorProjection(course, futureAbsences = state.simulatorAbsences) {
    if (!course) return null;
    const total = Number(course.totalLessons || 0);
    const attended = Number(course.attended || 0);
    const absent = Number(course.absent || 0);
    const publicAbsent = Number(course.publicAbsent || 0);
    const remaining = Math.max(0, total - attended - absent - publicAbsent);
    const selectedAbsences = clamp(Number(futureAbsences || 0), 0, remaining);
    const finalAttended = attended + publicAbsent + (remaining - selectedAbsences);
    return {
      remaining,
      selectedAbsences,
      rate: total ? finalAttended / total : 0,
      meetsRequirement: StudylogAttendanceRules.meetsRequirement(finalAttended, total)
    };
  }

  function renderSimulator() {
    const course = simulatorCourse();
    if (!course) return `<div class="empty-inline">科目データがありません。</div>`;
    const projection = simulatorProjection(course);
    const selectable = courseStats().filter((item) => state.showArchivedAttendance || !item.archived);
    return `<div class="simulator"><label>科目<select id="sim-course">${selectable.map((item) => `<option value="${esc(item.classId)}"${String(item.classId) === String(course.classId) ? " selected" : ""}>${esc(item.name)}${item.archived ? "（アーカイブ）" : ""}</option>`).join("")}</select></label><label>残り${projection.remaining}回のうち、今後休む回数</label><div class="stepper"><button data-sim-step="-1" type="button" aria-label="欠席回数を減らす">−</button><output id="sim-absence-label">${projection.selectedAbsences}回</output><button data-sim-step="1" type="button" aria-label="欠席回数を増やす">＋</button></div><input id="sim-absence" type="range" min="0" max="${projection.remaining}" value="${projection.selectedAbsences}"><div class="sim-result"><span><strong id="sim-rate">${Math.round(projection.rate * 100)}%</strong><small class="muted" style="display:block">残りをそれ以外すべて出席した場合</small></span><span id="sim-judgement" class="status-pill ${projection.meetsRequirement ? "done" : "pending"}">${projection.meetsRequirement ? "基準内" : "基準未満"}</span></div></div>`;
  }

  // Keep archived courses out of the simulator, including a previously selected one.
  function simulatorCourse() {
    const courses = courseStats().filter((course) => !course.archived);
    return courses.find((course) => String(course.classId) === String(state.simulatorCourseId)) || courses[0] || null;
  }

  function simCourseButton(course, selected) {
    const margin = course.margin === null ? "余裕 —" : course.margin < 0 ? "基準未満" : `あと${course.margin}回`;
    return `<button class="sim-course-button${selected ? " is-selected" : ""}" data-sim-course="${esc(course.classId)}" type="button" aria-pressed="${selected}"><strong>${esc(course.name)}</strong><span>${margin}</span></button>`;
  }

  function renderSimulator() {
    const course = simulatorCourse();
    if (!course) return `<div class="empty-inline">科目データがありません。</div>`;
    const projection = simulatorProjection(course);
    const courses = courseStats().sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name, "ja"));
    const current = courses.filter((item) => !item.archived);
    const archived = courses.filter((item) => item.archived);
    const absenceButtons = Array.from({ length: projection.remaining + 1 }, (_, index) => `<button class="sim-absence-button${index === projection.selectedAbsences ? " is-selected" : ""}" data-sim-absence="${index}" type="button" aria-pressed="${index === projection.selectedAbsences}">${index}</button>`).join("");
    return `<div class="simulator"><div class="sim-field"><span class="sim-label">科目を選ぶ</span><div class="sim-course-list" role="listbox" aria-label="科目を選ぶ">${current.map((item) => simCourseButton(item, String(item.classId) === String(course.classId))).join("") || `<div class="empty-inline">実施中の科目はありません。</div>`}</div>${archived.length ? `<details class="sim-archives"${course.archived ? " open" : ""}><summary>アーカイブ ${archived.length}科目</summary><div class="sim-course-list">${archived.map((item) => simCourseButton(item, String(item.classId) === String(course.classId))).join("")}</div></details>` : ""}</div><div class="sim-field"><div class="sim-choice-heading"><span>今後休む回数</span><strong>残り${projection.remaining}回</strong></div><div class="sim-absence-buttons" role="group" aria-label="今後休む回数">${absenceButtons}</div></div><div class="sim-result"><span><strong id="sim-rate">${Math.round(projection.rate * 100)}%</strong><small class="muted">残りをそれ以外すべて出席した場合</small></span><span id="sim-absence-label" class="sim-selected-count">${projection.selectedAbsences}回休む</span><span id="sim-judgement" class="status-pill ${projection.meetsRequirement ? "done" : "pending"}">${projection.meetsRequirement ? "基準内" : "基準未満"}</span></div></div>`;
  }

  function updateSimulator(value) {
    const course = simulatorCourse();
    if (!course) return;
    const projection = simulatorProjection(course, value);
    state.simulatorAbsences = projection.selectedAbsences;
    const input = $("#sim-absence");
    if (input) input.value = projection.selectedAbsences;
    $$("[data-sim-absence]").forEach((button) => {
      const selected = Number(button.dataset.simAbsence) === projection.selectedAbsences;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    const label = $("#sim-absence-label");
    if (label) label.textContent = `${projection.selectedAbsences}回休む`;
    const rate = $("#sim-rate");
    if (rate) rate.textContent = `${Math.round(projection.rate * 100)}%`;
    const judgement = $("#sim-judgement");
    if (judgement) {
      judgement.textContent = projection.meetsRequirement ? "基準内" : "基準未満";
      judgement.className = `status-pill ${projection.meetsRequirement ? "done" : "pending"}`;
    }
  }

  function renderSimulator() {
    const course = simulatorCourse();
    if (!course) return `<div class="empty-inline">科目データがありません。</div>`;
    const projection = simulatorProjection(course);
    const courses = courseStats().sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name, "ja"));
    const current = courses.filter((item) => !item.archived);
    const archived = courses.filter((item) => item.archived);
    const absenceButtons = Array.from({ length: projection.remaining + 1 }, (_, index) => `<button class="sim-absence-button${index === projection.selectedAbsences ? " is-selected" : ""}" data-sim-absence="${index}" type="button" aria-pressed="${index === projection.selectedAbsences}">${index}</button>`).join("");
    const courseButtons = (items) => items.map((item) => simCourseButton(item, String(item.classId) === String(course.classId))).join("");
    return `<div class="simulator"><div class="sim-field sim-course-picker-field"><span class="sim-label">科目を選ぶ</span><details class="sim-course-picker"><summary class="sim-course-summary"><strong>${esc(course.name)}</strong><span>${course.archived ? "アーカイブ · " : ""}${course.margin === null ? "余裕 —" : course.margin < 0 ? "基準未満" : `あと${course.margin}回`}</span></summary><div class="sim-course-menu" role="listbox" aria-label="科目を選ぶ">${current.length ? `<div class="sim-course-menu-section"><span>実施中</span>${courseButtons(current)}</div>` : ""}${archived.length ? `<div class="sim-course-menu-section"><span>アーカイブ</span>${courseButtons(archived)}</div>` : ""}</div></details></div><div class="sim-field"><div class="sim-choice-heading"><span>今後休む回数</span><strong>残り${projection.remaining}回</strong></div><div class="sim-absence-buttons" role="group" aria-label="今後休む回数">${absenceButtons}</div></div><div class="sim-result"><span><strong id="sim-rate">${Math.round(projection.rate * 100)}%</strong><small class="muted">残りをそれ以外すべて出席した場合</small></span><span id="sim-absence-label" class="sim-selected-count">${projection.selectedAbsences}回休む</span><span id="sim-judgement" class="status-pill ${projection.meetsRequirement ? "done" : "pending"}">${projection.meetsRequirement ? "基準内" : "基準未満"}</span></div></div>`;
  }

  function renderSimulator() {
    const course = simulatorCourse();
    if (!course) return `<div class="empty-inline">実施中の科目がありません。</div>`;
    const projection = simulatorProjection(course);
    const courses = courseStats().filter((item) => !item.archived).sort((a, b) => a.name.localeCompare(b.name, "ja"));
    const courseButtons = courses.map((item) => simCourseButton(item, String(item.classId) === String(course.classId))).join("");
    return `<div class="simulator"><div class="simulator-top"><div class="sim-counter-area"><div class="sim-counter" role="group" aria-label="今後休む回数"><button data-sim-step="-1" type="button" aria-label="休む回数を1減らす">−</button><input id="sim-absence" type="number" inputmode="numeric" min="0" max="${projection.remaining}" step="1" value="${projection.selectedAbsences}" aria-label="今後休む回数"><button data-sim-step="1" type="button" aria-label="休む回数を1増やす">＋</button></div><small class="sim-limit">残り${projection.remaining}回まで</small></div><details class="sim-course-picker"><summary class="sim-course-summary"><strong>${esc(course.name)}</strong><span>${course.margin === null ? "余裕 —" : course.margin < 0 ? "基準未満" : `あと${course.margin}回`}</span></summary><div class="sim-course-menu" role="listbox" aria-label="科目を選ぶ">${courses.length ? `<div class="sim-course-menu-section"><span>実施中</span>${courseButtons}</div>` : ""}</div></details></div><div class="sim-result"><span><strong id="sim-rate">${Math.round(projection.rate * 100)}%</strong><small class="muted">残りをそれ以外すべて出席した場合</small></span><span id="sim-judgement" class="status-pill ${projection.meetsRequirement ? "done" : "pending"}">${projection.meetsRequirement ? "基準内" : "基準未満"}</span></div></div>`;
  }

  function renderAbsenceSimulatorWidget() {
    return `${cardHead("欠席シミュレーター", "", "absence-simulator")}${renderSimulator()}`;
  }

  function renderAttendance() {
    const archivedCount = courseStats().filter((course) => course.archived).length;
    return pageHeader("ATTENDANCE", "出席の安全余裕", "必要出席数は75%を切り捨て・公欠は出席として計算", archiveToggle("attendance", archivedCount, state.showArchivedAttendance)) +
      `<div class="standard-grid">
        ${renderDashboardCard({ cardId: "attendance-summary", size: "medium" })}
        ${renderDashboardCard({ cardId: "absence-simulator", size: "medium" })}
        ${renderDashboardCard({ cardId: "absence-safety", size: "medium" })}
      </div>`;
  }

  function renderCourses() {
    const allCourses = courseStats();
    const archivedCount = allCourses.filter((course) => course.archived).length;
    const courses = allCourses.filter((course) => state.showArchivedCourses || !course.archived).sort((a, b) => a.name.localeCompare(b.name, "ja"));
    return pageHeader("COURSES", "科目カルテ", "出席・課題・授業回を科目ごとに確認", archiveToggle("courses", archivedCount, state.showArchivedCourses), "course-file") +
      `<div class="course-grid standard-grid">${courses.map((course) => `<button class="course-card card-size-small${course.archived ? " is-archived" : ""}" style="--course-color:${colorForCourse(course.classId)};text-align:left" data-course-open="${esc(course.classId)}" type="button"><span class="kind-pill">${course.archived ? "アーカイブ" : esc(course.term || "期間不明")}</span><h2>${esc(course.name)}</h2><p>${esc(course.period || "実施期間未取得")} · ${course.directories.length}回を収集</p><div class="course-card-metrics"><div><strong>${Math.round(course.attendance * 100)}%</strong><span>出席扱い率</span></div><div><strong>${course.pending}</strong><span>未整理</span></div></div></button>`).join("") || `<div class="empty-inline">実施中の科目はありません。必要な場合はアーカイブを表示してください。</div>`}</div>`;
  }

  function renderCourseDialog(classId) {
    const course = courseStats().find((item) => String(item.classId) === String(classId));
    if (!course) return;
    const dialog = $("#course-dialog");
    dialog.dataset.currentClassId = classId;
    $("#course-dialog-heading").innerHTML = `<p class="eyebrow">COURSE FILE</p><h2>${esc(course.name)}</h2>`;
    const displayRank = (report) => isEffectivelyPending(report) ? 0 : isDigestDeferred(report) ? 2 : 1;
    const reports = [...course.ownReports].sort((a, b) => displayRank(a) - displayRank(b));
    const recent = [...course.directories].filter((item) => item.lessonDate).sort((a, b) => String(b.lessonDate).localeCompare(String(a.lessonDate))).slice(0, 8);
    $("#course-dialog-body").innerHTML = `<div class="metric-row three"><div class="metric"><strong>${Math.round(course.attendance * 100)}%</strong><span>出席扱い率</span></div><div class="metric"><strong>${course.margin ?? "—"}</strong><span>欠席余裕</span></div><div class="metric"><strong>${course.pending}</strong><span>未整理</span></div></div><div class="bento-grid standard-grid" style="margin-top:14px"><section class="card flat card-size-large">${cardHead("課題・テスト", "完了方法とスタログ状態を表示・手動完了も変更可能")}${renderTaskRows(reports, { showPriority: false })}</section><section class="card flat card-size-medium">${cardHead("最近の授業回", `${course.directories.length}回を収集`)}<div class="timeline">${recent.map((item) => `<div class="timeline-row"><span class="timeline-date">${esc(formatDate(item.lessonDate))}</span><span class="timeline-axis"></span><div class="timeline-content"><strong>${esc(item.title || `第${item.lessonNumber || "?"}回`)}</strong></div></div>`).join("") || `<div class="empty-inline">日付つき授業回がありません。</div>`}</div></section></div>`;
    if (!dialog.open) dialog.showModal();
  }

  function renderNavigation() {
    const nav = $("#main-nav");
    nav.classList.toggle("is-organizing", state.pageManageMode);
    const entries = state.prefs.pageOrder.map((pageId) => {
      const page = pageMetadata(pageId);
      if (!page) return "";
      const isStartPage = pageId === state.prefs.startPageId;
      return `<div class="nav-entry${pageId === state.view ? " is-active" : ""}" data-page-entry="${esc(pageId)}"${state.pageManageMode ? " draggable=\"true\"" : ""}>
        ${state.pageManageMode ? `<span class="nav-drag-handle" aria-hidden="true">⠿</span>` : ""}
        <button class="nav-item${pageId === state.view ? " is-active" : ""}" data-view="${esc(pageId)}" type="button"><span class="dashboard-icon">${esc(iconGlyph(page.icon))}</span><strong>${esc(page.name)}</strong></button>
        ${state.pageManageMode ? `<span class="nav-order-buttons"><button class="nav-start-button${isStartPage ? " is-selected" : ""}" data-set-start-page type="button" aria-label="${esc(page.name)}を開始タブに設定" aria-pressed="${isStartPage}" title="開始タブに設定">★</button><button data-page-shift="-1" type="button" aria-label="${esc(page.name)}を上へ移動">↑</button><button data-page-shift="1" type="button" aria-label="${esc(page.name)}を下へ移動">↓</button></span>` : ""}
      </div>`;
    }).join("");
    nav.innerHTML = entries + (state.pageManageMode ? `<p class="nav-start-help"><span aria-hidden="true">★</span> ダッシュボードを開いた時に表示</p>` : "");
    $("#organize-pages").textContent = state.pageManageMode ? "整理を終了" : "ページを整理";
    $("#organize-pages").classList.toggle("is-active", state.pageManageMode);
  }

  function widgetSizeControls(card, definition) {
    return Object.entries(SIZE_SPECS).map(([size, spec]) => {
      const allowed = definition.allowedSizes.includes(size);
      return `<button class="widget-size-button${card.size === size ? " is-selected" : ""}" data-card-size="${size}" type="button"${allowed ? "" : " disabled"} title="${allowed ? `${spec.label}サイズに変更` : `${spec.label}サイズは使用できません`}">${spec.label}</button>`;
    }).join("");
  }

  function renderDashboardCard(card, custom = false, cardIndex = -1) {
    const definition = cardDefinition(card.cardId);
    if (!definition) return "";
    const spec = SIZE_SPECS[card.size];
    const editing = custom && state.layoutEditMode;
    const editor = editing
      ? `<div class="widget-editor"><span class="widget-drag-handle" aria-hidden="true">⠿</span><span class="widget-editor-label">${esc(spec.label)} · ${spec.columns}×${spec.rows} · 列${card.x}/行${card.y}</span><div class="widget-size-controls">${widgetSizeControls(card, definition)}</div><button class="widget-remove-button" data-remove-card="${cardIndex}" type="button" aria-label="${esc(definition.name)}を取り除く">×</button></div>`
      : "";
    const placement = custom ? ` style="grid-column:${card.x} / span ${spec.columns};grid-row:${card.y} / span ${spec.rows}" data-custom-card="${esc(card.cardId)}" data-custom-card-index="${cardIndex}"` : "";
    return `<section class="card custom-widget custom-widget-${card.size} card-size-${card.size} ${definition.tone || ""}${editing ? " is-editing" : ""}" data-dashboard-card="${esc(card.cardId)}"${placement}${editing ? ' draggable="true"' : ""}>${editor}<div class="custom-widget-content">${definition.render(card.size)}</div></section>`;
  }

  function renderCustomPage(page) {
    const actions = `${state.layoutEditMode ? `<button class="secondary-button" data-edit-custom-page="${esc(page.id)}" type="button">名前・アイコン</button>` : ""}<button class="${state.layoutEditMode ? "primary-button" : "secondary-button"}" data-toggle-layout-edit type="button">${state.layoutEditMode ? "編集を終了" : "配置を編集"}</button>${state.layoutEditMode ? `<button class="primary-button" data-open-card-catalog type="button">＋ カードを追加</button>` : ""}`;
    const empty = state.layoutEditMode
      ? `<div class="custom-page-empty"><span>＋</span><h2>最初のカードを追加する</h2><p>利用できるカードから、このページに置く情報を選びます。</p><button class="primary-button" data-open-card-catalog type="button">カードを追加</button></div>`
      : `<div class="custom-page-empty"><span>◇</span><h2>まだカードがありません</h2><p>「配置を編集」からカードを追加してください。</p><button class="primary-button" data-toggle-layout-edit type="button">配置を編集</button></div>`;
    const rows = StudylogDashboardLayout.gridRows(page.cards, state.layoutEditMode ? 6 : 1);
    const spatialCards = page.cards.map((card, index) => ({ card, index })).sort((a, b) => a.card.y - b.card.y || a.card.x - b.card.x);
    return pageHeader("CUSTOM PAGE", `${iconGlyph(page.icon)} ${page.name}`, `${page.cards.length}枚のカード · 12列グリッド`, actions) +
      (page.cards.length ? `<div class="custom-grid${state.layoutEditMode ? " is-editing" : ""}" style="--custom-grid-rows:${rows}">${spatialCards.map(({ card, index }) => renderDashboardCard(card, true, index)).join("")}</div>` : empty);
  }

  function openPageSettings(pageId = "") {
    const page = customPage(pageId);
    $("#page-settings-title").textContent = page ? "ページを編集" : "ページを追加";
    $("#page-settings-id").value = page?.id || "";
    renderPageIconPicker(page?.icon || "dashboard");
    $("#page-settings-name").value = page?.name || "";
    $("#delete-custom-page").hidden = !page;
    $("#page-settings-dialog").showModal();
    $("#page-settings-name").focus();
  }

  async function savePageSettings(event) {
    event.preventDefault();
    const pageId = $("#page-settings-id").value;
    const name = $("#page-settings-name").value.trim().slice(0, 24);
    const icon = dashboardIcon($("#page-settings-icon").value).id;
    if (!name || !icon) return toast("ページ名とアイコンを入力してください");
    const existing = customPage(pageId);
    if (existing) {
      existing.name = name;
      existing.icon = icon;
    } else {
      const id = StudylogDashboardLayout.createPageId(state.prefs.pageOrder);
      state.prefs.customPages.push({ id, name, icon, cards: [] });
      state.prefs.pageOrder.push(id);
      state.prefs.lastPageId = id;
      state.view = id;
    }
    $("#page-settings-dialog").close();
    await savePreferences({ rerender: true });
    toast(existing ? "ページ情報を変更しました" : "新しいページを追加しました");
  }

  async function deleteCustomPage() {
    const pageId = $("#page-settings-id").value;
    const page = customPage(pageId);
    if (!page || !confirm(`「${page.name}」を削除しますか？`)) return;
    state.prefs.customPages = state.prefs.customPages.filter((item) => item.id !== pageId);
    state.prefs.pageOrder = state.prefs.pageOrder.filter((id) => id !== pageId);
    if (state.prefs.startPageId === pageId) {
      state.prefs.startPageId = state.prefs.pageOrder.includes("home") ? "home" : state.prefs.pageOrder[0];
    }
    if (state.view === pageId) state.view = state.prefs.pageOrder[0] || "home";
    state.prefs.lastPageId = state.view;
    state.layoutEditMode = false;
    $("#page-settings-dialog").close();
    await savePreferences({ rerender: true });
    toast("ページを削除しました");
  }

  function openCardCatalog() {
    const page = customPage();
    if (!page) return;
    $("#card-catalog-list").innerHTML = cardDefinitions().map((definition) => {
      const placedCount = page.cards.filter((card) => card.cardId === definition.id).length;
      const sizes = definition.allowedSizes.map((size) => SIZE_SPECS[size].label).join("・");
      return `<article class="widget-catalog-item"><div class="widget-catalog-icon dashboard-icon">${esc(iconGlyph(definition.icon))}</div><div><h3>${esc(definition.name)}</h3><p>${esc(definition.description)}</p><small>配置枚数: ${placedCount}枚 · サイズ: ${esc(sizes)}</small></div><button class="primary-button" data-add-card="${esc(definition.id)}" type="button">追加</button></article>`;
    }).join("");
    $("#card-catalog-dialog").showModal();
  }

  async function addCard(cardId) {
    const page = customPage();
    const definition = cardDefinition(cardId);
    if (!page || !definition) return;
    const position = StudylogDashboardLayout.findOpenPosition(page.cards, definition.defaultSize);
    page.cards.push({ cardId, size: definition.defaultSize, ...position });
    $("#card-catalog-dialog").close();
    await savePreferences({ rerender: true });
    toast(`${definition.name}を追加しました`);
  }

  async function removeCard(cardIndex) {
    const page = customPage();
    if (!page || !page.cards[cardIndex]) return;
    page.cards.splice(cardIndex, 1);
    await savePreferences({ rerender: true });
    toast("カードをページから取り除きました");
  }

  async function changeCardSize(cardIndex, size) {
    const page = customPage();
    const card = page?.cards[cardIndex];
    const definition = cardDefinition(card?.cardId);
    if (!card || !definition?.allowedSizes.includes(size)) return;
    const candidate = { ...card, size };
    const moved = !StudylogDashboardLayout.isPositionFree(page.cards, candidate, card);
    const position = moved ? StudylogDashboardLayout.findOpenPosition(page.cards, size, candidate, card) : { x: card.x, y: card.y };
    card.size = size;
    card.x = position.x;
    card.y = position.y;
    await savePreferences({ rerender: true });
    if (moved) toast("サイズ変更後に収まる空き位置へ移動しました");
  }

  async function reorderPages(movedId, targetId) {
    state.prefs.pageOrder = StudylogDashboardLayout.reorder(state.prefs.pageOrder, movedId, targetId);
    await savePreferences();
    renderNavigation();
  }

  function shiftPage(pageId, direction) {
    const index = state.prefs.pageOrder.indexOf(pageId);
    const target = state.prefs.pageOrder[index + direction];
    if (index < 0 || !target) return;
    reorderPages(pageId, target);
  }

  async function moveCard(cardIndex, x, y) {
    const page = customPage();
    const card = page?.cards[cardIndex];
    if (!card) return;
    const candidate = { ...card, x, y };
    if (!StudylogDashboardLayout.isPositionFree(page.cards, candidate, card)) return toast("その位置には別のカードがあります");
    card.x = x;
    card.y = y;
    await savePreferences({ rerender: true });
  }

  function cardDropPosition(event, grid, card) {
    const bounds = grid.getBoundingClientRect();
    const styles = getComputedStyle(grid);
    const columnGap = Number.parseFloat(styles.columnGap) || 0;
    const rowGap = Number.parseFloat(styles.rowGap) || 0;
    return StudylogDashboardLayout.pointToGridPosition({
      pointerX: event.clientX,
      pointerY: event.clientY,
      gridLeft: bounds.left,
      gridTop: bounds.top,
      gridWidth: bounds.width,
      columnGap,
      rowGap,
      offsetX: draggedCardOffset.x,
      offsetY: draggedCardOffset.y,
      size: card.size
    });
  }

  function updateCardDropPreview(event, grid) {
    const page = customPage();
    const card = page?.cards[draggedCardIndex];
    if (!card || !cardDropPreview) return null;
    const spec = SIZE_SPECS[card.size];
    const position = cardDropPosition(event, grid, card);
    const candidate = { ...card, ...position };
    const valid = StudylogDashboardLayout.isPositionFree(page.cards, candidate, card);
    cardDropPreview.style.gridColumn = `${position.x} / span ${spec.columns}`;
    cardDropPreview.style.gridRow = `${position.y} / span ${spec.rows}`;
    cardDropPreview.classList.toggle("is-invalid", !valid);
    cardDropPreview.dataset.x = String(position.x);
    cardDropPreview.dataset.y = String(position.y);
    cardDropPreview.dataset.valid = String(valid);
    const requiredRows = Math.max(Number(grid.style.getPropertyValue("--custom-grid-rows")) || 6, position.y + spec.rows - 1);
    grid.style.setProperty("--custom-grid-rows", String(requiredRows));
    return { ...position, valid };
  }

  function createTransparentDragImage(event) {
    const element = document.createElement("span");
    element.style.cssText = "position:fixed;left:-10px;top:-10px;width:1px;height:1px;opacity:0";
    document.body.append(element);
    event.dataTransfer.setDragImage(element, 0, 0);
    setTimeout(() => element.remove());
  }

  function cleanupCardDrag() {
    draggedCardIndex = null;
    draggedCardOffset = { x: 0, y: 0 };
    cardDropPreview?.remove();
    cardDropPreview = null;
    $$(".custom-widget.is-dragging").forEach((card) => card.classList.remove("is-dragging"));
  }

  function updateTopbar() {
    $("#topbar-freshness").textContent = snapshotReady() ? `最終取得 ${formatDateTime(state.snapshot.collectedAt)}` : "データ未読込";
  }

  function render() {
    hideFeatureInfo();
    updateTopbar();
    if (!pageExists(state.view)) state.view = state.prefs.pageOrder[0] || "home";
    renderNavigation();
    const topbarPageHeader = $("#topbar-page-header");
    if (!snapshotReady()) {
      topbarPageHeader.replaceChildren();
      topbarPageHeader.hidden = true;
      $("#topbar-default").hidden = false;
      $("#app-view").replaceChildren($("#empty-state-template").content.cloneNode(true));
      return;
    }
    const renderers = { home: renderHome, tasks: renderTasks, attendance: renderAttendance, courses: renderCourses };
    const page = customPage();
    $("#app-view").innerHTML = page ? renderCustomPage(page) : (renderers[state.view] || renderHome)();
    topbarPageHeader.replaceChildren($("#app-view .page-header"));
    topbarPageHeader.hidden = false;
    $("#topbar-default").hidden = true;
  }

  async function setView(view) {
    if (!pageExists(view)) return;
    state.view = view;
    state.prefs.lastPageId = view;
    state.layoutEditMode = false;
    $(".sidebar").classList.remove("is-open");
    window.scrollTo({ top: 0, behavior: "smooth" });
    render();
    await savePreferences();
  }

  async function setStartPage(pageId) {
    if (!pageExists(pageId)) return;
    state.prefs.startPageId = pageId;
    await savePreferences();
    renderNavigation();
    toast(`「${pageMetadata(pageId).name}」を開始タブに設定しました`);
  }

  const ATTENDANCE_WATCH_STATE_KEY = "studylogAttendanceWatchStateV1";

  function attendanceWatchPrefs() {
    return normalizeAttendanceWatch(state.prefs.attendanceWatch);
  }

  async function requestExtensionPermission(query) {
    if (!globalThis.chrome?.permissions) return false;
    try {
      if (await chrome.permissions.contains(query)) return true;
      return await chrome.permissions.request(query);
    } catch {
      return false;
    }
  }

  function attendanceProbeSummary(probes) {
    if (!probes.length) return `<p class="help-text">まだ確認の記録がありません。授業の時間帯にスタログを開いておくと、ここに判定の履歴が残ります。</p>`;
    const rows = probes.slice(-12).reverse().map((probe) => {
      const time = new Date(probe.at).toLocaleString("ja-JP", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
      const outcome = probe.outcome === "open" ? "受付を検知" : probe.outcome === "error" ? "取得に失敗" : "変化なし";
      const detail = [
        probe.mode === "screen" ? `画面判定: ${probe.screenState}` : "科目トップのみ",
        probe.signatureChanged ? "ボタンの表示が変化" : probe.hasBaseline === false ? "基準を記録" : "",
        probe.detail || ""
      ].filter(Boolean).join(" / ");
      return `<tr><td>${esc(time)}</td><td>${esc(courseNameById(probe.classId))}</td><td>${esc(outcome)}</td><td>${esc(detail)}</td></tr>`;
    }).join("");
    return `<div class="attendance-probe-log"><table><thead><tr><th>時刻</th><th>科目</th><th>結果</th><th>内訳</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function courseNameById(classId) {
    return array(state.snapshot?.courses).find((course) => String(course.classId) === String(classId))?.name || `科目 ${classId ?? "不明"}`;
  }

  const ATTENDANCE_REASON_LABELS = Object.freeze({
    disabled: "見張りは無効です",
    snoozed: "今日は停止中です",
    "no-lesson": "今日の時間割に授業がありません。トップ画面で時間割を取得すると対象になります",
    "outside-window": "いまは授業時間外です",
    detected: "この授業回では受付を検知済みです",
    completed: "この授業回では出席済みを確認しました",
    failed: "取得に続けて失敗したため、この授業回は諦めました",
    budget: "この授業回の確認回数が上限に達しました",
    backoff: "取得に失敗したため、少し待っています",
    interval: "確認したばかりです。次の確認を待っています"
  });

  const clockLabel = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

  function attendanceWatchStatus(watchState) {
    const settings = attendanceWatchPrefs();
    const blocks = watchState?.blocks || {};
    const slots = array(state.snapshot?.timetableSlots);
    const now = dashboardNow();
    const plan = StudylogAttendanceWatchRules.plan({
      now: now.valueOf(),
      slots,
      periodTimes: PERIOD_TIMES,
      state: blocks,
      enabled: settings.enabled,
      snoozedUntil: settings.snoozedUntil
    });
    const todaysBlocks = StudylogAttendanceWatchRules.blocks(slots, PERIOD_TIMES, isoDay(now));
    const minutes = now.getHours() * 60 + now.getMinutes();
    const upcoming = todaysBlocks.find((block) => StudylogAttendanceWatchRules.windowFor(block).openMinutes > minutes);
    const active = plan.block || todaysBlocks.find((block) => {
      const bounds = StudylogAttendanceWatchRules.windowFor(block);
      return bounds.openMinutes <= minutes && minutes < bounds.closeMinutes;
    });
    const lastChecked = active ? blocks[active.key]?.lastCheckedAt : null;
    return {
      watching: plan.watching,
      headline: plan.watching ? "監視中です" : ATTENDANCE_REASON_LABELS[plan.reason] || "監視していません",
      nextLine: upcoming
        ? `次の監視は ${clockLabel(StudylogAttendanceWatchRules.windowFor(upcoming).openMinutes)} から（${esc(courseNameById(upcoming.classId))}）`
        : todaysBlocks.length ? "今日の授業はすべて終わりました" : "",
      lastLine: lastChecked ? `最後の確認: ${new Date(lastChecked).toLocaleTimeString("ja-JP")}` : "",
      todaysBlocks
    };
  }

  function attendanceProbeCourses() {
    const todayIds = new Set(array(state.snapshot?.timetableSlots).filter((slot) => slot.date === isoDay(dashboardNow())).map((slot) => String(slot.classId)));
    const courses = array(state.snapshot?.courses).map((course) => ({ classId: String(course.classId), name: course.name }));
    return [...courses].sort((left, right) => Number(todayIds.has(right.classId)) - Number(todayIds.has(left.classId)));
  }

  // スタログのタブの中で読み取る。拡張機能ページから直接取得すると、
  // セッションが乗らずログイン画面が返るため、実際の監視と同じ文脈に合わせる。
  async function askStudylogTab(type, classId) {
    if (!globalThis.chrome?.tabs) throw new Error("この画面からは確認できません。");
    const tabs = await chrome.tabs.query({ url: `${PORTAL_ORIGIN}/lms/*` });
    if (!tabs.length) throw new Error("スタログのタブを開いてから、もう一度押してください。");
    const preferred = tabs.find((tab) => tab.url?.includes(`/lms/class/${classId}/`)) || tabs[0];
    const response = await chrome.tabs.sendMessage(preferred.id, { type, classId });
    if (!response) throw new Error("スタログのタブが応答しません。ページを再読み込みしてください。");
    if (!response.ok) throw new Error(response.error || "確認できませんでした。");
    return response.result;
  }

  const probeAttendanceNow = (classId) => askStudylogTab("studylog-bridge:attendance-probe", classId);

  const ATTENDANCE_SCREEN_LABELS = Object.freeze({
    open: "受付中と判定しました",
    closed: "受付していないと判定しました",
    done: "出席済みと判定しました",
    unknown: "判定できませんでした（この状態では通知しません）"
  });

  const ATTENDANCE_ENTRY_LABELS = Object.freeze({
    open: "受付中です。いま出席確認に応じられます。",
    quiet: "受付はありません（新たな出席確認は行われていません）。",
    unknown: "スタログが想定と違う応答を返しました。この状態では通知しません。"
  });

  function attendanceEntryLine(entryCheck) {
    if (!entryCheck) return "";
    if (!entryCheck.ok) return `<p><strong>受付状態: 確認できませんでした</strong>（${esc(entryCheck.error || "")}）</p>`;
    return `<p><strong>受付状態: ${esc(ATTENDANCE_ENTRY_LABELS[entryCheck.state] || entryCheck.state)}</strong><br><span class="help-text">スタログが返した値: <code>is_accepted = ${esc(entryCheck.isAccepted || "(なし)")}</code></span></p>`;
  }

  function attendanceFactsText(facts) {
    if (!facts) return "見ていません";
    if (facts.loginScreen) return `ログイン画面が返りました（${facts.url}）`;
    if (!facts.entry) return `出席確認ボタンが見つかりません（タイトル: ${facts.title || "不明"}）`;
    const how = { clickable: "押せる要素", text: "文字列のみ", "text-ancestor": "文字列から親要素をたどって特定" }[facts.entry.via] || facts.entry.via;
    return `出席確認ボタンを見つけました（<${facts.entry.tag}> / ${facts.entry.label} / ${how}）`;
  }

  function attendanceSourceLine(label, facts) {
    if (!facts) return "";
    return `<li>${esc(label)}: ${esc(attendanceFactsText(facts))}</li>`;
  }

  // 結果を一度に渡せるようにする。氏名や学籍番号が混じりうる画面の抜粋だけは含めない。
  function attendanceProbeReport(result) {
    const entry = result.entryCheck;
    const lines = [
      `科目ID: ${result.classId || "(不明)"}`,
      entry?.ok
        ? `受付状態: ${ATTENDANCE_ENTRY_LABELS[entry.state] || entry.state} (is_accepted = ${entry.isAccepted || "(なし)"})`
        : `受付状態: 確認できませんでした (${entry?.error || "理由不明"})`,
      `表示中の画面: ${attendanceFactsText(result.live)}`,
      `取得したHTML: ${attendanceFactsText(result.fetched)}`,
      `出席確認の画面: ${result.screen ? ATTENDANCE_SCREEN_LABELS[result.screen.state] || result.screen.state : "開いていません"}`,
      `リンク先: ${result.entryUrl || "(リンクではありません)"}`,
      `署名: ${result.signature || "(なし)"}`
    ];
    const handlers = Object.entries(result.handlers || {});
    if (handlers.length) lines.push("", ...handlers.map(([name, source]) => `// ${name}\n${source}`));
    return lines.join("\n");
  }

  function attendanceReportBlock(result) {
    return `<pre class="attendance-probe-report" hidden>${esc(attendanceProbeReport(result))}</pre>`
      + `<button class="quiet-button" id="attendance-handler-copy" type="button">この結果をまとめてコピー</button>`;
  }

  function attendanceProbeMarkup(result, watchState) {
    const usingEntry = attendanceWatchPrefs().mode !== "screen";
    const entryOk = Boolean(result.entryCheck?.ok);
    const foundLive = Boolean(result.live?.entry);
    const foundFetched = Boolean(result.fetched?.entry);
    const foundButton = foundLive || foundFetched;

    // 見出しは、見張りが実際に使っている判定材料を映す。
    // 「受付状態を問い合わせる」方式では、ボタンが見つかるかどうかは判定に関係しない。
    const headline = usingEntry
      ? entryOk ? "受付状態を確認できました。" : "受付状態を確認できませんでした。"
      : foundButton ? "出席確認ボタンを見つけました。" : "出席確認ボタンが見つかりませんでした。";

    const notes = [];
    if (!foundButton) {
      notes.push(usingEntry
        ? "出席確認ボタンは見つかりませんでしたが、いまの方式では判定に使っていないので支障ありません。ボタンはJavaScriptで描かれるため、その科目のトップページを開いているタブがないと見つかりません。"
        : result.fetched?.loginScreen
          ? "スタログにログインし直してから、もう一度お試しください。"
          : "画面の作りが想定と違う可能性があります。科目トップを開いた状態でもう一度押すと、表示中の画面からも探します。");
    }
    if (foundLive && !foundFetched) {
      notes.push("ボタンは表示中の画面にだけありました。JavaScriptで描かれているため、取得したHTMLの中には存在しません。");
    }
    if (usingEntry && result.fetched?.loginScreen) {
      notes.push("HTMLの取得ではログイン画面が返っています。受付状態の問い合わせはページ側の通信を使うため、こちらは影響を受けません。");
    }

    const handlers = Object.entries(result.handlers || {});
    const handlerText = handlers.map(([name, source]) => `// ${name}\n${source}`).join("\n\n");
    const handlerBlock = handlers.length
      ? `<details class="attendance-probe-excerpt"><summary>ボタンが呼ぶ処理（${handlers.length}件）</summary><p class="help-text">受付状態をどこへ問い合わせているかを知るための、ページ側の関数の中身です。実行はしていません。</p><pre class="attendance-handler-source">${esc(handlerText)}</pre></details>`
      : "";
    const excerpt = result.screen?.excerpt
      ? `<details class="attendance-probe-excerpt"><summary>読み取った画面の文言を見る</summary><p class="help-text">氏名や学籍番号が含まれる場合があります。共有する前に必ず確認してください。この抜粋は保存もコピーもされません。</p><p>${esc(result.screen.excerpt)}</p></details>`
      : "";
    const buttonDetail = foundButton
      ? `<p class="help-text">出席確認の画面: ${result.screen ? esc(ATTENDANCE_SCREEN_LABELS[result.screen.state] || result.screen.state) : "開けません（ボタンがリンクではなくJavaScriptで動くため）"}</p>
        <p class="help-text">リンク先: <code>${esc(result.entryUrl || "(リンクではありません)")}</code></p>
        <p class="help-text">署名: <code>${esc(result.signature)}</code></p>`
      : "";
    const survey = `<details class="attendance-probe-excerpt"${usingEntry ? "" : " open"}><summary>ボタンの探索結果${usingEntry ? "（参考）" : ""}</summary><ul class="attendance-probe-sources">${attendanceSourceLine("表示中の画面", result.live)}${attendanceSourceLine("取得したHTML", result.fetched)}</ul>${buttonDetail}</details>`;

    return `<div class="attendance-probe-result">
      <p><strong>${esc(headline)}</strong></p>
      ${attendanceEntryLine(result.entryCheck)}
      ${notes.map((line) => `<p class="help-text">${esc(line)}</p>`).join("")}
      ${survey}
      ${attendanceReportBlock(result)}
      ${handlerBlock}
      ${excerpt}
    </div>`;
  }

  async function renderAttendanceWatchDialog({ probeMarkup = "" } = {}) {
    const settings = attendanceWatchPrefs();
    const stored = await storageGet([ATTENDANCE_WATCH_STATE_KEY]);
    const watchState = stored[ATTENDANCE_WATCH_STATE_KEY] || {};
    const probes = array(watchState.probes);
    const snoozed = settings.snoozedUntil > dashboardNow().valueOf();
    const lessons = todayTimetableBlocks();
    const status = attendanceWatchStatus(watchState);
    const courses = attendanceProbeCourses();
    $("#attendance-watch-body").innerHTML = `
      <p class="help-text">今日の時間割にある科目だけを、授業開始5分前から終了10分後までのあいだ確認します。それ以外の時間は通信しません。受付を検知しても、出席の登録は行いません。必ず自分でスタログの「出席確認」を押してください。</p>
      <section class="attendance-watch-status" data-watching="${status.watching}">
        <strong>${esc(status.headline)}</strong>
        ${status.nextLine ? `<span>${status.nextLine}</span>` : ""}
        ${status.lastLine ? `<span>${esc(status.lastLine)}</span>` : ""}
      </section>
      <section class="attendance-watch-section">
        <h3>いま何が見えているか試す</h3>
        <p class="help-text">監視の時間帯でなくても、選んだ科目を1回だけ読み取って結果を表示します。「受付中として予行演習」を押すと、受付状態の問い合わせは本物のまま、その答えを受付中とみなして本番と同じ通知を一度だけ流します。どちらも表示と通知だけで、コードの送信も受付ボタンの押下も行いません。</p>
        <div class="attendance-probe-controls">
          <select id="attendance-probe-course">${courses.map((course) => `<option value="${esc(course.classId)}">${esc(course.name)}</option>`).join("") || `<option value="">科目が未取得です</option>`}</select>
          <button class="secondary-button" id="attendance-probe-run" type="button" ${courses.length ? "" : "disabled"}>今すぐ確認</button>
          <button class="secondary-button" id="attendance-rehearse" type="button" ${courses.length ? "" : "disabled"}>受付中として予行演習</button>
          <button class="quiet-button" id="attendance-notify-test" type="button">通知を試す</button>
        </div>
        <div id="attendance-probe-output">${probeMarkup}</div>
      </section>
      <section class="attendance-watch-section">
        <label class="attendance-watch-toggle"><input type="checkbox" data-attendance-watch="enabled" ${settings.enabled ? "checked" : ""}><span><strong>見張りを有効にする</strong><small>スタログのタブを開いているあいだだけ動きます。${esc(lessons)}</small></span></label>
      </section>
      <section class="attendance-watch-section">
        <h3>確認のしかた</h3>
        <label class="attendance-watch-toggle"><input type="radio" name="attendance-watch-mode" data-attendance-mode="entry" ${settings.mode !== "screen" ? "checked" : ""}><span><strong>受付状態を問い合わせる（推奨）</strong><small>出席確認ボタンを押した時にスタログ自身が行う問い合わせと同じものを送り、返ってきた受付状態だけを読みます。受付フォームは開かず、コードの送信も受付の確定も行いません。</small></span></label>
        <label class="attendance-watch-toggle"><input type="radio" name="attendance-watch-mode" data-attendance-mode="screen" ${settings.mode === "screen" ? "checked" : ""}><span><strong>出席確認の画面まで開いて読む</strong><small>出席確認ボタンが普通のリンクである場合だけ使えます。この学校のボタンはリンクではないため機能しません。</small></span></label>
      </section>
      <section class="attendance-watch-section">
        <h3>知らせかた</h3>
        <label class="attendance-watch-toggle"><input type="checkbox" data-attendance-watch="desktop" ${settings.channels.desktop ? "checked" : ""}><span><strong>デスクトップ通知</strong><small>Chromeの通知を出します。通知を押すとその科目のページを開きます。</small></span></label>
        <label class="attendance-watch-toggle"><input type="checkbox" data-attendance-watch="sound" ${settings.channels.sound ? "checked" : ""}><span><strong>音を鳴らす</strong><small>3回まで繰り返します。その科目のページを自分で開いている場合は鳴らしません。</small></span></label>
        <label class="attendance-watch-toggle"><input type="checkbox" data-attendance-watch="slack" ${settings.channels.slack ? "checked" : ""} ${settings.slack ? "" : "disabled"}><span><strong>Slackへ送る</strong><small>スマートフォンで受け取れます。送るのは科目名・時限・リンクだけです。${settings.slack ? "" : "下の「通知の送り先」で先に連携してください。"}</small></span></label>
        <label class="attendance-watch-toggle"><input type="checkbox" data-attendance-watch="discord" ${settings.channels.discord ? "checked" : ""} ${settings.discord ? "" : "disabled"}><span><strong>Discordへ送る</strong><small>Slackと同じ内容を、Discordのチャンネルへも送ります。${settings.discord ? "" : "下の「通知の送り先」で先に連携してください。"}</small></span></label>
      </section>
      <section class="attendance-watch-section">
        <h3>通知の送り先</h3>
        ${connectionSummaryMarkup()}
      </section>
      <div class="modal-actions">
        <button class="secondary-button" id="attendance-watch-snooze" type="button">${snoozed ? "今日の停止を解除" : "今日はもう鳴らさない"}</button>
        <button class="quiet-button" id="attendance-watch-copy" type="button">記録をコピー</button>
      </div>
      <section class="attendance-watch-section">
        <h3>確認の記録</h3>
        ${attendanceProbeSummary(probes)}
      </section>`;
  }

  // ログインを伴う外部サービスの連携は、ほかの設定と地続きにせず「サービス連携」のダイアログにまとめる。
  // 新しいサービスを足す時は、この配列に1件加えれば、一覧・状態表示・本文がそろう。
  function connectionServices() {
    const settings = attendanceWatchPrefs();
    return [
      {
        id: "slack",
        name: "Slack",
        summary: "出席確認の受付を検知した時に、選んだチャンネルへ知らせを送ります。スマートフォンで受け取れます。",
        linked: Boolean(settings.slack),
        state: settings.slack ? StudylogSlackLinkRules.summarizeLink(settings.slack) : "未連携",
        body: () => slackLinkMarkup(settings)
      },
      {
        id: "discord",
        name: "Discord",
        summary: "同じ知らせを Discord のチャンネルへ送ります。Webhook のURLを貼るだけで、アプリの作成もログインの許可も要りません。",
        linked: Boolean(settings.discord),
        state: settings.discord ? StudylogDiscordWebhookRules.summarizeLink(settings.discord) : "未連携",
        body: () => discordLinkMarkup(settings)
      }
    ];
  }

  function connectionService(serviceId) {
    return connectionServices().find((service) => service.id === serviceId) || null;
  }

  // 出席確認の見張りの画面には、状態と入口だけを置く。手順は連携のダイアログ側にある。
  function connectionSummaryMarkup() {
    return connectionServices().map((service) => `
      <div class="connection-summary" data-service="${esc(service.id)}" data-linked="${service.linked}">
        <div>
          <strong>${esc(service.linked ? `${service.name}: ${service.state} に送ります` : `${service.name}: まだ連携していません`)}</strong>
          <span>${service.linked ? "送り先の変更や解除も、連携の画面から行えます。" : esc(`連携すると「${service.name}へ送る」を選べるようになります。`)}</span>
        </div>
        <button class="secondary-button" data-open-connection="${esc(service.id)}" type="button">${service.linked ? "連携を管理" : "連携をはじめる"}</button>
      </div>`).join("");
  }

  function renderConnectionDialog() {
    const services = connectionServices();
    $("#connection-dialog-body").innerHTML = `
      <p class="help-text">ログインが必要な外部サービスとの連携を、ここでまとめて行います。連携しなくても、ほかの機能はそのまま使えます。</p>
      ${services.map((service) => `
        <section class="connection-card" data-service="${esc(service.id)}">
          <div class="connection-card-head">
            <div>
              <strong>${esc(service.name)}</strong>
              <span>${esc(service.summary)}</span>
            </div>
            <span class="connection-state" data-linked="${service.linked}">${esc(service.state)}</span>
          </div>
          ${service.body()}
          <p class="help-text connection-progress" data-service="${esc(service.id)}" role="status" aria-live="polite"></p>
        </section>`).join("")}`;
  }

  function openConnectionDialog() {
    renderConnectionDialog();
    $("#connection-dialog").showModal();
  }

  // 戻り先は拡張機能IDから決まる。利用者が考える余地はなく、Slackアプリ側にもこの値をそのまま登録する。
  function slackRedirectUri() {
    try {
      return globalThis.chrome?.identity?.getRedirectURL ? chrome.identity.getRedirectURL() : "";
    } catch {
      return "";
    }
  }

  function slackLinkMarkup(settings) {
    const link = settings.slack;
    if (link) {
      const linkedAt = link.linkedAt ? new Date(link.linkedAt).toLocaleString("ja-JP") : "";
      return `
        <div class="connection-status" data-linked="true">
          <strong>${esc(StudylogSlackLinkRules.summarizeLink(link))} につながっています</strong>
          <span>送り先: ${esc(StudylogSlackLinkRules.maskWebhookUrl(link.webhookUrl))}</span>
          ${linkedAt ? `<span>連携した日時: ${esc(linkedAt)}</span>` : ""}
        </div>
        <div class="connection-actions">
          <button class="secondary-button" id="slack-send-test" type="button">Slackへテスト送信</button>
          ${link.configurationUrl ? `<a class="quiet-button" href="${esc(link.configurationUrl)}" target="_blank" rel="noreferrer noopener">Slack側の設定を開く</a>` : ""}
          <button class="quiet-button" id="slack-unlink" type="button">連携を解除</button>
        </div>
        <p class="help-text">送り先のURLはこの端末の <code>chrome.storage.local</code> にだけ保存されます。これを知っている相手は同じチャンネルへ書き込めるため、他人と共有しないでください。</p>`;
    }
    const redirectUri = slackRedirectUri();
    return `
      <p class="help-text">出席確認の知らせを、スマートフォンのSlackアプリで受け取れるようにします。この拡張機能に入力するのは Client ID と Client Secret の2つだけで、あとは自動です。Slack側の画面は英語ですが、押す場所は下に書いてあります。</p>
      <ol class="connection-steps">
        <li>
          <strong>どのワークスペースに送るかを決める</strong>
          <p class="help-text">学校のワークスペースは、管理者の承認がないとアプリを追加できないことがあります（その場合、あとの許可画面が申請フォームに変わり、承認されるまで進めません）。すぐ使いたい場合は、自分専用の無料ワークスペースを作るのが確実です。スマートフォンのSlackアプリから同じアカウントでそのワークスペースに入っておけば、通知はそちらに届きます。</p>
          <div class="connection-actions">
            <button class="secondary-button" id="slack-create-workspace" type="button">自分専用のワークスペースを作る</button>
          </div>
          <p class="help-text">学校のワークスペースをそのまま使う場合は、この手順は不要です。</p>
        </li>
        <li>
          <strong>Slackアプリを作る</strong>
          <p class="help-text">必要な権限（incoming-webhook）と戻り先URLを入れた状態で、Slackの作成画面を開きます。</p>
          <div class="connection-actions">
            <button class="secondary-button" id="slack-create-app" type="button">Slackアプリの作成画面を開く</button>
            <button class="quiet-button" id="slack-copy-manifest" type="button">設定内容(JSON)をコピー</button>
          </div>
          <details class="connection-note">
            <summary>Slack側で何が表示され、どこを押すか</summary>
            <ol class="connection-substeps">
              <li>ログインを求められたら、<strong>通知を受け取りたいワークスペース</strong>のアカウントでログインします。別のワークスペースに入ってしまった場合は、画面の「Sign in to another workspace」から入り直せます。</li>
              <li>ログイン後にチャンネル一覧（いつものSlackの画面）へ飛ばされた場合は、<strong>もう一度この「Slackアプリの作成画面を開く」を押します</strong>。今度は開発者向けの画面が開きます。</li>
              <li>「Create an app」の内容が入力済みで開くので、<strong>Pick a workspace to develop your app in</strong> で送り先のワークスペースを選び、<strong>Next</strong> →（設定内容の確認）→ <strong>Create</strong> を押します。</li>
              <li>作成できると、そのアプリの「Basic Information」の画面に移ります。次の手順で使うのはこの画面です。</li>
            </ol>
            <p class="help-text">事前入力の画面が開かない場合は、「設定内容(JSON)をコピー」を押し、Slackの Your Apps → Create New App → <strong>From an app manifest</strong> で貼り付けても同じ結果になります。</p>
          </details>
          <p class="help-text">手で作る場合に登録する戻り先URL: <code>${esc(redirectUri || "（拡張機能として読み込むと表示されます）")}</code> <button class="quiet-button" id="slack-copy-redirect" type="button" ${redirectUri ? "" : "disabled"}>コピー</button></p>
        </li>
        <li>
          <strong>Client ID と Client Secret を貼る</strong>
          <p class="help-text">作ったアプリの「Basic Information」を下にたどると「App Credentials」があり、その中の Client ID と Client Secret です。Client Secret は初め隠れているので「Show」を押すと出ます。Signing Secret や Verification Token ではありません。</p>
          <div class="connection-actions">
            <button class="quiet-button" id="slack-open-apps" type="button">作ったアプリの一覧を開く</button>
          </div>
          <label class="attendance-watch-field"><span>Client ID</span><input type="text" id="slack-client-id" autocomplete="off" spellcheck="false" placeholder="1234567890123.1234567890123" value="${esc(settings.slackClientId)}"></label>
          <label class="attendance-watch-field"><span>Client Secret（この端末にも保存しません）</span><input type="password" id="slack-client-secret" autocomplete="off" spellcheck="false" placeholder="連携の時に一度だけ使います"></label>
        </li>
        <li>
          <strong>連携する</strong>
          <p class="help-text">押すとSlackの許可画面（Where should <em>アプリ名</em> post?）が開きます。知らせを受け取るチャンネルを選んで <strong>Allow</strong> を押せば、送り先の取得・権限の追加・テスト送信まで自動で終わります。</p>
          <button class="primary-button" id="slack-link-start" type="button">Slackと連携する</button>
        </li>
      </ol>
      <details class="connection-note">
        <summary>うまくいかない時</summary>
        <ul class="connection-substeps">
          <li><strong>ログインしたら普段のSlack画面に飛ばされた。</strong> 開発者向けの画面とチャンネルの画面は別物です。「Slackアプリの作成画面を開く」をもう一度押してください。</li>
          <li><strong>選びたいワークスペースが出てこない。</strong> そのワークスペースにログインできていません。Slackの画面右上から「Sign in to another workspace」で入り直してください。</li>
          <li><strong>許可画面に「承認を依頼」などと出て進めない。</strong> そのワークスペースが管理者の承認を必須にしています。承認を待つか、手順1で自分専用のワークスペースを作ってやり直してください。</li>
          <li><strong>Client Secret が見つからない。</strong> 「Basic Information」→「App Credentials」の中にあります。「OAuth &amp; Permissions」の画面ではありません。</li>
        </ul>
      </details>
      <details class="connection-manual">
        <summary>すでに Incoming Webhook のURLを持っている場合</summary>
        <label class="attendance-watch-field"><span>Slack Incoming Webhook のURL</span><input type="url" id="attendance-slack-url" placeholder="https://hooks.slack.com/services/..."></label>
        <p class="help-text">貼り付けると、権限の追加と「Slackへ送る」の有効化まで自動で行います。</p>
      </details>`;
  }

  function showConnectionProgress(serviceId, message) {
    const element = $(`.connection-progress[data-service="${serviceId}"]`);
    if (element) element.textContent = message;
  }

  const showSlackProgress = (message) => showConnectionProgress("slack", message);

  function setSlackLinkBusy(busy) {
    ["#slack-link-start", "#slack-create-app", "#slack-send-test", "#slack-unlink"].forEach((selector) => {
      const button = $(selector);
      if (button) button.disabled = busy;
    });
  }

  function openExternalPage(url) {
    window.open(url, "_blank", "noreferrer,noopener");
  }

  function openSlackAppCreatePage() {
    const manifest = StudylogSlackLinkRules.buildAppManifest({ redirectUri: slackRedirectUri() });
    openExternalPage(StudylogSlackLinkRules.buildAppCreateUrl(manifest));
  }

  async function copySlackAppManifest() {
    const manifest = StudylogSlackLinkRules.buildAppManifest({ redirectUri: slackRedirectUri() });
    try {
      await navigator.clipboard.writeText(JSON.stringify(manifest, null, 2));
      toast("Slackアプリの設定内容をコピーしました");
    } catch {
      toast("コピーできませんでした");
    }
  }

  async function copySlackRedirectUri() {
    try {
      await navigator.clipboard.writeText(slackRedirectUri());
      toast("戻り先URLをコピーしました");
    } catch {
      toast("コピーできませんでした");
    }
  }

  // 連携が成立した時に共通で行う後始末。ここまで来れば、あとは本番の通知と同じ経路になる。
  async function completeSlackLink(link, { announce = true, clientId } = {}) {
    const settings = attendanceWatchPrefs();
    await updateAttendanceWatch({
      slack: link,
      slackClientId: clientId === undefined ? settings.slackClientId : clientId,
      slackWebhookUrl: link.webhookUrl,
      channels: { ...settings.channels, slack: true }
    });
    if (announce) {
      const delivered = await sendSlackTestMessage(link.webhookUrl);
      showSlackProgress(delivered ? "連携できました。Slackにテストの1通を送っています。" : "連携しましたが、テスト送信は届きませんでした。Slack側でアプリが削除されていないか確認してください。");
      toast(delivered ? `Slackとつながりました（${StudylogSlackLinkRules.summarizeLink(link)}）` : "連携しましたが、テスト送信は届きませんでした");
      return;
    }
    toast(`Slackとつながりました（${StudylogSlackLinkRules.summarizeLink(link)}）`);
  }

  async function sendSlackTestMessage(webhookUrl) {
    try {
      const delivered = await chrome.runtime.sendMessage({
        type: "studylog-bridge:attendance-test",
        channels: ["slack"],
        courseName: "通知のテスト",
        periodLabel: "テスト",
        url: `${PORTAL_ORIGIN}/lms/`,
        slackWebhookUrl: webhookUrl
      });
      return Boolean(delivered?.slack);
    } catch {
      return false;
    }
  }

  // 権限 → 許可画面 → 送り先の受け取り → 保存 → テスト送信、までを一続きで行う。
  async function startSlackLink() {
    const idInput = $("#slack-client-id");
    const secretInput = $("#slack-client-secret");
    const credentials = StudylogSlackLinkRules.validateCredentials({ clientId: idInput?.value, clientSecret: secretInput?.value });
    if (!credentials.ok) {
      showSlackProgress(credentials.message);
      (credentials.field === "clientId" ? idInput : secretInput)?.focus();
      return;
    }
    const redirectUri = slackRedirectUri();
    if (!redirectUri) {
      showSlackProgress("拡張機能として読み込まれていないため、連携できません。");
      return;
    }
    setSlackLinkBusy(true);
    try {
      showSlackProgress("Slackへの接続の許可を求めています…");
      if (!(await requestExtensionPermission({ origins: StudylogSlackLinkRules.REQUIRED_ORIGINS }))) {
        showSlackProgress("Slackへの接続が許可されなかったため、連携できません。");
        return;
      }
      showSlackProgress("Slackの許可画面を開いています。通知を受け取るチャンネルを選んでください…");
      const state = crypto.randomUUID();
      let redirected = "";
      try {
        redirected = await chrome.identity.launchWebAuthFlow({
          url: StudylogSlackLinkRules.buildAuthorizeUrl({ clientId: credentials.clientId, redirectUri, state }),
          interactive: true
        });
      } catch {
        redirected = "";
      }
      const auth = StudylogSlackLinkRules.parseAuthRedirect(redirected, state);
      if (!auth.ok) {
        showSlackProgress(auth.message);
        return;
      }
      showSlackProgress("送り先を受け取っています…");
      const response = await fetch(StudylogSlackLinkRules.TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
        body: StudylogSlackLinkRules.buildTokenExchangeBody({ ...credentials, code: auth.code, redirectUri })
      });
      const payload = await response.json().catch(() => null);
      const result = StudylogSlackLinkRules.parseTokenResponse(payload);
      if (!result.ok) {
        showSlackProgress(result.message);
        return;
      }
      // Client Secret はここで役目を終える。保存も再表示もしない。
      if (secretInput) secretInput.value = "";
      await completeSlackLink(result.link, { clientId: credentials.clientId });
    } catch (error) {
      showSlackProgress(`連携できませんでした: ${error.message}`);
    } finally {
      setSlackLinkBusy(false);
    }
  }

  async function unlinkSlack() {
    const settings = attendanceWatchPrefs();
    const link = settings.slack;
    setSlackLinkBusy(true);
    try {
      // Slack側の許可も取り消す。取り消せなくても、端末に残る送り先は必ず消す。
      if (link?.accessToken) {
        try {
          await fetch(StudylogSlackLinkRules.REVOKE_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
            body: StudylogSlackLinkRules.buildRevokeBody(link.accessToken)
          });
        } catch {
          // 取り消せない場合も、この下で端末側の記録は消す。
        }
      }
      await updateAttendanceWatch({ slack: null, slackWebhookUrl: "", channels: { ...settings.channels, slack: false } });
      try {
        await chrome.permissions.remove({ origins: StudylogSlackLinkRules.REQUIRED_ORIGINS });
      } catch {
        // 権限を返せなくても連携の解除は済んでいる。
      }
      showSlackProgress("連携を解除しました。Slackへは送らなくなります。");
      toast("Slack連携を解除しました");
    } finally {
      setSlackLinkBusy(false);
    }
  }

  async function useManualSlackWebhook(rawUrl) {
    const link = StudylogSlackLinkRules.linkFromWebhookUrl(rawUrl);
    if (!link) {
      showSlackProgress("SlackのWebhook URLは https://hooks.slack.com/services/ で始まる必要があります。");
      return;
    }
    if (!(await requestExtensionPermission({ origins: StudylogSlackLinkRules.REQUIRED_ORIGINS }))) {
      showSlackProgress("Slackへの接続が許可されなかったため、連携できません。");
      return;
    }
    await completeSlackLink(link);
  }

  // Discord は Webhook だけで完結する。アプリの作成もログインの許可も要らないため、手順はURLを貼る1つだけ。
  function discordLinkMarkup(settings) {
    const rules = StudylogDiscordWebhookRules;
    const link = settings.discord;
    if (link) {
      const linkedAt = link.linkedAt ? new Date(link.linkedAt).toLocaleString("ja-JP") : "";
      return `
        <div class="connection-status" data-linked="true">
          <strong>${esc(rules.summarizeLink(link))} に送ります</strong>
          <span>送り先: ${esc(rules.maskWebhookUrl(link.webhookUrl))}</span>
          ${linkedAt ? `<span>連携した日時: ${esc(linkedAt)}</span>` : ""}
        </div>
        <div class="connection-actions">
          <button class="secondary-button" id="discord-send-test" type="button">Discordへテスト送信</button>
          <button class="quiet-button" id="discord-unlink" type="button">連携を解除</button>
        </div>
        <p class="help-text">このURLはこの端末の <code>chrome.storage.local</code> にだけ保存されます。URLを知っている相手は同じチャンネルへ書き込めるため、他人と共有しないでください。解除してもDiscord側のウェブフックは残るので、完全に消す場合はチャンネル設定から削除してください。</p>`;
    }
    return `
      <ol class="connection-steps">
        <li>
          <strong>通知を受け取るチャンネルを決める</strong>
          <p class="help-text">自分だけのサーバーを作ってそこへ送るのが手軽です（Discordの左端の「＋」→「オリジナルの作成」）。ほかの人のサーバーでは、ウェブフックを作るのに「ウェブフックの管理」権限が要ります。</p>
          <div class="connection-actions">
            <button class="secondary-button" id="discord-open-app" type="button">Discordを開く</button>
          </div>
        </li>
        <li>
          <strong>ウェブフックを作ってURLをコピーする</strong>
          <p class="help-text">チャンネル名の横の歯車（チャンネルの編集）→「連携サービス」→「ウェブフックを作成」→ 名前を決めて「ウェブフックURLをコピー」を押します。</p>
          <div class="connection-actions">
            <button class="quiet-button" id="discord-open-guide" type="button">Discordの説明を開く</button>
          </div>
        </li>
        <li>
          <strong>URLを貼る</strong>
          <p class="help-text">貼って押すと、権限の追加・送り先の確認・「Discordへ送る」の有効化・テスト送信まで自動で行います。</p>
          <label class="attendance-watch-field"><span>ウェブフックURL</span><input type="url" id="discord-webhook-url" autocomplete="off" spellcheck="false" placeholder="https://discord.com/api/webhooks/..."></label>
          <button class="primary-button" id="discord-link-start" type="button">Discordと連携する</button>
        </li>
      </ol>
      <details class="connection-note">
        <summary>うまくいかない時</summary>
        <ul class="connection-substeps">
          <li><strong>「連携サービス」が見当たらない。</strong> サーバー名の横の「サーバー設定」→「連携サービス」→「ウェブフック」からも作れます。</li>
          <li><strong>ウェブフックを作れない。</strong> そのサーバーで権限がありません。自分のサーバーを作るか、管理者に作ってもらったURLを貼ってください。</li>
          <li><strong>URLの形が違うと言われる。</strong> 「ウェブフックURLをコピー」で得られる <code>https://discord.com/api/webhooks/…</code> の形が必要です。チャンネルのリンク（<code>/channels/…</code>）ではありません。</li>
          <li><strong>スマートフォンに通知が来ない。</strong> Discordアプリでそのチャンネルの通知がミュートになっていないか確認してください。</li>
        </ul>
      </details>`;
  }

  function setDiscordLinkBusy(busy) {
    ["#discord-link-start", "#discord-send-test", "#discord-unlink"].forEach((selector) => {
      const button = $(selector);
      if (button) button.disabled = busy;
    });
  }

  const showDiscordProgress = (message) => showConnectionProgress("discord", message);

  async function sendDiscordTestMessage(webhookUrl) {
    try {
      const delivered = await chrome.runtime.sendMessage({
        type: "studylog-bridge:attendance-test",
        channels: ["discord"],
        courseName: "通知のテスト",
        periodLabel: "テスト",
        url: `${PORTAL_ORIGIN}/lms/`,
        discordWebhookUrl: webhookUrl
      });
      return Boolean(delivered?.discord);
    } catch {
      return false;
    }
  }

  // 権限 → 送り先の確認 → 保存 → テスト送信。貼り付けたあとは押す操作が1回で済む。
  async function linkDiscord() {
    const rules = StudylogDiscordWebhookRules;
    const input = $("#discord-webhook-url");
    const webhookUrl = rules.normalizeWebhookUrl(input?.value);
    if (!webhookUrl) {
      showDiscordProgress("ウェブフックURLは https://discord.com/api/webhooks/ で始まる形です。「ウェブフックURLをコピー」で得られるものを貼ってください。");
      input?.focus();
      return;
    }
    setDiscordLinkBusy(true);
    try {
      showDiscordProgress("Discordへの接続の許可を求めています…");
      if (!(await requestExtensionPermission({ origins: rules.REQUIRED_ORIGINS }))) {
        showDiscordProgress("Discordへの接続が許可されなかったため、連携できません。");
        return;
      }
      showDiscordProgress("送り先を確かめています…");
      let payload = null;
      try {
        const response = await fetch(rules.buildInspectUrl(webhookUrl));
        payload = await response.json();
      } catch {
        showDiscordProgress("Discordへつながりませんでした。通信を確かめて、もう一度お試しください。");
        return;
      }
      const parsed = rules.parseWebhookInfo(payload);
      if (!parsed.ok) {
        showDiscordProgress(parsed.message);
        return;
      }
      const link = rules.linkFromWebhookUrl(webhookUrl, { info: parsed.info });
      const settings = attendanceWatchPrefs();
      await updateAttendanceWatch({
        discord: link,
        discordWebhookUrl: link.webhookUrl,
        channels: { ...settings.channels, discord: true }
      });
      const delivered = await sendDiscordTestMessage(link.webhookUrl);
      showDiscordProgress(delivered ? "連携できました。Discordにテストの1通を送っています。" : "連携しましたが、テスト送信は届きませんでした。ウェブフックが消えていないか確認してください。");
      toast(delivered ? `Discordとつながりました（${rules.summarizeLink(link)}）` : "連携しましたが、テスト送信は届きませんでした");
    } catch (error) {
      showDiscordProgress(`連携できませんでした: ${error.message}`);
    } finally {
      setDiscordLinkBusy(false);
    }
  }

  async function unlinkDiscord() {
    const settings = attendanceWatchPrefs();
    setDiscordLinkBusy(true);
    try {
      // ウェブフックはDiscord側に残す。消すかどうかは持ち主が決めることなので、こちらからは削除しない。
      await updateAttendanceWatch({ discord: null, discordWebhookUrl: "", channels: { ...settings.channels, discord: false } });
      try {
        await chrome.permissions.remove({ origins: StudylogDiscordWebhookRules.REQUIRED_ORIGINS });
      } catch {
        // 権限を返せなくても連携の解除は済んでいる。
      }
      showDiscordProgress("連携を解除しました。Discordへは送らなくなります。ウェブフック自体はDiscord側に残っています。");
      toast("Discord連携を解除しました");
    } finally {
      setDiscordLinkBusy(false);
    }
  }

  function todayTimetableBlocks() {
    const slots = array(state.snapshot?.timetableSlots).filter((slot) => slot.date === isoDay(dashboardNow()));
    if (!slots.length) return "今日の時間割は収集できていないため、いまは何も確認しません。";
    const names = [...new Set(slots.map((slot) => courseNameById(slot.classId)))];
    return `今日の対象: ${names.join("、")}`;
  }

  async function updateAttendanceWatch(changes) {
    state.prefs.attendanceWatch = normalizeAttendanceWatch({ ...attendanceWatchPrefs(), ...changes });
    await savePreferences();
    await renderAttendanceWatchDialog();
    if ($("#connection-dialog").open) renderConnectionDialog();
  }

  async function handleAttendanceWatchChange(event) {
    const field = event.target.dataset?.attendanceWatch;
    const mode = event.target.dataset?.attendanceMode;
    if (event.target.id === "attendance-slack-url") {
      const url = event.target.value.trim();
      if (url) await useManualSlackWebhook(url);
      return;
    }
    // 連携の入力欄は、連携が成立した時にまとめて保存する。ここで保存すると画面を描き直してしまい、
    // 入力中の値が消える。
    if (["slack-client-id", "slack-client-secret", "discord-webhook-url"].includes(event.target.id)) return;
    if (mode) {
      await updateAttendanceWatch({ mode });
      return;
    }
    if (!field) return;
    const settings = attendanceWatchPrefs();
    const checked = event.target.checked;
    if (field === "enabled") {
      await updateAttendanceWatch({ enabled: checked });
      toast(checked ? "出席確認の見張りを有効にしました" : "出席確認の見張りを止めました");
      return;
    }
    if (field === "desktop" && checked && !(await requestExtensionPermission({ permissions: ["notifications"] }))) {
      toast("通知の権限が許可されなかったため、デスクトップ通知は使えません");
      await renderAttendanceWatchDialog();
      return;
    }
    if ((field === "slack" || field === "discord") && checked) {
      const name = field === "slack" ? "Slack" : "Discord";
      const origins = field === "slack" ? StudylogSlackLinkRules.REQUIRED_ORIGINS : StudylogDiscordWebhookRules.REQUIRED_ORIGINS;
      if (!settings[field]) {
        toast(`先に「通知の送り先」で${name}と連携してください`);
        await renderAttendanceWatchDialog();
        return;
      }
      if (!(await requestExtensionPermission({ origins }))) {
        toast(`${name}への送信が許可されなかったため、この通知は使えません`);
        await renderAttendanceWatchDialog();
        return;
      }
      await updateAttendanceWatch({ channels: { ...settings.channels, [field]: true } });
      return;
    }
    await updateAttendanceWatch({ channels: { ...settings.channels, [field]: checked } });
  }

  async function runAttendanceProbe() {
    const select = $("#attendance-probe-course");
    const classId = select?.value;
    if (!classId) return;
    const button = $("#attendance-probe-run");
    const output = $("#attendance-probe-output");
    button.disabled = true;
    output.innerHTML = `<p class="help-text">確認しています…</p>`;
    try {
      const stored = await storageGet([ATTENDANCE_WATCH_STATE_KEY]);
      const result = await probeAttendanceNow(classId);
      output.innerHTML = attendanceProbeMarkup(result, stored[ATTENDANCE_WATCH_STATE_KEY] || {});
    } catch (error) {
      output.innerHTML = `<p class="help-text">確認できませんでした: ${esc(error.message)}</p>`;
    } finally {
      button.disabled = false;
    }
  }

  const REHEARSAL_CHANNEL_LABELS = Object.freeze({ badge: "アイコンの印", desktop: "デスクトップ通知", sound: "音", slack: "Slack", discord: "Discord" });

  async function rehearseAttendance() {
    const classId = $("#attendance-probe-course")?.value;
    if (!classId) return;
    const button = $("#attendance-rehearse");
    const output = $("#attendance-probe-output");
    button.disabled = true;
    output.innerHTML = `<p class="help-text">予行演習をしています…</p>`;
    try {
      const result = await askStudylogTab("studylog-bridge:attendance-rehearse", classId);
      const notes = [];
      if (!result.notify) {
        notes.push(result.reason === "snoozed"
          ? "今日は停止中なので、何も鳴らしませんでした。停止を解除してからもう一度お試しください。"
          : "通知は送られませんでした。");
      } else {
        notes.push(`送った通知: ${result.channels.map((name) => REHEARSAL_CHANNEL_LABELS[name] || name).join("、")}`);
      }
      if (result.viewingClass) notes.push("その科目のページを自分で開いているため、本番と同じ扱いで音とデスクトップ通知は止めています。別のタブを前に出してから試すと、鳴りかたを確認できます。");
      if (!result.scheduledToday) notes.push("この科目は今日の時間割にないため、時限は「予行演習」と表示されます。本番では時限が入ります。");
      notes.push(`受付状態の問い合わせ自体は成功しています（is_accepted = ${result.isAccepted || "(なし)"} → ${ATTENDANCE_ENTRY_LABELS[result.screenState] || result.screenState}）。予行演習では、この結果に関わらず受付中として通知します。`);
      output.innerHTML = `<div class="attendance-probe-result"><p><strong>予行演習を行いました（${esc(result.courseName)}）。</strong></p>${notes.map((line) => `<p class="help-text">${esc(line)}</p>`).join("")}<p class="help-text">見張りの記録には検知として残していないので、このあと本物の受付が来ても通常どおり通知します。</p></div>`;
    } catch (error) {
      output.innerHTML = `<p class="help-text">予行演習できませんでした: ${esc(error.message)}</p>`;
    } finally {
      button.disabled = false;
    }
  }

  async function testAttendanceNotification() {
    const settings = attendanceWatchPrefs();
    const channels = ["badge"];
    if (settings.channels.desktop) channels.push("desktop");
    if (settings.channels.sound) channels.push("sound");
    if (settings.channels.slack) channels.push("slack");
    if (settings.channels.discord) channels.push("discord");
    try {
      const delivered = await chrome.runtime.sendMessage({
        type: "studylog-bridge:attendance-test",
        channels,
        courseName: "通知のテスト",
        periodLabel: "テスト",
        url: `${PORTAL_ORIGIN}/lms/`,
        slackWebhookUrl: settings.slackWebhookUrl,
        discordWebhookUrl: settings.discordWebhookUrl
      });
      const failed = channels.filter((channel) => delivered && delivered[channel] === false);
      toast(failed.length ? `届かなかった通知: ${failed.join("、")}` : "通知を送りました");
    } catch {
      toast("通知を送れませんでした");
    }
  }

  async function openAttendanceWatchDialog() {
    await renderAttendanceWatchDialog();
    $("#attendance-watch-dialog").showModal();
  }

  // 記録は相談のために外へ貼られることがあるため、送り先と権限の証書は伏せる。
  function attendanceWatchSettingsForLog() {
    const settings = attendanceWatchPrefs();
    return {
      ...settings,
      slackWebhookUrl: StudylogSlackLinkRules.maskWebhookUrl(settings.slackWebhookUrl),
      slack: settings.slack
        ? { channelName: settings.slack.channelName, teamName: settings.slack.teamName, linkedAt: settings.slack.linkedAt }
        : null,
      discordWebhookUrl: StudylogDiscordWebhookRules.maskWebhookUrl(settings.discordWebhookUrl),
      discord: settings.discord
        ? { name: settings.discord.name, webhookId: settings.discord.webhookId, linkedAt: settings.discord.linkedAt }
        : null
    };
  }

  async function copyAttendanceProbeLog() {
    const stored = await storageGet([ATTENDANCE_WATCH_STATE_KEY]);
    const payload = JSON.stringify({
      schemaVersion: 1,
      copiedAt: new Date().toISOString(),
      settings: attendanceWatchSettingsForLog(),
      probes: array(stored[ATTENDANCE_WATCH_STATE_KEY]?.probes)
    }, null, 2);
    try {
      await navigator.clipboard.writeText(payload);
      toast("確認の記録をコピーしました");
    } catch {
      toast("コピーできませんでした");
    }
  }

  async function toggleAttendanceSnooze() {
    const settings = attendanceWatchPrefs();
    const endOfDay = dashboardNow();
    endOfDay.setHours(23, 59, 59, 999);
    await updateAttendanceWatch({ snoozedUntil: settings.snoozedUntil > dashboardNow().valueOf() ? 0 : endOfDay.valueOf() });
  }

  function toast(message) {
    const element = document.createElement("div");
    element.className = "toast";
    element.textContent = message;
    $("#toast-region").append(element);
    setTimeout(() => element.remove(), 2800);
  }

  function updateDataSummary() {
    const summary = $("#data-summary");
    const quality = $("#data-quality");
    if (!snapshotReady()) {
      summary.textContent = "まだデータを読み込んでいません。";
      quality.innerHTML = `<div class="empty-inline">データ読み込み後に確認できます。</div>`;
      return;
    }
    const freshness = state.snapshot.freshnessByYear?.[state.snapshot.academicYear] || {};
    const freshnessLine = freshness.reportStatusCollectedAt || freshness.subjectStatusCollectedAt || freshness.lastDirectoryCollectedAt
      ? `<br>課題状態 ${esc(formatDateTime(freshness.reportStatusCollectedAt))} · 出席状態 ${esc(formatDateTime(freshness.subjectStatusCollectedAt))} · 科目回 ${esc(formatDateTime(freshness.lastDirectoryCollectedAt || freshness.directoriesCollectedAt))}`
      : "";
    summary.innerHTML = `<strong>最終取得: ${esc(formatDateTime(state.snapshot.collectedAt))}</strong><br>${array(state.snapshot.courses).length}科目 · ${array(state.snapshot.reports).length}課題/テスト · ${array(state.snapshot.directories).length}授業回 · 手動完了${state.prefs.manualCompleted.length}件 · 対応不要${state.prefs.notRequired.length}件${freshnessLine}<br>スキーマ v${esc(state.snapshot.schemaVersion || "?")} · 履修年度 ${esc(state.snapshot.academicYear || "不明")}`;
    quality.innerHTML = renderQuality();
  }

  function download(filename, type, content) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importJson(file) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed || !Array.isArray(parsed.courses) || !Array.isArray(parsed.reports)) throw new Error("Studylog Bridge形式ではありません");
      state.snapshot = parsed;
      if (Array.isArray(parsed.studylogDashboard?.manualCompleted)) {
        state.prefs.manualCompleted = parsed.studylogDashboard.manualCompleted;
      }
      if (Array.isArray(parsed.studylogDashboard?.notRequired)) {
        state.prefs.notRequired = parsed.studylogDashboard.notRequired;
      }
      if (Object.hasOwn(parsed.studylogDashboard || {}, "completionIncludedCourseIds")) {
        state.prefs.completionIncludedCourseIds = Array.isArray(parsed.studylogDashboard.completionIncludedCourseIds)
          ? parsed.studylogDashboard.completionIncludedCourseIds.map(String)
          : null;
      }
      if (Array.isArray(parsed.studylogDashboard?.customPages)) state.prefs.customPages = parsed.studylogDashboard.customPages;
      if (Array.isArray(parsed.studylogDashboard?.pageOrder)) state.prefs.pageOrder = parsed.studylogDashboard.pageOrder;
      if (parsed.studylogDashboard?.lastPageId) state.prefs.lastPageId = String(parsed.studylogDashboard.lastPageId);
      if (parsed.studylogDashboard?.startPageId) state.prefs.startPageId = String(parsed.studylogDashboard.startPageId);
      state.prefs = normalizePreferences(state.prefs);
      if (!pageExists(state.view)) state.view = state.prefs.startPageId;
      await storageSet({ [SNAPSHOT_KEY]: parsed, [PREFS_KEY]: state.prefs, [AUTO_COLLECT_STATE_KEY]: null });
      updateDataSummary();
      $("#data-dialog").close();
      render();
      toast(`${parsed.courses.length}科目のデータを読み込みました`);
    } catch (error) { toast(`読み込み失敗: ${error.message}`); }
  }

  async function toggleManual(key) {
    const completed = new Set(state.prefs.manualCompleted);
    const notRequired = new Set(state.prefs.notRequired);
    const wasCompleted = completed.has(key);
    if (wasCompleted) completed.delete(key);
    else {
      completed.add(key);
      notRequired.delete(key);
    }
    state.prefs.manualCompleted = [...completed];
    state.prefs.notRequired = [...notRequired];
    await storageSet({ [PREFS_KEY]: state.prefs });
    render();
    const dialog = $("#course-dialog");
    if (dialog.open && dialog.dataset.currentClassId) renderCourseDialog(dialog.dataset.currentClassId);
    toast(wasCompleted ? "手動完了を解除しました" : "手動で完了にしました");
  }

  async function toggleNotRequired(key) {
    const notRequired = new Set(state.prefs.notRequired);
    const completed = new Set(state.prefs.manualCompleted);
    const wasNotRequired = notRequired.has(key);
    if (wasNotRequired) notRequired.delete(key);
    else {
      notRequired.add(key);
      completed.delete(key);
    }
    state.prefs.notRequired = [...notRequired];
    state.prefs.manualCompleted = [...completed];
    await storageSet({ [PREFS_KEY]: state.prefs });
    render();
    const dialog = $("#course-dialog");
    if (dialog.open && dialog.dataset.currentClassId) renderCourseDialog(dialog.dataset.currentClassId);
    toast(wasNotRequired ? "対応不要を解除しました" : "対応不要にしました");
  }

  async function markPossibleNotRequired() {
    const candidates = pendingTasks().filter((report) => report.possibleNotRequired);
    if (!candidates.length) return;
    state.prefs.notRequired = [...new Set([...state.prefs.notRequired, ...candidates.map((report) => report.key)])];
    await storageSet({ [PREFS_KEY]: state.prefs });
    render();
    toast(`${candidates.length}件を対応不要にしました`);
  }

  function legacyUpdateSimulator(value) {
    const course = simulatorCourse();
    if (!course) return;
    const projection = simulatorProjection(course, value);
    state.simulatorAbsences = projection.selectedAbsences;
    const range = $("#sim-absence");
    if (range) range.value = projection.selectedAbsences;
    $("#sim-absence-label").textContent = `${projection.selectedAbsences}回`;
    $("#sim-rate").textContent = `${Math.round(projection.rate * 100)}%`;
    const judgement = $("#sim-judgement");
    judgement.textContent = projection.meetsRequirement ? "基準内" : "基準未満";
    judgement.className = `status-pill ${projection.meetsRequirement ? "done" : "pending"}`;
  }

  function openDataDialog() {
    updateDataSummary();
    $("#data-dialog").showModal();
  }

  function positionFeatureInfo(button) {
    if (!button?.isConnected) return hideFeatureInfo();
    const wrapper = button.closest(".feature-info");
    const popover = wrapper?.querySelector(".feature-info-popover");
    if (!popover) return;
    const viewportGap = 12;
    const anchorGap = 9;
    wrapper.classList.add("is-open");
    popover.style.left = `${viewportGap}px`;
    popover.style.top = `${viewportGap}px`;
    const buttonRect = button.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();
    const maxLeft = Math.max(viewportGap, window.innerWidth - popoverRect.width - viewportGap);
    const left = clamp(buttonRect.left + buttonRect.width / 2 - popoverRect.width / 2, viewportGap, maxLeft);
    const fitsBelow = buttonRect.bottom + anchorGap + popoverRect.height <= window.innerHeight - viewportGap;
    const placement = fitsBelow ? "bottom" : "top";
    const preferredTop = fitsBelow ? buttonRect.bottom + anchorGap : buttonRect.top - anchorGap - popoverRect.height;
    const maxTop = Math.max(viewportGap, window.innerHeight - popoverRect.height - viewportGap);
    const top = clamp(preferredTop, viewportGap, maxTop);
    const arrowLeft = clamp(buttonRect.left + buttonRect.width / 2 - left, 14, popoverRect.width - 14);
    popover.style.left = `${Math.round(left)}px`;
    popover.style.top = `${Math.round(top)}px`;
    popover.style.setProperty("--feature-arrow-left", `${Math.round(arrowLeft)}px`);
    popover.dataset.placement = placement;
  }

  function showFeatureInfo(button) {
    if (activeFeatureInfoButton && activeFeatureInfoButton !== button) hideFeatureInfo();
    activeFeatureInfoButton = button;
    positionFeatureInfo(button);
  }

  function hideFeatureInfo(button = activeFeatureInfoButton) {
    button?.closest?.(".feature-info")?.classList.remove("is-open");
    if (!button || button === activeFeatureInfoButton) activeFeatureInfoButton = null;
  }

  function installEvents() {
    $("#main-nav").addEventListener("click", (event) => {
      const button = event.target.closest("[data-view]");
      if (button) setView(button.dataset.view);
    });
    $("#menu-toggle").addEventListener("click", () => $(".sidebar").classList.toggle("is-open"));
    $("#organize-pages").addEventListener("click", () => {
      state.pageManageMode = !state.pageManageMode;
      renderNavigation();
    });
    $("#add-custom-page").addEventListener("click", () => openPageSettings());
    $("#page-settings-form").addEventListener("submit", savePageSettings);
    $("#delete-custom-page").addEventListener("click", deleteCustomPage);
    $("#open-data-dialog").addEventListener("click", openDataDialog);
    $("#open-attendance-watch-dialog").addEventListener("click", () => { openAttendanceWatchDialog().catch(() => {}); });
    $("#attendance-watch-body").addEventListener("change", (event) => { handleAttendanceWatchChange(event).catch(() => {}); });
    $("#attendance-watch-body").addEventListener("click", (event) => {
      if (event.target.closest("#attendance-watch-snooze")) toggleAttendanceSnooze().catch(() => {});
      if (event.target.closest("#attendance-watch-copy")) copyAttendanceProbeLog().catch(() => {});
      if (event.target.closest("#attendance-probe-run")) runAttendanceProbe().catch(() => {});
      if (event.target.closest("#attendance-rehearse")) rehearseAttendance().catch(() => {});
      if (event.target.closest("#attendance-notify-test")) testAttendanceNotification().catch(() => {});
      if (event.target.closest("[data-open-connection]")) openConnectionDialog();
      if (event.target.closest("#attendance-handler-copy")) {
        navigator.clipboard.writeText($(".attendance-probe-report")?.textContent || "").then(
          () => toast("確認結果をコピーしました（画面の抜粋は含みません）"),
          () => toast("コピーできませんでした")
        );
      }
    });
    $("#open-connection-dialog").addEventListener("click", openConnectionDialog);
    $("#connection-dialog").addEventListener("close", () => {
      // 連携の結果を、開いたままの見張りの画面へ反映する。
      if ($("#attendance-watch-dialog").open) renderAttendanceWatchDialog().catch(() => {});
    });
    $("#connection-dialog-body").addEventListener("change", (event) => { handleAttendanceWatchChange(event).catch(() => {}); });
    $("#connection-dialog-body").addEventListener("click", (event) => {
      if (event.target.closest("#slack-create-app")) openSlackAppCreatePage();
      if (event.target.closest("#slack-create-workspace")) openExternalPage(StudylogSlackLinkRules.WORKSPACE_CREATE_URL);
      if (event.target.closest("#slack-open-apps")) openExternalPage(StudylogSlackLinkRules.APP_DIRECTORY_URL);
      if (event.target.closest("#slack-copy-manifest")) copySlackAppManifest().catch(() => {});
      if (event.target.closest("#slack-copy-redirect")) copySlackRedirectUri().catch(() => {});
      if (event.target.closest("#slack-link-start")) startSlackLink().catch(() => {});
      if (event.target.closest("#slack-unlink")) unlinkSlack().catch(() => {});
      if (event.target.closest("#slack-send-test")) {
        const webhookUrl = attendanceWatchPrefs().slackWebhookUrl;
        showSlackProgress("Slackへ送っています…");
        sendSlackTestMessage(webhookUrl).then(
          (delivered) => showSlackProgress(delivered ? "Slackへ届きました。" : "Slackへ届きませんでした。連携を解除して、もう一度つなぎ直してください。"),
          () => showSlackProgress("Slackへ届きませんでした。")
        );
      }
      if (event.target.closest("#discord-open-app")) openExternalPage(StudylogDiscordWebhookRules.APP_URL);
      if (event.target.closest("#discord-open-guide")) openExternalPage(StudylogDiscordWebhookRules.WEBHOOK_GUIDE_URL);
      if (event.target.closest("#discord-link-start")) linkDiscord().catch(() => {});
      if (event.target.closest("#discord-unlink")) unlinkDiscord().catch(() => {});
      if (event.target.closest("#discord-send-test")) {
        const webhookUrl = attendanceWatchPrefs().discordWebhookUrl;
        showDiscordProgress("Discordへ送っています…");
        sendDiscordTestMessage(webhookUrl).then(
          (delivered) => showDiscordProgress(delivered ? "Discordへ届きました。" : "Discordへ届きませんでした。ウェブフックが消えていないか確認してください。"),
          () => showDiscordProgress("Discordへ届きませんでした。")
        );
      }
    });
    $("#topbar-data-button").addEventListener("click", openDataDialog);
    $("#json-import").addEventListener("change", (event) => importJson(event.target.files?.[0]));
    $("#json-export").addEventListener("click", () => {
      if (!snapshotReady()) return toast("書き出すデータがありません");
      const payload = { ...state.snapshot, studylogDashboard: { schemaVersion: 4, manualCompleted: state.prefs.manualCompleted, notRequired: state.prefs.notRequired, completionIncludedCourseIds: state.prefs.completionIncludedCourseIds, layoutSchemaVersion: state.prefs.layoutSchemaVersion, customPages: state.prefs.customPages, pageOrder: state.prefs.pageOrder, lastPageId: state.prefs.lastPageId, startPageId: state.prefs.startPageId } };
      download(`studylog-dashboard-${isoDay(new Date())}.json`, "application/json", JSON.stringify(payload, null, 2));
    });
    document.addEventListener("pointerover", (event) => {
      const button = event.target.closest?.(".feature-info-button");
      if (button) showFeatureInfo(button);
    });
    document.addEventListener("pointerout", (event) => {
      const button = event.target.closest?.(".feature-info-button");
      if (!button) return;
      const wrapper = button.closest(".feature-info");
      if (!wrapper.contains(event.relatedTarget) && document.activeElement !== button) hideFeatureInfo(button);
    });
    document.addEventListener("focusin", (event) => {
      const button = event.target.closest?.(".feature-info-button");
      if (button) showFeatureInfo(button);
    });
    document.addEventListener("focusout", (event) => {
      const button = event.target.closest?.(".feature-info-button");
      if (button && !button.closest(".feature-info").contains(event.relatedTarget)) hideFeatureInfo(button);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && activeFeatureInfoButton) {
        const button = activeFeatureInfoButton;
        hideFeatureInfo();
        button.blur();
      }
    });
    window.addEventListener("resize", () => positionFeatureInfo(activeFeatureInfoButton));
    document.addEventListener("scroll", () => positionFeatureInfo(activeFeatureInfoButton), true);
    document.addEventListener("click", (event) => {
      const backdrop = event.target.closest?.("dialog.modal");
      if (backdrop && event.target === backdrop) return backdrop.close();
      const dataOpen = event.target.closest("[data-open-data]");
      if (dataOpen) return openDataDialog();
      const completionSettings = event.target.closest("[data-open-completion-settings]");
      if (completionSettings) return renderCompletionSettingsDialog();
      const completionSelection = event.target.closest("[data-completion-selection]");
      if (completionSelection) return setAllCompletionCourses(completionSelection.dataset.completionSelection === "all");
      const iconChoice = event.target.closest("[data-icon-choice]");
      if (iconChoice) return renderPageIconPicker(iconChoice.dataset.iconChoice);
      const pageShift = event.target.closest("[data-page-shift]");
      if (pageShift) return shiftPage(pageShift.closest("[data-page-entry]")?.dataset.pageEntry, Number(pageShift.dataset.pageShift));
      const startPage = event.target.closest("[data-set-start-page]");
      if (startPage) return setStartPage(startPage.closest("[data-page-entry]")?.dataset.pageEntry);
      const editPage = event.target.closest("[data-edit-custom-page]");
      if (editPage) return openPageSettings(editPage.dataset.editCustomPage);
      const layoutEdit = event.target.closest("[data-toggle-layout-edit]");
      if (layoutEdit) { state.layoutEditMode = !state.layoutEditMode; return render(); }
      const cardCatalog = event.target.closest("[data-open-card-catalog]");
      if (cardCatalog) return openCardCatalog();
      const addCardButton = event.target.closest("[data-add-card]");
      if (addCardButton) return addCard(addCardButton.dataset.addCard);
      const removeCardButton = event.target.closest("[data-remove-card]");
      if (removeCardButton) return removeCard(Number(removeCardButton.dataset.removeCard));
      const sizeButton = event.target.closest("[data-card-size]");
      if (sizeButton) return changeCardSize(Number(sizeButton.closest("[data-custom-card]")?.dataset.customCardIndex), sizeButton.dataset.cardSize);
      const view = event.target.closest("[data-view-target]");
      if (view) return setView(view.dataset.viewTarget);
      const filter = event.target.closest("[data-task-filter]");
      if (filter) { state.taskFilter = filter.dataset.taskFilter; return render(); }
      const manual = event.target.closest("[data-manual-toggle]");
      if (manual) return toggleManual(manual.dataset.manualToggle);
      const notRequired = event.target.closest("[data-not-required-toggle]");
      if (notRequired) return toggleNotRequired(notRequired.dataset.notRequiredToggle);
      const markPossibleNotRequiredButton = event.target.closest("[data-mark-possible-not-required]");
      if (markPossibleNotRequiredButton) return markPossibleNotRequired();
      const course = event.target.closest("[data-course-open]");
      if (course) return renderCourseDialog(course.dataset.courseOpen);
      const close = event.target.closest("[data-close-dialog]");
      if (close) return $(`#${close.dataset.closeDialog}`).close();
      const simCourseButton = event.target.closest("[data-sim-course]");
      if (simCourseButton) {
        state.simulatorCourseId = simCourseButton.dataset.simCourse;
        state.simulatorAbsences = 0;
        const simulator = simCourseButton.closest(".simulator");
        const wrapper = document.createElement("div");
        wrapper.innerHTML = renderSimulator();
        simulator.replaceWith(wrapper.firstElementChild);
        return;
      }
      const simAbsenceButton = event.target.closest("[data-sim-absence]");
      if (simAbsenceButton) return updateSimulator(Number(simAbsenceButton.dataset.simAbsence));
      const step = event.target.closest("[data-sim-step]");
      if (step) return updateSimulator(state.simulatorAbsences + Number(step.dataset.simStep));
      const archives = event.target.closest("[data-toggle-archives]");
      if (archives) {
        if (archives.dataset.toggleArchives === "attendance") {
          state.showArchivedAttendance = !state.showArchivedAttendance;
          state.simulatorCourseId = null;
          state.simulatorAbsences = 0;
        } else {
          state.showArchivedCourses = !state.showArchivedCourses;
        }
        return render();
      }
    });
    $("#main-nav").addEventListener("dragstart", (event) => {
      const entry = event.target.closest?.("[data-page-entry]");
      if (!state.pageManageMode || !entry) return event.preventDefault();
      draggedPageId = entry.dataset.pageEntry;
      entry.classList.add("is-dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", draggedPageId);
    });
    $("#main-nav").addEventListener("dragover", (event) => {
      if (!draggedPageId || !event.target.closest?.("[data-page-entry]")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    });
    $("#main-nav").addEventListener("drop", (event) => {
      const target = event.target.closest?.("[data-page-entry]");
      if (!draggedPageId || !target) return;
      event.preventDefault();
      const movedId = draggedPageId;
      draggedPageId = null;
      reorderPages(movedId, target.dataset.pageEntry);
    });
    $("#main-nav").addEventListener("dragend", () => {
      draggedPageId = null;
      $$(".nav-entry.is-dragging").forEach((entry) => entry.classList.remove("is-dragging"));
    });
    document.addEventListener("dragstart", (event) => {
      const card = event.target.closest?.("[data-custom-card]");
      if (!state.layoutEditMode || !card) return;
      draggedCardIndex = Number(card.dataset.customCardIndex);
      const cardBounds = card.getBoundingClientRect();
      draggedCardOffset = { x: event.clientX - cardBounds.left, y: event.clientY - cardBounds.top };
      card.classList.add("is-dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(draggedCardIndex));
      createTransparentDragImage(event);
      const definition = cardDefinition(card.dataset.customCard);
      cardDropPreview = document.createElement("div");
      cardDropPreview.className = "grid-drop-preview";
      cardDropPreview.innerHTML = `<strong>${esc(definition?.name || "カード")}</strong><span>ここに配置</span>`;
      card.closest(".custom-grid")?.append(cardDropPreview);
    });
    document.addEventListener("dragover", (event) => {
      const grid = event.target.closest?.(".custom-grid");
      if (draggedCardIndex === null || !grid) return;
      event.preventDefault();
      const position = updateCardDropPreview(event, grid);
      event.dataTransfer.dropEffect = position?.valid ? "move" : "none";
    });
    document.addEventListener("drop", (event) => {
      const grid = event.target.closest?.(".custom-grid");
      if (draggedCardIndex === null || !grid) return;
      event.preventDefault();
      const movedIndex = draggedCardIndex;
      const position = updateCardDropPreview(event, grid);
      cleanupCardDrag();
      if (!position?.valid) return toast("その位置には別のカードがあります");
      moveCard(movedIndex, position.x, position.y);
    });
    document.addEventListener("dragend", cleanupCardDrag);
    document.addEventListener("change", (event) => {
      if (event.target.matches("[data-completion-course]")) return setCompletionCourseSelection(event.target.dataset.completionCourse, event.target.checked);
      if (event.target.id === "sim-course") {
        state.simulatorCourseId = event.target.value;
        state.simulatorAbsences = 0;
        const simulator = event.target.closest(".simulator");
        const wrapper = document.createElement("div");
        wrapper.innerHTML = renderSimulator();
        simulator.replaceWith(wrapper.firstElementChild);
      }
    });
    document.addEventListener("input", (event) => { if (event.target.id === "sim-absence") updateSimulator(Number(event.target.value)); });
  }

  function refreshNextCourseCard() {
    const current = $('[data-dashboard-card="next-course"]');
    if (!current || state.layoutEditMode || !snapshotReady()) return;
    const size = current.classList.contains("card-size-small") ? "small" : "medium";
    current.querySelector(".custom-widget-content").innerHTML = renderNextCourseWidget(size);
  }

  function installStorageSync() {
    if (!globalThis.chrome?.storage?.onChanged) return;
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local") return;
      let changed = false;
      if (changes[SNAPSHOT_KEY]) {
        state.snapshot = changes[SNAPSHOT_KEY].newValue || null;
        changed = true;
      }
      if (changes[PREFS_KEY]) {
        state.prefs = normalizePreferences(changes[PREFS_KEY].newValue || {});
        if (!pageExists(state.view)) state.view = state.prefs.startPageId;
        changed = true;
      }
      if (!changed) return;
      updateDataSummary();
      render();
    });
  }

  async function initialize() {
    const stored = await storageGet([SNAPSHOT_KEY, PREFS_KEY]);
    state.snapshot = stored[SNAPSHOT_KEY] || null;
    state.prefs = normalizePreferences(stored[PREFS_KEY] || {});
    state.view = state.prefs.startPageId;
    const requestedView = new URLSearchParams(location.search).get("view");
    if (pageExists(requestedView)) state.view = requestedView;
    $("#data-quality-help").innerHTML = featureInfo("data-quality");
    installEvents();
    installStorageSync();
    updateDataSummary();
    render();
    setInterval(refreshNextCourseCard, 30_000);
  }

  initialize().catch((error) => {
    console.error(error);
    $("#app-view").innerHTML = `<div class="empty-state"><h1>ダッシュボードを開けませんでした</h1><p>${esc(error.message)}</p></div>`;
  });
})();
