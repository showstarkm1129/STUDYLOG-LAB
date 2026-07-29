(() => {
  "use strict";

  const SNAPSHOT_KEY = "stalogBridgeSnapshotV1";
  const PREFS_KEY = "stalogDashboardPreferencesV1";
  const PORTAL_ORIGIN = "https://portal.iwasaki.ac.jp";
  const ATTENDANCE_THRESHOLD = 0.75;
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

  const defaultPreferences = { manualCompleted: [] };
  const state = {
    snapshot: null,
    prefs: { ...defaultPreferences },
    view: "home",
    taskFilter: "pending",
    showArchivedAttendance: false,
    showArchivedCourses: false,
    simulatorCourseId: null,
    simulatorAbsences: 0
  };

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

  function dashboardNow() {
    const override = location.hostname === "127.0.0.1" ? new URLSearchParams(location.search).get("now") : null;
    const parsed = override ? new Date(override) : null;
    return parsed && !Number.isNaN(parsed.valueOf()) ? parsed : new Date();
  }

  function parseDate(value) {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.valueOf()) ? null : new Date(value);
    const direct = new Date(value);
    if (!Number.isNaN(direct.valueOf())) return direct;
    const match = String(value).normalize("NFKC").match(/(?:(20\d{2})\D+)?(\d{1,2})\D+(\d{1,2})(?:\D+(\d{1,2})[:時](\d{1,2})?)?/);
    if (!match) return null;
    const year = Number(match[1] || state.snapshot?.academicYear || new Date().getFullYear());
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
    return [report.classId, report.directoryId, report.kind, normalize(report.title), report.href]
      .map((value) => String(value || ""))
      .join("::");
  }

  function manualSet() { return new Set(state.prefs.manualCompleted); }
  function isManualComplete(report) { return manualSet().has(reportKey(report)); }
  function digestResolution(report) { return StalogDigestRules.resolution(report, array(state.snapshot?.reports)); }
  function isDigestAutoComplete(report) { return digestResolution(report).state === "auto-complete"; }
  function isDigestDeferred(report) { return digestResolution(report).state === "deferred"; }
  function isEffectivelyDone(report) { return isPortalDone(report) || isManualComplete(report) || isDigestAutoComplete(report); }
  function isEffectivelyPending(report) { return isPortalPending(report) && !isManualComplete(report) && !isDigestAutoComplete(report) && !isDigestDeferred(report); }
  function isCountedReport(report) { return !isDigestDeferred(report); }

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
    const scheduled = parseDate(report.scheduledAt);
    if (scheduled) return { date: scheduled, source: "scheduled", label: "実施日" };
    const directory = directoryMap().get(`${report.classId}:${report.directoryId}`);
    const lesson = parseDate(directory?.lessonDate);
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
    const total = Number(course.totalLessons || 0);
    if (!total) return null;
    const maximumAbsences = Math.max(0, Math.floor(total * (1 - ATTENDANCE_THRESHOLD) + 1e-8));
    return maximumAbsences - Number(course.absent || 0);
  }

  function courseEndDate(course) {
    const matches = [...String(course.period || "").normalize("NFKC").matchAll(/(?:(20\d{2})\s*[\/年.\-]\s*)?(\d{1,2})\s*[\/月.\-]\s*(\d{1,2})/g)];
    const last = matches.at(-1);
    if (last) {
      const month = Number(last[2]);
      const day = Number(last[3]);
      const academicYear = Number(state.snapshot?.academicYear || dashboardNow().getFullYear());
      const year = Number(last[1] || academicYear + (month <= 3 ? 1 : 0));
      const date = new Date(year, month - 1, day);
      if (date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day) return date;
    }
    const lessonDates = array(state.snapshot?.directories)
      .filter((item) => String(item.classId) === String(course.classId))
      .map((item) => parseDate(item.lessonDate))
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
      const hasAttendance = Number(course.attended || 0) + Number(course.absent || 0) + Number(course.publicAbsent || 0) > 0;
      const attendancePoints = hasAttendance ? Math.round(clamp(attendance / ATTENDANCE_THRESHOLD, 0, 1) * 50) : 0;
      const taskPoints = Math.round(completion * 50);
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
        attendancePoints,
        taskPoints,
        health: attendancePoints + taskPoints,
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
    const level = score >= 45 ? "high" : score >= 20 ? "medium" : "low";
    return { ...report, key: reportKey(report), context, priority: { score, level, reasons } };
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

  function reportLink(report) {
    const path = String(report.href || "");
    return path.startsWith("/") ? `${PORTAL_ORIGIN}${path}` : "";
  }

  function priorityPill(priority) {
    const labels = { high: "先に確認", medium: "確認候補", low: "通常" };
    return `<span class="priority-pill ${priority.level}">${labels[priority.level]}</span>`;
  }

  function reportStatus(report) {
    const manual = isManualComplete(report);
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
      const portalDone = isPortalDone(report);
      const digest = digestResolution(report);
      const digestDone = digest.state === "auto-complete";
      const deferred = digest.state === "deferred";
      const locked = portalDone || digestDone || deferred;
      const link = reportLink(report);
      const contextLabel = report.context.date ? `${report.context.label} ${formatDate(report.context.date)}` : "日付なし";
      const reason = report.priority.reasons[0] ? `<span class="task-reason"> · ${esc(report.priority.reasons[0])}</span>` : "";
      const actionLabel = manual ? "チェックを外して未整理へ戻す" : digestDone ? "ダイジェスト6割以上のため完了" : deferred ? "ダイジェスト実施後に補講の要否を判定" : portalDone ? "スタログ上で完了済み" : "チェックして完了扱いにする";
      return `<div class="task-row${manual ? " is-manual" : ""}">
        <button class="task-check${manual ? " is-manual" : digestDone ? " is-digest-done" : deferred ? " is-deferred" : portalDone ? " is-portal-done" : ""}" data-manual-toggle="${esc(report.key)}" type="button" aria-pressed="${manual}" aria-label="${actionLabel}" title="${actionLabel}"${locked && !manual ? " disabled" : ""}>✓</button>
        ${showPriority && !manual && !locked ? priorityPill(report.priority) : `<span class="kind-pill">${esc(report.kind || "項目")}</span>`}
        <div class="row-main"><strong>${esc(report.title || "名称なし")}</strong><span>${esc(courseName(report.classId))} · ${esc(report.kind || "項目")} · ${esc(contextLabel)}${reason}</span></div>
        ${reportStatus(report)}
        ${link ? `<a class="secondary-button" href="${esc(link)}" target="_blank" rel="noreferrer">開く</a>` : ""}
      </div>`;
    }).join("")}</div>`;
  }

  function pageHeader(eyebrow, title, subtitle, actions = "") {
    return `<div class="page-header"><div><p class="eyebrow">${esc(eyebrow)}</p><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div>${actions ? `<div class="header-actions">${actions}</div>` : ""}</div>`;
  }

  function cardHead(title, subtitle = "") {
    return `<div class="card-head"><div><h2>${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ""}</div></div>`;
  }

  function progressBar(value, type = "") {
    return `<div class="progress-track"><div class="progress-fill ${type}" style="width:${clamp(value, 0, 100)}%"></div></div>`;
  }

  function healthBreakdown(course) {
    return `<div class="health-breakdown">
      <div class="health-line"><span>出席基準</span>${progressBar(course.attendancePoints * 2, course.attendancePoints < 50 ? "warn" : "good")}<strong>${course.attendancePoints}/50</strong></div>
      <div class="health-line"><span>課題整理</span>${progressBar(course.taskPoints * 2, course.taskPoints < 35 ? "warn" : "good")}<strong>${course.taskPoints}/50</strong></div>
    </div>`;
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
    const academicYear = Number(state.snapshot?.academicYear || dashboardNow().getFullYear());
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

  function renderNextCourseCard({ todayOnly = false } = {}) {
    const nextCourse = nextDifferentCourse(dashboardNow(), { todayOnly });
    if (!nextCourse) {
      return `<section class="card hero-card next-course-card span-5" data-next-course-card><div>${cardHead("次の科目", todayOnly ? "今日の時間割だけから判定" : "収集済みの時間割から判定")}<h3>${todayOnly ? "今日の授業は終了しました" : "次の科目を判定できません"}</h3><p class="muted">${todayOnly ? "次の授業日は表示しません。" : "次の授業日を含む時間割を収集してください。"}</p></div><div class="next-course-clock">--<span>限</span></div></section>`;
    }
    const slot = nextCourse.slot;
    const time = PERIOD_TIMES[Number(slot.period)];
    const href = slot.classId ? `${PORTAL_ORIGIN}/lms/class/${encodeURIComponent(slot.classId)}/` : "";
    const exam = unitExamForSlot(slot);
    return `<section class="card hero-card next-course-card span-5${exam ? " is-unit-exam" : ""}" data-next-course-card data-next-class-id="${esc(slot.classId || "")}">
      <div>${cardHead("次の科目", "同じ科目の連続時限は飛ばして表示")}${exam ? unitExamBadge() : ""}<p class="next-course-when">${esc(nextCourseTiming(nextCourse))} · ${esc(formatDate(slot.date))}</p><h3>${esc(slot.courseName || courseName(slot.classId))}</h3><p class="next-course-meta">${esc(slot.period)}限 ${esc(time.start)}開始${slot.room ? ` · ${esc(slot.room)}教室` : ""}</p>${href ? `<a class="next-course-link" href="${esc(href)}" target="_blank" rel="noreferrer">科目を開く →</a>` : ""}</div>
      <div class="next-course-clock"><strong>${esc(slot.period)}</strong><span>限</span></div>
    </section>`;
  }

  function todayCourseBlocks() {
    const today = isoDay(dashboardNow());
    const slots = orderedTimetableSlots().filter((slot) => slot.date === today);
    return slots.filter((slot, index) => index === 0 || String(slot.classId) !== String(slots[index - 1].classId));
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

  function renderHome() {
    const today = todayCourseBlocks();
    const todayClassIds = new Set(today.map((slot) => String(slot.classId)));
    const reports = array(state.snapshot.reports).filter((report) => todayClassIds.has(String(report.classId)) && isCountedReport(report));
    const tasks = pendingTasks().filter((report) => todayClassIds.has(String(report.classId)));
    const portalDone = reports.filter(isPortalDone).length;
    const digestDone = reports.filter(isDigestAutoComplete).length;
    const manualDone = reports.filter((report) => isPortalPending(report) && isManualComplete(report) && !isDigestAutoComplete(report)).length;
    const effectiveDone = reports.filter(isEffectivelyDone).length;
    const completion = reports.length ? Math.round(effectiveDone / reports.length * 100) : 0;
    const courses = courseStats().filter((course) => todayClassIds.has(String(course.classId)));
    const now = dashboardNow();
    const actions = `<button class="primary-button" data-view-target="tasks" type="button">課題を確認</button>`;
    return pageHeader("TODAY", new Intl.DateTimeFormat("ja-JP", { month: "long", day: "numeric", weekday: "long" }).format(now), `${formatDateTime(state.snapshot.collectedAt)}に更新 · 今日の${today.length}科目だけを表示`, actions) +
      `<div class="bento-grid">
        <section class="card span-7">${cardHead("今日の科目の全体像", "今日の時間割にある科目だけを集計")}<div class="metric-row three"><div class="metric"><strong>${tasks.length}</strong><span>未完了</span><small>チェック済みを除外</small></div><div class="metric"><strong>${completion}<small>%</small></strong><span>整理済み</span><small>${effectiveDone} / ${reports.length}件</small></div><div class="metric"><strong>${manualDone}</strong><span>手動で完了</span><small>端末内の補正</small></div></div></section>
        ${renderNextCourseCard({ todayOnly: true })}

        <section class="card span-4">${cardHead("課題の整理率", "課題実施・D判定・手動完了を合算")}<div style="display:flex;align-items:center;gap:18px"><div class="ring" style="--value:${completion}"><div class="ring-label"><strong>${completion}%</strong><span>整理済み</span></div></div><div style="flex:1"><div class="progress-label"><span>課題を実施して完了</span><strong>${portalDone}</strong></div>${progressBar(reports.length ? portalDone / reports.length * 100 : 0, "good")}<div class="progress-label" style="margin-top:9px"><span>D 60%以上で補講完了</span><strong>${digestDone}</strong></div>${progressBar(reports.length ? digestDone / reports.length * 100 : 0, "good")}<div class="progress-label" style="margin-top:9px"><span>手動で完了</span><strong>${manualDone}</strong></div>${progressBar(reports.length ? manualDone / reports.length * 100 : 0, "warn")}<div class="progress-label" style="margin-top:9px"><span>残り</span><strong>${tasks.length}</strong></div></div></div></section>

        <section class="card span-8">${cardHead("今日の授業", today.length ? `${today.length}科目` : "時間割から確認")}<div class="compact-list">${today.map((slot) => { const exam = unitExamForSlot(slot); return `<div class="list-row${exam ? " is-unit-exam" : ""}"><span class="row-icon">${esc(slot.period)}</span><div class="row-main"><strong>${esc(slot.courseName || courseName(slot.classId))}</strong>${exam ? unitExamBadge() : ""}<span>${esc(PERIOD_TIMES[Number(slot.period)]?.start || "時刻不明")} · ${esc(slot.room ? `${slot.room}教室` : "教室未取得")}</span></div><div class="row-meta"><strong>${esc(slot.period)}限</strong></div></div>`; }).join("") || `<div class="empty-inline">今日の時間割は収集されていません。</div>`}</div></section>

        <section class="card span-7" data-today-candidates>${cardHead("次に確認する候補", "今日の科目にある未完了だけを表示")}${renderTaskRows(tasks, { limit: 3 })}</section>
        <section class="card span-5" data-today-courses>${cardHead("今日の科目ヘルス", "今日の科目だけを表示")}<div class="compact-list">${[...courses].sort((a, b) => a.health - b.health).map((course) => `<button class="list-row" style="border:0;width:100%;text-align:left;cursor:pointer" data-course-open="${esc(course.classId)}" type="button"><span class="row-icon" style="color:${colorForCourse(course.classId)}">●</span><div class="row-main"><strong>${esc(course.name)}</strong><span>出席 ${course.attendancePoints}/50 · 課題 ${course.taskPoints}/50</span></div><div class="row-meta"><strong>${course.health}</strong><span>/ 100</span></div></button>`).join("") || `<div class="empty-inline">今日の科目はありません。</div>`}</div></section>
      </div>`;
  }

  function renderTasks() {
    const pending = pendingTasks();
    const manual = manualTasks();
    const items = state.taskFilter === "manual" ? manual : pending;
    const filter = `<div class="filter-bar"><button class="filter-chip${state.taskFilter === "pending" ? " is-active" : ""}" data-task-filter="pending" type="button">スタログ上の未完了 ${pending.length}</button><button class="filter-chip${state.taskFilter === "manual" ? " is-active" : ""}" data-task-filter="manual" type="button">手動で完了 ${manual.length}</button></div>`;
    return pageHeader("TASKS", "課題を整理する", "スタログの表示は残したまま、自分の判断で完了扱いにできます") +
      `<section class="card">${cardHead(state.taskFilter === "manual" ? "手動で完了した項目" : "スタログ上で未完了の項目", state.taskFilter === "manual" ? "チェックを外すと未完了一覧へ戻ります" : "チェックすると全機能の集計から除外されます")}${filter}${renderTaskRows(items, { showPriority: state.taskFilter !== "manual" })}</section>`;
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
    return { remaining, selectedAbsences, rate: total ? finalAttended / total : 0 };
  }

  function renderSimulator() {
    const course = simulatorCourse();
    if (!course) return `<div class="empty-inline">科目データがありません。</div>`;
    const projection = simulatorProjection(course);
    const selectable = courseStats().filter((item) => state.showArchivedAttendance || !item.archived);
    return `<div class="simulator"><label>科目<select id="sim-course">${selectable.map((item) => `<option value="${esc(item.classId)}"${String(item.classId) === String(course.classId) ? " selected" : ""}>${esc(item.name)}${item.archived ? "（アーカイブ）" : ""}</option>`).join("")}</select></label><label>残り${projection.remaining}回のうち、今後休む回数</label><div class="stepper"><button data-sim-step="-1" type="button" aria-label="欠席回数を減らす">−</button><output id="sim-absence-label">${projection.selectedAbsences}回</output><button data-sim-step="1" type="button" aria-label="欠席回数を増やす">＋</button></div><input id="sim-absence" type="range" min="0" max="${projection.remaining}" value="${projection.selectedAbsences}"><div class="sim-result"><span><strong id="sim-rate">${Math.round(projection.rate * 100)}%</strong><small class="muted" style="display:block">残りをそれ以外すべて出席した場合</small></span><span id="sim-judgement" class="status-pill ${projection.rate >= ATTENDANCE_THRESHOLD ? "done" : "pending"}">${projection.rate >= ATTENDANCE_THRESHOLD ? "75%以上" : "75%未満"}</span></div></div>`;
  }

  function renderAttendance() {
    const allCourses = courseStats();
    const archivedCount = allCourses.filter((course) => course.archived).length;
    const courses = allCourses.filter((course) => state.showArchivedAttendance || !course.archived).sort((a, b) => (a.margin ?? 999) - (b.margin ?? 999));
    const attended = sum(courses, (course) => Number(course.attended || 0) + Number(course.publicAbsent || 0));
    const absent = sum(courses, (course) => course.absent);
    const overall = attended + absent ? attended / (attended + absent) : 0;
    return pageHeader("ATTENDANCE", "出席の安全余裕", "全科目75%必須・公欠は出席として計算", archiveToggle("attendance", archivedCount, state.showArchivedAttendance)) +
      `<div class="bento-grid"><section class="card span-4 tint-brand">${cardHead("全科目の出席扱い率", `出席＋公欠 ${attended} / 欠席 ${absent}`)}<div style="display:flex;align-items:center;gap:20px"><div class="ring tint" style="--value:${Math.round(overall * 100)}"><div class="ring-label"><strong>${Math.round(overall * 100)}%</strong><span>現在</span></div></div><div><strong style="font-size:31px">${courses.filter((course) => course.margin !== null && course.margin <= 2).length}</strong><p class="muted" style="font-size:9px">欠席余裕2回以下</p></div></div></section><section class="card span-8">${cardHead("欠席シミュレーター", "＋/−またはスライダーで簡単計算")}${renderSimulator()}</section><section class="card span-12">${cardHead("科目別セーフティ残量", "総授業数の25%までを欠席可能回数として計算")}<table class="attendance-table"><thead><tr><th>科目</th><th>出席扱い率</th><th>出席</th><th>欠席</th><th>公欠</th><th>残り授業</th><th>欠席余裕</th></tr></thead><tbody>${courses.map((course) => {
        const rate = Math.round(course.attendance * 100);
        const remaining = Math.max(0, Number(course.totalLessons || 0) - Number(course.attended || 0) - Number(course.absent || 0) - Number(course.publicAbsent || 0));
        const statusClass = course.margin < 0 ? "text-danger" : course.margin <= 2 ? "text-warn" : "text-good";
        return `<tr data-course-open="${esc(course.classId)}"><td class="table-course">${esc(course.name)}${course.archived ? ` <span class="archive-pill">アーカイブ</span>` : ""}</td><td class="rate-cell"><div class="progress-label"><span>${rate}%</span></div>${progressBar(rate, rate < 75 ? "danger" : rate < 82 ? "warn" : "good")}</td><td>${course.attended || 0}</td><td>${course.absent || 0}</td><td>${course.publicAbsent || 0}</td><td>${remaining}</td><td><strong class="${statusClass}">${course.margin === null ? "—" : course.margin < 0 ? `${Math.abs(course.margin)}回超過` : `${course.margin}回`}</strong></td></tr>`;
      }).join("")}</tbody></table><p class="help-text">公欠は出席扱いです。休講は出欠数・授業消化数に含まれない前提で計算しています。</p></section></div>`;
  }

  function renderCourses() {
    const allCourses = courseStats();
    const archivedCount = allCourses.filter((course) => course.archived).length;
    const courses = allCourses.filter((course) => state.showArchivedCourses || !course.archived).sort((a, b) => a.name.localeCompare(b.name, "ja"));
    return pageHeader("COURSES", "科目カルテ", "出席・課題・授業回と、説明可能なヘルス内訳を確認", archiveToggle("courses", archivedCount, state.showArchivedCourses)) +
      `<div class="course-grid">${courses.map((course) => `<button class="course-card${course.archived ? " is-archived" : ""}" style="--course-color:${colorForCourse(course.classId)};text-align:left" data-course-open="${esc(course.classId)}" type="button"><span class="kind-pill">${course.archived ? "アーカイブ" : esc(course.term || "期間不明")}</span><h2>${esc(course.name)}</h2><p>${esc(course.period || "実施期間未取得")} · ${course.directories.length}回を収集</p><div class="course-card-metrics"><div><strong>${Math.round(course.attendance * 100)}%</strong><span>出席扱い率</span></div><div><strong>${course.pending}</strong><span>未整理</span></div><div><strong>${course.health}</strong><span>ヘルス /100</span></div></div>${healthBreakdown(course)}</button>`).join("") || `<div class="empty-inline">実施中の科目はありません。必要な場合はアーカイブを表示してください。</div>`}</div>`;
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
    $("#course-dialog-body").innerHTML = `<div class="metric-row"><div class="metric"><strong>${Math.round(course.attendance * 100)}%</strong><span>出席扱い率</span></div><div class="metric"><strong>${course.margin ?? "—"}</strong><span>欠席余裕</span></div><div class="metric"><strong>${course.pending}</strong><span>未整理</span></div><div class="metric"><strong>${course.health}</strong><span>ヘルス</span></div></div><section class="card flat" style="margin-top:16px">${cardHead("ヘルスの内訳", "出席基準と課題整理のみで算出")}${healthBreakdown(course)}</section><div class="bento-grid" style="margin-top:14px"><section class="card flat span-8">${cardHead("課題・テスト", "完了方法とスタログ状態を表示・手動完了も変更可能")}${renderTaskRows(reports, { showPriority: false })}</section><section class="card flat span-4">${cardHead("最近の授業回", `${course.directories.length}回を収集`)}<div class="timeline">${recent.map((item) => `<div class="timeline-row"><span class="timeline-date">${esc(formatDate(item.lessonDate))}</span><span class="timeline-axis"></span><div class="timeline-content"><strong>${esc(item.title || `第${item.lessonNumber || "?"}回`)}</strong></div></div>`).join("") || `<div class="empty-inline">日付つき授業回がありません。</div>`}</div></section></div>`;
    if (!dialog.open) dialog.showModal();
  }

  function updateTopbar() {
    $("#topbar-freshness").textContent = snapshotReady() ? `最終取得 ${formatDateTime(state.snapshot.collectedAt)}` : "データ未読込";
  }

  function render() {
    updateTopbar();
    if (!snapshotReady()) {
      $("#app-view").replaceChildren($("#empty-state-template").content.cloneNode(true));
      return;
    }
    const renderers = { home: renderHome, tasks: renderTasks, attendance: renderAttendance, courses: renderCourses };
    $("#app-view").innerHTML = (renderers[state.view] || renderHome)();
    $$(".nav-item").forEach((item) => item.classList.toggle("is-active", item.dataset.view === state.view));
  }

  function setView(view) {
    if (!["home", "tasks", "attendance", "courses"].includes(view)) return;
    state.view = view;
    $(".sidebar").classList.remove("is-open");
    window.scrollTo({ top: 0, behavior: "smooth" });
    render();
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
    summary.innerHTML = `<strong>最終取得: ${esc(formatDateTime(state.snapshot.collectedAt))}</strong><br>${array(state.snapshot.courses).length}科目 · ${array(state.snapshot.reports).length}課題/テスト · ${array(state.snapshot.directories).length}授業回 · 手動完了${state.prefs.manualCompleted.length}件<br>スキーマ v${esc(state.snapshot.schemaVersion || "?")} · 履修年度 ${esc(state.snapshot.academicYear || "不明")}`;
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
      if (!parsed || !Array.isArray(parsed.courses) || !Array.isArray(parsed.reports)) throw new Error("Stalog Bridge形式ではありません");
      state.snapshot = parsed;
      if (Array.isArray(parsed.stalogDashboard?.manualCompleted)) {
        state.prefs.manualCompleted = parsed.stalogDashboard.manualCompleted;
      }
      await storageSet({ [SNAPSHOT_KEY]: parsed, [PREFS_KEY]: state.prefs });
      updateDataSummary();
      $("#data-dialog").close();
      render();
      toast(`${parsed.courses.length}科目のデータを読み込みました`);
    } catch (error) { toast(`読み込み失敗: ${error.message}`); }
  }

  async function toggleManual(key) {
    const completed = new Set(state.prefs.manualCompleted);
    const wasCompleted = completed.has(key);
    if (wasCompleted) completed.delete(key); else completed.add(key);
    state.prefs.manualCompleted = [...completed];
    await storageSet({ [PREFS_KEY]: state.prefs });
    render();
    const dialog = $("#course-dialog");
    if (dialog.open && dialog.dataset.currentClassId) renderCourseDialog(dialog.dataset.currentClassId);
    toast(wasCompleted ? "手動完了を解除しました" : "手動で完了にしました");
  }

  function updateSimulator(value) {
    const course = simulatorCourse();
    if (!course) return;
    const projection = simulatorProjection(course, value);
    state.simulatorAbsences = projection.selectedAbsences;
    const range = $("#sim-absence");
    if (range) range.value = projection.selectedAbsences;
    $("#sim-absence-label").textContent = `${projection.selectedAbsences}回`;
    $("#sim-rate").textContent = `${Math.round(projection.rate * 100)}%`;
    const judgement = $("#sim-judgement");
    judgement.textContent = projection.rate >= ATTENDANCE_THRESHOLD ? "75%以上" : "75%未満";
    judgement.className = `status-pill ${projection.rate >= ATTENDANCE_THRESHOLD ? "done" : "pending"}`;
  }

  function openDataDialog() {
    updateDataSummary();
    $("#data-dialog").showModal();
  }

  function installEvents() {
    $("#main-nav").addEventListener("click", (event) => {
      const button = event.target.closest("[data-view]");
      if (button) setView(button.dataset.view);
    });
    $("#menu-toggle").addEventListener("click", () => $(".sidebar").classList.toggle("is-open"));
    $("#open-data-dialog").addEventListener("click", openDataDialog);
    $("#topbar-data-button").addEventListener("click", openDataDialog);
    $("#json-import").addEventListener("change", (event) => importJson(event.target.files?.[0]));
    $("#json-export").addEventListener("click", () => {
      if (!snapshotReady()) return toast("書き出すデータがありません");
      const payload = { ...state.snapshot, stalogDashboard: { schemaVersion: 1, manualCompleted: state.prefs.manualCompleted } };
      download(`stalog-dashboard-${isoDay(new Date())}.json`, "application/json", JSON.stringify(payload, null, 2));
    });
    document.addEventListener("click", (event) => {
      const backdrop = event.target.closest?.("dialog.modal");
      if (backdrop && event.target === backdrop) return backdrop.close();
      const dataOpen = event.target.closest("[data-open-data]");
      if (dataOpen) return openDataDialog();
      const view = event.target.closest("[data-view-target]");
      if (view) return setView(view.dataset.viewTarget);
      const filter = event.target.closest("[data-task-filter]");
      if (filter) { state.taskFilter = filter.dataset.taskFilter; return render(); }
      const manual = event.target.closest("[data-manual-toggle]");
      if (manual) return toggleManual(manual.dataset.manualToggle);
      const course = event.target.closest("[data-course-open]");
      if (course) return renderCourseDialog(course.dataset.courseOpen);
      const close = event.target.closest("[data-close-dialog]");
      if (close) return $(`#${close.dataset.closeDialog}`).close();
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
    document.addEventListener("change", (event) => {
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
    const current = $("[data-next-course-card]");
    if (!current || state.view !== "home" || !snapshotReady()) return;
    const wrapper = document.createElement("div");
    wrapper.innerHTML = renderNextCourseCard();
    current.replaceWith(wrapper.firstElementChild);
  }

  async function initialize() {
    const stored = await storageGet([SNAPSHOT_KEY, PREFS_KEY]);
    state.snapshot = stored[SNAPSHOT_KEY] || null;
    state.prefs = { ...defaultPreferences, ...(stored[PREFS_KEY] || {}) };
    const requestedView = new URLSearchParams(location.search).get("view");
    if (["home", "tasks", "attendance", "courses"].includes(requestedView)) state.view = requestedView;
    installEvents();
    updateDataSummary();
    render();
    setInterval(refreshNextCourseCard, 30_000);
  }

  initialize().catch((error) => {
    console.error(error);
    $("#app-view").innerHTML = `<div class="empty-state"><h1>ダッシュボードを開けませんでした</h1><p>${esc(error.message)}</p></div>`;
  });
})();
