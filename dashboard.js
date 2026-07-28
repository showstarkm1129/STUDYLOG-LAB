(() => {
  "use strict";

  const SNAPSHOT_KEY = "stalogBridgeSnapshotV1";
  const PREFS_KEY = "stalogLabPreferencesV1";
  const HISTORY_KEY = "stalogLabHistoryV1";
  const REVIEW_KEY = "stalogLabReviewV1";
  const PORTAL_ORIGIN = "https://portal.iwasaki.ac.jp";
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

  const FEATURES = [
    { id: "daily-brief", name: "今日のブリーフ", area: "ホーム", description: "今日の授業・教室・注意事項を1枚に集約" },
    { id: "next-course", name: "次の科目", area: "ホーム", description: "現在時刻から次に切り替わる科目と教室を即時表示" },
    { id: "action-triage", name: "次にやること", area: "ホーム", description: "未完了を種類・日付・出席リスクから自動順位付け" },
    { id: "progress-ring", name: "完了率リング", area: "ホーム", description: "課題とテストの消化率を一目で確認" },
    { id: "attendance-alert", name: "出席アラート", area: "ホーム", description: "欠席余裕が少ない科目だけを早期表示" },
    { id: "course-health", name: "科目ヘルススコア", area: "ホーム", description: "出席・完了率・得点を科目ごとに合成" },
    { id: "task-inbox", name: "未完了インボックス", area: "やること", description: "未提出・未完了を横断フィルター" },
    { id: "task-pin", name: "自分用チェック", area: "やること", description: "気になる項目を端末内のリストに固定" },
    { id: "task-snooze", name: "あとで見る", area: "やること", description: "ノイズになる項目を一時的に隠す" },
    { id: "retry-finder", name: "再挑戦候補", area: "やること", description: "低得点や同じ回の未完了クイズを抽出" },
    { id: "attendance-margin", name: "欠席セーフティ残量", area: "出席", description: "基準出席率まであと何回休めるか参考計算" },
    { id: "absence-simulator", name: "欠席シミュレーター", area: "出席", description: "今後休んだ場合の着地出席率を試算" },
    { id: "threshold-switch", name: "出席基準スイッチ", area: "出席", description: "75%など任意の基準で危険度を再計算" },
    { id: "score-normalizer", name: "得点率の正規化", area: "成績", description: "満点が異なるテストを百分率で比較" },
    { id: "weak-score-finder", name: "弱点スコア抽出", area: "成績", description: "低得点のテストを科目横断で発見" },
    { id: "score-distribution", name: "得点分布", area: "成績", description: "得点率の偏りをヒストグラム表示" },
    { id: "weekly-timetable", name: "週間時間割", area: "時間割", description: "日付・時限・教室つきの見やすい週表示" },
    { id: "room-change", name: "教室移動アラート", area: "時間割", description: "連続授業の教室変更を先回り表示" },
    { id: "gap-finder", name: "空きコマ発見", area: "時間割", description: "授業間の空き時間を自動抽出" },
    { id: "calendar-export", name: "カレンダー書き出し", area: "時間割", description: "時間を推測せず終日予定としてICS化" },
    { id: "course-explorer", name: "科目カルテ", area: "科目", description: "各科目の出席・課題・回・得点を1画面化" },
    { id: "cross-search", name: "横断検索", area: "共通", description: "科目名・課題名をどの画面からでも検索" },
    { id: "workload-heatmap", name: "学習ヒートマップ", area: "発見", description: "授業回と課題が集中した日を可視化" },
    { id: "lesson-timeline", name: "授業タイムライン", area: "発見", description: "収集できた授業回を日付順に俯瞰" },
    { id: "study-roulette", name: "学習ルーレット", area: "発見", description: "迷ったときに未完了から1件を選ぶ" },
    { id: "focus-timer", name: "集中タイマー", area: "発見", description: "選んだ課題に25分だけ集中" },
    { id: "data-quality", name: "データ品質メーター", area: "試作品", description: "日付・時間割・教材の収集カバレッジを表示" },
    { id: "history-diff", name: "前回からの変化", area: "試作品", description: "読み込んだスナップショット間の差分を確認" },
    { id: "copy-brief", name: "ブリーフをコピー", area: "共通", description: "今日の予定をテキストでクリップボードへ" },
    { id: "csv-export", name: "未完了CSV", area: "共通", description: "表計算で検討できる形式へ書き出し" },
    { id: "adoption-review", name: "採用候補レビュー", area: "試作品", description: "良い試作品だけ印を付け選定結果をJSON化" },
    { id: "dark-mode", name: "ダークモード", area: "共通", description: "夜間でも見やすい配色へ切り替え" }
  ];

  const defaultPreferences = {
    attendanceThreshold: 0.75,
    theme: "light",
    pinnedTasks: [],
    snoozedTasks: []
  };

  const state = {
    snapshot: null,
    prefs: { ...defaultPreferences },
    reviews: {},
    history: [],
    view: "home",
    taskFilter: "pending",
    taskCourse: "all",
    rouletteKey: null,
    timerSeconds: 25 * 60,
    timerRunning: false,
    timerId: null
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const array = (value) => Array.isArray(value) ? value : [];
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
  const normalize = (value) => String(value || "").normalize("NFKC").toLowerCase();
  const unique = (items) => [...new Set(items)];
  const sum = (items, getter = (item) => item) => items.reduce((total, item) => total + (Number(getter(item)) || 0), 0);
  const average = (items, getter = (item) => item) => items.length ? sum(items, getter) / items.length : 0;
  const pad = (value) => String(value).padStart(2, "0");
  const isoDay = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

  function dashboardNow() {
    // ローカルのプレビューだけは境界時刻を再現可能にする。拡張機能では常に端末時刻を使う。
    const override = location.hostname === "127.0.0.1" ? new URLSearchParams(location.search).get("now") : null;
    const parsed = override ? new Date(override) : null;
    return parsed && !Number.isNaN(parsed.valueOf()) ? parsed : new Date();
  }

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

  function parseDate(value) {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.valueOf()) ? null : value;
    const direct = new Date(value);
    if (!Number.isNaN(direct.valueOf())) return direct;
    const match = String(value).normalize("NFKC").match(/(?:(20\d{2})\D+)?(\d{1,2})\D+(\d{1,2})(?:\D+(\d{1,2})[:時](\d{1,2})?)?/);
    if (!match) return null;
    const year = Number(match[1] || state.snapshot?.academicYear || new Date().getFullYear());
    const result = new Date(year, Number(match[2]) - 1, Number(match[3]), Number(match[4] || 0), Number(match[5] || 0));
    return Number.isNaN(result.valueOf()) ? null : result;
  }

  function formatDate(value, options = {}) {
    const date = parseDate(value);
    if (!date) return "日付なし";
    return new Intl.DateTimeFormat("ja-JP", options.long
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
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    date.setHours(0, 0, 0, 0);
    const days = Math.round((date - today) / DAY);
    if (days === 0) return "今日";
    if (days === 1) return "明日";
    if (days === -1) return "昨日";
    return days > 0 ? `${days}日後` : `${Math.abs(days)}日前`;
  }

  function isPending(report) { return /未完了|未提出|未回答|未受験|未実施/.test(report?.status || ""); }
  function isWaiting(report) { return /未採点|採点待/.test(report?.status || ""); }
  function isDone(report) { return !isPending(report) && /完了|提出済|回答済|受験済/.test(report?.status || ""); }

  function parseScore(status) {
    const normalized = String(status || "").normalize("NFKC");
    const fraction = normalized.match(/(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*点/);
    if (fraction && Number(fraction[2]) > 0) {
      const earned = Number(fraction[1]);
      const max = Number(fraction[2]);
      return { earned, max, percent: earned / max * 100 };
    }
    return null;
  }

  function snapshotReady(snapshot = state.snapshot) {
    return Boolean(snapshot && (array(snapshot.courses).length || array(snapshot.reports).length || snapshot.collectedAt));
  }

  function courseMap() {
    return new Map(array(state.snapshot?.courses).map((course) => [String(course.classId), course]));
  }

  function courseName(classId) {
    return courseMap().get(String(classId))?.name || `科目 ${classId || "不明"}`;
  }

  function colorForCourse(classId) {
    const hash = [...String(classId || "0")].reduce((total, char) => total + char.charCodeAt(0), 0);
    return COURSE_COLORS[hash % COURSE_COLORS.length];
  }

  function directoryMap() {
    return new Map(array(state.snapshot?.directories).map((item) => [`${item.classId}:${item.directoryId}`, item]));
  }

  function reportContextDate(report) {
    const scheduled = parseDate(report.scheduledAt);
    if (scheduled) return { date: scheduled, source: "scheduled" };
    const directory = directoryMap().get(`${report.classId}:${report.directoryId}`);
    const lesson = parseDate(directory?.lessonDate);
    return lesson ? { date: lesson, source: "lesson" } : { date: null, source: "none" };
  }

  function reportKey(report) {
    return [report.classId, report.directoryId, report.kind, report.title, report.status].map((value) => String(value || "")).join("::");
  }

  function attendanceRate(course) {
    const attended = Number(course.attended || 0);
    const absent = Number(course.absent || 0);
    return attended + absent ? attended / (attended + absent) : 0;
  }

  function absenceMargin(course, threshold = state.prefs.attendanceThreshold) {
    const total = Number(course.totalLessons || 0);
    const absent = Number(course.absent || 0);
    if (!total) return null;
    const maximumAbsences = Math.max(0, Math.floor(total * (1 - threshold) + 1e-8));
    return maximumAbsences - absent;
  }

  function courseStats() {
    const reports = array(state.snapshot?.reports);
    const directories = array(state.snapshot?.directories);
    return array(state.snapshot?.courses).map((course) => {
      const ownReports = reports.filter((item) => String(item.classId) === String(course.classId));
      const scores = ownReports.map((item) => parseScore(item.status)).filter(Boolean);
      const done = ownReports.filter(isDone).length;
      const completion = ownReports.length ? done / ownReports.length : 0;
      const scoreAverage = scores.length ? average(scores, (score) => score.percent) : null;
      const attendance = attendanceRate(course);
      const health = Math.round(completion * 45 + clamp(attendance, 0, 1) * 35 + (scoreAverage ?? 70) / 100 * 20);
      return {
        ...course,
        ownReports,
        reportsTotal: ownReports.length,
        done,
        pending: ownReports.filter(isPending).length,
        waiting: ownReports.filter(isWaiting).length,
        completion,
        scores,
        scoreAverage,
        attendance,
        margin: absenceMargin(course),
        directories: directories.filter((item) => String(item.classId) === String(course.classId)),
        health
      };
    });
  }

  function taskPriority(report) {
    const course = courseStats().find((item) => String(item.classId) === String(report.classId));
    const context = reportContextDate(report);
    let score = /レポート|report/i.test(report.kind || "") ? 30 : 14;
    if (/未提出/.test(report.status || "")) score += 26;
    if (/未完了/.test(report.status || "")) score += 15;
    if (course?.margin !== null && course?.margin <= 2) score += 17;
    if (context.date) {
      const days = Math.round((context.date - new Date()) / DAY);
      if (context.source === "scheduled" && days < 0) score += 40;
      else if (context.source === "scheduled" && days <= 3) score += 30;
      else if (days >= -14) score += 8;
    }
    return { score, level: score >= 55 ? "high" : score >= 32 ? "medium" : "low" };
  }

  function pendingTasks(includeSnoozed = false) {
    const snoozed = new Set(state.prefs.snoozedTasks);
    return array(state.snapshot?.reports)
      .filter(isPending)
      .map((report) => ({ ...report, key: reportKey(report), priority: taskPriority(report), context: reportContextDate(report) }))
      .filter((report) => includeSnoozed || !snoozed.has(report.key))
      .sort((a, b) => b.priority.score - a.priority.score || (b.context.date?.valueOf() || 0) - (a.context.date?.valueOf() || 0));
  }

  function todaySlots() {
    const today = isoDay(new Date());
    return array(state.snapshot?.timetableSlots).filter((slot) => slot.date === today).sort((a, b) => Number(a.period) - Number(b.period));
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

  function firstDifferentCourse(slots, startIndex, classId) {
    return slots.slice(startIndex).find((slot) => String(slot.classId) !== String(classId));
  }

  function nextDifferentCourse(now = dashboardNow()) {
    const slots = orderedTimetableSlots();
    const today = isoDay(now);
    const todaysSlots = slots.filter((slot) => slot.date === today);
    const laterDateSlot = slots.find((slot) => slot.date > today);
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const activeIndex = todaysSlots.findIndex((slot) => {
      const period = PERIOD_TIMES[Number(slot.period)];
      return clockMinutes(period.start) <= currentMinutes && currentMinutes < clockMinutes(period.end);
    });

    if (activeIndex >= 0) {
      const active = todaysSlots[activeIndex];
      const next = firstDifferentCourse(todaysSlots, activeIndex + 1, active.classId) || laterDateSlot;
      return next ? { slot: next, context: "during", current: active, startsAt: slotStart(next) } : null;
    }

    const futureIndex = todaysSlots.findIndex((slot) => clockMinutes(PERIOD_TIMES[Number(slot.period)].start) > currentMinutes);
    if (futureIndex >= 0) {
      const future = todaysSlots[futureIndex];
      const previous = [...todaysSlots.slice(0, futureIndex)].reverse().find((slot) => clockMinutes(PERIOD_TIMES[Number(slot.period)].end) <= currentMinutes);
      const isSameContinuousCourse = previous
        && Number(future.period) === Number(previous.period) + 1
        && String(future.classId) === String(previous.classId);
      if (isSameContinuousCourse) {
        const next = firstDifferentCourse(todaysSlots, futureIndex + 1, future.classId) || laterDateSlot;
        return next ? { slot: next, context: "between-continuation", current: previous, startsAt: slotStart(next) } : null;
      }
      return { slot: future, context: "upcoming", current: previous || null, startsAt: slotStart(future) };
    }

    return laterDateSlot ? { slot: laterDateSlot, context: "next-day", current: todaysSlots.at(-1) || null, startsAt: slotStart(laterDateSlot) } : null;
  }

  function nextCourseTiming(nextCourse, now = dashboardNow()) {
    if (!nextCourse?.startsAt) return "開始時刻不明";
    const minutes = Math.max(0, Math.ceil((nextCourse.startsAt - now) / 60_000));
    if (nextCourse.slot.date === isoDay(now)) {
      if (minutes < 60) return `あと${minutes}分`;
      const hours = Math.floor(minutes / 60);
      const rest = minutes % 60;
      return rest ? `あと${hours}時間${rest}分` : `あと${hours}時間`;
    }
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return nextCourse.slot.date === isoDay(tomorrow) ? "明日" : formatDate(nextCourse.slot.date);
  }

  function renderNextCourseCard() {
    const nextCourse = nextDifferentCourse();
    if (!nextCourse) {
      return `<section class="card hero-card next-course-card span-5" data-next-course-card>
        <div>${cardHead("next-course", "次の科目", "収集済みの時間割から判定")}<h3>次の科目を判定できません</h3><p class="muted">次の授業日を含む時間割をスタログで収集してください。</p></div>
        <div class="next-course-clock">--<span>限</span></div>
      </section>`;
    }
    const slot = nextCourse.slot;
    const periodTime = PERIOD_TIMES[Number(slot.period)];
    const timing = nextCourseTiming(nextCourse);
    const href = slot.classId ? `${PORTAL_ORIGIN}/lms/class/${encodeURIComponent(slot.classId)}/` : "";
    return `<section class="card hero-card next-course-card span-5" data-next-course-card data-next-class-id="${esc(slot.classId || "")}">
      <div>${cardHead("next-course", "次の科目", "同じ科目の連続時限は飛ばして表示")}
        <p class="next-course-when">${esc(timing)} · ${esc(formatDate(slot.date))}</p>
        <h3>${esc(slot.courseName || courseName(slot.classId))}</h3>
        <p class="next-course-meta">${esc(slot.period)}限 ${esc(periodTime.start)}開始${slot.room ? ` · ${esc(slot.room)}教室` : ""}</p>
        ${href ? `<a class="next-course-link" href="${esc(href)}" target="_blank" rel="noreferrer">科目を開く →</a>` : ""}
      </div>
      <div class="next-course-clock"><strong>${esc(slot.period)}</strong><span>限</span></div>
    </section>`;
  }

  function refreshNextCourseCard() {
    const current = document.querySelector("[data-next-course-card]");
    if (!current || state.view !== "home" || !snapshotReady()) return;
    const wrapper = document.createElement("div");
    wrapper.innerHTML = renderNextCourseCard();
    current.replaceWith(wrapper.firstElementChild);
  }

  function reviewedCount() {
    return Object.values(state.reviews).filter(Boolean).length;
  }

  function featureById(id) { return FEATURES.find((feature) => feature.id === id); }

  function candidateButton(id) {
    const selected = Boolean(state.reviews[id]);
    return `<button class="candidate-button${selected ? " is-selected" : ""}" data-candidate="${esc(id)}" type="button" aria-label="${selected ? "採用候補から外す" : "採用候補にする"}" title="${selected ? "採用候補" : "採用候補に追加"}">${selected ? "★" : "☆"}</button>`;
  }

  function cardHead(id, title, subtitle = "") {
    return `<div class="card-head"><div><h2>${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ""}</div><div class="card-tools"><span class="lab-chip">試作</span>${candidateButton(id)}</div></div>`;
  }

  function pageHeader(eyebrow, title, subtitle, actions = "") {
    return `<div class="page-header"><div><p class="eyebrow">${esc(eyebrow)}</p><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div>${actions ? `<div class="header-actions">${actions}</div>` : ""}</div>`;
  }

  function statusPill(report) {
    const type = isPending(report) ? "pending" : isWaiting(report) ? "waiting" : "done";
    return `<span class="status-pill ${type}">${esc(report.status || "状態なし")}</span>`;
  }

  function priorityLabel(priority) {
    const labels = { high: "優先", medium: "次点", low: "通常" };
    return `<span class="priority-pill ${priority.level}">${labels[priority.level]}</span>`;
  }

  function reportLink(report) {
    const path = String(report.href || "");
    if (!path.startsWith("/")) return "";
    return `${PORTAL_ORIGIN}${path}`;
  }

  function renderTaskRows(tasks, limit = Infinity) {
    if (!tasks.length) return `<div class="empty-inline">該当する項目はありません。</div>`;
    const pinned = new Set(state.prefs.pinnedTasks);
    const snoozed = new Set(state.prefs.snoozedTasks);
    return `<div class="task-list">${tasks.slice(0, limit).map((report) => {
      const link = reportLink(report);
      const dateLabel = report.context?.date ? `${relativeDate(report.context.date)} · ${formatDate(report.context.date)}` : "日付なし";
      return `<div class="task-row${snoozed.has(report.key) ? " is-snoozed" : ""}">
        <button class="task-check${pinned.has(report.key) ? " is-pinned" : ""}" data-task-pin="${esc(report.key)}" type="button" title="自分用リストに固定">${pinned.has(report.key) ? "✓" : ""}</button>
        ${priorityLabel(report.priority)}
        <div class="row-main"><strong>${esc(report.title || "名称なし")}</strong><span>${esc(courseName(report.classId))} · ${esc(report.kind || "項目")} · ${esc(dateLabel)}</span></div>
        <button class="tiny-action" data-task-snooze="${esc(report.key)}" type="button" title="あとで見る">${snoozed.has(report.key) ? "↺" : "◷"}</button>
        ${link ? `<a class="secondary-button" href="${esc(link)}" target="_blank" rel="noreferrer">開く</a>` : statusPill(report)}
      </div>`;
    }).join("")}</div>`;
  }

  function renderHome() {
    const reports = array(state.snapshot.reports);
    const tasks = pendingTasks();
    const done = reports.filter(isDone).length;
    const waiting = reports.filter(isWaiting).length;
    const completion = reports.length ? Math.round(done / reports.length * 100) : 0;
    const courses = courseStats();
    const atRisk = courses.filter((course) => course.margin !== null && course.margin <= 2).sort((a, b) => a.margin - b.margin);
    const today = todaySlots();
    const next = nextDifferentCourse()?.slot;
    const freshnessHours = state.snapshot.collectedAt ? Math.max(0, Math.round((Date.now() - parseDate(state.snapshot.collectedAt)) / 3_600_000)) : null;

    const actions = `<button class="secondary-button" data-copy-brief type="button">今日をコピー</button><button class="primary-button" data-view-target="tasks" type="button">やることを見る</button>`;
    let html = pageHeader("OVERVIEW", `${new Intl.DateTimeFormat("ja-JP", { month: "long", day: "numeric", weekday: "long" }).format(new Date())}`, `${freshnessHours === null ? "未取得" : freshnessHours < 1 ? "1時間以内に更新" : `${freshnessHours}時間前に更新`} · ${array(state.snapshot.courses).length}科目を横断`, actions);
    html += `<div class="bento-grid">
      <section class="card span-7">${cardHead("daily-brief", "いまの全体像", "収集データの主要指標")}
        <div class="metric-row">
          <div class="metric"><strong>${tasks.length}</strong><span>未完了・未提出</span><small>${tasks.filter((item) => item.priority.level === "high").length}件を優先判定</small></div>
          <div class="metric"><strong>${completion}<small>%</small></strong><span>課題・テスト完了率</span><small>${done} / ${reports.length}件</small></div>
          <div class="metric"><strong>${waiting}</strong><span>提出済・未採点</span><small>結果待ち</small></div>
          <div class="metric"><strong>${atRisk.length}</strong><span>出席の要注意科目</span><small>余裕2回以下</small></div>
        </div>
      </section>

      ${renderNextCourseCard()}

      <section class="card span-4">${cardHead("progress-ring", "学習の消化率", "完了と結果待ちを分けて表示")}
        <div style="display:flex;align-items:center;gap:18px">
          <div class="ring" style="--value:${completion}"><div class="ring-label"><strong>${completion}%</strong><span>完了済み</span></div></div>
          <div style="flex:1"><div class="progress-label"><span>完了</span><strong>${done}</strong></div><div class="progress-track"><div class="progress-fill good" style="width:${completion}%"></div></div>
          <div class="progress-label" style="margin-top:12px"><span>未完了</span><strong>${tasks.length}</strong></div><div class="progress-track"><div class="progress-fill danger" style="width:${reports.length ? tasks.length / reports.length * 100 : 0}%"></div></div></div>
        </div>
      </section>

      <section class="card span-4">${cardHead("daily-brief", today.length ? "今日の授業" : "次の授業", today.length ? `${today.length}コマを取得` : "取得済み時間割から表示")}
        <div class="compact-list">${(today.length ? today : next ? [next] : []).map((slot) => `<div class="list-row"><span class="row-icon">${esc(slot.period || "?")}</span><div class="row-main"><strong>${esc(slot.courseName || courseName(slot.classId))}</strong><span>${esc(slot.room ? `${slot.room}教室` : "教室未取得")} · ${esc(formatDate(slot.date))}</span></div><div class="row-meta"><strong>${esc(slot.period || "?")}限</strong></div></div>`).join("") || `<div class="empty-inline">時間割がまだ記録されていません。</div>`}</div>
      </section>

      <section class="card span-4">${cardHead("attendance-alert", "出席アラート", `基準 ${Math.round(state.prefs.attendanceThreshold * 100)}% の参考値`)}
        <div class="compact-list">${atRisk.slice(0, 4).map((course) => `<div class="list-row"><span class="row-icon">!</span><div class="row-main"><strong>${esc(course.name)}</strong><span>現在 ${Math.round(course.attendance * 100)}% · 欠席${course.absent || 0}回</span></div><div class="row-meta"><strong class="${course.margin < 0 ? "text-danger" : "text-warn"}">${course.margin < 0 ? `${Math.abs(course.margin)}超過` : `残${course.margin}回`}</strong></div></div>`).join("") || `<div class="empty-inline">要注意科目はありません。</div>`}</div>
      </section>

      <section class="card span-7">${cardHead("action-triage", "次にやること", "優先度の高い未完了を3件に絞る")}${renderTaskRows(tasks, 3)}</section>

      <section class="card span-5">${cardHead("course-health", "科目ヘルス", "出席・課題・得点の合成スコア")}
        <div class="compact-list">${courses.sort((a, b) => a.health - b.health).slice(0, 5).map((course) => `<button class="list-row" style="border:0;width:100%;text-align:left;cursor:pointer" data-course-open="${esc(course.classId)}" type="button"><span class="row-icon" style="color:${colorForCourse(course.classId)}">●</span><div class="row-main"><strong>${esc(course.name)}</strong><span>未完了 ${course.pending} · 出席 ${Math.round(course.attendance * 100)}%</span></div><div class="row-meta"><strong>${course.health}</strong><span>/ 100</span></div></button>`).join("")}</div>
      </section>
    </div>`;
    return html;
  }

  function renderTasks() {
    const allTasks = pendingTasks(true);
    const pinned = new Set(state.prefs.pinnedTasks);
    const snoozed = new Set(state.prefs.snoozedTasks);
    let tasks = allTasks;
    if (state.taskFilter === "high") tasks = tasks.filter((item) => item.priority.level === "high");
    if (state.taskFilter === "report") tasks = tasks.filter((item) => /レポート|report/i.test(item.kind || ""));
    if (state.taskFilter === "quiz") tasks = tasks.filter((item) => /クイズ|quiz|test/i.test(item.kind || ""));
    if (state.taskFilter === "pinned") tasks = tasks.filter((item) => pinned.has(item.key));
    if (state.taskFilter !== "snoozed") tasks = tasks.filter((item) => !snoozed.has(item.key));
    else tasks = tasks.filter((item) => snoozed.has(item.key));
    if (state.taskCourse !== "all") tasks = tasks.filter((item) => String(item.classId) === state.taskCourse);

    const scores = array(state.snapshot.reports).map((report) => ({ report, score: parseScore(report.status) })).filter((entry) => entry.score && entry.score.percent < 70).sort((a, b) => a.score.percent - b.score.percent);
    const grouped = new Map();
    array(state.snapshot.reports).forEach((report) => {
      const key = `${report.classId}:${report.directoryId}:${normalize(report.title)}`;
      const items = grouped.get(key) || [];
      items.push(report);
      grouped.set(key, items);
    });
    const retryGroups = [...grouped.values()].filter((items) => items.some(isPending) && items.some((item) => parseScore(item.status)));
    const retry = [...scores.slice(0, 5), ...retryGroups.slice(0, 5).map((items) => ({ report: items.find(isPending), score: parseScore(items.find((item) => parseScore(item.status))?.status) }))]
      .filter((entry, index, list) => list.findIndex((other) => reportKey(other.report) === reportKey(entry.report)) === index)
      .slice(0, 6);

    const courses = courseStats().filter((course) => course.pending).sort((a, b) => b.pending - a.pending);
    const filters = [
      ["pending", `未完了 ${allTasks.filter((item) => !snoozed.has(item.key)).length}`],
      ["high", "優先"], ["report", "レポート"], ["quiz", "クイズ"],
      ["pinned", `固定 ${allTasks.filter((item) => pinned.has(item.key)).length}`], ["snoozed", "あとで"]
    ];
    const filterHtml = `<div class="filter-bar">${filters.map(([value, label]) => `<button class="filter-chip${state.taskFilter === value ? " is-active" : ""}" data-task-filter="${value}" type="button">${esc(label)}</button>`).join("")}<select id="task-course-filter"><option value="all">すべての科目</option>${courses.map((course) => `<option value="${esc(course.classId)}"${state.taskCourse === String(course.classId) ? " selected" : ""}>${esc(course.name)} (${course.pending})</option>`).join("")}</select></div>`;

    return pageHeader("TASK INBOX", "やること", "未完了を整理し、自分用の短いリストを作る", `<button class="secondary-button" data-export-csv type="button">CSV書き出し</button>`) +
      `<div class="bento-grid">
        <section class="card span-8">${cardHead("task-inbox", "未完了インボックス", `${tasks.length}件を表示`)}${filterHtml}${renderTaskRows(tasks)}</section>
        <div class="span-4" style="display:grid;gap:14px;align-content:start">
          <section class="card">${cardHead("retry-finder", "再挑戦候補", "低得点・未完了の組み合わせ")}
            <div class="compact-list">${retry.map(({ report, score }) => `<div class="list-row"><span class="row-icon">↺</span><div class="row-main"><strong>${esc(report.title || "名称なし")}</strong><span>${esc(courseName(report.classId))}</span></div><div class="row-meta"><strong class="text-warn">${score ? Math.round(score.percent) + "%" : "再挑戦"}</strong></div></div>`).join("") || `<div class="empty-inline">候補は見つかりませんでした。</div>`}</div>
          </section>
          <section class="card roulette">${cardHead("study-roulette", "迷ったら1件", "未完了からランダムに選ぶ")}
            ${renderRoulette(allTasks.filter((item) => !snoozed.has(item.key)))}
          </section>
          <section class="card">${cardHead("task-pin", "自分用リスト", "チェックした項目だけを固定")}
            <div class="metric-row" style="grid-template-columns:repeat(2,1fr)"><div class="metric"><strong>${allTasks.filter((item) => pinned.has(item.key)).length}</strong><span>固定中</span></div><div class="metric"><strong>${allTasks.filter((item) => snoozed.has(item.key)).length}</strong><span>あとで見る</span></div></div>
          </section>
        </div>
      </div>`;
  }

  function renderRoulette(tasks) {
    const selected = tasks.find((item) => item.key === state.rouletteKey) || tasks[0];
    return `<div class="roulette-orb"><span>PICK ONE</span><strong>${esc(selected?.title || "未完了なし")}</strong></div><button class="primary-button" data-roulette type="button"${tasks.length ? "" : " disabled"}>もう1回まわす</button>`;
  }

  function renderAttendance() {
    const courses = courseStats().sort((a, b) => (a.margin ?? 999) - (b.margin ?? 999));
    const totalAttended = sum(courses, (course) => course.attended);
    const totalAbsent = sum(courses, (course) => course.absent);
    const overallRate = totalAttended + totalAbsent ? totalAttended / (totalAttended + totalAbsent) : 0;
    const threshold = state.prefs.attendanceThreshold;
    const risky = courses.filter((course) => course.margin !== null && course.margin <= 2).length;
    const selected = courses[0];
    return pageHeader("ATTENDANCE", "出席の安全余裕", "公式判定ではなく、収集値からの早期警戒用シミュレーション", `<label class="secondary-button">基準 <select id="threshold-select"><option value="0.66"${threshold === .66 ? " selected" : ""}>66%</option><option value="0.75"${threshold === .75 ? " selected" : ""}>75%</option><option value="0.8"${threshold === .8 ? " selected" : ""}>80%</option></select></label>`) +
      `<div class="bento-grid">
        <section class="card span-4 tint-brand">${cardHead("attendance-margin", "全科目の出席率", `${totalAttended}出席 / ${totalAbsent}欠席`)}
          <div style="display:flex;align-items:center;gap:20px"><div class="ring tint" style="--value:${Math.round(overallRate * 100)};--ring-color:var(--brand)"><div class="ring-label"><strong>${Math.round(overallRate * 100)}%</strong><span>現在</span></div></div><div><div class="hero-number" style="font-size:48px;color:var(--ink)">${risky}<small>科目</small></div><p class="muted" style="font-size:10px;margin:8px 0 0">欠席余裕2回以下</p></div></div>
        </section>
        <section class="card span-8">${cardHead("absence-simulator", "もしあと何回休んだら？", "科目と欠席回数を動かして確認")}${renderAttendanceSimulator(selected)}</section>
        <section class="card span-12">${cardHead("attendance-margin", "科目別セーフティ残量", `基準 ${Math.round(threshold * 100)}% · 公欠は参考表示のみ`)}
          <table class="attendance-table"><thead><tr><th>科目</th><th>現在の出席率</th><th>出席</th><th>欠席</th><th>公欠</th><th>残り授業</th><th>欠席余裕</th></tr></thead><tbody>${courses.map((course) => {
            const rate = Math.round(course.attendance * 100);
            const remaining = Math.max(0, Number(course.totalLessons || 0) - Number(course.attended || 0) - Number(course.absent || 0) - Number(course.publicAbsent || 0));
            const cls = course.margin < 0 ? "text-danger" : course.margin <= 2 ? "text-warn" : "text-good";
            return `<tr data-course-open="${esc(course.classId)}"><td class="table-course">${esc(course.name)}</td><td class="rate-cell"><div class="progress-label"><span>${rate}%</span></div><div class="progress-track"><div class="progress-fill ${rate < threshold * 100 ? "danger" : rate < threshold * 100 + 8 ? "warn" : "good"}" style="width:${rate}%"></div></div></td><td>${course.attended || 0}</td><td>${course.absent || 0}</td><td>${course.publicAbsent || 0}</td><td>${remaining}</td><td><strong class="${cls}">${course.margin === null ? "—" : course.margin < 0 ? `${Math.abs(course.margin)}回超過` : `${course.margin}回`}</strong></td></tr>`;
          }).join("")}</tbody></table>
          <p class="help-text">「欠席余裕」は総授業数×基準率からの単純試算です。進級・単位認定の正式条件や公欠の扱いは学校の規定を確認してください。</p>
        </section>
      </div>`;
  }

  function renderAttendanceSimulator(course) {
    if (!course) return `<div class="empty-inline">科目データがありません。</div>`;
    const remaining = Math.max(0, Number(course.totalLessons || 0) - Number(course.attended || 0) - Number(course.absent || 0) - Number(course.publicAbsent || 0));
    return `<div class="simulator"><label>科目<select id="sim-course">${courseStats().map((item) => `<option value="${esc(item.classId)}"${String(item.classId) === String(course.classId) ? " selected" : ""}>${esc(item.name)}</option>`).join("")}</select></label><label>今後休む回数: <strong id="sim-absence-label">0回</strong><input id="sim-absence" type="range" min="0" max="${remaining}" value="0"></label><div class="sim-result"><span><strong id="sim-rate">${Math.round(course.attendance * 100)}%</strong><small class="muted" style="display:block">予想出席率</small></span><span id="sim-judgement" class="status-pill ${course.attendance >= state.prefs.attendanceThreshold ? "done" : "pending"}">${course.attendance >= state.prefs.attendanceThreshold ? "基準以上" : "基準未満"}</span></div></div>`;
  }

  function renderResults() {
    const reports = array(state.snapshot.reports);
    const scored = reports.map((report) => ({ report, score: parseScore(report.status) })).filter((entry) => entry.score);
    const averageScore = average(scored, (entry) => entry.score.percent);
    const perfect = scored.filter((entry) => entry.score.percent >= 99.999).length;
    const weak = scored.filter((entry) => entry.score.percent < 70).sort((a, b) => a.score.percent - b.score.percent);
    const bins = Array(10).fill(0);
    scored.forEach((entry) => { bins[Math.min(9, Math.floor(entry.score.percent / 10))] += 1; });
    const maxBin = Math.max(...bins, 1);
    const courses = courseStats().filter((course) => course.scores.length).sort((a, b) => (a.scoreAverage ?? 0) - (b.scoreAverage ?? 0));
    return pageHeader("RESULTS", "得点の見え方を変える", "満点が違うテストを正規化し、改善候補を探す") +
      `<div class="bento-grid">
        <section class="card span-7">${cardHead("score-normalizer", "正規化した成績サマリー", "「獲得点 / 満点」を得点率へ統一")}
          <div class="metric-row"><div class="metric"><strong>${Math.round(averageScore)}%</strong><span>平均得点率</span></div><div class="metric"><strong>${scored.length}</strong><span>採点済み</span></div><div class="metric"><strong>${perfect}</strong><span>満点</span></div><div class="metric"><strong>${weak.length}</strong><span>70%未満</span></div></div>
        </section>
        <section class="card span-5">${cardHead("score-distribution", "得点分布", "10点刻みのヒストグラム")}
          <div class="score-distribution">${bins.map((count, index) => `<div class="score-bar" title="${index * 10}〜${index === 9 ? 100 : index * 10 + 9}%: ${count}件" style="--bar-height:${count / maxBin * 100}%"><span>${index * 10}</span></div>`).join("")}</div>
        </section>
        <section class="card span-7">${cardHead("score-normalizer", "科目別の得点率", "採点済み項目だけで集計")}
          <table class="score-table"><thead><tr><th>科目</th><th>平均</th><th>採点数</th><th>満点</th><th>70%未満</th></tr></thead><tbody>${courses.map((course) => `<tr data-course-open="${esc(course.classId)}"><td class="table-course">${esc(course.name)}</td><td class="rate-cell"><div class="progress-label"><strong>${Math.round(course.scoreAverage)}%</strong></div><div class="progress-track"><div class="progress-fill ${course.scoreAverage < 70 ? "danger" : course.scoreAverage < 85 ? "warn" : "good"}" style="width:${course.scoreAverage}%"></div></div></td><td>${course.scores.length}</td><td>${course.scores.filter((score) => score.percent >= 99.999).length}</td><td>${course.scores.filter((score) => score.percent < 70).length}</td></tr>`).join("")}</tbody></table>
        </section>
        <section class="card span-5">${cardHead("weak-score-finder", "改善候補", "得点率が低い順")}
          <div class="compact-list">${weak.slice(0, 8).map(({ report, score }) => `<div class="list-row"><span class="row-icon">${Math.round(score.percent)}</span><div class="row-main"><strong>${esc(report.title || "名称なし")}</strong><span>${esc(courseName(report.classId))} · ${esc(report.kind)}</span></div><div class="row-meta"><strong class="text-danger">${score.earned}/${score.max}</strong></div></div>`).join("") || `<div class="empty-inline">70%未満の項目はありません。</div>`}</div>
        </section>
      </div>`;
  }

  function timetableDays() {
    return unique(array(state.snapshot.timetableSlots).map((slot) => slot.date).filter(Boolean)).sort();
  }

  function timetableWarnings() {
    const groups = new Map();
    array(state.snapshot.timetableSlots).forEach((slot) => {
      if (!slot.date || !slot.period) return;
      const list = groups.get(slot.date) || [];
      list.push(slot);
      groups.set(slot.date, list);
    });
    const roomMoves = [];
    const gaps = [];
    for (const [date, slots] of groups) {
      slots.sort((a, b) => Number(a.period) - Number(b.period));
      for (let index = 1; index < slots.length; index += 1) {
        const previous = slots[index - 1];
        const current = slots[index];
        const gap = Number(current.period) - Number(previous.period);
        if (gap === 1 && previous.room && current.room && previous.room !== current.room) roomMoves.push({ date, previous, current });
        if (gap > 1) gaps.push({ date, from: previous.period, to: current.period, count: gap - 1 });
      }
    }
    return { roomMoves, gaps };
  }

  function renderTimetable() {
    const days = timetableDays();
    const slots = array(state.snapshot.timetableSlots);
    const periods = unique(slots.map((slot) => Number(slot.period)).filter(Boolean)).sort((a, b) => a - b);
    const { roomMoves, gaps } = timetableWarnings();
    const grid = days.length ? `<div class="week-board"><div class="week-grid" style="--day-count:${days.length}"><div></div>${days.map((day) => `<div class="week-head${day === isoDay(new Date()) ? " is-today" : ""}">${esc(formatDate(day))}</div>`).join("")}${periods.flatMap((period) => [`<div class="period-label">${period}限</div>`, ...days.map((day) => {
      const slot = slots.find((item) => item.date === day && Number(item.period) === period);
      return `<div class="schedule-cell">${slot ? `<div class="schedule-event" style="border-color:${colorForCourse(slot.classId)}"><strong>${esc(slot.courseName || courseName(slot.classId))}</strong><span>${esc(slot.room ? `${slot.room}教室` : "教室未取得")}</span></div>` : ""}</div>`;
    })]).join("")}</div></div>` : `<div class="empty-inline">トップ画面で時間割を収集すると表示されます。</div>`;
    return pageHeader("TIMETABLE", "時間割を、移動まで読む", "見た目だけでなく空きコマと教室変更を抽出", `<button class="secondary-button" data-copy-brief type="button">今日をコピー</button><button class="primary-button" data-export-ics type="button">ICS書き出し</button>`) +
      `<div class="bento-grid">
        <section class="card span-12">${cardHead("weekly-timetable", "取得した週", `${days.length}日 · ${slots.length}コマ`)}${grid}</section>
        <section class="card span-6">${cardHead("room-change", "教室移動", "連続する時限の教室変更")}
          <div class="compact-list">${roomMoves.map((move) => `<div class="list-row"><span class="row-icon">→</span><div class="row-main"><strong>${esc(move.previous.room)} → ${esc(move.current.room)}</strong><span>${esc(formatDate(move.date))} · ${move.previous.period}限から${move.current.period}限</span></div><div class="row-meta"><strong>${esc(move.current.courseName || courseName(move.current.classId))}</strong></div></div>`).join("") || `<div class="empty-inline">連続授業の教室変更はありません。</div>`}</div>
        </section>
        <section class="card span-6">${cardHead("gap-finder", "空きコマ", "授業の間に空いている時限")}
          <div class="compact-list">${gaps.map((gap) => `<div class="list-row"><span class="row-icon">○</span><div class="row-main"><strong>${gap.count}コマ空き</strong><span>${esc(formatDate(gap.date))} · ${gap.from}限と${gap.to}限の間</span></div><div class="row-meta"><strong>集中候補</strong></div></div>`).join("") || `<div class="empty-inline">空きコマは見つかりませんでした。</div>`}</div>
        </section>
      </div>`;
  }

  function renderCourses() {
    const courses = courseStats().sort((a, b) => a.name.localeCompare(b.name, "ja"));
    return pageHeader("COURSES", "科目カルテ", "科目を開いて、出席・課題・授業回をまとめて確認") +
      `<section>${cardHead("course-explorer", `${courses.length}科目`, "カードを選ぶと詳細を表示")}<div class="course-grid">${courses.map((course) => `<button class="course-card" style="--course-color:${colorForCourse(course.classId)};text-align:left" data-course-open="${esc(course.classId)}" type="button"><span class="kind-pill">${esc(course.term || "期間不明")}</span><h2>${esc(course.name)}</h2><p>${esc(course.period || "実施期間未取得")} · ${course.directories.length}回を収集</p><div class="course-card-metrics"><div><strong>${Math.round(course.attendance * 100)}%</strong><span>出席率</span></div><div><strong>${course.pending}</strong><span>未完了</span></div><div><strong>${course.scoreAverage === null ? "—" : Math.round(course.scoreAverage) + "%"}</strong><span>平均得点率</span></div></div></button>`).join("")}</div></section>`;
  }

  function activityByDate() {
    const counts = new Map();
    array(state.snapshot.directories).forEach((directory) => {
      if (directory.lessonDate) counts.set(directory.lessonDate, (counts.get(directory.lessonDate) || 0) + 1);
    });
    array(state.snapshot.reports).forEach((report) => {
      const context = reportContextDate(report);
      if (context.date) {
        const key = isoDay(context.date);
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    });
    return counts;
  }

  function insightItems() {
    const courses = courseStats();
    const tasks = pendingTasks();
    const weak = array(state.snapshot.reports).map((report) => ({ report, score: parseScore(report.status) })).filter((entry) => entry.score?.percent < 70);
    const mostPending = [...courses].sort((a, b) => b.pending - a.pending)[0];
    const tightest = [...courses].filter((course) => course.margin !== null).sort((a, b) => a.margin - b.margin)[0];
    const strongest = [...courses].filter((course) => course.scoreAverage !== null).sort((a, b) => b.scoreAverage - a.scoreAverage)[0];
    return [
      mostPending && { icon: "✓", title: `${mostPending.name}に未完了が${mostPending.pending}件`, body: `全未完了の${tasks.length ? Math.round(mostPending.pending / tasks.length * 100) : 0}%がこの科目に集中しています。` },
      tightest && { icon: "!", title: `${tightest.name}の欠席余裕は${tightest.margin}回`, body: `基準${Math.round(state.prefs.attendanceThreshold * 100)}%での参考値です。次回の出席を優先する判断材料になります。` },
      strongest && { icon: "↗", title: `${strongest.name}の平均得点率は${Math.round(strongest.scoreAverage)}%`, body: `${strongest.scores.length}件の採点済み項目を満点差をならして比較しました。` },
      weak.length && { icon: "↺", title: `70%未満の結果が${weak.length}件`, body: "再挑戦できるクイズや、復習テーマの候補としてまとめられます。" },
      { icon: "⌁", title: `授業回の日付カバー率 ${Math.round(array(state.snapshot.directories).filter((item) => item.lessonDate).length / Math.max(1, array(state.snapshot.directories).length) * 100)}%`, body: "日付が増えるほど、負荷の集中や学習タイムラインの精度が上がります。" }
    ].filter(Boolean);
  }

  function renderInsights() {
    const counts = activityByDate();
    const dates = [...counts.keys()].sort();
    const lastDate = parseDate(dates.at(-1)) || new Date();
    const cells = Array.from({ length: 84 }, (_, index) => {
      const date = new Date(lastDate);
      date.setDate(lastDate.getDate() - (83 - index));
      const key = isoDay(date);
      const count = counts.get(key) || 0;
      const level = count === 0 ? 0 : count <= 2 ? 1 : count <= 5 ? 2 : count <= 8 ? 3 : 4;
      return `<span class="heat-cell${level ? ` l${level}` : ""}" title="${esc(formatDate(key))}: ${count}件"></span>`;
    }).join("");
    const timeline = array(state.snapshot.directories).filter((item) => item.lessonDate).sort((a, b) => String(b.lessonDate).localeCompare(String(a.lessonDate))).slice(0, 9);
    const currentTasks = pendingTasks();
    const historyDiff = getHistoryDiff();
    return pageHeader("INSIGHTS", "データから見つける", "断定ではなく、次の行動につながる小さな気づき") +
      `<div class="bento-grid">
        <section class="card span-7">${cardHead("workload-heatmap", "学習負荷ヒートマップ", "直近12週間・授業回と課題の記録密度")}<div class="heatmap">${cells}</div><p class="help-text">色が濃い日は、授業回または課題の記録が多い日です。締切日とは限りません。</p></section>
        <section class="card span-5">${cardHead("history-diff", "前回からの変化", "保存したスナップショットを比較")}
          ${historyDiff ? `<div class="metric-row" style="grid-template-columns:repeat(3,1fr)"><div class="metric"><strong>${historyDiff.completed >= 0 ? "+" : ""}${historyDiff.completed}</strong><span>完了</span></div><div class="metric"><strong>${historyDiff.pending >= 0 ? "+" : ""}${historyDiff.pending}</strong><span>未完了</span></div><div class="metric"><strong>${historyDiff.absences >= 0 ? "+" : ""}${historyDiff.absences}</strong><span>欠席</span></div></div>` : `<div class="empty-inline">別の時点のJSONを読み込むと差分が表示されます。</div>`}
        </section>
        <section class="card span-5">${cardHead("lesson-timeline", "最近の授業回", "日付を取得できた回だけを表示")}
          <div class="timeline">${timeline.map((item) => `<div class="timeline-row"><span class="timeline-date">${esc(formatDate(item.lessonDate))}</span><span class="timeline-axis"></span><div class="timeline-content"><strong>${esc(courseName(item.classId))}</strong><span>${esc(item.title || `第${item.lessonNumber || "?"}回`)}</span></div></div>`).join("") || `<div class="empty-inline">日付つき授業回がありません。</div>`}</div>
        </section>
        <section class="card span-7">${cardHead("data-quality", "自動で見つけたこと", "データに根拠がある観察だけ")}
          <div class="insight-list">${insightItems().map((item) => `<div class="insight-row"><span class="row-icon">${item.icon}</span><div><strong>${esc(item.title)}</strong><p>${esc(item.body)}</p></div></div>`).join("")}</div>
        </section>
        <section class="card span-6 roulette">${cardHead("study-roulette", "学習ルーレット", "選ぶ時間を減らして着手する")}${renderRoulette(currentTasks)}</section>
        <section class="card span-6 focus-timer">${cardHead("focus-timer", "25分集中タイマー", "端末内で完結する簡易タイマー")}${renderTimer()}</section>
      </div>`;
  }

  function renderTimer() {
    return `<div class="timer-display" id="timer-display">${pad(Math.floor(state.timerSeconds / 60))}:${pad(state.timerSeconds % 60)}</div><div class="timer-actions"><button class="primary-button" data-timer-toggle type="button">${state.timerRunning ? "一時停止" : "スタート"}</button><button class="secondary-button" data-timer-reset type="button">リセット</button></div>`;
  }

  function qualityMetrics() {
    const directories = array(state.snapshot.directories);
    const slots = array(state.snapshot.timetableSlots);
    const reports = array(state.snapshot.reports);
    return [
      { label: "科目基本情報", value: array(state.snapshot.courses).filter((item) => item.name).length, total: array(state.snapshot.courses).length },
      { label: "授業回の日付", value: directories.filter((item) => item.lessonDate).length, total: directories.length },
      { label: "課題の状態", value: reports.filter((item) => item.status).length, total: reports.length },
      { label: "時間割の日付", value: slots.filter((item) => item.date).length, total: slots.length },
      { label: "時間割の教室", value: slots.filter((item) => item.room).length, total: slots.length },
      { label: "教材項目", value: array(state.snapshot.directoryItems).length, total: directories.length }
    ];
  }

  function renderLab() {
    const selected = reviewedCount();
    const quality = qualityMetrics();
    return pageHeader("PROTOTYPE REVIEW", "試作品から宝石を選ぶ", `${FEATURES.length}個の小さな機能を個別に評価`, `<button class="secondary-button" data-clear-reviews type="button">選択をクリア</button><button class="primary-button" data-export-reviews type="button">選定結果を書き出す</button>`) +
      `<div class="bento-grid">
        <section class="card span-4 tint-accent">${cardHead("adoption-review", "採用候補", "星を付けた試作品")}
          <div class="hero-number" style="color:var(--ink);margin:16px 0">${selected}<small>/ ${FEATURES.length}</small></div><p class="muted" style="font-size:10px">各カード右上の ☆ でも選べます。</p>
        </section>
        <section class="card span-8">${cardHead("data-quality", "データ品質", "機能の判断に使える収集カバレッジ")}
          <div class="quality-grid">${quality.map((item) => { const rate = item.total ? Math.round(item.value / item.total * 100) : 0; return `<div class="quality-item"><strong>${rate}%</strong><span>${esc(item.label)} · ${item.value}/${item.total}</span></div>`; }).join("")}</div>
        </section>
        <section class="span-12"><div class="filter-bar" id="catalog-filters"><button class="filter-chip is-active" data-catalog-area="all" type="button">すべて ${FEATURES.length}</button>${unique(FEATURES.map((feature) => feature.area)).map((area) => `<button class="filter-chip" data-catalog-area="${esc(area)}" type="button">${esc(area)}</button>`).join("")}<button class="filter-chip" data-catalog-area="selected" type="button">★ 採用候補</button></div>
          <div class="catalog-grid" id="catalog-grid">${renderCatalogItems(FEATURES)}</div>
        </section>
      </div>`;
  }

  function renderCatalogItems(features) {
    return features.map((feature, index) => `<article class="catalog-item${state.reviews[feature.id] ? " is-selected" : ""}" data-feature-area="${esc(feature.area)}"><span class="catalog-number">${pad(FEATURES.indexOf(feature) + 1)}</span><div><h2>${esc(feature.name)}</h2><p>${esc(feature.description)}</p><div class="catalog-tag">${esc(feature.area)}</div></div>${candidateButton(feature.id)}</article>`).join("") || `<div class="empty-inline">該当する試作品はありません。</div>`;
  }

  function renderCourseDialog(classId) {
    const course = courseStats().find((item) => String(item.classId) === String(classId));
    if (!course) return;
    const heading = $("#course-dialog-heading");
    const body = $("#course-dialog-body");
    heading.innerHTML = `<p class="eyebrow">COURSE FILE</p><h2>${esc(course.name)}</h2>`;
    const recentDirectories = [...course.directories].filter((item) => item.lessonDate).sort((a, b) => String(b.lessonDate).localeCompare(String(a.lessonDate))).slice(0, 8);
    const pending = course.ownReports.filter(isPending).map((report) => ({ ...report, key: reportKey(report), priority: taskPriority(report), context: reportContextDate(report) }));
    body.innerHTML = `<div class="metric-row"><div class="metric"><strong>${Math.round(course.attendance * 100)}%</strong><span>出席率</span></div><div class="metric"><strong>${course.margin ?? "—"}</strong><span>欠席余裕</span></div><div class="metric"><strong>${course.pending}</strong><span>未完了</span></div><div class="metric"><strong>${course.scoreAverage === null ? "—" : Math.round(course.scoreAverage) + "%"}</strong><span>平均得点率</span></div></div>
      <div class="bento-grid" style="margin-top:18px"><section class="card flat span-7"><div class="card-head"><div><h2>未完了</h2><p>${pending.length}件</p></div></div>${renderTaskRows(pending, 8)}</section><section class="card flat span-5"><div class="card-head"><div><h2>最近の授業回</h2><p>${course.directories.length}回を収集</p></div></div><div class="timeline">${recentDirectories.map((item) => `<div class="timeline-row"><span class="timeline-date">${esc(formatDate(item.lessonDate))}</span><span class="timeline-axis"></span><div class="timeline-content"><strong>${esc(item.title || `第${item.lessonNumber || "?"}回`)}</strong><span>${esc(item.dateSource || "日付")}</span></div></div>`).join("") || `<div class="empty-inline">日付つき授業回がありません。</div>`}</div></section></div>`;
    $("#course-dialog").showModal();
  }

  function render() {
    updateReviewCounter();
    if (!snapshotReady()) {
      $("#app-view").replaceChildren($("#empty-state-template").content.cloneNode(true));
      return;
    }
    const renderers = { home: renderHome, tasks: renderTasks, attendance: renderAttendance, results: renderResults, timetable: renderTimetable, courses: renderCourses, insights: renderInsights, lab: renderLab };
    $("#app-view").innerHTML = (renderers[state.view] || renderHome)();
    $$(".nav-item").forEach((item) => item.classList.toggle("is-active", item.dataset.view === state.view));
  }

  function updateReviewCounter() {
    const count = reviewedCount();
    $("#review-counter strong").textContent = count;
  }

  function updateDataSummary() {
    const summary = $("#data-summary");
    if (!snapshotReady()) {
      summary.innerHTML = "まだデータを読み込んでいません。";
      return;
    }
    summary.innerHTML = `<strong>最終取得: ${esc(formatDateTime(state.snapshot.collectedAt))}</strong><br>${array(state.snapshot.courses).length}科目 · ${array(state.snapshot.reports).length}課題/テスト · ${array(state.snapshot.directories).length}授業回 · ${array(state.snapshot.timetableSlots).length}時間割スロット<br>スキーマ v${esc(state.snapshot.schemaVersion || "?")} · 履修年度 ${esc(state.snapshot.academicYear || "不明")}`;
  }

  function toast(message) {
    const element = document.createElement("div");
    element.className = "toast";
    element.textContent = message;
    $("#toast-region").append(element);
    setTimeout(() => element.remove(), 3000);
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

  function csvCell(value) { return `"${String(value ?? "").replace(/"/g, '""')}"`; }

  function exportTasksCsv() {
    const rows = [["優先度", "種別", "科目", "名称", "状態", "参考日", "URL"], ...pendingTasks(true).map((report) => [report.priority.level, report.kind, courseName(report.classId), report.title, report.status, report.context.date ? isoDay(report.context.date) : "", reportLink(report)])];
    download(`stalog-pending-${isoDay(new Date())}.csv`, "text/csv;charset=utf-8", `\ufeff${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`);
    toast("未完了CSVを書き出しました");
  }

  function escapeIcs(value) { return String(value || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;"); }

  function exportIcs() {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const events = array(state.snapshot.timetableSlots).filter((slot) => /^\d{4}-\d{2}-\d{2}$/.test(slot.date || "")).map((slot) => {
      const date = slot.date.replace(/-/g, "");
      const next = new Date(`${slot.date}T00:00:00`);
      next.setDate(next.getDate() + 1);
      return ["BEGIN:VEVENT", `UID:stalog-${escapeIcs(slot.classId)}-${date}-${slot.period}@local`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${date}`, `DTEND;VALUE=DATE:${isoDay(next).replace(/-/g, "")}`, `SUMMARY:${escapeIcs(`${slot.period || "?"}限 ${slot.courseName || courseName(slot.classId)}`)}`, `LOCATION:${escapeIcs(slot.room ? `${slot.room}教室` : "")}`, "DESCRIPTION:時刻は推測せず終日予定として出力しています。", "END:VEVENT"].join("\r\n");
    });
    download(`stalog-timetable-${isoDay(new Date())}.ics`, "text/calendar;charset=utf-8", ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Stalog Lab//JA", "CALSCALE:GREGORIAN", ...events, "END:VCALENDAR"].join("\r\n"));
    toast("時間割をICSで書き出しました");
  }

  function dailyBriefText() {
    const today = todaySlots();
    const tasks = pendingTasks().slice(0, 3);
    const risky = courseStats().filter((course) => course.margin !== null && course.margin <= 2).sort((a, b) => a.margin - b.margin).slice(0, 3);
    return [
      `【Stalog Lab｜${formatDate(new Date(), { long: true })}】`,
      "",
      "今日の授業",
      ...(today.length ? today.map((slot) => `・${slot.period || "?"}限 ${slot.courseName || courseName(slot.classId)}${slot.room ? `（${slot.room}教室）` : ""}`) : ["・取得した時間割に今日の授業はありません"]),
      "",
      "優先候補",
      ...(tasks.length ? tasks.map((report) => `・${report.title || "名称なし"}｜${courseName(report.classId)}`) : ["・未完了はありません"]),
      "",
      "出席アラート",
      ...(risky.length ? risky.map((course) => `・${course.name}｜欠席余裕 ${course.margin}回（参考）`) : ["・要注意科目なし"])
    ].join("\n");
  }

  async function copyBrief() {
    await navigator.clipboard.writeText(dailyBriefText());
    toast("今日のブリーフをコピーしました");
  }

  async function importJson(file) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed || !Array.isArray(parsed.courses) || !Array.isArray(parsed.reports)) throw new Error("Stalog Bridge形式ではありません");
      if (snapshotReady()) await addHistorySnapshot(state.snapshot);
      state.snapshot = parsed;
      await storageSet({ [SNAPSHOT_KEY]: parsed });
      await addHistorySnapshot(parsed);
      updateDataSummary();
      render();
      $("#data-dialog").close();
      toast(`${parsed.courses.length}科目のJSONを読み込みました`);
    } catch (error) {
      toast(`読み込み失敗: ${error.message}`);
    }
  }

  function snapshotDigest(snapshot) {
    return {
      collectedAt: snapshot.collectedAt || new Date().toISOString(),
      courses: array(snapshot.courses).map((course) => ({ classId: course.classId, attended: course.attended, absent: course.absent, publicAbsent: course.publicAbsent })),
      reports: array(snapshot.reports).map((report) => ({ classId: report.classId, directoryId: report.directoryId, title: report.title, kind: report.kind, status: report.status }))
    };
  }

  async function addHistorySnapshot(snapshot) {
    if (!snapshot?.collectedAt) return;
    const digest = snapshotDigest(snapshot);
    state.history = [digest, ...state.history.filter((item) => item.collectedAt !== digest.collectedAt)].slice(0, 6);
    await storageSet({ [HISTORY_KEY]: state.history });
  }

  function getHistoryDiff() {
    if (state.history.length < 2) return null;
    const current = state.history.find((item) => item.collectedAt === state.snapshot.collectedAt) || snapshotDigest(state.snapshot);
    const previous = state.history.find((item) => item.collectedAt !== current.collectedAt);
    if (!previous) return null;
    const counts = (snapshot) => ({
      completed: array(snapshot.reports).filter(isDone).length,
      pending: array(snapshot.reports).filter(isPending).length,
      absences: sum(array(snapshot.courses), (course) => course.absent)
    });
    const now = counts(current);
    const before = counts(previous);
    return { completed: now.completed - before.completed, pending: now.pending - before.pending, absences: now.absences - before.absences };
  }

  async function savePrefs() { await storageSet({ [PREFS_KEY]: state.prefs }); }
  async function saveReviews() { await storageSet({ [REVIEW_KEY]: state.reviews }); }

  async function toggleCandidate(id) {
    if (!featureById(id)) return;
    state.reviews[id] = !state.reviews[id];
    await saveReviews();
    render();
    toast(state.reviews[id] ? `「${featureById(id).name}」を採用候補に追加` : `「${featureById(id).name}」を候補から外しました`);
  }

  function exportReviews() {
    const payload = {
      exportedAt: new Date().toISOString(),
      snapshotCollectedAt: state.snapshot?.collectedAt,
      candidates: FEATURES.filter((feature) => state.reviews[feature.id]).map((feature) => ({ id: feature.id, name: feature.name, area: feature.area, description: feature.description })),
      rejectedOrUndecided: FEATURES.filter((feature) => !state.reviews[feature.id]).map((feature) => ({ id: feature.id, name: feature.name }))
    };
    download(`stalog-lab-review-${isoDay(new Date())}.json`, "application/json", JSON.stringify(payload, null, 2));
    toast("選定結果を書き出しました");
  }

  function setView(view) {
    if (!["home", "tasks", "attendance", "results", "timetable", "courses", "insights", "lab"].includes(view)) return;
    state.view = view;
    $(".sidebar").classList.remove("is-open");
    window.scrollTo({ top: 0, behavior: "smooth" });
    render();
  }

  function updateSimulator() {
    const classId = $("#sim-course")?.value;
    const course = courseStats().find((item) => String(item.classId) === String(classId));
    const input = $("#sim-absence");
    if (!course || !input) return;
    const futureAbsences = Number(input.value || 0);
    const rate = Number(course.attended || 0) / Math.max(1, Number(course.attended || 0) + Number(course.absent || 0) + futureAbsences);
    $("#sim-absence-label").textContent = `${futureAbsences}回`;
    $("#sim-rate").textContent = `${Math.round(rate * 100)}%`;
    const judgement = $("#sim-judgement");
    judgement.textContent = rate >= state.prefs.attendanceThreshold ? "基準以上" : "基準未満";
    judgement.className = `status-pill ${rate >= state.prefs.attendanceThreshold ? "done" : "pending"}`;
  }

  function changeSimulatorCourse() {
    const course = courseStats().find((item) => String(item.classId) === String($("#sim-course")?.value));
    const section = $("#sim-course")?.closest(".card");
    if (!course || !section) return;
    const old = section.querySelector(".simulator");
    const wrapper = document.createElement("div");
    wrapper.innerHTML = renderAttendanceSimulator(course);
    old.replaceWith(wrapper.firstElementChild);
  }

  function runRoulette() {
    const tasks = pendingTasks();
    if (!tasks.length) return;
    const candidates = tasks.filter((item) => item.key !== state.rouletteKey);
    state.rouletteKey = (candidates.length ? candidates : tasks)[Math.floor(Math.random() * (candidates.length || tasks.length))].key;
    render();
  }

  function updateTimerDisplay() {
    const display = $("#timer-display");
    if (display) display.textContent = `${pad(Math.floor(state.timerSeconds / 60))}:${pad(state.timerSeconds % 60)}`;
  }

  function toggleTimer() {
    state.timerRunning = !state.timerRunning;
    clearInterval(state.timerId);
    if (state.timerRunning) {
      state.timerId = setInterval(() => {
        state.timerSeconds -= 1;
        updateTimerDisplay();
        if (state.timerSeconds <= 0) {
          clearInterval(state.timerId);
          state.timerRunning = false;
          state.timerSeconds = 0;
          toast("25分経過しました。ひと休みしましょう");
          render();
        }
      }, 1000);
    }
    render();
  }

  function resetTimer() {
    clearInterval(state.timerId);
    state.timerRunning = false;
    state.timerSeconds = 25 * 60;
    render();
  }

  function search(query) {
    const panel = $("#search-panel");
    const value = normalize(query).trim();
    if (!value || !snapshotReady()) { panel.hidden = true; return; }
    const courses = array(state.snapshot.courses).filter((course) => normalize(course.name).includes(value)).slice(0, 6);
    const reports = array(state.snapshot.reports).filter((report) => normalize(`${report.title} ${report.kind} ${report.status} ${courseName(report.classId)}`).includes(value)).slice(0, 10);
    panel.innerHTML = `${courses.length ? `<div class="search-section-title">科目</div>${courses.map((course) => `<button class="search-result" data-course-open="${esc(course.classId)}" type="button"><span class="row-icon">□</span><span><strong>${esc(course.name)}</strong><span>${esc(course.period || "期間不明")}</span></span><span>開く</span></button>`).join("")}` : ""}${reports.length ? `<div class="search-section-title">課題・テスト</div>${reports.map((report) => `<button class="search-result" data-search-task="${esc(reportKey(report))}" type="button"><span class="row-icon">${/レポート/.test(report.kind || "") ? "R" : "Q"}</span><span><strong>${esc(report.title || "名称なし")}</strong><span>${esc(courseName(report.classId))} · ${esc(report.status)}</span></span>${statusPill(report)}</button>`).join("")}` : ""}${!courses.length && !reports.length ? `<div class="empty-inline">「${esc(query)}」は見つかりませんでした。</div>` : ""}`;
    panel.hidden = false;
  }

  function filterCatalog(area) {
    $$("[data-catalog-area]").forEach((button) => button.classList.toggle("is-active", button.dataset.catalogArea === area));
    const features = area === "all" ? FEATURES : area === "selected" ? FEATURES.filter((feature) => state.reviews[feature.id]) : FEATURES.filter((feature) => feature.area === area);
    $("#catalog-grid").innerHTML = renderCatalogItems(features);
  }

  function installEvents() {
    $("#main-nav").addEventListener("click", (event) => {
      const button = event.target.closest("[data-view]");
      if (button) setView(button.dataset.view);
    });
    $("#menu-toggle").addEventListener("click", () => $(".sidebar").classList.toggle("is-open"));
    $("#open-data-dialog").addEventListener("click", () => { updateDataSummary(); $("#data-dialog").showModal(); });
    $("#review-counter").addEventListener("click", () => setView("lab"));
    $("#theme-toggle").addEventListener("click", async () => {
      state.prefs.theme = state.prefs.theme === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = state.prefs.theme;
      await savePrefs();
    });
    $("#json-import").addEventListener("change", (event) => importJson(event.target.files?.[0]));
    $("#json-export").addEventListener("click", () => {
      if (!snapshotReady()) return toast("書き出すデータがありません");
      download(`stalog-bridge-${isoDay(new Date())}.json`, "application/json", JSON.stringify(state.snapshot, null, 2));
    });
    $("#csv-export").addEventListener("click", exportTasksCsv);
    $("#global-search").addEventListener("input", (event) => search(event.target.value));
    $("#global-search").addEventListener("keydown", (event) => { if (event.key === "Escape") { event.target.value = ""; search(""); event.target.blur(); } });
    document.addEventListener("keydown", (event) => {
      if (event.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) { event.preventDefault(); $("#global-search").focus(); }
    });
    document.addEventListener("click", async (event) => {
      const candidate = event.target.closest("[data-candidate]");
      if (candidate) return toggleCandidate(candidate.dataset.candidate);
      const viewTarget = event.target.closest("[data-view-target]");
      if (viewTarget) return setView(viewTarget.dataset.viewTarget);
      const dataOpen = event.target.closest("[data-open-data]");
      if (dataOpen) { updateDataSummary(); return $("#data-dialog").showModal(); }
      const courseOpen = event.target.closest("[data-course-open]");
      if (courseOpen) { $("#search-panel").hidden = true; return renderCourseDialog(courseOpen.dataset.courseOpen); }
      const taskFilter = event.target.closest("[data-task-filter]");
      if (taskFilter) { state.taskFilter = taskFilter.dataset.taskFilter; return render(); }
      const taskPin = event.target.closest("[data-task-pin]");
      if (taskPin) {
        const key = taskPin.dataset.taskPin;
        state.prefs.pinnedTasks = state.prefs.pinnedTasks.includes(key) ? state.prefs.pinnedTasks.filter((item) => item !== key) : [...state.prefs.pinnedTasks, key];
        await savePrefs(); return render();
      }
      const taskSnooze = event.target.closest("[data-task-snooze]");
      if (taskSnooze) {
        const key = taskSnooze.dataset.taskSnooze;
        state.prefs.snoozedTasks = state.prefs.snoozedTasks.includes(key) ? state.prefs.snoozedTasks.filter((item) => item !== key) : [...state.prefs.snoozedTasks, key];
        await savePrefs(); return render();
      }
      if (event.target.closest("[data-roulette]")) return runRoulette();
      if (event.target.closest("[data-timer-toggle]")) return toggleTimer();
      if (event.target.closest("[data-timer-reset]")) return resetTimer();
      if (event.target.closest("[data-copy-brief]")) return copyBrief();
      if (event.target.closest("[data-export-csv]")) return exportTasksCsv();
      if (event.target.closest("[data-export-ics]")) return exportIcs();
      if (event.target.closest("[data-export-reviews]")) return exportReviews();
      if (event.target.closest("[data-clear-reviews]")) { state.reviews = {}; await saveReviews(); return render(); }
      const area = event.target.closest("[data-catalog-area]");
      if (area) return filterCatalog(area.dataset.catalogArea);
      const close = event.target.closest("[data-close-dialog]");
      if (close) return $(`#${close.dataset.closeDialog}`).close();
      if (!event.target.closest(".global-search") && !event.target.closest("#search-panel")) $("#search-panel").hidden = true;
    });
    document.addEventListener("change", async (event) => {
      if (event.target.id === "task-course-filter") { state.taskCourse = event.target.value; render(); }
      if (event.target.id === "threshold-select") { state.prefs.attendanceThreshold = Number(event.target.value); await savePrefs(); render(); }
      if (event.target.id === "sim-course") changeSimulatorCourse();
    });
    document.addEventListener("input", (event) => { if (event.target.id === "sim-absence") updateSimulator(); });
  }

  async function initialize() {
    const stored = await storageGet([SNAPSHOT_KEY, PREFS_KEY, HISTORY_KEY, REVIEW_KEY]);
    state.snapshot = stored[SNAPSHOT_KEY] || null;
    state.prefs = { ...defaultPreferences, ...(stored[PREFS_KEY] || {}) };
    state.history = array(stored[HISTORY_KEY]);
    state.reviews = stored[REVIEW_KEY] || {};
    const requestedView = new URLSearchParams(location.search).get("view");
    if (["home", "tasks", "attendance", "results", "timetable", "courses", "insights", "lab"].includes(requestedView)) state.view = requestedView;
    document.documentElement.dataset.theme = state.prefs.theme;
    installEvents();
    if (snapshotReady()) await addHistorySnapshot(state.snapshot);
    updateDataSummary();
    render();
    setInterval(refreshNextCourseCard, 30_000);
  }

  initialize().catch((error) => {
    console.error(error);
    $("#app-view").innerHTML = `<div class="empty-state"><h1>ダッシュボードを開けませんでした</h1><p>${esc(error.message)}</p></div>`;
  });
})();
