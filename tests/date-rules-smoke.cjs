const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const context = {};
vm.createContext(context);
vm.runInContext(fs.readFileSync("date-rules.js", "utf8"), context);
const rules = context.StudylogDateRules;
const lesson = (value, academicYear = 2026) => rules.fromText(value, { academicYear, compact: true });

for (const value of ["2026-09-29", "2026/09/29", "2026年9月29日", "２０２６年９月２９日", "第1回 9/29", "第1回_0929_単位認定試験"]) {
  assert.equal(lesson(value), "2026-09-29", value);
}
for (const value of ["3/0/45", "1/1/45", "2026-02-30", "2026-02-300", "2026-13-01", "2026-00-01", "2026-03-00", "NaN-NaN-NaN", "第1回", "2026/02/29"]) {
  assert.equal(lesson(value), undefined, value);
  assert.equal(rules.validIsoDate(value), false, value);
}
assert.equal(lesson("2024-02-29"), "2024-02-29");
assert.equal(lesson("1月8日"), "2027-01-08");
assert.equal(rules.fromText("1/4", { referenceDate: "2026-12-29" }), "2027-01-04");
assert.equal(rules.fromText("12/31", { referenceDate: "2027-01-01" }), "2026-12-31");
assert.equal(rules.addDays("2026-12-31", 1), "2027-01-01");
assert.equal(rules.addDays("2024-02-28", 1), "2024-02-29");
assert.equal(rules.addDays("2026-03-00", 1), undefined);

const snapshot = {
  academicYear: 2026,
  timetableWeekStart: { startDate: "2026-02-30" },
  timetableSlots: [{ date: "2026-03-00", dateLabel: "3/0/45" }, { date: "NaN-NaN-NaN" }, { date: "2026-09-29" }],
  directories: [
    { title: "第1回 2026年9月29日", lessonDate: "2026-09-02", dateSource: "directoryTitle" },
    { title: "第2回", lessonDate: "2026-03-00", dateSource: "getLessonList" },
    { title: "第3回", lessonDate: "2026-09-30", dateSource: "getLessonList" }
  ]
};
assert.equal(rules.sanitizeSnapshot(snapshot), true);
assert.equal(snapshot.timetableSlots[0].date, undefined);
assert.equal(snapshot.timetableSlots[0].dateLabel, undefined);
assert.equal(snapshot.timetableSlots[1].date, undefined);
assert.equal(snapshot.timetableSlots[2].date, "2026-09-29");
assert.equal(snapshot.timetableWeekStart, undefined);
assert.equal(snapshot.directories[0].lessonDate, "2026-09-29");
assert.equal(snapshot.directories[1].lessonDate, undefined);
assert.equal(snapshot.directories[2].lessonDate, "2026-09-30");
assert.equal(rules.sanitizeSnapshot(snapshot), false, "migration is idempotent");
console.log("date rules smoke test: ok");
