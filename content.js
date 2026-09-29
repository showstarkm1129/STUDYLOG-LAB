(() => {
  "use strict";

  const STORAGE_KEY = "studylogBridgeSnapshotV1";
  const PREFS_KEY = "studylogDashboardPreferencesV1";
  const AUTO_COLLECT_STATE_KEY = "studylogBridgeAutoCollectV1";
  const AUTO_COLLECT_INTERVAL_MS = 30 * 60 * 1000;
  const AUTO_COLLECT_RETRY_MS = 5 * 60 * 1000;
  const STATUS_REFRESH_DELAY_MS = 15 * 1000;
  const STATUS_REFRESH_SESSION_KEY = "studylogBridgeStatusRefreshV1";
  const ROOT_ID = "studylog-bridge-root";
  const QUIZ_INSPECTOR_ROOT_ID = "studylog-quiz-inspector-root";
  const QUIZ_TRACE_SESSION_KEY = "studylogQuizTraceV1";
  const QUIZ_TRACE_LIMIT = 250;
  const CLASS_PATH = /\/lms\/class\/(?:grade\/)?(?<classId>\d+)(?:\/(?<directoryId>\d+))?/;
  const PERIOD_TIMES = Object.freeze({
    1: { start: "09:00", end: "09:50" },
    2: { start: "10:00", end: "10:50" },
    3: { start: "11:00", end: "11:50" },
    4: { start: "12:40", end: "13:30" },
    5: { start: "13:40", end: "14:30" },
    6: { start: "14:40", end: "15:30" }
  });

  const text = (element) => (element?.textContent || "").replace(/\s+/g, " ").trim();
  const array = (value) => Array.isArray(value) ? value : [];
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
  const normalize = (value) => String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
  const pad = (value) => String(value).padStart(2, "0");
  const isoDay = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const uniqueBy = (items, key) => [...new Map(items.map((item) => [key(item), item])).values()];
  const mergeBy = (existing, incoming, key) => {
    const merged = new Map(existing.map((item) => [key(item), item]));
    incoming.forEach((item) => merged.set(key(item), { ...merged.get(key(item)), ...item }));
    return [...merged.values()];
  };
  const numberOrUndefined = (value) => {
    const match = String(value ?? "").match(/\d+/);
    return match ? Number(match[0]) : undefined;
  };

  function parseClassLink(href) {
    const match = String(href || "").match(CLASS_PATH);
    return match?.groups ? { classId: match.groups.classId, directoryId: match.groups.directoryId } : {};
  }

  function pageKind() {
    const path = location.pathname;
    if (path.includes("sMyPage.php")) return "mypage";
    if (/^\/lms\/class\//.test(path)) return "class";
    if (path === "/lms/" || path === "/lms") return "top";
    if (path.includes("/lms/schedule/")) return "schedule";
    return "other";
  }

  function isQuizScreen() {
    return /\/quiz(?:\/|\.php(?:\/|$)|$)/i.test(location.pathname)
      || /quiz/i.test(location.search)
      || Boolean(document.querySelector('form[action*="/quiz/"][method="post"], #div-quiz-question, [data-page-type="quiz"]'));
  }

  function isQuizDebugMode() {
    return new URLSearchParams(location.search).get("studylogBridgeDebug") === "1";
  }

  function pageScene() {
    if (isQuizScreen()) return "quiz";
    const kind = pageKind();
    if (kind === "class") return readClassContext().directoryId ? "directory" : "class";
    return kind;
  }

  function readScheduleStartDate(url) {
    try {
      const requestUrl = new URL(url, location.origin);
      const value = requestUrl.searchParams.get("startDate") || requestUrl.searchParams.get("startdate");
      return value && /^20\d{2}-\d{2}-\d{2}$/.test(value) ? value : undefined;
    } catch {
      return undefined;
    }
  }

  function readClassContext() {
    const fromDom = document.querySelector("#input-current-class-id")?.value;
    const fromPath = parseClassLink(location.pathname);
    return {
      classId: fromDom || fromPath.classId,
      directoryId: document.querySelector("#div-class-contents")?.getAttribute("directory_id") || fromPath.directoryId
    };
  }

  function readAcademicYear(fallbackYear) {
    const candidates = [
      document.querySelector("#select-year")?.value,
      text(document.querySelector("#select-year option:checked")),
      document.querySelector("[name='year']")?.value,
      document.querySelector("[data-academic-year]")?.getAttribute("data-academic-year")
    ];
    const found = candidates.map((value) => String(value || "").match(/(20\d{2})/)).find(Boolean);
    return found ? Number(found[1]) : Number(fallbackYear || StudylogAutoSyncRules.currentAcademicYear());
  }

  function dateFromLessonText(value, academicYear) {
    const normalizedValue = String(value || "").normalize("NFKC");
    const full = normalizedValue.match(/(20\d{2})\s*[年\/.-]\s*(0?[1-9]|1[0-2])\s*[月\/.-]\s*(0?[1-9]|[12]\d|3[01])(?:日)?/);
    const short = normalizedValue.match(/(?:^|[^0-9])(\d{1,2})\s*[月\/.]\s*(\d{1,2})(?:日)?/);
    const compact = normalizedValue.match(/(?:^|[_\s(（])(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?=$|[_\s)）])/);
    const match = full || short || compact;
    if (!match) return undefined;
    const month = Number(match[full ? 2 : 1]);
    const day = Number(match[full ? 3 : 2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
    const year = full ? Number(match[1]) : academicYear + (month < 4 ? 1 : 0);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return undefined;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function parseDirectoriesFromDocument(doc, classId, academicYear, source) {
    const links = [...doc.querySelectorAll(".a-open-contents[directory_id], .a-load-contents[directory_id]")];
    return uniqueBy(links.map((link) => ({
      classId,
      directoryId: link.getAttribute("directory_id"),
      title: text(link),
      lessonNumber: Number(text(link).match(/第\s*0?(\d+)\s*回/)?.[1]) || undefined,
      lessonDate: dateFromLessonText(text(link), academicYear),
      dateSource: dateFromLessonText(text(link), academicYear) ? "directoryTitle" : undefined,
      source
    })).filter((item) => item.directoryId), (item) => `${item.classId}:${item.directoryId}`);
  }

  function readDirectories(fallbackYear) {
    const context = readClassContext();
    if (!context.classId) return [];
    return parseDirectoriesFromDocument(document, context.classId, readAcademicYear(fallbackYear), "classPageDom");
  }

  function parseLessonList(html, classId, academicYear) {
    const entries = [];
    const doc = new DOMParser().parseFromString(html, "text/html");
    [...doc.querySelectorAll("[directory_id], [data-directory-id], a[href*='/lms/class/'], tr")].forEach((element) => {
      const route = parseClassLink(element.getAttribute?.("href"));
      const directoryId = element.getAttribute?.("directory_id") || element.getAttribute?.("data-directory-id") || route.directoryId;
      const lessonDate = dateFromLessonText(text(element), academicYear);
      if (directoryId && lessonDate) entries.push({ classId, directoryId, lessonDate, dateSource: "getLessonList" });
    });
    try {
      const parsed = JSON.parse(html);
      const visit = (value) => {
        if (Array.isArray(value)) return value.forEach(visit);
        if (!value || typeof value !== "object") return;
        const directoryId = value.directory_id || value.directoryId;
        const dateValue = value.lesson_date || value.lessonDate || value.date || value.start_date || value.startDate;
        const lessonDate = dateValue ? dateFromLessonText(String(dateValue), academicYear) : undefined;
        if (directoryId && lessonDate) entries.push({ classId, directoryId: String(directoryId), lessonDate, dateSource: "getLessonList" });
        Object.values(value).forEach(visit);
      };
      visit(parsed);
    } catch {
      // HTML 断片の場合は上の DOM 抽出だけを使う。
    }
    return uniqueBy(entries, (entry) => `${entry.classId}:${entry.directoryId}`);
  }

  function classifyLearningItem(value, href = "") {
    if (/レポート|課題/.test(value) || /\/report\//.test(href)) return "report";
    if (/クイズ|テスト|試験/.test(value) || /\/quiz\//.test(href)) return "test";
    if (/アンケート/.test(value)) return "survey";
    if (/動画/.test(value)) return "video";
    if (/資料|ファイル|教材/.test(value)) return "material";
    return "other";
  }

  function readDeadline(value) {
    const labelled = value.match(/(?:提出(?:期限|締切)?|締切|期限|回答期限|終了(?:日時|日)?)[^0-9０-９]{0,20}((?:20)?[0-9０-９]{2,4}\s*[\/年.\-]\s*[0-9０-９]{1,2}\s*[\/月.\-]\s*[0-9０-９]{1,2}(?:\s*日)?(?:\s*(?:[0-9０-９]{1,2}[:】【：][0-9０-９]{2}|[0-9０-９]{1,2}時(?:[0-9０-９]{1,2}分)?))?)/);
    if (!labelled) return undefined;
    const dueText = labelled[1].replace(/\s+/g, " ").trim();
    const normal = dueText.replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xFEE0));
    const match = normal.match(/(?:(\d{4})\s*[\/年.\-]\s*)?(\d{1,2})\s*[\/月.\-]\s*(\d{1,2})(?:\s*日)?(?:\s*(\d{1,2})[:：](\d{2})|\s*(\d{1,2})時(?:\s*(\d{1,2})分)?)?/);
    if (!match) return { dueText };
    const year = Number(match[1] || new Date().getFullYear());
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = Number(match[4] || match[6] || 0);
    const minute = Number(match[5] || match[7] || 0);
    const dueAt = new Date(year, month - 1, day, hour, minute);
    return Number.isNaN(dueAt.valueOf()) ? { dueText } : { dueText, dueAt: dueAt.toISOString() };
  }

  function closestContentBlock(element, root) {
    let current = element;
    while (current && current !== root) {
      const value = text(current);
      if (/提出|締切|期限|回答期限|レポート|課題|クイズ|テスト|試験/.test(value) && value.length <= 1600) return current;
      current = current.parentElement;
    }
    return element;
  }

  function readCurrentDirectoryItems(reports = []) {
    const root = document.querySelector("#div-class-contents");
    const context = readClassContext();
    if (!root || !context.classId || !context.directoryId) return [];
    const knownReports = reports.filter((report) => report.classId === context.classId && report.directoryId === context.directoryId);
    const genericLabels = new Set(["受講", "結果", "実行", "開始", "詳細", ".", ""]);
    const candidates = [...root.querySelectorAll('a[href*="/lms/content/"], a[href*="/lms/file/"], a[href*="/lms/plugin/"]')];
    const items = candidates.map((candidate) => {
      const block = closestContentBlock(candidate, root);
      const blockText = text(block);
      const resolved = new URL(candidate.getAttribute("href"), location.origin);
      if (resolved.origin !== location.origin) return null;
      const candidateTitle = text(candidate);
      const matchingReport = knownReports.find((report) => blockText.includes(report.title)) || knownReports[0];
      const title = genericLabels.has(candidateTitle) ? matchingReport?.title : candidateTitle;
      const deadline = readDeadline(blockText);
      const href = `${resolved.pathname}${resolved.search}`;
      const kind = classifyLearningItem(`${title || ""} ${matchingReport?.kind || ""}`, href);
      if (!title || (!deadline && kind === "other")) return null;
      return {
        classId: context.classId,
        directoryId: context.directoryId,
        title,
        kind,
        href,
        ...deadline,
        source: "classPageDomV2"
      };
    }).filter(Boolean);
    return uniqueBy(items, (item) => `${item.classId}:${item.directoryId}:${item.title}:${item.dueText || ""}:${item.href || ""}`);
  }

  function tableGrid(table) {
    const grid = [];
    [...table.rows].forEach((row, rowIndex) => {
      grid[rowIndex] ||= [];
      let columnIndex = 0;
      [...row.cells].forEach((cell) => {
        while (grid[rowIndex][columnIndex]) columnIndex += 1;
        const rowSpan = Number(cell.rowSpan || 1);
        const colSpan = Number(cell.colSpan || 1);
        for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
          grid[rowIndex + rowOffset] ||= [];
          for (let colOffset = 0; colOffset < colSpan; colOffset += 1) grid[rowIndex + rowOffset][columnIndex + colOffset] = cell;
        }
        columnIndex += colSpan;
      });
    });
    return grid;
  }

  function dateFromLabel(value) {
    const full = value.match(/(20\d{2})\s*[\/年.\-]\s*(0?[1-9]|1[0-2])\s*[\/月.\-]\s*(0?[1-9]|[12]\d|3[01])(?:日)?/);
    const short = value.match(/(?:^|\s)(\d{1,2})\s*[\/.月]\s*(\d{1,2})/);
    const match = full || short;
    if (!match) return undefined;
    const year = full ? Number(match[1]) : new Date().getFullYear();
    const month = Number(match[full ? 2 : 1]);
    const day = Number(match[full ? 3 : 2]);
    const parsed = new Date(year, month - 1, day);
    if (Number.isNaN(parsed.valueOf())) return undefined;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function periodFromLabel(value) {
    const explicit = value.match(/([1-6])\s*(?:時限|限)/);
    if (explicit) return Number(explicit[1]);
    const leading = value.match(/^([1-6])(?:\s|$)/);
    if (leading) return Number(leading[1]);
    return /^[1-6]$/.test(value) ? Number(value) : undefined;
  }

  function addDays(isoDate, days) {
    const date = new Date(`${isoDate}T00:00:00`);
    date.setDate(date.getDate() + days);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function readTimetableDates(fallbackStartDate) {
    const preferredScopes = ["#div-top-timetable1", "#div-top-timetable2", "#div-top-timetable", "#timetable"]
      .map((selector) => document.querySelector(selector))
      .filter(Boolean);
    const scopes = preferredScopes.length ? preferredScopes : [document];
    const attributeNames = ["data-date", "date", "data-start-date", "startdate", "data-day", "value", "href", "onclick", "title", "aria-label"];
    const dates = [];
    scopes.forEach((scope) => {
      const elements = [scope, ...scope.querySelectorAll("[data-date], [date], [data-start-date], [startdate], [data-day], input[value], option[value], a[href], [onclick], [title], [aria-label]")];
      elements.forEach((element) => {
        const values = [text(element), ...attributeNames.map((name) => element.getAttribute?.(name) || "")];
        values.forEach((value) => {
          const found = dateFromLabel(value);
          if (found && !dates.includes(found)) dates.push(found);
        });
      });
    });
    if (dates.length >= 2) return dates;
    // 週の開始日だけが属性にある場合は、同じ週の7日分を読み取り専用で補完する。
    const startDate = dates[0] || fallbackStartDate;
    return startDate ? Array.from({ length: 7 }, (_, index) => addDays(startDate, index)) : [];
  }

  function readTimetableTeacherName(cell) {
    return [...cell.querySelectorAll(".div-class-name .text-right small")]
      .map(text)
      .find((value) => value && !/^教室\s*[:：]?$/.test(value));
  }

  function readNormalizedTimetable(fallbackStartDate) {
    const firstCell = document.querySelector(".top-timetable-table-td");
    const table = firstCell?.closest("table");
    if (!table) return [];
    const grid = tableGrid(table);
    const cells = [...table.querySelectorAll(".top-timetable-table-td")];
    const dateButtons = [...document.querySelectorAll(".a-load-timetable-select")]
      .map((element) => text(element))
      .filter((label) => dateFromLabel(label));
    const timetableDates = readTimetableDates(fallbackStartDate);
    const orderedColumns = [...new Set(cells.map((cell) => {
      const rowIndex = grid.findIndex((row) => row.includes(cell));
      return rowIndex >= 0 ? grid[rowIndex].indexOf(cell) : -1;
    }).filter((columnIndex) => columnIndex >= 0))].sort((a, b) => a - b);
    const lastCourseByColumn = new Map();
    const slots = [];
    cells.forEach((cell) => {
      const rowIndex = grid.findIndex((row) => row.includes(cell));
      const columnIndex = rowIndex >= 0 ? grid[rowIndex].indexOf(cell) : -1;
      if (rowIndex < 0 || columnIndex < 0) return;
      const headerLabels = grid.slice(0, rowIndex).map((row) => text(row[columnIndex])).filter(Boolean);
      const rowLabels = grid[rowIndex].slice(0, columnIndex).map(text).filter(Boolean);
      const link = cell.querySelector('a[href*="/lms/class/"]');
      const route = parseClassLink(link?.getAttribute("href"));
      const rawText = text(cell);
      const parsedRoom = rawText.match(/教室\s*[:：]\s*([0-9]{2,4}[A-Za-z]?)/)?.[1];
      const parsedTeacherName = readTimetableTeacherName(cell);
      // 連続時限は「2 〃」のように時限番号の後へ省略記号が付く。
      const continuation = !route.classId && /^(?:[1-6]\s*)?〃(?:\s|$)/.test(rawText);
      const inherited = continuation ? lastCourseByColumn.get(columnIndex) : undefined;
      const course = route.classId ? { classId: route.classId, directoryId: route.directoryId, courseName: text(link), teacherName: parsedTeacherName, room: parsedRoom } : inherited;
      if (!course?.classId) return;
      if (route.classId) lastCourseByColumn.set(columnIndex, course);
      const dateLabel = headerLabels.find((label) => dateFromLabel(label)) || dateButtons[columnIndex - 1];
      const date = dateLabel ? dateFromLabel(dateLabel) : timetableDates[orderedColumns.indexOf(columnIndex)];
      const period = rowLabels.map(periodFromLabel).find(Boolean) || periodFromLabel(rawText);
      const room = parsedRoom || inherited?.room;
      slots.push({
        date,
        dateLabel,
        period,
        rowIndex,
        columnIndex,
        ...course,
        room,
        continuation,
        rawText,
        source: "topTimetableDom"
      });
    });
    return uniqueBy(slots, (slot) => `${slot.rowIndex}:${slot.columnIndex}`);
  }

  function readVisibleTimetable() {
    const cells = [...document.querySelectorAll(".top-timetable-table-td")];
    return cells.map((cell, index) => {
      const link = cell.querySelector('a[href*="/lms/class/"]');
      const route = parseClassLink(link?.getAttribute("href"));
      return {
        cellIndex: index,
        classId: route.classId,
        directoryId: route.directoryId,
        courseName: text(link),
        teacherName: readTimetableTeacherName(cell),
        text: text(cell),
        href: link ? new URL(link.getAttribute("href"), location.origin).pathname : undefined
      };
    }).filter((item) => item.classId || item.text);
  }

  function parseSubjectStatus(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const rows = [...doc.querySelectorAll("tr")];
    const courses = rows.map((row) => {
      const cells = [...row.querySelectorAll("td")].map(text);
      const link = row.querySelector('a[href*="/lms/class/"]');
      const { classId } = parseClassLink(link?.getAttribute("href"));
      if (!classId || cells.length < 7) return null;
      return {
        classId,
        name: text(link),
        term: cells[0] || undefined,
        period: cells[2] || undefined,
        totalLessons: numberOrUndefined(cells[3]),
        attended: numberOrUndefined(cells[4]),
        absent: numberOrUndefined(cells[5]),
        publicAbsent: numberOrUndefined(cells[6]),
        source: "mySubjectStatus"
      };
    }).filter(Boolean);
    return uniqueBy(courses, (course) => course.classId);
  }

  function parseReportStatus(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const rows = [...doc.querySelectorAll("tr")];
    const items = rows.map((row) => {
      const cells = [...row.querySelectorAll("td")].map(text);
      const link = row.querySelector('a[href*="/lms/class/"]');
      const route = parseClassLink(link?.getAttribute("href"));
      if (!route.classId || cells.length < 3) return null;
      return {
        classId: route.classId,
        directoryId: route.directoryId,
        kind: cells[0],
        title: text(link) || cells[1],
        scheduledAt: cells.length >= 4 ? cells[cells.length - 2] : undefined,
        status: cells[cells.length - 1],
        href: new URL(link.getAttribute("href"), location.origin).pathname,
        source: "myReportStatus"
      };
    }).filter(Boolean);
    return uniqueBy(items, (item) => `${item.classId}:${item.directoryId || ""}:${item.kind}:${item.title}:${item.status}`);
  }

  async function fetchText(path) {
    const response = await fetch(path, { credentials: "include" });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return response.text();
  }

  function unwrapAjaxHtml(body) {
    try {
      const data = JSON.parse(body);
      if (typeof data === "string") return data;
      if (typeof data?.html === "string") return data.html;
      if (typeof data?.result?.html === "string") return data.result.html;
    } catch {
      // HTML 断片はそのまま扱う。
    }
    return body;
  }

  async function fetchAjaxHtml(action, params) {
    const body = new URLSearchParams({ action, ...params });
    const response = await fetch("/lms/", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body
    });
    if (!response.ok) throw new Error(`${action}: HTTP ${response.status}`);
    return unwrapAjaxHtml(await response.text());
  }

  async function fetchLessonDates(classId, academicYear) {
    const html = await fetchText(`/portal/lmsinc/getLessonList.php?classId=${encodeURIComponent(classId)}`);
    return parseLessonList(html, classId, academicYear);
  }

  async function fetchCourseDirectories(classId, academicYear) {
    // 通常画面が使う回一覧 API を読むだけで、別タブ・ページ内 JavaScript・受講操作は実行しない。
    const ajaxHtml = await fetchAjaxHtml("glexa_ajax_class_directory_list", { class_id: classId });
    const ajaxDirectories = parseDirectoriesFromDocument(new DOMParser().parseFromString(ajaxHtml, "text/html"), classId, academicYear, "classDirectoryAjax");
    if (ajaxDirectories.length) return ajaxDirectories;

    // 実装差異がある場合の読み取り専用フォールバック。
    const html = await fetchText(`/lms/class/${encodeURIComponent(classId)}/`);
    const doc = new DOMParser().parseFromString(html, "text/html");
    return parseDirectoriesFromDocument(doc, classId, academicYear, "courseTopHtml");
  }

  async function fetchAllCourseDirectories(classIds, academicYear) {
    const entries = [];
    // 順番に読み取る。複数タブを開いたり並列アクセスしたりしない。
    for (const classId of classIds) {
      try {
        const directories = await fetchCourseDirectories(classId, academicYear);
        const lessonDates = await fetchLessonDates(classId, academicYear).catch(() => []);
        entries.push(...mergeBy(directories, lessonDates, (entry) => `${entry.classId}:${entry.directoryId}`));
      } catch {
        // 個別科目の失敗では、他科目の収集を止めない。
      }
    }
    return uniqueBy(entries, (entry) => `${entry.classId}:${entry.directoryId}`);
  }

  async function readSnapshot() {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const snapshot = result[STORAGE_KEY] || {
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      courses: [],
      reports: [],
      directories: [],
      directoryItems: [],
      visibleTimetable: [],
      timetableSlots: [],
      timetableWeekStart: undefined
    };
    // 旧版の説明本文つきエントリは、読み出し時点で端末内保存からも除去する。
    const oldItems = snapshot.directoryItems || [];
    const safeItems = oldItems.filter((item) => item.source !== "classPageDom");
    if (safeItems.length !== oldItems.length) {
      snapshot.directoryItems = safeItems;
      await chrome.storage.local.set({ [STORAGE_KEY]: snapshot });
    }
    return snapshot;
  }

  async function saveSnapshot(snapshot) {
    await chrome.storage.local.set({ [STORAGE_KEY]: snapshot });
  }

  async function readAutoCollectState() {
    const result = await chrome.storage.local.get(AUTO_COLLECT_STATE_KEY);
    const state = result[AUTO_COLLECT_STATE_KEY] || {};
    return { ...state, years: state.years || {} };
  }

  function yearOf(item, fallbackYear) {
    return Number(item?.academicYear || fallbackYear || 0);
  }

  function itemsForYear(items, academicYear, fallbackYear) {
    return array(items).filter((item) => yearOf(item, fallbackYear) === Number(academicYear));
  }

  function replaceYearItems(existing, incoming, academicYear, fallbackYear, key) {
    const kept = array(existing).filter((item) => yearOf(item, fallbackYear) !== Number(academicYear));
    const scoped = array(incoming).map((item) => ({ ...item, academicYear: Number(academicYear) }));
    return uniqueBy([...kept, ...scoped], key);
  }

  function stampLegacyAcademicYear(snapshot, academicYear) {
    for (const field of ["courses", "reports", "directories", "directoryItems"]) {
      snapshot[field] = array(snapshot[field]).map((item) => item?.academicYear ? item : { ...item, academicYear: Number(academicYear) });
    }
  }

  function prepareSnapshotForCurrentYear(snapshot) {
    const previousYear = Number(snapshot.academicYear || readAcademicYear());
    stampLegacyAcademicYear(snapshot, previousYear);
    snapshot.academicYear = readAcademicYear(previousYear);
    return snapshot;
  }

  function markSnapshotFreshness(snapshot, academicYear, changes) {
    snapshot.freshnessByYear ||= {};
    snapshot.freshnessByYear[academicYear] = { ...(snapshot.freshnessByYear[academicYear] || {}), ...changes };
  }

  function mergeCurrentPage(snapshot) {
    snapshot.directories ||= [];
    snapshot.directoryItems ||= [];
    snapshot.visibleTimetable ||= [];
    snapshot.timetableSlots ||= [];
    const academicYear = readAcademicYear(snapshot.academicYear);
    const kind = pageKind();
    if (kind === "class") {
      snapshot.directories = mergeBy(snapshot.directories, readDirectories(academicYear).map((item) => ({ ...item, academicYear })), (item) => `${item.classId}:${item.directoryId}`);
      snapshot.directoryItems = uniqueBy([...snapshot.directoryItems, ...readCurrentDirectoryItems(snapshot.reports).map((item) => ({ ...item, academicYear }))], (item) => `${item.classId}:${item.directoryId}:${item.title}:${item.dueText || ""}:${item.href || ""}`);
    }
    if (kind === "top") {
      snapshot.visibleTimetable = readVisibleTimetable();
      snapshot.timetableSlots = readNormalizedTimetable(snapshot.timetableWeekStart?.startDate);
    }
  }

  async function collect() {
    const [subjectHtml, reportHtml, snapshot, state] = await Promise.all([
      fetchText("/portal/lmsinc/mySubjectStatus.php"),
      fetchText("/portal/lmsinc/myReportStatus.php"),
      readSnapshot(),
      readAutoCollectState()
    ]);
    const previousYear = Number(snapshot.academicYear || readAcademicYear());
    const academicYear = readAcademicYear(previousYear);
    const collectedAt = new Date().toISOString();
    stampLegacyAcademicYear(snapshot, previousYear);
    snapshot.schemaVersion = 1;
    snapshot.collectedAt = collectedAt;
    snapshot.sourceOrigin = location.origin;
    snapshot.courses = replaceYearItems(snapshot.courses, parseSubjectStatus(subjectHtml), academicYear, previousYear, (item) => `${item.academicYear}:${item.classId}`);
    snapshot.reports = replaceYearItems(snapshot.reports, parseReportStatus(reportHtml), academicYear, previousYear, (item) => `${item.academicYear}:${reportKey(item)}`);
    // 旧版は教材の説明本文まで保存していたため、安全な V2 形式へ置換する。
    snapshot.directoryItems = (snapshot.directoryItems || []).filter((item) => item.source !== "classPageDom");
    snapshot.academicYear = academicYear;
    mergeCurrentPage(snapshot);
    const classIds = [...new Set([
      ...itemsForYear(snapshot.courses, academicYear, previousYear).map((course) => course.classId),
      ...itemsForYear(snapshot.reports, academicYear, previousYear).map((report) => report.classId)
    ])];
    const directories = await fetchAllCourseDirectories(classIds, academicYear);
    snapshot.directories = replaceYearItems(snapshot.directories, directories, academicYear, previousYear, (item) => `${item.academicYear}:${item.classId}:${item.directoryId}`);
    snapshot.lessonListCollectedAt = collectedAt;
    snapshot.collectedClassCount = classIds.length;
    markSnapshotFreshness(snapshot, academicYear, { reportStatusCollectedAt: collectedAt, subjectStatusCollectedAt: collectedAt, directoriesCollectedAt: collectedAt });
    const yearState = state.years[academicYear] || {};
    state.years[academicYear] = {
      ...yearState,
      reportStatusCollectedAt: collectedAt,
      subjectStatusCollectedAt: collectedAt,
      directoriesByClass: Object.fromEntries(classIds.map((classId) => [classId, collectedAt]))
    };
    state.completedAt = collectedAt;
    delete state.lastError;
    await chrome.storage.local.set({ [STORAGE_KEY]: snapshot, [AUTO_COLLECT_STATE_KEY]: state });
    return snapshot;
  }

  function exportSnapshot(snapshot) {
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `studylog-bridge-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function readPreferences() {
    const result = await chrome.storage.local.get(PREFS_KEY);
    const stored = result[PREFS_KEY] || {};
    return { ...stored, manualCompleted: array(stored.manualCompleted), notRequired: array(stored.notRequired), completionIncludedCourseIds: Array.isArray(stored.completionIncludedCourseIds) ? stored.completionIncludedCourseIds.map(String) : null };
  }

  async function savePreferences(preferences) {
    await chrome.storage.local.set({ [PREFS_KEY]: preferences });
  }

  function reportKey(report) {
    return StudylogTaskRules.reportKey(report);
  }

  function isPortalPending(report) {
    return /未完了|未提出|未回答|未受験|未実施/.test(report?.status || "");
  }

  function isPortalDone(report) {
    return !isPortalPending(report) && /完了|提出済|回答済|受験済/.test(report?.status || "");
  }

  function isManualComplete(report, preferences) {
    return new Set(preferences.manualCompleted).has(reportKey(report));
  }

  function isNotRequired(report, preferences) {
    return isPortalPending(report) && StudylogTaskRules.isNotRequired(report, preferences);
  }

  function notRequiredMatch(report, snapshot, preferences) {
    return StudylogTaskRules.notRequiredMatch(report, array(snapshot.reports), preferences);
  }

  function digestResolution(report, snapshot) {
    return StudylogDigestRules.resolution(report, array(snapshot.reports));
  }

  function isDigestAutoComplete(report, snapshot) {
    return digestResolution(report, snapshot).state === "auto-complete";
  }

  function isDigestDeferred(report, snapshot) {
    return digestResolution(report, snapshot).state === "deferred";
  }

  function isCompletionCourseIncluded(report, preferences) {
    const selected = preferences.completionIncludedCourseIds;
    return !Array.isArray(selected) || selected.includes(String(report?.classId));
  }

  function isEffectivelyPending(report, snapshot, preferences) {
    return isPortalPending(report)
      && !isManualComplete(report, preferences)
      && !isNotRequired(report, preferences)
      && !isDigestAutoComplete(report, snapshot)
      && !isDigestDeferred(report, snapshot);
  }

  function attendanceRate(course) {
    const attended = Number(course?.attended || 0);
    const absent = Number(course?.absent || 0);
    const publicAbsent = Number(course?.publicAbsent || 0);
    const observed = attended + absent + publicAbsent;
    return observed ? (attended + publicAbsent) / observed : 0;
  }

  function absenceMargin(course) {
    return StudylogAttendanceRules.absenceMargin(course);
  }

  function courseEndDate(course, snapshot) {
    const matches = [...String(course?.period || "").normalize("NFKC").matchAll(/(?:(20\d{2})\s*[\/年.\-]\s*)?(\d{1,2})\s*[\/月.\-]\s*(\d{1,2})/g)];
    const last = matches.at(-1);
    if (last) {
      const month = Number(last[2]);
      const day = Number(last[3]);
      const academicYear = Number(course?.academicYear || snapshot.academicYear || new Date().getFullYear());
      const year = Number(last[1] || academicYear + (month <= 3 ? 1 : 0));
      const date = new Date(year, month - 1, day);
      if (date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day) return date;
    }
    return array(snapshot.directories)
      .filter((item) => String(item.classId) === String(course?.classId))
      .map((item) => item.lessonDate ? new Date(`${item.lessonDate}T00:00:00`) : null)
      .filter((date) => date && !Number.isNaN(date.valueOf()))
      .sort((a, b) => a - b)
      .at(-1) || null;
  }

  function isArchived(course, snapshot) {
    const end = courseEndDate(course, snapshot);
    if (!end) return false;
    end.setDate(end.getDate() + 1);
    end.setHours(0, 0, 0, 0);
    return new Date() >= end;
  }

  function clockMinutes(value) {
    const [hour, minute] = String(value || "").split(":").map(Number);
    return hour * 60 + minute;
  }

  function orderedSlots(snapshot) {
    return array(snapshot.timetableSlots)
      .filter((slot) => slot.date && PERIOD_TIMES[Number(slot.period)])
      .sort((a, b) => String(a.date).localeCompare(String(b.date)) || Number(a.period) - Number(b.period));
  }

  function nextDifferentCourse(snapshot, now = new Date(), { todayOnly = false } = {}) {
    const slots = orderedSlots(snapshot);
    const today = isoDay(now);
    const todaysSlots = slots.filter((slot) => slot.date === today);
    const nextDate = todayOnly ? null : slots.find((slot) => slot.date > today);
    const minutes = now.getHours() * 60 + now.getMinutes();
    const activeIndex = todaysSlots.findIndex((slot) => {
      const period = PERIOD_TIMES[Number(slot.period)];
      return clockMinutes(period.start) <= minutes && minutes < clockMinutes(period.end);
    });
    if (activeIndex >= 0) {
      const active = todaysSlots[activeIndex];
      return todaysSlots.slice(activeIndex + 1).find((slot) => String(slot.classId) !== String(active.classId)) || nextDate || null;
    }
    const futureIndex = todaysSlots.findIndex((slot) => clockMinutes(PERIOD_TIMES[Number(slot.period)].start) > minutes);
    if (futureIndex >= 0) {
      const future = todaysSlots[futureIndex];
      const previous = todaysSlots[futureIndex - 1];
      if (previous && Number(future.period) === Number(previous.period) + 1 && String(future.classId) === String(previous.classId)) {
        return todaysSlots.slice(futureIndex + 1).find((slot) => String(slot.classId) !== String(future.classId)) || nextDate || null;
      }
      return future;
    }
    return nextDate || null;
  }

  function todayCourseBlocks(snapshot) {
    const slots = orderedSlots(snapshot).filter((slot) => slot.date === isoDay(new Date()));
    return slots.filter((slot, index) => index === 0 || String(slot.classId) !== String(slots[index - 1].classId));
  }

  function courseNavigationContext(snapshot) {
    if (!["class", "directory"].includes(pageScene())) return null;
    const { classId, directoryId } = readClassContext();
    const slots = orderedSlots(snapshot);
    const matchesDirectory = (item) => String(item.classId) === String(classId)
      && directoryId && String(item.directoryId) === String(directoryId);
    const directory = array(snapshot.directories).find(matchesDirectory);
    const exactDates = [...new Set(slots.filter(matchesDirectory).map((slot) => slot.date))];
    const lessonDate = directory?.lessonDate || dateFromLessonText(directory?.title, Number(directory?.academicYear || snapshot.academicYear));
    const dates = exactDates.length ? exactDates : lessonDate ? [lessonDate]
      : [...new Set(slots.filter((slot) => String(slot.classId) === String(classId)).map((slot) => slot.date))];
    const contextKey = `${classId}:${directoryId || ""}`;
    const selector = document.querySelector("#studylog-course-navigation-date");
    const selectedDate = selector?.dataset.context === contextKey ? selector.value : "";
    const linkedDate = String(parseClassLink(location.pathname).classId) === String(classId)
      ? new URLSearchParams(location.search).get("studylogDate") : "";
    const date = dates.length === 1 ? dates[0]
      : dates.includes(selectedDate) ? selectedDate : dates.includes(linkedDate) ? linkedDate : null;
    return { classId, directoryId, slots, matchesDirectory, dates, date, contextKey };
  }

  function adjacentCourseFromCurrentPage(snapshot, offset, navigation) {
    if (!navigation?.date) return null;
    const { classId, directoryId, slots, matchesDirectory, date } = navigation;
    const blocks = [...new Set(slots.map((slot) => slot.date))]
      .flatMap((day) => StudylogAttendanceWatchRules.blocks(slots, PERIOD_TIMES, day));
    const slotsFor = (block) => slots.filter((slot) => slot.date === block.date
      && String(slot.classId) === block.classId && block.periods.includes(Number(slot.period)));
    let candidates = blocks.filter((block) => block.date === date && block.classId === String(classId));
    if (directoryId) {
      const exact = candidates.filter((block) => slotsFor(block).some(matchesDirectory));
      candidates = exact.length ? exact : candidates.filter((block) => slotsFor(block).every((slot) => !slot.directoryId));
    }
    // 同じ日に複数のまとまりがあり、表示中の回を特定できない場合はリンクを推測しない。
    if (candidates.length !== 1) return null;
    const adjacent = blocks[blocks.indexOf(candidates[0]) + offset];
    if (!adjacent || !/^\d+$/.test(adjacent.classId)) return null;
    const adjacentSlots = slotsFor(adjacent);
    const target = adjacentSlots.find((slot) => /^\d+$/.test(String(slot.directoryId || ""))) || adjacentSlots[0];
    const needsDate = adjacent.date !== isoDay(new Date()) || new Set(slots.filter((slot) => String(slot.classId) === adjacent.classId).map((slot) => slot.date)).size > 1;
    const href = `/lms/class/${adjacent.classId}/${target.directoryId && /^\d+$/.test(String(target.directoryId)) ? `${target.directoryId}/` : ""}${needsDate ? `?studylogDate=${encodeURIComponent(adjacent.date)}` : ""}`;
    return { href, label: `${offset < 0 ? "← 前の授業へ" : "次の授業へ →"} ${formatContextDate(adjacent.date)} ${adjacent.periods.join("・")}限 ${target.courseName || courseName(snapshot, adjacent.classId)}` };
  }

  function courseMap(snapshot) {
    return new Map(array(snapshot.courses).map((course) => [String(course.classId), course]));
  }

  function courseName(snapshot, classId) {
    return courseMap(snapshot).get(String(classId))?.name || `科目 ${classId || "不明"}`;
  }

  function isUnitExamTitle(value) {
    const title = String(value || "").normalize("NFKC");
    return title.includes("単位認定試験") && !/(練習|模擬|対策|弱点|過去)/.test(title);
  }

  function unitExamForSlot(snapshot, slot) {
    if (!slot?.date || !slot?.classId) return null;
    const academicYear = Number(snapshot.academicYear || new Date().getFullYear());
    if (slot.directoryId) {
      return array(snapshot.directories).find((directory) =>
        String(directory.classId) === String(slot.classId)
        && String(directory.directoryId) === String(slot.directoryId)
        && isUnitExamTitle(directory.title)
      ) || null;
    }
    return array(snapshot.directories).find((directory) => {
      if (String(directory.classId) !== String(slot.classId) || !isUnitExamTitle(directory.title)) return false;
      const lessonDate = directory.lessonDate || dateFromLessonText(directory.title, academicYear);
      return lessonDate === slot.date;
    }) || null;
  }

  function unitExamLabel() {
    return '<em class="studylog-unit-exam-label">重要：単位認定試験</em>';
  }

  function timetableCourseLine(slot, snapshot, { showTime = false } = {}) {
    const exam = unitExamForSlot(snapshot, slot);
    const meta = showTime
      ? `${PERIOD_TIMES[Number(slot.period)]?.start || ""} · ${slot.room ? `${slot.room}教室` : "教室未取得"}`
      : slot.room || "教室未取得";
    return `<div class="studylog-context-line${exam ? " studylog-context-unit-exam" : ""}"><strong>${escapeHtml(slot.period)}限 ${escapeHtml(slot.courseName || courseName(snapshot, slot.classId))}${exam ? unitExamLabel() : ""}</strong><span>${escapeHtml(meta)}</span></div>`;
  }

  function markUnitExamTimetable(snapshot) {
    if (isQuizScreen()) return;
    const firstCell = document.querySelector(".top-timetable-table-td");
    const table = firstCell?.closest("table");
    if (!table) return;
    const grid = tableGrid(table);
    const examHeaders = new Set();
    const slots = readNormalizedTimetable(snapshot.timetableWeekStart?.startDate);
    slots.forEach((slot) => {
      const cell = grid[slot.rowIndex]?.[slot.columnIndex];
      if (!cell) return;
      const exam = unitExamForSlot(snapshot, slot);
      cell.classList.toggle("studylog-unit-exam-cell", Boolean(exam));
      if (!exam) return;
      const header = grid.slice(0, slot.rowIndex).map((row) => row[slot.columnIndex]).reverse().find((candidate) => dateFromLabel(text(candidate)));
      if (header) examHeaders.add(header);
    });
    const currentHeaders = table.querySelectorAll(".studylog-unit-exam-day");
    new Set([...currentHeaders, ...examHeaders]).forEach((header) => header.classList.toggle("studylog-unit-exam-day", examHeaders.has(header)));
  }

  function portalPendingReports(snapshot, preferences, filters = {}) {
    return array(snapshot.reports).filter((report) => {
      if (!isPortalPending(report) || isNotRequired(report, preferences) || isDigestAutoComplete(report, snapshot) || isDigestDeferred(report, snapshot)) return false;
      if (filters.classId && String(report.classId) !== String(filters.classId)) return false;
      if (filters.directoryId && String(report.directoryId) !== String(filters.directoryId)) return false;
      return true;
    });
  }

  function pendingReports(snapshot, preferences, filters = {}) {
    return portalPendingReports(snapshot, preferences, filters).filter((report) => !isManualComplete(report, preferences));
  }

  function compactLabel(scene, snapshot, preferences) {
    if (!snapshot.collectedAt) return "スタログ収集";
    const context = readClassContext();
    const course = courseMap(snapshot).get(String(context.classId));
    if (scene === "directory" && course) return `${course.name} · ほかの回`;
    if (scene === "class" && course) {
      const margin = absenceMargin(course);
      return `${course.name} · ${margin === null ? "出席確認" : `欠席余裕 ${margin}回`}`;
    }
    if (scene === "mypage") return `未整理 ${pendingReports(snapshot, preferences).length}件`;
    const next = nextDifferentCourse(snapshot, new Date(), { todayOnly: scene === "top" });
    if (unitExamForSlot(snapshot, next)) return `重要：単位認定試験 · ${next.courseName || courseName(snapshot, next.classId)}`;
    if (next) return `次: ${next.courseName || courseName(snapshot, next.classId)} ${PERIOD_TIMES[Number(next.period)].start}`;
    return "Studylog Dashboard";
  }

  function formatContextDate(value) {
    if (!value) return "";
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.valueOf())) return "";
    return new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", weekday: "short" }).format(date);
  }

  function reportContextDate(report, snapshot, directories) {
    const directory = directories.get(`${report.classId}:${report.directoryId}`);
    const academicYear = Number(report?.academicYear || directory?.academicYear || snapshot.academicYear || new Date().getFullYear());
    const scheduledAt = dateFromLessonText(report.scheduledAt, academicYear);
    if (scheduledAt) return { label: "実施日", value: scheduledAt };
    const lessonDate = directory?.lessonDate || dateFromLessonText(directory?.title, academicYear);
    return lessonDate ? { value: lessonDate } : null;
  }

  function taskRows(reports, snapshot, preferences, { limit = 3, showChecked = true } = {}) {
    if (!reports.length) return `<p class="studylog-context-empty">該当する未整理項目はありません。</p>`;
    const directories = new Map(array(snapshot.directories).map((directory) => [`${directory.classId}:${directory.directoryId}`, directory]));
    const manualOrder = new Map(array(preferences.manualCompleted).map((key, index) => [key, index]));
    const unchecked = reports
      .filter((report) => !isManualComplete(report, preferences))
      .sort((left, right) => Number(Boolean(notRequiredMatch(left, snapshot, preferences))) - Number(Boolean(notRequiredMatch(right, snapshot, preferences))));
    const checked = (showChecked ? reports : [])
      .filter((report) => isManualComplete(report, preferences))
      .sort((a, b) => (manualOrder.get(reportKey(b)) ?? -1) - (manualOrder.get(reportKey(a)) ?? -1));
    const visible = [...unchecked.slice(0, limit), ...checked.slice(0, 2)];
    return `<div class="studylog-context-list">${visible.map((report) => {
      const href = String(report.href || "").startsWith("/") ? report.href : "";
      const completed = isManualComplete(report, preferences);
      const label = completed ? "チェックを外して未整理へ戻す" : "チェックして完了扱いにする";
      const possibleNotRequired = !completed && notRequiredMatch(report, snapshot, preferences);
      const contextDate = reportContextDate(report, snapshot, directories);
      const dateLabel = contextDate ? ` · ${contextDate.label ? `${contextDate.label} ` : ""}${formatContextDate(contextDate.value)}` : "";
      return `<div class="studylog-context-task" data-manual-complete="${completed}" data-possible-not-required="${Boolean(possibleNotRequired)}"><button class="studylog-context-check" type="button" data-context-manual="${escapeHtml(reportKey(report))}" data-checked="${completed}" aria-pressed="${completed}" aria-label="${label}" title="${label}">✓</button><div><strong>${escapeHtml(report.title || "名称なし")}</strong>${possibleNotRequired ? `<em class="studylog-possible-not-required" title="${escapeHtml(possibleNotRequired.reason)}">対応不要の可能性</em>` : ""}<span>${escapeHtml(courseName(snapshot, report.classId))}${escapeHtml(dateLabel)} · ${escapeHtml(report.status || "状態なし")}${completed ? " · 手動で完了" : ""}</span></div><div class="studylog-context-task-actions"><button type="button" data-context-not-required="${escapeHtml(reportKey(report))}">対応不要</button>${href ? `<a href="${escapeHtml(href)}">開く</a>` : ""}</div></div>`;
    }).join("")}<div class="studylog-context-list-summary">未完了 ${unchecked.length}件${showChecked ? ` · チェック済み ${checked.length}件` : ""}</div></div>`;
  }

  function nextCourseBlock(snapshot, { todayOnly = false } = {}) {
    const next = nextDifferentCourse(snapshot, new Date(), { todayOnly });
    if (!next) return `<div class="studylog-context-feature"><span>次の科目</span><strong>${todayOnly ? "次の授業はありません" : "判定できません"}</strong><small>${todayOnly ? "次の授業日は表示しません" : "次の授業日を含む時間割を収集してください"}</small></div>`;
    const time = PERIOD_TIMES[Number(next.period)];
    const exam = unitExamForSlot(snapshot, next);
    return `<div class="studylog-context-feature studylog-context-next${exam ? " studylog-context-unit-exam" : ""}"><span>次の科目</span>${exam ? unitExamLabel() : ""}<strong>${escapeHtml(next.courseName || courseName(snapshot, next.classId))}</strong><small>${escapeHtml(next.period)}限 ${escapeHtml(time.start)} · ${escapeHtml(next.room ? `${next.room}教室` : "教室未取得")}</small></div>`;
  }

  function progressBlock(snapshot, preferences, classIds = null) {
    const reports = array(snapshot.reports).filter((report) => (!classIds || classIds.has(String(report.classId))) && isCompletionCourseIncluded(report, preferences) && !isNotRequired(report, preferences) && !isDigestDeferred(report, snapshot));
    const done = reports.filter((report) => isPortalDone(report) || isManualComplete(report, preferences) || isDigestAutoComplete(report, snapshot)).length;
    const rate = reports.length ? Math.round(done / reports.length * 100) : 0;
    const pending = reports.filter((report) => isEffectivelyPending(report, snapshot, preferences)).length;
    const allCourseIds = new Set(array(snapshot.courses).map((course) => String(course.classId)).filter(Boolean));
    const availableCourseIds = classIds || allCourseIds;
    const selectedCourseIds = [...availableCourseIds].filter((classId) => isCompletionCourseIncluded({ classId }, preferences));
    return `<div class="studylog-context-feature"><span>${classIds ? "今日の科目の整理率" : "課題の整理率"}</span><strong>${rate}%</strong><small>${done}/${reports.length}件 · 未完了${pending}件 · 対象${selectedCourseIds.length}/${availableCourseIds.size}科目</small></div>`;
  }

  function courseBlock(course, snapshot) {
    if (!course) return `<p class="studylog-context-empty">この科目の収集データがありません。</p>`;
    const margin = absenceMargin(course);
    const rate = Math.round(attendanceRate(course) * 100);
    const archived = isArchived(course, snapshot);
    return `<div class="studylog-context-metrics"><div><span>出席扱い率</span><strong>${rate}%</strong></div><div><span>欠席余裕</span><strong>${margin ?? "—"}回</strong></div><div><span>状態</span><strong>${archived ? "終了" : "実施中"}</strong></div></div>`;
  }

  function sceneContent(scene, snapshot, preferences) {
    const context = readClassContext();
    const course = courseMap(snapshot).get(String(context.classId));
    const allPending = portalPendingReports(snapshot, preferences);
    const coursePending = portalPendingReports(snapshot, preferences, { classId: context.classId });
    const otherCoursePending = coursePending.filter((report) => String(report.directoryId || "") !== String(context.directoryId || ""));
    const today = todayCourseBlocks(snapshot);
    const todayClassIds = new Set(today.map((slot) => String(slot.classId)));
    const todayPending = allPending.filter((report) => todayClassIds.has(String(report.classId)));
    if (!snapshot.collectedAt) return `<p class="studylog-context-empty">まだ収集していません。「取得して保存」を押してください。</p>`;
    if (scene === "top") return `${nextCourseBlock(snapshot, { todayOnly: true })}<h3>今日の授業</h3><div class="studylog-context-list">${today.slice(0, 4).map((slot) => timetableCourseLine(slot, snapshot)).join("") || `<p class="studylog-context-empty">今日の時間割はありません。</p>`}</div><h3>次に確認する候補</h3>${taskRows(todayPending, snapshot, preferences, { showChecked: false })}`;
    if (scene === "schedule") return `${nextCourseBlock(snapshot)}<h3>今日の授業</h3><div class="studylog-context-list">${today.map((slot) => timetableCourseLine(slot, snapshot, { showTime: true })).join("") || `<p class="studylog-context-empty">今日の時間割はありません。</p>`}</div>`;
    if (scene === "mypage") return `${progressBlock(snapshot, preferences)}<h3>スタログ上の未完了</h3>${taskRows(allPending, snapshot, preferences, { limit: 5 })}`;
    if (scene === "class") return `${courseBlock(course, snapshot)}<h3>この科目の未整理</h3>${taskRows(coursePending, snapshot, preferences)}<button class="studylog-context-wide" type="button" data-action="dashboard" data-view="courses">科目カルテを開く</button>`;
    if (scene === "directory") return `<h3>同じ授業のほかの回</h3>${taskRows(otherCoursePending, snapshot, preferences)}<button class="studylog-context-wide" type="button" data-action="dashboard" data-view="courses">科目カルテを開く</button>`;
    return `${nextCourseBlock(snapshot)}${progressBlock(snapshot, preferences)}`;
  }

  function sceneTitle(scene) {
    return ({ top: "今日のブリーフ", schedule: "時間割", mypage: "課題状況", class: "科目の状況", directory: "この授業回", other: "学習状況" })[scene] || "学習状況";
  }

  const quizTrace = [];
  const QUIZ_TEXT_IDLE_SAVE_DELAY_MS = 30000;
  let quizTraceRecording = true;
  let quizAutoSaveTimer;
  let quizAutoSaveInFlight = false;
  let quizAutoSaveQueued = false;
  let quizAutoSaveRequestId = "";
  let quizAutoSaveTimeout;

  function isQuizAnswerControl(target) {
    return target instanceof HTMLElement
      && /^answers\[/.test(String(target.getAttribute("name") || ""))
      && target.getAttribute("type") !== "file";
  }

  function startQuizAutoSave() {
    quizAutoSaveTimer = undefined;
    if (!isQuizScreen() || !quizAutoSaveQueued || quizAutoSaveInFlight) return;
    quizAutoSaveQueued = false;
    quizAutoSaveInFlight = true;
    quizAutoSaveRequestId = `autosave-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    window.dispatchEvent(new CustomEvent("studylog-bridge:quiz-save-request", { detail: { requestId: quizAutoSaveRequestId } }));
    clearTimeout(quizAutoSaveTimeout);
    quizAutoSaveTimeout = window.setTimeout(() => {
      quizAutoSaveInFlight = false;
      quizAutoSaveRequestId = "";
      if (quizAutoSaveQueued) scheduleQuizAutoSave(250);
    }, 12000);
  }

  function scheduleQuizAutoSave(delay = 800) {
    if (!isQuizScreen()) return;
    quizAutoSaveQueued = true;
    clearTimeout(quizAutoSaveTimer);
    quizAutoSaveTimer = window.setTimeout(startQuizAutoSave, delay);
  }

  function persistQuizTrace() {
    try {
      sessionStorage.setItem(QUIZ_TRACE_SESSION_KEY, JSON.stringify(quizTrace));
    } catch {
      // セッション領域が使えない環境では、そのページを開いている間だけ保持する。
    }
  }

  function safeTraceUrl(value) {
    try {
      const url = new URL(String(value || ""), location.href);
      const queryKeys = [...new Set(url.searchParams.keys())];
      return `${url.origin === location.origin ? "" : url.origin}${url.pathname}${queryKeys.length ? `?${queryKeys.map(encodeURIComponent).join("&")}` : ""}`;
    } catch {
      return "(URLを取得できません)";
    }
  }

  function normalizeTrace(detail) {
    const parsedAt = new Date(detail?.at || Date.now());
    const entry = {
      at: Number.isNaN(parsedAt.valueOf()) ? new Date().toISOString() : parsedAt.toISOString(),
      elapsedMs: Number(detail?.elapsedMs) || Math.round(performance.now()),
      phase: String(detail?.phase || "signal").slice(0, 20),
      transport: String(detail?.transport || "ui").slice(0, 20)
    };
    if (detail?.requestId) entry.requestId = String(detail.requestId).slice(0, 40);
    if (detail?.method) entry.method = String(detail.method).slice(0, 12).toUpperCase();
    if (detail?.url) entry.url = safeTraceUrl(detail.url);
    if (detail?.signal) entry.signal = String(detail.signal).slice(0, 60);
    if (detail?.control) entry.control = String(detail.control).slice(0, 120);
    if (detail?.status !== undefined) entry.status = String(detail.status).slice(0, 20);
    if (detail?.failed) entry.failed = true;
    entry.fields = array(detail?.fields).map((field) => String(field).slice(0, 80)).filter(Boolean).slice(0, 40);
    entry.hints = Object.fromEntries(Object.entries(detail?.hints || {})
      .filter(([key]) => ["action", "back", "timeover", "select_page_number_flg", "page_number", "prev_page_number"].includes(key))
      .map(([key, value]) => [key, String(value).slice(0, 100)]));
    if (detail?.source) entry.source = String(detail.source).slice(0, 600);
    return entry;
  }

  function isSaveCandidate(entry) {
    const haystack = [entry.signal, entry.control, entry.url, ...entry.fields].join(" ");
    return entry.phase !== "response" && /save|pause|suspend|interrupt|answer|response|quiz|submit|finish|complete|中断|保存|一時|解答|回答|提出|終了/i.test(haystack);
  }

  function traceSummary(entry) {
    if (entry.transport === "ui") return entry.control ? `${entry.signal}: ${entry.control}` : entry.signal;
    if (entry.transport === "form") return `${entry.signal}: ${entry.method} ${entry.url}`;
    if (entry.phase === "response") return `${entry.transport} 応答 ${entry.status}: ${entry.url}`;
    return `${entry.transport} ${entry.method}: ${entry.url}`;
  }

  function renderQuizTrace() {
    const root = document.getElementById(QUIZ_INSPECTOR_ROOT_ID);
    if (!root) return;
    const list = root.querySelector("#studylog-quiz-trace-list");
    const visible = quizTrace.slice(-80).reverse();
    list.innerHTML = visible.map((entry) => `
      <li data-candidate="${isSaveCandidate(entry)}">
        <time>${escapeHtml(new Date(entry.at).toLocaleTimeString("ja-JP", { hour12: false }))}</time>
        <div><strong>${escapeHtml(traceSummary(entry))}</strong>${entry.fields.length ? `<small>フィールド: ${escapeHtml(entry.fields.join(", "))}</small>` : ""}${Object.keys(entry.hints).length ? `<small>制御値: ${escapeHtml(Object.entries(entry.hints).map(([key, value]) => `${key}=${value}`).join(", "))}</small>` : ""}${entry.source ? `<small>呼出元: ${escapeHtml(entry.source)}</small>` : ""}</div>
        ${isSaveCandidate(entry) ? "<span>候補</span>" : ""}
      </li>`).join("") || '<li class="studylog-quiz-trace-empty">まだイベントはありません。</li>';
    root.querySelector("#studylog-quiz-trace-count").textContent = `${quizTrace.length}件`;
    root.querySelector('[data-quiz-action="record"]').textContent = quizTraceRecording ? "記録を停止" : "記録を再開";
    root.querySelector("#studylog-quiz-trace-state").textContent = quizTraceRecording ? "記録中" : "停止中";
  }

  function recordQuizTrace(detail) {
    if (!quizTraceRecording || !isQuizScreen()) return;
    quizTrace.push(normalizeTrace(detail));
    if (quizTrace.length > QUIZ_TRACE_LIMIT) quizTrace.splice(0, quizTrace.length - QUIZ_TRACE_LIMIT);
    persistQuizTrace();
    renderQuizTrace();
  }

  function controlMetadata(target) {
    const control = target?.closest?.("button, input[type='button'], input[type='submit'], a, [role='button']");
    if (!control || control.closest(`#${QUIZ_INSPECTOR_ROOT_ID}`)) return null;
    const type = control.getAttribute("type") || control.tagName.toLowerCase();
    const id = control.id ? `#${control.id}` : "";
    const name = control.getAttribute("name") ? `[name=${control.getAttribute("name")}]` : "";
    const action = control.getAttribute("data-action") ? `[action=${control.getAttribute("data-action")}]` : "";
    const visibleText = text(control);
    const label = /中断|保存|一時|次へ|前へ|戻る|確認|提出|終了|再開/.test(visibleText) ? `「${visibleText.slice(0, 40)}」` : "";
    return `${control.tagName.toLowerCase()}${id}${name}${action}[type=${type}]${label}`;
  }

  function installQuizInspector() {
    if (!isQuizScreen() || document.getElementById(QUIZ_INSPECTOR_ROOT_ID)) return;
    const root = document.createElement("div");
    root.id = QUIZ_INSPECTOR_ROOT_ID;
    root.innerHTML = `
      <section id="studylog-quiz-inspector-panel" data-open="true" aria-live="polite">
        <header><div><span>STUDYLOG LAB</span><h2>クイズ保存調査</h2></div><button type="button" data-quiz-action="toggle" aria-label="折りたたむ">×</button></header>
        <p class="studylog-quiz-inspector-note">解答内容は採取せず、操作と通信のメタデータだけをタブ内に記録します。</p>
        <div class="studylog-quiz-inspector-status"><strong id="studylog-quiz-trace-state">記録中</strong><span id="studylog-quiz-trace-count">0件</span></div>
        <ol id="studylog-quiz-trace-list"></ol>
        <footer>
          <button class="studylog-quiz-save-experiment" type="button" data-quiz-action="save">このページを保存</button>
          <button type="button" data-quiz-action="record">記録を停止</button>
          <button type="button" data-quiz-action="clear">消去</button>
          <button type="button" data-quiz-action="copy">匿名ログをコピー</button>
        </footer>
        <p id="studylog-quiz-inspector-message">「候補」は保存に関係しそうな操作・通信です。</p>
      </section>
      <button id="studylog-quiz-inspector-toggle" type="button" data-quiz-action="toggle"><span>◎</span><span>保存調査</span></button>`;
    document.documentElement.append(root);
    root.addEventListener("click", async (event) => {
      const action = event.target.closest("[data-quiz-action]")?.dataset.quizAction;
      if (!action) return;
      const panel = root.querySelector("#studylog-quiz-inspector-panel");
      const message = root.querySelector("#studylog-quiz-inspector-message");
      if (action === "toggle") {
        panel.dataset.open = panel.dataset.open === "true" ? "false" : "true";
        return;
      }
      if (action === "record") {
        quizTraceRecording = !quizTraceRecording;
        renderQuizTrace();
        return;
      }
      if (action === "save") {
        const button = event.target.closest("button");
        const requestId = `save-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        button.disabled = true;
        button.dataset.requestId = requestId;
        message.textContent = "現在ページの保存要求を送信しています…";
        window.dispatchEvent(new CustomEvent("studylog-bridge:quiz-save-request", { detail: { requestId } }));
        window.setTimeout(() => {
          if (button.dataset.requestId !== requestId) return;
          button.disabled = false;
          delete button.dataset.requestId;
          message.textContent = "保存要求がタイムアウトしました。ログを確認してください。";
        }, 10000);
        return;
      }
      if (action === "clear") {
        quizTrace.splice(0);
        persistQuizTrace();
        renderQuizTrace();
        message.textContent = "ログを消去しました。";
        return;
      }
      if (action === "copy") {
        const payload = JSON.stringify({
          schemaVersion: 1,
          page: safeTraceUrl(location.href),
          copiedAt: new Date().toISOString(),
          entries: quizTrace
        }, null, 2);
        try {
          await navigator.clipboard.writeText(payload);
          message.textContent = "匿名ログをクリップボードへコピーしました。";
        } catch {
          message.textContent = "コピーできませんでした。ブラウザの権限を確認してください。";
        }
      }
    });
    renderQuizTrace();
  }

  function dashboardView(scene) {
    if (scene === "mypage") return "tasks";
    if (scene === "class" || scene === "directory") return "courses";
    return "home";
  }

  async function updateTaskDisposition(key, disposition) {
    const preferences = await readPreferences();
    const completed = new Set(array(preferences.manualCompleted));
    const notRequired = new Set(array(preferences.notRequired));
    if (disposition === "manual") {
      if (completed.has(key)) completed.delete(key);
      else {
        completed.add(key);
        notRequired.delete(key);
      }
    }
    if (disposition === "not-required") {
      if (notRequired.has(key)) notRequired.delete(key);
      else {
        notRequired.add(key);
        completed.delete(key);
      }
    }
    preferences.manualCompleted = [...completed];
    preferences.notRequired = [...notRequired];
    await savePreferences(preferences);
    const snapshot = await readSnapshot();
    await renderCompanion(document.getElementById(ROOT_ID), snapshot, preferences);
  }

  function inlineReportHost(root, report) {
    const wanted = normalize(report.title);
    if (!wanted) return null;
    const direct = [...root.querySelectorAll("a, button, strong, [data-title], [title]")]
      .find((element) => normalize(text(element)) === wanted || normalize(element.getAttribute?.("title")) === wanted);
    if (direct) return direct.closest("td, li, .content-row, .class-content") || direct.parentElement;
    return [...root.querySelectorAll("td, li")]
      .filter((element) => normalize(text(element)).includes(wanted))
      .sort((left, right) => text(left).length - text(right).length)[0] || null;
  }

  function inlineTaskMarkup(report, snapshot, preferences) {
    const key = reportKey(report);
    const manual = isManualComplete(report, preferences);
    const notRequired = isNotRequired(report, preferences);
    const portalDone = isPortalDone(report);
    const digestDone = isDigestAutoComplete(report, snapshot);
    const deferred = isDigestDeferred(report, snapshot);
    const locked = portalDone || digestDone || deferred || notRequired;
    const possible = !manual && !notRequired && !portalDone ? notRequiredMatch(report, snapshot, preferences) : null;
    const checkLabel = portalDone ? "スタログ上で完了" : manual ? "手動完了を解除" : notRequired ? "対応不要のため完了操作はできません" : "手動完了にする";
    const stateLabel = portalDone ? "完了" : manual ? "手動完了" : notRequired ? "対応不要" : "未完了";
    return `<button class="studylog-inline-check${manual ? " is-manual" : portalDone ? " is-portal-done" : ""}" type="button" data-inline-manual="${escapeHtml(key)}" aria-pressed="${manual || portalDone}" title="${checkLabel}"${locked && !manual ? " disabled" : ""}>✓</button><span class="studylog-inline-state" data-state="${portalDone ? "done" : manual ? "manual" : notRequired ? "not-required" : "pending"}">${stateLabel}</span>${possible ? `<span class="studylog-inline-possible" title="${escapeHtml(possible.reason)}">対応不要の可能性</span>` : ""}${!portalDone && !digestDone && !deferred ? `<button class="studylog-inline-not-required${notRequired ? " is-active" : ""}" type="button" data-inline-not-required="${escapeHtml(key)}">${notRequired ? "対応不要を解除" : "対応不要"}</button>` : ""}`;
  }

  function renderInlineTaskControls(snapshot, preferences) {
    const root = document.querySelector("#div-class-contents");
    const context = readClassContext();
    if (!root || !context.classId || !context.directoryId) return;
    array(snapshot.reports)
      .filter((report) => String(report.classId) === String(context.classId) && String(report.directoryId) === String(context.directoryId))
      .forEach((report) => {
        const key = reportKey(report);
        const markup = inlineTaskMarkup(report, snapshot, preferences);
        let controls = [...root.querySelectorAll(".studylog-inline-task-control")].find((item) => item.dataset.inlineTaskKey === key);
        if (!controls) {
          const host = inlineReportHost(root, report);
          if (!host) return;
          controls = document.createElement("span");
          controls.className = "studylog-inline-task-control";
          controls.dataset.inlineTaskKey = key;
          host.append(controls);
        }
        if (controls.innerHTML !== markup) controls.innerHTML = markup;
      });
  }

  async function renderCompanion(root, suppliedSnapshot, suppliedPreferences) {
    if (!root || isQuizScreen()) return;
    const [snapshot, preferences] = suppliedSnapshot && suppliedPreferences
      ? [suppliedSnapshot, suppliedPreferences]
      : await Promise.all([readSnapshot(), readPreferences()]);
    const scene = pageScene();
    const navigation = courseNavigationContext(snapshot);
    root.querySelector("#studylog-course-navigation").hidden = !navigation;
    const dateControl = root.querySelector("#studylog-course-navigation-choice");
    const dateSelector = root.querySelector("#studylog-course-navigation-date");
    dateControl.hidden = !navigation || navigation.dates.length < 2;
    dateSelector.innerHTML = '<option value="">日付を選択</option>' + (navigation?.dates || []).map((date) => `<option value="${escapeHtml(date)}">${escapeHtml(formatContextDate(date))}</option>`).join("");
    dateSelector.dataset.context = navigation?.contextKey || "";
    dateSelector.value = navigation?.date || "";
    let hasCourseLink = false;
    for (const [direction, offset] of [["previous", -1], ["next", 1]]) {
      const course = adjacentCourseFromCurrentPage(snapshot, offset, navigation);
      hasCourseLink ||= Boolean(course);
      const shortcut = root.querySelector(`#studylog-${direction}-course`);
      shortcut.hidden = !course;
      if (course) {
        shortcut.href = course.href;
        shortcut.textContent = course.label;
      } else {
        shortcut.removeAttribute("href");
        shortcut.textContent = "";
      }
    }
    const navigationStatus = root.querySelector("#studylog-course-navigation-status");
    navigationStatus.hidden = !navigation || hasCourseLink;
    navigationStatus.textContent = !navigation ? "" : !navigation.dates.length
      ? "この科目の時間割が未取得です。トップで該当する日の時間割を表示してください。"
      : !navigation.date ? "この科目は複数日にあります。前後に移動する日付を選んでください。"
      : "保存済み時間割に前後の授業がないか、この授業回を特定できません。該当する日の時間割を確認してください。";
    root.querySelector("#studylog-bridge-toggle").title = `STUDYLOGメニュー · ${compactLabel(scene, snapshot, preferences)}`;
    root.querySelector("#studylog-context-body").innerHTML = sceneContent(scene, snapshot, preferences);
    root.querySelector("#studylog-context-title").textContent = sceneTitle(scene);
    root.querySelector('[data-action="dashboard"][data-footer]').dataset.view = dashboardView(scene);
    const updated = snapshot.collectedAt ? new Date(snapshot.collectedAt).toLocaleString("ja-JP") : "未取得";
    root.querySelector("#studylog-bridge-status").textContent = `最終取得: ${updated}`;
    markUnitExamTimetable(snapshot);
    renderInlineTaskControls(snapshot, preferences);
    root.dataset.ready = "true";
  }

  let automaticCollectionPromise;
  let automaticCollectionRetryAt = 0;
  let forcedReportRefreshQueued = false;
  let statusRefreshTimer;

  function automaticCollectionAllowed() {
    return !isQuizScreen() && location.hostname === "portal.iwasaki.ac.jp" && document.visibilityState !== "hidden";
  }

  function pendingCountForYear(snapshot, academicYear, fallbackYear) {
    return itemsForYear(snapshot?.reports, academicYear, fallbackYear)
      .filter((report) => /未完了|未提出|未回答|未受験|未実施/.test(report?.status || ""))
      .length;
  }

  function orderedClassIds(snapshot, academicYear, fallbackYear) {
    const currentClassId = readClassContext().classId;
    return [...new Set([
      currentClassId,
      ...itemsForYear(snapshot?.courses, academicYear, fallbackYear).map((course) => course.classId),
      ...itemsForYear(snapshot?.reports, academicYear, fallbackYear).map((report) => report.classId)
    ].filter(Boolean))];
  }

  async function automaticCollectionDue(forceReports = false) {
    const stored = await chrome.storage.local.get([STORAGE_KEY, AUTO_COLLECT_STATE_KEY]);
    const snapshot = stored[STORAGE_KEY] || await readSnapshot();
    const state = { ...(stored[AUTO_COLLECT_STATE_KEY] || {}), years: stored[AUTO_COLLECT_STATE_KEY]?.years || {} };
    const startedAt = Date.parse(state.startedAt || "") || 0;
    const completedAt = Date.parse(state.completedAt || "") || 0;
    if (startedAt > completedAt && Date.now() - startedAt < AUTO_COLLECT_RETRY_MS) return null;
    const previousYear = Number(snapshot.academicYear || readAcademicYear());
    const academicYear = readAcademicYear(previousYear);
    const storedYearState = state.years[academicYear] || {};
    const legacyCollectedAt = Number(academicYear) === previousYear ? snapshot.collectedAt : undefined;
    const yearState = {
      ...storedYearState,
      reportStatusCollectedAt: storedYearState.reportStatusCollectedAt || snapshot.freshnessByYear?.[academicYear]?.reportStatusCollectedAt || legacyCollectedAt,
      subjectStatusCollectedAt: storedYearState.subjectStatusCollectedAt || snapshot.freshnessByYear?.[academicYear]?.subjectStatusCollectedAt || legacyCollectedAt,
      directoriesByClass: storedYearState.directoriesByClass || Object.fromEntries(orderedClassIds(snapshot, academicYear, previousYear).map((classId) => [classId, snapshot.lessonListCollectedAt || legacyCollectedAt]).filter(([, value]) => value))
    };
    const classIds = orderedClassIds(snapshot, academicYear, previousYear);
    const plan = StudylogAutoSyncRules.plan({
      academicYear,
      pendingCount: pendingCountForYear(snapshot, academicYear, previousYear),
      classIds,
      yearState,
      forceReports
    });
    return plan.hasWork ? { snapshot, state, yearState, previousYear, academicYear, plan } : null;
  }

  async function acquireAutomaticCollectionLease() {
    try {
      const response = await chrome.runtime.sendMessage({ type: "studylog-bridge:auto-collection-acquire", leaseMs: AUTO_COLLECT_RETRY_MS });
      if (response && typeof response.granted === "boolean") return response;
    } catch {
      // テスト環境や旧バックグラウンドでは、このタブ内の排他制御だけを使う。
    }
    return { granted: true, leaseId: `local-${Date.now()}` };
  }

  function releaseAutomaticCollectionLease(leaseId) {
    if (!leaseId || String(leaseId).startsWith("local-")) return;
    const result = chrome.runtime.sendMessage({ type: "studylog-bridge:auto-collection-release", leaseId });
    result?.catch?.(() => {});
  }

  async function collectAutomatically(context) {
    const { snapshot, state, yearState, previousYear, academicYear, plan } = context;
    const changes = {};
    const errors = [];
    let succeeded = false;
    state.startedAt = new Date().toISOString();
    stampLegacyAcademicYear(snapshot, previousYear);

    if (plan.reportsDue) {
      try {
        const collectedAt = new Date().toISOString();
        const reports = parseReportStatus(await fetchText("/portal/lmsinc/myReportStatus.php"));
        snapshot.reports = replaceYearItems(snapshot.reports, reports, academicYear, previousYear, (item) => `${item.academicYear}:${reportKey(item)}`);
        yearState.reportStatusCollectedAt = collectedAt;
        changes.reportStatusCollectedAt = collectedAt;
        sessionStorage.removeItem(STATUS_REFRESH_SESSION_KEY);
        succeeded = true;
      } catch (error) { errors.push(error); }
    }

    if (plan.subjectsDue) {
      try {
        const collectedAt = new Date().toISOString();
        const courses = parseSubjectStatus(await fetchText("/portal/lmsinc/mySubjectStatus.php"));
        snapshot.courses = replaceYearItems(snapshot.courses, courses, academicYear, previousYear, (item) => `${item.academicYear}:${item.classId}`);
        yearState.subjectStatusCollectedAt = collectedAt;
        changes.subjectStatusCollectedAt = collectedAt;
        succeeded = true;
      } catch (error) { errors.push(error); }
    }

    if (plan.directoryClassId) {
      try {
        const collectedAt = new Date().toISOString();
        const directories = await fetchCourseDirectories(plan.directoryClassId, academicYear);
        const lessonDates = await fetchLessonDates(plan.directoryClassId, academicYear).catch(() => []);
        const merged = mergeBy(directories, lessonDates, (entry) => `${entry.classId}:${entry.directoryId}`);
        snapshot.directories = mergeBy(snapshot.directories, merged.map((item) => ({ ...item, academicYear })), (item) => `${item.classId}:${item.directoryId}`);
        yearState.directoriesByClass = { ...(yearState.directoriesByClass || {}), [plan.directoryClassId]: collectedAt };
        changes.lastDirectoryCollectedAt = collectedAt;
        changes.lastDirectoryClassId = plan.directoryClassId;
        succeeded = true;
      } catch (error) { errors.push(error); }
    }

    if (succeeded) {
      const completedAt = new Date().toISOString();
      snapshot.schemaVersion = 1;
      snapshot.academicYear = academicYear;
      snapshot.sourceOrigin = location.origin;
      snapshot.collectedAt = completedAt;
      mergeCurrentPage(snapshot);
      markSnapshotFreshness(snapshot, academicYear, changes);
      state.years[academicYear] = yearState;
      state.completedAt = completedAt;
      if (errors.length) state.lastError = errors[0].message;
      else delete state.lastError;
      await chrome.storage.local.set({ [STORAGE_KEY]: snapshot, [AUTO_COLLECT_STATE_KEY]: state });
    }
    if (errors.length) throw errors[0];
    return snapshot;
  }

  async function runAutomaticCollection(options = {}) {
    const forceReports = options?.forceReports === true;
    if (forceReports && automaticCollectionPromise) forcedReportRefreshQueued = true;
    if (!automaticCollectionAllowed() || automaticCollectionPromise || Date.now() < automaticCollectionRetryAt) return automaticCollectionPromise;
    const context = await automaticCollectionDue(forceReports);
    if (!context) return null;
    const lease = await acquireAutomaticCollectionLease();
    if (!lease.granted) return null;
    const root = document.getElementById(ROOT_ID);
    automaticCollectionPromise = (async () => {
      if (root) root.querySelector("#studylog-bridge-status").textContent = "自動取得中…";
      try {
        const snapshot = await collectAutomatically(context);
        await renderCompanion(root);
        return snapshot;
      } catch (error) {
        automaticCollectionRetryAt = Date.now() + AUTO_COLLECT_RETRY_MS;
        window.setTimeout(runAutomaticCollection, AUTO_COLLECT_RETRY_MS);
        if (root) root.querySelector("#studylog-bridge-status").textContent = `自動取得を再試行します: ${error.message}`;
        return null;
      } finally {
        automaticCollectionPromise = null;
        releaseAutomaticCollectionLease(lease.leaseId);
        if (forcedReportRefreshQueued) {
          forcedReportRefreshQueued = false;
          window.setTimeout(() => runAutomaticCollection({ forceReports: true }), STATUS_REFRESH_DELAY_MS);
        }
      }
    })();
    return automaticCollectionPromise;
  }

  function queueStatusRefresh(delay = STATUS_REFRESH_DELAY_MS) {
    try { sessionStorage.setItem(STATUS_REFRESH_SESSION_KEY, String(Date.now())); } catch { /* ページ内タイマーだけで継続する。 */ }
    clearTimeout(statusRefreshTimer);
    statusRefreshTimer = window.setTimeout(() => runAutomaticCollection({ forceReports: true }), delay);
  }

  function refreshStatusImmediatelyAndLater() {
    try { sessionStorage.setItem(STATUS_REFRESH_SESSION_KEY, String(Date.now())); } catch { /* ページ遷移後の再開ができない場合でも、このページでは更新する。 */ }
    clearTimeout(statusRefreshTimer);
    runAutomaticCollection({ forceReports: true });
    statusRefreshTimer = window.setTimeout(() => runAutomaticCollection({ forceReports: true }), STATUS_REFRESH_DELAY_MS);
  }

  function resumePendingStatusRefresh() {
    try {
      const requestedAt = Number(sessionStorage.getItem(STATUS_REFRESH_SESSION_KEY) || 0);
      if (requestedAt && Date.now() - requestedAt < 10 * 60 * 1000) refreshStatusImmediatelyAndLater();
      else sessionStorage.removeItem(STATUS_REFRESH_SESSION_KEY);
    } catch {
      // セッション領域が使えない場合は通常の30分取得で補う。
    }
  }

  async function captureCurrentPageAutomatically() {
    if (isQuizScreen()) return;
    const snapshot = prepareSnapshotForCurrentYear(await readSnapshot());
    mergeCurrentPage(snapshot);
    if (!snapshot.collectedAt) return;
    await saveSnapshot(snapshot);
    await renderCompanion(document.getElementById(ROOT_ID));
  }

  function installUi() {
    if (isQuizScreen() || document.getElementById(ROOT_ID)) return;
    const root = document.createElement("div");
    root.id = ROOT_ID;
    root.innerHTML = `
      <div id="studylog-bridge-panel" aria-live="polite">
        <div class="studylog-context-head"><div><span>STUDYLOG</span><h2 id="studylog-context-title">学習状況</h2></div><button type="button" data-action="close" aria-label="閉じる">×</button></div>
        <div id="studylog-context-body"></div>
        <div class="studylog-bridge-actions">
          <button class="studylog-bridge-primary" type="button" data-action="collect">取得して保存</button>
          <button type="button" data-action="dashboard" data-footer>ダッシュボード</button>
          <button type="button" data-action="export">JSON</button>
        </div>
        <p id="studylog-bridge-status"></p>
        <div id="studylog-course-navigation" hidden>
          <p id="studylog-course-navigation-status" hidden></p>
          <label id="studylog-course-navigation-choice" hidden>時間割の日付 <select id="studylog-course-navigation-date"></select></label>
          <a id="studylog-previous-course" class="studylog-course-shortcut" hidden></a>
          <a id="studylog-next-course" class="studylog-course-shortcut" hidden></a>
        </div>
      </div>
      <button id="studylog-bridge-toggle" type="button" aria-label="STUDYLOGメニューを開閉" aria-controls="studylog-bridge-panel" aria-expanded="false"><img class="studylog-context-icon" src="${chrome.runtime.getURL("icons/studylog.svg")}" alt="" aria-hidden="true"></button>`;
    document.documentElement.append(root);
    root.querySelector("#studylog-course-navigation-date").addEventListener("change", () => renderCompanion(root));
    root.addEventListener("click", async (event) => {
      const action = event.target.closest("[data-action]")?.dataset.action;
      const panel = root.querySelector("#studylog-bridge-panel");
      if (event.target.closest("#studylog-bridge-toggle")) {
        panel.dataset.open = panel.dataset.open === "true" ? "false" : "true";
        root.querySelector("#studylog-bridge-toggle").setAttribute("aria-expanded", panel.dataset.open);
        if (panel.dataset.open === "true") await renderCompanion(root);
        return;
      }
      if (action === "close") {
        panel.dataset.open = "false";
        root.querySelector("#studylog-bridge-toggle").setAttribute("aria-expanded", "false");
        root.querySelector("#studylog-bridge-toggle").focus();
        return;
      }
      if (action === "collect") {
        const button = event.target.closest("button");
        button.disabled = true;
        root.querySelector("#studylog-bridge-status").textContent = "取得中…";
        try {
          const snapshot = automaticCollectionPromise ? await automaticCollectionPromise : await collect();
          if (!snapshot) throw new Error("取得を完了できませんでした");
          await renderCompanion(root);
        }
        catch (error) { root.querySelector("#studylog-bridge-status").textContent = `取得できませんでした: ${error.message}`; }
        finally { button.disabled = false; }
        return;
      }
      if (action === "export") {
        const snapshot = await readSnapshot();
        if (!snapshot.collectedAt) { root.querySelector("#studylog-bridge-status").textContent = "先に取得してください。"; return; }
        exportSnapshot(snapshot);
        root.querySelector("#studylog-bridge-status").textContent = "JSONを書き出しました。";
        return;
      }
      if (action === "dashboard") {
        chrome.runtime.sendMessage({ type: "studylog-bridge:open-dashboard", view: event.target.closest("[data-view]")?.dataset.view || dashboardView(pageScene()) });
        return;
      }
      const manual = event.target.closest("[data-context-manual]");
      if (manual) {
        await updateTaskDisposition(manual.dataset.contextManual, "manual");
        return;
      }
      const notRequired = event.target.closest("[data-context-not-required]");
      if (notRequired) await updateTaskDisposition(notRequired.dataset.contextNotRequired, "not-required");
    });
    renderCompanion(root);
  }

  let pageHookInjected = false;
  function injectPageHook() {
    if (pageHookInjected) return;
    const host = document.documentElement || document.head;
    if (!host) {
      document.addEventListener("readystatechange", injectPageHook, { once: true });
      return;
    }
    pageHookInjected = true;
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("page-hook.js");
    script.dataset.studylogBridgeHook = "true";
    host.append(script);
    script.remove();
  }

  window.addEventListener("studylog-bridge:quiz-traffic", (event) => recordQuizTrace(event.detail));
  window.addEventListener("studylog-bridge:learning-write", (event) => {
    if (event.detail?.phase === "submitted") {
      refreshStatusImmediatelyAndLater();
      return;
    }
    if (event.detail?.phase === "response" && Number(event.detail?.status) >= 200 && Number(event.detail?.status) < 400) queueStatusRefresh();
  });
  window.addEventListener("studylog-bridge:quiz-save-result", (event) => {
    if (String(event.detail?.requestId || "") === quizAutoSaveRequestId) {
      clearTimeout(quizAutoSaveTimeout);
      quizAutoSaveInFlight = false;
      quizAutoSaveRequestId = "";
      recordQuizTrace({
        phase: "signal",
        transport: "autosave",
        signal: event.detail?.ok ? "saved" : "failed",
        status: event.detail?.status,
        control: event.detail?.pageNumber ? `page=${event.detail.pageNumber}` : undefined
      });
      if (quizAutoSaveQueued) scheduleQuizAutoSave(250);
      return;
    }
    const root = document.getElementById(QUIZ_INSPECTOR_ROOT_ID);
    const button = root?.querySelector('[data-quiz-action="save"]');
    const message = root?.querySelector("#studylog-quiz-inspector-message");
    if (!button || button.dataset.requestId !== String(event.detail?.requestId || "")) return;
    button.disabled = false;
    delete button.dataset.requestId;
    if (event.detail?.ok) {
      message.textContent = `ページ${event.detail.pageNumber}を保存しました（XHR ${event.detail.status}・フォーム確定済み）。`;
    } else {
      message.textContent = `保存要求に失敗しました: ${event.detail?.error || `HTTP ${event.detail?.status || 0}`}`;
    }
  });
  try {
    const storedQuizTrace = JSON.parse(sessionStorage.getItem(QUIZ_TRACE_SESSION_KEY) || "[]");
    quizTrace.push(...array(storedQuizTrace).slice(-QUIZ_TRACE_LIMIT).map(normalizeTrace));
  } catch {
    // 破損した旧ログは読み込まない。
  }
  injectPageHook();

  window.addEventListener("studylog-bridge:schedule-request", async (event) => {
    const startDate = readScheduleStartDate(event.detail?.url);
    if (!startDate) return;
    const snapshot = prepareSnapshotForCurrentYear(await readSnapshot());
    snapshot.timetableWeekStart = { startDate, observedAt: new Date().toISOString() };
    if (pageKind() === "top") {
      snapshot.timetableSlots = readNormalizedTimetable(startDate);
    }
    await saveSnapshot(snapshot);
  });

  window.addEventListener("studylog-bridge:location-change", () => syncPageMode(true));

  let observerTimer;
  let lastContextLocation = "";
  let lastQuizMode;

  function notifyPageMode(quiz) {
    const result = chrome.runtime.sendMessage({ type: "studylog-bridge:page-mode", quiz });
    result?.catch?.(() => {});
  }

  function syncPageMode(forceRender = false) {
    const quiz = isQuizScreen();
    const returnedFromQuiz = lastQuizMode === true && quiz === false;
    if (quiz !== lastQuizMode) {
      notifyPageMode(quiz);
      lastQuizMode = quiz;
    }
    if (quiz) {
      document.getElementById(ROOT_ID)?.remove();
      if (isQuizDebugMode()) installQuizInspector();
      else document.getElementById(QUIZ_INSPECTOR_ROOT_ID)?.remove();
      lastContextLocation = location.href;
      return;
    }

    clearTimeout(quizAutoSaveTimer);
    quizAutoSaveQueued = false;
    document.getElementById(QUIZ_INSPECTOR_ROOT_ID)?.remove();
    const root = document.getElementById(ROOT_ID);
    if (!root) installUi();
    else if (forceRender || lastContextLocation !== location.href) renderCompanion(root);
    if (returnedFromQuiz) refreshStatusImmediatelyAndLater();
    lastContextLocation = location.href;
  }

  const ATTENDANCE_WATCH_STATE_KEY = "studylogAttendanceWatchStateV1";
  const ATTENDANCE_PROBE_LOG_LIMIT = 60;

  function attendanceWatchSettings(preferences) {
    const stored = preferences?.attendanceWatch || {};
    return {
      enabled: Boolean(stored.enabled),
      mode: stored.mode === "screen" ? "screen" : "entry",
      channels: {
        desktop: stored.channels?.desktop !== false,
        sound: stored.channels?.sound !== false,
        slack: Boolean(stored.channels?.slack),
        discord: Boolean(stored.channels?.discord)
      },
      slackWebhookUrl: String(stored.slackWebhookUrl || stored.slack?.webhookUrl || ""),
      discordWebhookUrl: String(stored.discordWebhookUrl || stored.discord?.webhookUrl || ""),
      snoozedUntil: Number(stored.snoozedUntil || 0)
    };
  }

  async function readAttendanceWatchState() {
    const stored = await chrome.storage.local.get(ATTENDANCE_WATCH_STATE_KEY);
    const state = stored[ATTENDANCE_WATCH_STATE_KEY] || {};
    return { blocks: state.blocks || {}, probes: array(state.probes) };
  }

  async function saveAttendanceWatchState(state) {
    await chrome.storage.local.set({
      [ATTENDANCE_WATCH_STATE_KEY]: {
        blocks: state.blocks,
        probes: array(state.probes).slice(-ATTENDANCE_PROBE_LOG_LIMIT)
      }
    });
  }

  // 検知の調整に使う記録。コード値・氏名・画面本文は残さず、判定結果と署名が変わったかどうかだけを保存する。
  function recordAttendanceProbe(state, entry) {
    state.probes = [...array(state.probes), { at: new Date().toISOString(), ...entry }].slice(-ATTENDANCE_PROBE_LOG_LIMIT);
  }

  const ATTENDANCE_ENTRY_TIMEOUT_MS = 16000;

  function requestAttendanceEntryState(classId) {
    return new Promise((resolve) => {
      const requestId = `entry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const listener = (event) => {
        if (event.detail?.requestId !== requestId) return;
        window.clearTimeout(timer);
        window.removeEventListener("studylog-bridge:attendance-entry-result", listener);
        resolve(event.detail);
      };
      const timer = window.setTimeout(() => {
        window.removeEventListener("studylog-bridge:attendance-entry-result", listener);
        resolve({ ok: false, error: "応答がありませんでした。" });
      }, ATTENDANCE_ENTRY_TIMEOUT_MS);
      window.addEventListener("studylog-bridge:attendance-entry-result", listener);
      window.dispatchEvent(new CustomEvent("studylog-bridge:attendance-entry-request", { detail: { requestId, classId } }));
    });
  }

  async function probeAttendance(classId, mode) {
    if (mode !== "screen") {
      const reply = await requestAttendanceEntryState(classId);
      if (!reply?.ok) throw new Error(reply?.error || "受付状態を確認できませんでした。");
      return { signature: null, entry: null, isAccepted: reply.isAccepted, screenState: StudylogAttendanceWatchRules.classifyEntry(reply) };
    }
    const html = await fetchText(`/lms/class/${encodeURIComponent(classId)}/`);
    const entry = StudylogAttendanceWatchRules.entryFrom(new DOMParser().parseFromString(html, "text/html"));
    const signature = StudylogAttendanceWatchRules.signature(entry);
    const target = StudylogAttendanceWatchRules.entryUrl(entry, location.origin);
    if (!target) return { signature, entry, screenState: "no-url" };
    return { signature, entry, screenState: StudylogAttendanceWatchRules.classifyScreen(await fetchText(target)) };
  }

  function viewingCourse(classId) {
    return document.visibilityState === "visible"
      && pageKind() === "class"
      && String(readClassContext().classId || "") === String(classId);
  }

  let attendanceWatchTimer;
  let attendanceWatchRunning = false;

  function scheduleAttendanceWatch(delayMs) {
    clearTimeout(attendanceWatchTimer);
    // 下限は暴走防止のためだけに置く。実際の間隔は plan() の判定が決める。
    attendanceWatchTimer = window.setTimeout(runAttendanceWatch, Math.max(Number(delayMs) || 60 * 1000, 5 * 1000));
  }

  async function announceAttendanceOpen(block, snapshot, settings, state) {
    const decision = StudylogAttendanceWatchRules.notification({
      blockState: state.blocks[block.key],
      viewingClass: viewingCourse(block.classId),
      channels: settings.channels,
      snoozedUntil: settings.snoozedUntil
    });
    if (!decision.notify) return;
    state.blocks[block.key] = { ...state.blocks[block.key], notifiedAt: new Date().toISOString() };
    try {
      await chrome.runtime.sendMessage({
        type: "studylog-bridge:attendance-open",
        channels: [...decision.channels],
        quiet: decision.quiet,
        courseName: courseName(snapshot, block.classId),
        periodLabel: `${block.periods.join("・")}限`,
        url: `${location.origin}/lms/class/${encodeURIComponent(block.classId)}/`,
        slackWebhookUrl: settings.slackWebhookUrl,
        discordWebhookUrl: settings.discordWebhookUrl
      });
    } catch {
      // バックグラウンドへ届かない場合でも、検知そのものは記録済みとして扱う。
    }
  }

  // 本番と同じ経路を、受付中という判定だけ差し替えて一度だけ走らせる。
  // 見張りの記録には検知も通知済みも書かないので、この後に本物の受付が来ても取り逃がさない。
  async function rehearseAttendanceOpen(classId) {
    const target = String(classId || "");
    if (!target) throw new Error("科目を特定できませんでした。");
    const [snapshot, preferences, state] = await Promise.all([readSnapshot(), readPreferences(), readAttendanceWatchState()]);
    const settings = attendanceWatchSettings(preferences);
    // 受付状態の問い合わせは本物を使う。ここで失敗するなら本番でも失敗する。
    const probe = await probeAttendance(target, settings.mode);
    const today = StudylogAttendanceWatchRules.isoDay(new Date());
    const scheduled = StudylogAttendanceWatchRules.blocks(array(snapshot.timetableSlots), PERIOD_TIMES, today)
      .find((item) => String(item.classId) === target);
    const block = scheduled || { key: `rehearsal:${today}:${target}`, classId: target, periods: [] };
    const viewing = viewingCourse(target);
    const decision = StudylogAttendanceWatchRules.notification({
      blockState: {},
      viewingClass: viewing,
      channels: settings.channels,
      snoozedUntil: settings.snoozedUntil
    });
    if (decision.notify) {
      await chrome.runtime.sendMessage({
        type: "studylog-bridge:attendance-open",
        channels: [...decision.channels],
        quiet: decision.quiet,
        // 本物の受付と見分けがつくようにしておく。
        courseName: `【予行演習】${courseName(snapshot, target)}`,
        periodLabel: block.periods.length ? `${block.periods.join("・")}限` : "予行演習",
        url: `${location.origin}/lms/class/${encodeURIComponent(target)}/`,
        slackWebhookUrl: settings.slackWebhookUrl,
        discordWebhookUrl: settings.discordWebhookUrl
      });
    }
    recordAttendanceProbe(state, {
      classId: target,
      blockKey: block.key,
      mode: settings.mode,
      screenState: probe.screenState,
      outcome: "rehearsal"
    });
    await saveAttendanceWatchState(state);
    return {
      screenState: probe.screenState,
      isAccepted: probe.isAccepted ?? null,
      notify: decision.notify,
      reason: decision.reason,
      channels: [...decision.channels],
      viewingClass: viewing,
      courseName: courseName(snapshot, target),
      scheduledToday: Boolean(scheduled)
    };
  }

  async function runAttendanceWatch() {
    if (attendanceWatchRunning || isQuizScreen() || location.hostname !== "portal.iwasaki.ac.jp") return;
    attendanceWatchRunning = true;
    try {
      const [snapshot, preferences, state] = await Promise.all([readSnapshot(), readPreferences(), readAttendanceWatchState()]);
      const settings = attendanceWatchSettings(preferences);
      const beforePrune = Object.keys(state.blocks).length;
      state.blocks = StudylogAttendanceWatchRules.prune(state.blocks, StudylogAttendanceWatchRules.isoDay(new Date()));
      const plan = StudylogAttendanceWatchRules.plan({
        slots: array(snapshot.timetableSlots),
        periodTimes: PERIOD_TIMES,
        state: state.blocks,
        enabled: settings.enabled,
        snoozedUntil: settings.snoozedUntil
      });
      if (!plan.watching) {
        if (beforePrune !== Object.keys(state.blocks).length) await saveAttendanceWatchState(state);
        scheduleAttendanceWatch(["no-lesson", "disabled", "snoozed"].includes(plan.reason) ? 10 * 60 * 1000 : 60 * 1000);
        return;
      }

      // 複数タブを開いていても、確認するのは常に1タブだけにする。
      const lease = await acquireAutomaticCollectionLease();
      if (!lease.granted) {
        scheduleAttendanceWatch(30 * 1000);
        return;
      }

      const block = plan.block;
      let result;
      try {
        result = await probeAttendance(block.classId, settings.mode);
        state.blocks[block.key] = StudylogAttendanceWatchRules.afterCheck(state.blocks[block.key], { ok: true });
      } catch (error) {
        state.blocks[block.key] = StudylogAttendanceWatchRules.afterCheck(state.blocks[block.key], { ok: false });
        recordAttendanceProbe(state, { classId: block.classId, blockKey: block.key, outcome: "error", detail: String(error?.message || error).slice(0, 120) });
        await saveAttendanceWatchState(state);
        scheduleAttendanceWatch(plan.nextDelayMs);
        return;
      } finally {
        releaseAutomaticCollectionLease(lease.leaseId);
      }

      const open = result.screenState === "open";
      recordAttendanceProbe(state, {
        classId: block.classId,
        blockKey: block.key,
        mode: settings.mode,
        screenState: result.screenState,
        outcome: open ? "open" : "quiet"
      });
      if (result.screenState === "done") state.blocks[block.key] = { ...state.blocks[block.key], completedAt: new Date().toISOString() };
      if (open) {
        state.blocks[block.key] = { ...state.blocks[block.key], detectedAt: new Date().toISOString() };
        await announceAttendanceOpen(block, snapshot, settings, state);
      }
      await saveAttendanceWatchState(state);
      scheduleAttendanceWatch(plan.nextDelayMs);
    } catch {
      scheduleAttendanceWatch(5 * 60 * 1000);
    } finally {
      attendanceWatchRunning = false;
    }
  }

  const ATTENDANCE_HANDLER_TIMEOUT_MS = 2000;

  function handlerNames(onclick) {
    return [...new Set([...String(onclick || "").matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)].map((match) => match[1]))].slice(0, 5);
  }

  // ページ側にある関数の中身を読む。呼び出しはせず、通信先を知るためだけに使う。
  function readPageHandlerSources(names) {
    if (!names.length) return Promise.resolve({});
    return new Promise((resolve) => {
      const requestId = `inspect-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const listener = (event) => {
        if (event.detail?.requestId !== requestId) return;
        window.clearTimeout(timer);
        window.removeEventListener("studylog-bridge:inspect-globals-result", listener);
        resolve(event.detail?.sources || {});
      };
      const timer = window.setTimeout(() => {
        window.removeEventListener("studylog-bridge:inspect-globals-result", listener);
        resolve({});
      }, ATTENDANCE_HANDLER_TIMEOUT_MS);
      window.addEventListener("studylog-bridge:inspect-globals-result", listener);
      window.dispatchEvent(new CustomEvent("studylog-bridge:inspect-globals-request", { detail: { requestId, names } }));
    });
  }

  function attendanceDocumentFacts(doc, url) {
    return {
      url,
      title: (doc?.title || "").slice(0, 120),
      loginScreen: Boolean(doc?.querySelector('input[type="password"]')) || /login|signin/i.test(String(url || "")),
      entry: StudylogAttendanceWatchRules.entryFrom(doc)
    };
  }

  // 表示中の画面と、取得したHTMLの両方を見る。片方だけに出る場合は描画のしかたが違う。
  async function inspectAttendance(classId) {
    const rules = StudylogAttendanceWatchRules;
    const target = String(classId || readClassContext().classId || "");
    if (!target) throw new Error("科目を特定できませんでした。");
    const onThisPage = pageKind() === "class" && String(readClassContext().classId || "") === target;
    const live = onThisPage ? attendanceDocumentFacts(document, location.href) : null;

    const response = await fetch(`/lms/class/${encodeURIComponent(target)}/`, { credentials: "include" });
    if (!response.ok) throw new Error(`科目トップを取得できませんでした (HTTP ${response.status})`);
    const fetched = attendanceDocumentFacts(new DOMParser().parseFromString(await response.text(), "text/html"), response.url);

    const entry = live?.entry || fetched.entry;
    const result = {
      classId: target,
      live,
      fetched,
      signature: rules.signature(entry),
      entryUrl: rules.entryUrl(entry, location.origin),
      handlers: {},
      entryCheck: null,
      screen: null
    };
    if (entry?.onclick && onThisPage) result.handlers = await readPageHandlerSources(handlerNames(entry.onclick));
    const reply = await requestAttendanceEntryState(target);
    result.entryCheck = reply?.ok
      ? { ok: true, isAccepted: reply.isAccepted, state: StudylogAttendanceWatchRules.classifyEntry(reply) }
      : { ok: false, error: reply?.error || "確認できませんでした。" };
    if (!result.entryUrl) return result;

    const screenResponse = await fetch(result.entryUrl, { credentials: "include" });
    if (!screenResponse.ok) throw new Error(`出席確認の画面を取得できませんでした (HTTP ${screenResponse.status})`);
    const screenHtml = await screenResponse.text();
    const screenDoc = new DOMParser().parseFromString(screenHtml, "text/html");
    screenDoc.body?.querySelectorAll("script, style, nav, header").forEach((element) => element.remove());
    result.screen = {
      url: screenResponse.url,
      title: (screenDoc.title || "").slice(0, 120),
      state: rules.classifyScreen(screenHtml),
      loginScreen: Boolean(screenDoc.querySelector('input[type="password"]')),
      excerpt: (screenDoc.body?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 400)
    };
    return result;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const run = message?.type === "studylog-bridge:attendance-probe" ? inspectAttendance
      : message?.type === "studylog-bridge:attendance-rehearse" ? rehearseAttendanceOpen
      : null;
    if (!run) return;
    run(message.classId).then(
      (result) => sendResponse({ ok: true, result }),
      (error) => sendResponse({ ok: false, error: String(error?.message || error).slice(0, 200) })
    );
    return true;
  });

  function observeCurrentPage() {
    const observer = new MutationObserver((mutations) => {
      const outsideCompanion = mutations.some((mutation) => !mutation.target.closest?.(`#${ROOT_ID}, #${QUIZ_INSPECTOR_ROOT_ID}`));
      if (!outsideCompanion) return;
      if (isQuizScreen()) {
        syncPageMode(false);
        return;
      }
      clearTimeout(observerTimer);
      observerTimer = setTimeout(async () => {
        syncPageMode(true);
        if (isQuizScreen()) return;
        const snapshot = prepareSnapshotForCurrentYear(await readSnapshot());
        mergeCurrentPage(snapshot);
        if (snapshot.collectedAt) {
          await saveSnapshot(snapshot);
          await renderCompanion(document.getElementById(ROOT_ID));
        }
      }, 300);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["directory_id", "href", "class"] });
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "studylog-bridge:toggle") return;
    if (isQuizScreen()) {
      if (isQuizDebugMode()) document.querySelector("#studylog-quiz-inspector-toggle")?.click();
      return;
    }
    document.querySelector("#studylog-bridge-toggle")?.click();
  });

  document.addEventListener("click", async (event) => {
    if (isQuizScreen()) return;
    const manual = event.target.closest?.("[data-inline-manual]");
    if (manual) {
      event.preventDefault();
      event.stopPropagation();
      await updateTaskDisposition(manual.dataset.inlineManual, "manual");
      return;
    }
    const notRequired = event.target.closest?.("[data-inline-not-required]");
    if (notRequired) {
      event.preventDefault();
      event.stopPropagation();
      await updateTaskDisposition(notRequired.dataset.inlineNotRequired, "not-required");
    }
  });

  document.addEventListener("change", (event) => {
    if (isQuizScreen() || !event.target.matches?.("#select-year, [name='year']")) return;
    queueStatusRefresh(1000);
  });

  document.addEventListener("click", (event) => {
    if (!isQuizScreen()) return;
    const control = controlMetadata(event.target);
    if (control) recordQuizTrace({ phase: "signal", transport: "ui", signal: "click", control });
  }, true);

  document.addEventListener("change", (event) => {
    if (!isQuizScreen() || event.target.closest?.(`#${QUIZ_INSPECTOR_ROOT_ID}`)) return;
    const target = event.target;
    const field = [target.tagName?.toLowerCase(), target.id ? `#${target.id}` : "", target.name ? `[name=${target.name}]` : "", target.type ? `[type=${target.type}]` : ""].join("");
    recordQuizTrace({ phase: "signal", transport: "ui", signal: "change", control: field });
    if (isQuizAnswerControl(target)) scheduleQuizAutoSave(250);
  }, true);

  document.addEventListener("input", (event) => {
    if (!isQuizScreen() || event.target.closest?.(`#${QUIZ_INSPECTOR_ROOT_ID}`) || !isQuizAnswerControl(event.target)) return;
    const type = String(event.target.getAttribute("type") || "").toLowerCase();
    if (!["radio", "checkbox", "select-one", "select-multiple"].includes(type)) {
      // 記述中は送らず、カーソルを置いたままの場合だけ長時間の無操作後に保険保存する。
      scheduleQuizAutoSave(QUIZ_TEXT_IDLE_SAVE_DELAY_MS);
    }
  }, true);

  document.addEventListener("click", (event) => {
    const root = document.getElementById(ROOT_ID);
    const panel = root?.querySelector("#studylog-bridge-panel");
    if (panel?.dataset.open === "true" && !event.composedPath().includes(root)) {
      panel.dataset.open = "false";
      root.querySelector("#studylog-bridge-toggle").setAttribute("aria-expanded", "false");
    }
  });

  const initialize = () => {
    syncPageMode(true);
    observeCurrentPage();
    resumePendingStatusRefresh();
    window.setTimeout(() => {
      captureCurrentPageAutomatically().catch(() => null).finally(runAutomaticCollection);
    }, 500);
    window.setInterval(() => runAutomaticCollection(), AUTO_COLLECT_INTERVAL_MS);
    scheduleAttendanceWatch(5 * 1000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      runAutomaticCollection();
      runAttendanceWatch();
    });
    window.addEventListener("popstate", () => syncPageMode(true));
    window.addEventListener("hashchange", () => syncPageMode(true));
    window.setInterval(() => syncPageMode(false), 750);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})();
