(() => {
  "use strict";

  const STORAGE_KEY = "stalogBridgeSnapshotV1";
  const ROOT_ID = "stalog-bridge-root";
  const CLASS_PATH = /\/lms\/class\/(?:grade\/)?(?<classId>\d+)(?:\/(?<directoryId>\d+))?/;

  const text = (element) => (element?.textContent || "").replace(/\s+/g, " ").trim();
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
      const continuation = !route.classId && /^〃(?:\s|$)/.test(rawText);
      const inherited = continuation ? lastCourseByColumn.get(columnIndex) : undefined;
      const course = route.classId ? { classId: route.classId, courseName: text(link) } : inherited;
      if (!course?.classId) return;
      if (route.classId) lastCourseByColumn.set(columnIndex, course);
      const dateLabel = headerLabels.find((label) => dateFromLabel(label)) || dateButtons[columnIndex - 1];
      const date = dateLabel ? dateFromLabel(dateLabel) : timetableDates[orderedColumns.indexOf(columnIndex)];
      const period = rowLabels.map(periodFromLabel).find(Boolean) || periodFromLabel(rawText);
      const room = rawText.match(/教室\s*[:：]\s*([0-9]{2,4}[A-Za-z]?)/)?.[1];
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

  function describe(snapshot) {
    if (!snapshot?.collectedAt) return "まだ収集していません。\n「取得して保存」を押すと、履修状況と課題／テスト状況を読み取り専用で取得します。";
    return [
      `最終取得: ${new Date(snapshot.collectedAt).toLocaleString("ja-JP")}`,
      `科目: ${snapshot.courses?.length || 0}件`,
      `課題・テスト: ${snapshot.reports?.length || 0}件`,
      `表示中に記録した回: ${snapshot.directories?.length || 0}件`,
      `日付を取得した回: ${snapshot.directories?.filter((item) => item.lessonDate).length || 0}件`,
      `全${snapshot.collectedClassCount || 0}科目・講座の回一覧を確認: ${snapshot.lessonListCollectedAt ? "済み" : "未実行"}`,
      `科目ページ項目: ${snapshot.directoryItems?.length || 0}件`,
      `正規化した時間割: ${snapshot.timetableSlots?.length || 0}件`,
      "認証情報・Cookieは保存も出力もしません。"
    ].join("\n");
  }

  function installUi() {
    if (document.getElementById(ROOT_ID)) return;
    const root = document.createElement("div");
    root.id = ROOT_ID;
    root.innerHTML = `
      <div id="stalog-bridge-panel" aria-live="polite">
        <h2>Stalog Bridge</h2>
        <p>ログイン済みセッションで必要な学習状況だけを読み取り、端末内に保存します。</p>
        <div class="stalog-bridge-actions">
          <button class="stalog-bridge-primary" type="button" data-action="collect">取得して保存</button>
          <button type="button" data-action="export">JSONを書き出す</button>
          <button type="button" data-action="dashboard">Labを開く</button>
        </div>
        <p id="stalog-bridge-status"></p>
      </div>
      <button id="stalog-bridge-toggle" type="button">スタログ収集</button>`;
    document.documentElement.append(root);
    const panel = root.querySelector("#stalog-bridge-panel");
    const status = root.querySelector("#stalog-bridge-status");
    const render = async () => { status.textContent = describe(await readSnapshot()); };
    root.querySelector("#stalog-bridge-toggle").addEventListener("click", async () => {
      panel.dataset.open = panel.dataset.open === "true" ? "false" : "true";
      await render();
    });
    root.querySelector('[data-action="collect"]').addEventListener("click", async (event) => {
      event.currentTarget.disabled = true;
      status.textContent = "取得中…";
      try { status.textContent = describe(await collect()); }
      catch (error) { status.textContent = `取得できませんでした: ${error.message}`; }
      finally { event.currentTarget.disabled = false; }
    });
    root.querySelector('[data-action="export"]').addEventListener("click", async () => {
      const snapshot = await readSnapshot();
      if (!snapshot.collectedAt) { status.textContent = "先に「取得して保存」を実行してください。"; return; }
      exportSnapshot(snapshot);
      status.textContent = "JSONを書き出しました。共有前に内容を確認してください。";
    });
    root.querySelector('[data-action="dashboard"]').addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "stalog-bridge:open-dashboard" });
    });
  }

  function injectPageHook() {
    if (document.querySelector("script[data-stalog-bridge-hook]")) return;
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

  let observerTimer;
  function observeCurrentPage() {
    const observer = new MutationObserver(() => {
      clearTimeout(observerTimer);
      observerTimer = setTimeout(async () => {
        const snapshot = await readSnapshot();
        mergeCurrentPage(snapshot);
        if (snapshot.collectedAt) await saveSnapshot(snapshot);
      }, 300);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["directory_id", "href", "class"] });
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "stalog-bridge:toggle") document.querySelector("#stalog-bridge-toggle")?.click();
  });

  injectPageHook();
  const initialize = () => {
    installUi();
    observeCurrentPage();
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})();
