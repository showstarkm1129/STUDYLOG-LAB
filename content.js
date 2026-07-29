(() => {
  "use strict";

  const STORAGE_KEY = "stalogBridgeSnapshotV1";
  const PREFS_KEY = "stalogDashboardPreferencesV1";
  const ROOT_ID = "stalog-bridge-root";
  const CLASS_PATH = /\/lms\/class\/(?:grade\/)?(?<classId>\d+)(?:\/(?<directoryId>\d+))?/;
  const ATTENDANCE_THRESHOLD = 0.75;
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

  function readAcademicYear() {
    const candidates = [
      document.querySelector("#select-year")?.value,
      text(document.querySelector("#select-year option:checked")),
      document.querySelector("[name='year']")?.value,
      document.querySelector("[data-academic-year]")?.getAttribute("data-academic-year")
    ];
    const found = candidates.map((value) => String(value || "").match(/(20\d{2})/)).find(Boolean);
    return found ? Number(found[1]) : new Date().getFullYear();
  }

  function dateFromLessonText(value, academicYear) {
    const full = value.match(/(20\d{2})\s*[年\/.-]\s*(0?[1-9]|1[0-2])\s*[月\/.-]\s*(0?[1-9]|[12]\d|3[01])(?:日)?/);
    const short = value.match(/(?:^|[^0-9])(\d{1,2})\s*[月\/.]\s*(\d{1,2})(?:日)?/);
    const match = full || short;
    if (!match) return undefined;
    const month = Number(match[full ? 2 : 1]);
    const day = Number(match[full ? 3 : 2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
    const year = full ? Number(match[1]) : academicYear + (month < 4 ? 1 : 0);
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

  function readDirectories() {
    const context = readClassContext();
    if (!context.classId) return [];
    return parseDirectoriesFromDocument(document, context.classId, readAcademicYear(), "classPageDom");
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
      // 連続時限は「2 〃」のように時限番号の後へ省略記号が付く。
      const continuation = !route.classId && /^(?:[1-6]\s*)?〃(?:\s|$)/.test(rawText);
      const inherited = continuation ? lastCourseByColumn.get(columnIndex) : undefined;
      const course = route.classId ? { classId: route.classId, courseName: text(link), room: parsedRoom } : inherited;
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
        courseName: text(link),
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

  function mergeCurrentPage(snapshot) {
    snapshot.directories ||= [];
    snapshot.directoryItems ||= [];
    snapshot.visibleTimetable ||= [];
    snapshot.timetableSlots ||= [];
    const kind = pageKind();
    if (kind === "class") {
      snapshot.directories = mergeBy(snapshot.directories, readDirectories(), (item) => `${item.classId}:${item.directoryId}`);
      snapshot.directoryItems = uniqueBy([...snapshot.directoryItems, ...readCurrentDirectoryItems(snapshot.reports)], (item) => `${item.classId}:${item.directoryId}:${item.title}:${item.dueText || ""}:${item.href || ""}`);
    }
    if (kind === "top") {
      snapshot.visibleTimetable = readVisibleTimetable();
      snapshot.timetableSlots = readNormalizedTimetable(snapshot.timetableWeekStart?.startDate);
    }
  }

  async function collect() {
    const [subjectHtml, reportHtml, snapshot] = await Promise.all([
      fetchText("/portal/lmsinc/mySubjectStatus.php"),
      fetchText("/portal/lmsinc/myReportStatus.php"),
      readSnapshot()
    ]);
    snapshot.schemaVersion = 1;
    snapshot.collectedAt = new Date().toISOString();
    snapshot.sourceOrigin = location.origin;
    snapshot.courses = parseSubjectStatus(subjectHtml);
    snapshot.reports = parseReportStatus(reportHtml);
    // 旧版は教材の説明本文まで保存していたため、安全な V2 形式へ置換する。
    snapshot.directoryItems = (snapshot.directoryItems || []).filter((item) => item.source !== "classPageDom");
    mergeCurrentPage(snapshot);
    snapshot.academicYear = readAcademicYear();
    const classIds = [...new Set([
      ...snapshot.courses.map((course) => course.classId),
      ...snapshot.reports.map((report) => report.classId)
    ])];
    const directories = await fetchAllCourseDirectories(classIds, snapshot.academicYear);
    snapshot.directories = mergeBy(snapshot.directories, directories, (item) => `${item.classId}:${item.directoryId}`);
    snapshot.lessonListCollectedAt = new Date().toISOString();
    snapshot.collectedClassCount = classIds.length;
    await saveSnapshot(snapshot);
    return snapshot;
  }

  function exportSnapshot(snapshot) {
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `stalog-bridge-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function readPreferences() {
    const result = await chrome.storage.local.get(PREFS_KEY);
    return { manualCompleted: [], ...(result[PREFS_KEY] || {}) };
  }

  async function savePreferences(preferences) {
    await chrome.storage.local.set({ [PREFS_KEY]: preferences });
  }

  function reportKey(report) {
    return [report.classId, report.directoryId, report.kind, normalize(report.title), report.href]
      .map((value) => String(value || ""))
      .join("::");
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

  function attendanceRate(course) {
    const attended = Number(course?.attended || 0);
    const absent = Number(course?.absent || 0);
    const publicAbsent = Number(course?.publicAbsent || 0);
    const observed = attended + absent + publicAbsent;
    return observed ? (attended + publicAbsent) / observed : 0;
  }

  function absenceMargin(course) {
    const total = Number(course?.totalLessons || 0);
    return total ? Math.floor(total * (1 - ATTENDANCE_THRESHOLD) + 1e-8) - Number(course.absent || 0) : null;
  }

  function courseEndDate(course, snapshot) {
    const matches = [...String(course?.period || "").normalize("NFKC").matchAll(/(?:(20\d{2})\s*[\/年.\-]\s*)?(\d{1,2})\s*[\/月.\-]\s*(\d{1,2})/g)];
    const last = matches.at(-1);
    if (last) {
      const month = Number(last[2]);
      const day = Number(last[3]);
      const academicYear = Number(snapshot.academicYear || new Date().getFullYear());
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

  function courseMap(snapshot) {
    return new Map(array(snapshot.courses).map((course) => [String(course.classId), course]));
  }

  function courseName(snapshot, classId) {
    return courseMap(snapshot).get(String(classId))?.name || `科目 ${classId || "不明"}`;
  }

  function portalPendingReports(snapshot, filters = {}) {
    return array(snapshot.reports).filter((report) => {
      if (!isPortalPending(report)) return false;
      if (filters.classId && String(report.classId) !== String(filters.classId)) return false;
      if (filters.directoryId && String(report.directoryId) !== String(filters.directoryId)) return false;
      return true;
    });
  }

  function pendingReports(snapshot, preferences, filters = {}) {
    return portalPendingReports(snapshot, filters).filter((report) => !isManualComplete(report, preferences));
  }

  function compactLabel(scene, snapshot, preferences) {
    if (!snapshot.collectedAt) return "スタログ収集";
    const context = readClassContext();
    const course = courseMap(snapshot).get(String(context.classId));
    if ((scene === "class" || scene === "directory") && course) {
      const margin = absenceMargin(course);
      return `${course.name} · ${margin === null ? "出席確認" : `欠席余裕 ${margin}回`}`;
    }
    if (scene === "mypage") return `未整理 ${pendingReports(snapshot, preferences).length}件`;
    const next = nextDifferentCourse(snapshot, new Date(), { todayOnly: scene === "top" });
    if (next) return `次: ${next.courseName || courseName(snapshot, next.classId)} ${PERIOD_TIMES[Number(next.period)].start}`;
    return "Stalog Dashboard";
  }

  function taskRows(reports, snapshot, preferences, { limit = 3, showChecked = true } = {}) {
    if (!reports.length) return `<p class="stalog-context-empty">該当する未整理項目はありません。</p>`;
    const manualOrder = new Map(array(preferences.manualCompleted).map((key, index) => [key, index]));
    const unchecked = reports.filter((report) => !isManualComplete(report, preferences));
    const checked = (showChecked ? reports : [])
      .filter((report) => isManualComplete(report, preferences))
      .sort((a, b) => (manualOrder.get(reportKey(b)) ?? -1) - (manualOrder.get(reportKey(a)) ?? -1));
    const visible = [...unchecked.slice(0, limit), ...checked.slice(0, 2)];
    return `<div class="stalog-context-list">${visible.map((report) => {
      const href = String(report.href || "").startsWith("/") ? report.href : "";
      const completed = isManualComplete(report, preferences);
      const label = completed ? "チェックを外して未整理へ戻す" : "チェックして完了扱いにする";
      return `<div class="stalog-context-task" data-manual-complete="${completed}"><button class="stalog-context-check" type="button" data-context-manual="${escapeHtml(reportKey(report))}" data-checked="${completed}" aria-pressed="${completed}" aria-label="${label}" title="${label}">✓</button><div><strong>${escapeHtml(report.title || "名称なし")}</strong><span>${escapeHtml(courseName(snapshot, report.classId))} · ${escapeHtml(report.status || "状態なし")}${completed ? " · 手動で完了" : ""}</span></div>${href ? `<a href="${escapeHtml(href)}">開く</a>` : ""}</div>`;
    }).join("")}<div class="stalog-context-list-summary">未完了 ${unchecked.length}件${showChecked ? ` · チェック済み ${checked.length}件` : ""}</div></div>`;
  }

  function nextCourseBlock(snapshot, { todayOnly = false } = {}) {
    const next = nextDifferentCourse(snapshot, new Date(), { todayOnly });
    if (!next) return `<div class="stalog-context-feature"><span>次の科目</span><strong>${todayOnly ? "今日の授業は終了" : "判定できません"}</strong><small>${todayOnly ? "次の授業日は表示しません" : "次の授業日を含む時間割を収集してください"}</small></div>`;
    const time = PERIOD_TIMES[Number(next.period)];
    return `<div class="stalog-context-feature stalog-context-next"><span>次の科目</span><strong>${escapeHtml(next.courseName || courseName(snapshot, next.classId))}</strong><small>${escapeHtml(next.period)}限 ${escapeHtml(time.start)} · ${escapeHtml(next.room ? `${next.room}教室` : "教室未取得")}</small></div>`;
  }

  function progressBlock(snapshot, preferences, classIds = null) {
    const reports = array(snapshot.reports).filter((report) => !classIds || classIds.has(String(report.classId)));
    const done = reports.filter((report) => isPortalDone(report) || isManualComplete(report, preferences)).length;
    const rate = reports.length ? Math.round(done / reports.length * 100) : 0;
    const pending = reports.filter((report) => isPortalPending(report) && !isManualComplete(report, preferences)).length;
    return `<div class="stalog-context-feature"><span>${classIds ? "今日の科目の整理率" : "課題の整理率"}</span><strong>${rate}%</strong><small>${done}/${reports.length}件 · 未完了${pending}件</small></div>`;
  }

  function courseBlock(course, snapshot) {
    if (!course) return `<p class="stalog-context-empty">この科目の収集データがありません。</p>`;
    const margin = absenceMargin(course);
    const rate = Math.round(attendanceRate(course) * 100);
    const archived = isArchived(course, snapshot);
    return `<div class="stalog-context-metrics"><div><span>出席扱い率</span><strong>${rate}%</strong></div><div><span>欠席余裕</span><strong>${margin ?? "—"}回</strong></div><div><span>状態</span><strong>${archived ? "終了" : "実施中"}</strong></div></div>`;
  }

  function sceneContent(scene, snapshot, preferences) {
    const context = readClassContext();
    const course = courseMap(snapshot).get(String(context.classId));
    const allPending = portalPendingReports(snapshot);
    const coursePending = portalPendingReports(snapshot, { classId: context.classId });
    const directoryPending = portalPendingReports(snapshot, { classId: context.classId, directoryId: context.directoryId });
    const otherCoursePending = coursePending.filter((report) => String(report.directoryId || "") !== String(context.directoryId || ""));
    const today = todayCourseBlocks(snapshot);
    const todayClassIds = new Set(today.map((slot) => String(slot.classId)));
    const todayPending = allPending.filter((report) => todayClassIds.has(String(report.classId)));
    if (!snapshot.collectedAt) return `<p class="stalog-context-empty">まだ収集していません。「取得して保存」を押してください。</p>`;
    if (scene === "top") return `${nextCourseBlock(snapshot, { todayOnly: true })}${progressBlock(snapshot, preferences, todayClassIds)}<h3>今日の授業</h3><div class="stalog-context-list">${today.slice(0, 4).map((slot) => `<div class="stalog-context-line"><strong>${escapeHtml(slot.period)}限 ${escapeHtml(slot.courseName || courseName(snapshot, slot.classId))}</strong><span>${escapeHtml(slot.room || "教室未取得")}</span></div>`).join("") || `<p class="stalog-context-empty">今日の時間割はありません。</p>`}</div><h3>次に確認する候補</h3>${taskRows(todayPending, snapshot, preferences, { showChecked: false })}`;
    if (scene === "schedule") return `${nextCourseBlock(snapshot)}<h3>今日の授業</h3><div class="stalog-context-list">${today.map((slot) => `<div class="stalog-context-line"><strong>${escapeHtml(slot.period)}限 ${escapeHtml(slot.courseName || courseName(snapshot, slot.classId))}</strong><span>${escapeHtml(PERIOD_TIMES[Number(slot.period)]?.start || "")} · ${escapeHtml(slot.room || "教室未取得")}</span></div>`).join("") || `<p class="stalog-context-empty">今日の時間割はありません。</p>`}</div>`;
    if (scene === "mypage") return `${progressBlock(snapshot, preferences)}<h3>スタログ上の未完了</h3>${taskRows(allPending, snapshot, preferences, { limit: 5 })}`;
    if (scene === "class") return `${courseBlock(course, snapshot)}<h3>この科目の未整理</h3>${taskRows(coursePending, snapshot, preferences)}<button class="stalog-context-wide" type="button" data-action="dashboard" data-view="courses">科目カルテを開く</button>`;
    if (scene === "directory") return `${courseBlock(course, snapshot)}<h3>この回の未整理</h3>${taskRows(directoryPending, snapshot, preferences)}<h3>同じ科目のほかの未整理</h3>${taskRows(otherCoursePending, snapshot, preferences)}<button class="stalog-context-wide" type="button" data-action="dashboard" data-view="courses">科目カルテを開く</button>`;
    return `${nextCourseBlock(snapshot)}${progressBlock(snapshot, preferences)}`;
  }

  function sceneTitle(scene) {
    return ({ top: "今日のブリーフ", schedule: "時間割", mypage: "課題状況", class: "科目の状況", directory: "この授業回", other: "学習状況" })[scene] || "学習状況";
  }

  function dashboardView(scene) {
    if (scene === "mypage") return "tasks";
    if (scene === "class" || scene === "directory") return "courses";
    return "home";
  }

  async function renderCompanion(root) {
    if (!root || isQuizScreen()) return;
    const [snapshot, preferences] = await Promise.all([readSnapshot(), readPreferences()]);
    const scene = pageScene();
    root.querySelector("#stalog-bridge-toggle").innerHTML = `<span class="stalog-context-dot">S</span><span>${escapeHtml(compactLabel(scene, snapshot, preferences))}</span>`;
    root.querySelector("#stalog-context-body").innerHTML = sceneContent(scene, snapshot, preferences);
    root.querySelector("#stalog-context-title").textContent = sceneTitle(scene);
    root.querySelector('[data-action="dashboard"][data-footer]').dataset.view = dashboardView(scene);
    const updated = snapshot.collectedAt ? new Date(snapshot.collectedAt).toLocaleString("ja-JP") : "未取得";
    root.querySelector("#stalog-bridge-status").textContent = `最終取得: ${updated}`;
  }

  function installUi() {
    if (isQuizScreen() || document.getElementById(ROOT_ID)) return;
    const root = document.createElement("div");
    root.id = ROOT_ID;
    root.innerHTML = `
      <div id="stalog-bridge-panel" aria-live="polite">
        <div class="stalog-context-head"><div><span>STALOG</span><h2 id="stalog-context-title">学習状況</h2></div><button type="button" data-action="close" aria-label="閉じる">×</button></div>
        <div id="stalog-context-body"></div>
        <div class="stalog-bridge-actions">
          <button class="stalog-bridge-primary" type="button" data-action="collect">取得して保存</button>
          <button type="button" data-action="dashboard" data-footer>ダッシュボード</button>
          <button type="button" data-action="export">JSON</button>
        </div>
        <p id="stalog-bridge-status"></p>
      </div>
      <button id="stalog-bridge-toggle" type="button"><span class="stalog-context-dot">S</span><span>読み込み中…</span></button>`;
    document.documentElement.append(root);
    root.addEventListener("click", async (event) => {
      const action = event.target.closest("[data-action]")?.dataset.action;
      const panel = root.querySelector("#stalog-bridge-panel");
      if (event.target.closest("#stalog-bridge-toggle")) {
        panel.dataset.open = panel.dataset.open === "true" ? "false" : "true";
        if (panel.dataset.open === "true") await renderCompanion(root);
        return;
      }
      if (action === "close") { panel.dataset.open = "false"; return; }
      if (action === "collect") {
        const button = event.target.closest("button");
        button.disabled = true;
        root.querySelector("#stalog-bridge-status").textContent = "取得中…";
        try { await collect(); await renderCompanion(root); }
        catch (error) { root.querySelector("#stalog-bridge-status").textContent = `取得できませんでした: ${error.message}`; }
        finally { button.disabled = false; }
        return;
      }
      if (action === "export") {
        const snapshot = await readSnapshot();
        if (!snapshot.collectedAt) { root.querySelector("#stalog-bridge-status").textContent = "先に取得してください。"; return; }
        exportSnapshot(snapshot);
        root.querySelector("#stalog-bridge-status").textContent = "JSONを書き出しました。";
        return;
      }
      if (action === "dashboard") {
        chrome.runtime.sendMessage({ type: "stalog-bridge:open-dashboard", view: event.target.closest("[data-view]")?.dataset.view || dashboardView(pageScene()) });
        return;
      }
      const manual = event.target.closest("[data-context-manual]");
      if (manual) {
        const preferences = await readPreferences();
        const completed = new Set(preferences.manualCompleted);
        if (completed.has(manual.dataset.contextManual)) completed.delete(manual.dataset.contextManual);
        else completed.add(manual.dataset.contextManual);
        preferences.manualCompleted = [...completed];
        await savePreferences(preferences);
        await renderCompanion(root);
      }
    });
    renderCompanion(root);
  }

  let pageHookInjected = false;
  function injectPageHook() {
    if (pageHookInjected) return;
    pageHookInjected = true;
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("page-hook.js");
    script.dataset.stalogBridgeHook = "true";
    (document.documentElement || document.head).append(script);
    script.remove();
  }

  window.addEventListener("stalog-bridge:schedule-request", async (event) => {
    const startDate = readScheduleStartDate(event.detail?.url);
    if (!startDate) return;
    const snapshot = await readSnapshot();
    snapshot.timetableWeekStart = { startDate, observedAt: new Date().toISOString() };
    if (pageKind() === "top") {
      snapshot.timetableSlots = readNormalizedTimetable(startDate);
    }
    await saveSnapshot(snapshot);
  });

  window.addEventListener("stalog-bridge:location-change", () => syncPageMode(true));

  let observerTimer;
  let lastContextLocation = "";
  let lastQuizMode;

  function notifyPageMode(quiz) {
    const result = chrome.runtime.sendMessage({ type: "stalog-bridge:page-mode", quiz });
    result?.catch?.(() => {});
  }

  function syncPageMode(forceRender = false) {
    const quiz = isQuizScreen();
    if (quiz !== lastQuizMode) {
      notifyPageMode(quiz);
      lastQuizMode = quiz;
    }
    if (quiz) {
      document.getElementById(ROOT_ID)?.remove();
      lastContextLocation = location.href;
      return;
    }

    injectPageHook();
    const root = document.getElementById(ROOT_ID);
    if (!root) installUi();
    else if (forceRender || lastContextLocation !== location.href) renderCompanion(root);
    lastContextLocation = location.href;
  }

  function observeCurrentPage() {
    const observer = new MutationObserver((mutations) => {
      const outsideCompanion = mutations.some((mutation) => !mutation.target.closest?.(`#${ROOT_ID}`));
      if (!outsideCompanion) return;
      if (isQuizScreen()) {
        syncPageMode(false);
        return;
      }
      clearTimeout(observerTimer);
      observerTimer = setTimeout(async () => {
        syncPageMode(true);
        if (isQuizScreen()) return;
        const snapshot = await readSnapshot();
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
    if (message?.type === "stalog-bridge:toggle" && !isQuizScreen()) document.querySelector("#stalog-bridge-toggle")?.click();
  });

  document.addEventListener("click", (event) => {
    const root = document.getElementById(ROOT_ID);
    const panel = root?.querySelector("#stalog-bridge-panel");
    if (panel?.dataset.open === "true" && !event.composedPath().includes(root)) panel.dataset.open = "false";
  });

  const initialize = () => {
    syncPageMode(true);
    observeCurrentPage();
    window.addEventListener("popstate", () => syncPageMode(true));
    window.addEventListener("hashchange", () => syncPageMode(true));
    window.setInterval(() => syncPageMode(false), 750);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})();
