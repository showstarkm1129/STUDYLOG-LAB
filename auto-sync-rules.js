(() => {
  "use strict";

  const MINUTE_MS = 60 * 1000;
  const HOUR_MS = 60 * MINUTE_MS;
  const DAY_MS = 24 * HOUR_MS;
  const intervals = Object.freeze({
    currentReports: 30 * MINUTE_MS,
    currentSubjects: 3 * HOUR_MS,
    currentDirectory: DAY_MS,
    watchedPastReports: DAY_MS,
    watchedPastSubjects: 30 * DAY_MS,
    watchedPastDirectory: 7 * DAY_MS,
    dormantPast: 30 * DAY_MS
  });

  const timestamp = (value) => Date.parse(value || "") || 0;
  const due = (value, interval, now) => now - timestamp(value) >= interval;

  function currentAcademicYear(now = Date.now()) {
    const date = new Date(now);
    return date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  }

  function reportInterval(academicYear, pendingCount, currentYear) {
    if (Number(academicYear) >= Number(currentYear)) return intervals.currentReports;
    return pendingCount > 0 ? intervals.watchedPastReports : intervals.dormantPast;
  }

  function subjectInterval(academicYear, currentYear) {
    return Number(academicYear) >= Number(currentYear) ? intervals.currentSubjects : intervals.watchedPastSubjects;
  }

  function directoryInterval(academicYear, pendingCount, currentYear) {
    if (Number(academicYear) >= Number(currentYear)) return intervals.currentDirectory;
    return pendingCount > 0 ? intervals.watchedPastDirectory : intervals.dormantPast;
  }

  function plan({ now = Date.now(), academicYear, pendingCount = 0, classIds = [], yearState = {}, forceReports = false }) {
    const currentYear = currentAcademicYear(now);
    const reportsDue = forceReports || due(yearState.reportStatusCollectedAt, reportInterval(academicYear, pendingCount, currentYear), now);
    const subjectsDue = due(yearState.subjectStatusCollectedAt, subjectInterval(academicYear, currentYear), now);
    const directoryTtl = directoryInterval(academicYear, pendingCount, currentYear);
    const directoryClassId = classIds.find((classId) => due(yearState.directoriesByClass?.[classId], directoryTtl, now));
    return { reportsDue, subjectsDue, directoryClassId, hasWork: reportsDue || subjectsDue || Boolean(directoryClassId) };
  }

  globalThis.StudylogAutoSyncRules = Object.freeze({ intervals, currentAcademicYear, reportInterval, subjectInterval, directoryInterval, plan });
})();
