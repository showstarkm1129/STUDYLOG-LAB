(() => {
  "use strict";

  const REQUIRED_ATTENDANCE_NUMERATOR = 3;
  const REQUIRED_ATTENDANCE_DENOMINATOR = 4;

  function lessonCount(value) {
    const count = Number(value);
    return Number.isFinite(count) && count > 0 ? Math.trunc(count) : 0;
  }

  function requiredAttendance(totalLessons) {
    const total = lessonCount(totalLessons);
    return total ? Math.floor(total * REQUIRED_ATTENDANCE_NUMERATOR / REQUIRED_ATTENDANCE_DENOMINATOR) : 0;
  }

  function maximumAbsences(totalLessons) {
    const total = lessonCount(totalLessons);
    return total ? total - requiredAttendance(total) : 0;
  }

  function minimumAttendanceRate(totalLessons) {
    const total = lessonCount(totalLessons);
    return total ? requiredAttendance(total) / total : 0;
  }

  function absenceMargin(course) {
    const total = lessonCount(course?.totalLessons);
    if (!total) return null;
    return maximumAbsences(total) - Number(course?.absent || 0);
  }

  function meetsRequirement(attendanceCount, totalLessons) {
    const total = lessonCount(totalLessons);
    return total > 0 && Number(attendanceCount) >= requiredAttendance(total);
  }

  globalThis.StudylogAttendanceRules = Object.freeze({
    threshold: REQUIRED_ATTENDANCE_NUMERATOR / REQUIRED_ATTENDANCE_DENOMINATOR,
    requiredAttendance,
    maximumAbsences,
    minimumAttendanceRate,
    absenceMargin,
    meetsRequirement
  });
})();
