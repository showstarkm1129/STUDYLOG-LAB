(() => {
  "use strict";

  const pad = (value) => String(value).padStart(2, "0");
  const isoDay = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

  function calendarDate(year, month, day) {
    if (!Number.isInteger(year) || year < 2000 || year > 2099) return undefined;
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
      ? isoDay(date) : undefined;
  }

  function validIsoDate(value) {
    if (typeof value !== "string" || !/^20\d{2}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split("-").map(Number);
    return calendarDate(year, month, day) === value;
  }

  function fromText(value, { academicYear, referenceDate, compact = false } = {}) {
    const source = String(value || "").normalize("NFKC");
    // 数字を最後まで読み、出席数の「3/0/45」などの一部を日付として拾わない。
    const full = source.match(/(?:^|[^\d])(20\d{2})\s*[年/.-]\s*(\d{1,2})\s*[月/.-]\s*(\d{1,2})(?:日)?(?![\d/.-])/);
    if (full) return calendarDate(Number(full[1]), Number(full[2]), Number(full[3]));
    const short = source.match(/(?:^|[^\d/.-])(\d{1,2})\s*[月/.]\s*(\d{1,2})(?:日)?(?![\d/.-])/);
    const packed = compact ? source.match(/(?:^|[_\s(（])(\d{2})(\d{2})(?=$|[_\s)）])/) : null;
    const match = short || packed;
    if (!match) return undefined;
    const month = Number(match[1]);
    const day = Number(match[2]);
    if (validIsoDate(referenceDate)) {
      const reference = new Date(`${referenceDate}T00:00:00`);
      // 年のない時間割見出しは表示週に最も近い年を使う（年末年始を含む）。
      return [reference.getFullYear() - 1, reference.getFullYear(), reference.getFullYear() + 1]
        .map((year) => calendarDate(year, month, day)).filter(Boolean)
        .sort((a, b) => Math.abs(new Date(`${a}T00:00:00`) - reference) - Math.abs(new Date(`${b}T00:00:00`) - reference))[0];
    }
    const year = Number(academicYear);
    return calendarDate(year + (month < 4 ? 1 : 0), month, day);
  }

  function addDays(value, days) {
    if (!validIsoDate(value) || !Number.isInteger(days)) return undefined;
    const date = new Date(`${value}T00:00:00`);
    date.setDate(date.getDate() + days);
    const result = isoDay(date);
    return validIsoDate(result) ? result : undefined;
  }

  function sanitizeSnapshot(snapshot) {
    if (!snapshot) return false;
    let changed = false;
    for (const slot of Array.isArray(snapshot.timetableSlots) ? snapshot.timetableSlots : []) {
      if (!slot || typeof slot !== "object") continue;
      if (slot.date && !validIsoDate(slot.date)) {
        delete slot.date;
        delete slot.dateLabel;
        changed = true;
      }
    }
    for (const directory of Array.isArray(snapshot.directories) ? snapshot.directories : []) {
      if (!directory || typeof directory !== "object") continue;
      const titleDate = fromText(directory.title, { academicYear: Number(directory.academicYear || snapshot.academicYear), compact: true });
      if (directory.dateSource === "directoryTitle" && titleDate && directory.lessonDate !== titleDate) {
        directory.lessonDate = titleDate;
        changed = true;
      } else if (directory.lessonDate && !validIsoDate(directory.lessonDate)) {
        delete directory.lessonDate;
        delete directory.dateSource;
        changed = true;
      }
    }
    if (snapshot.timetableWeekStart && !validIsoDate(snapshot.timetableWeekStart.startDate)) {
      delete snapshot.timetableWeekStart;
      changed = true;
    }
    return changed;
  }

  globalThis.StudylogDateRules = Object.freeze({ calendarDate, validIsoDate, fromText, addDays, sanitizeSnapshot });
})();
