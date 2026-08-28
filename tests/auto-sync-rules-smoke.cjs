const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const context = { Date };
context.globalThis = context;
vm.runInNewContext(fs.readFileSync("auto-sync-rules.js", "utf8"), context);
const rules = context.StudylogAutoSyncRules;
const now = new Date("2026-07-30T12:00:00+09:00").valueOf();

assert.equal(rules.currentAcademicYear(now), 2026);
assert.equal(rules.currentAcademicYear(new Date("2026-02-01T12:00:00+09:00").valueOf()), 2025);

const currentFresh = rules.plan({
  now,
  academicYear: 2026,
  pendingCount: 3,
  classIds: ["1", "2"],
  yearState: {
    reportStatusCollectedAt: new Date(now - 10 * 60 * 1000).toISOString(),
    subjectStatusCollectedAt: new Date(now - 60 * 60 * 1000).toISOString(),
    directoriesByClass: { "1": new Date(now - 60 * 60 * 1000).toISOString() }
  }
});
assert.equal(currentFresh.reportsDue, false);
assert.equal(currentFresh.subjectsDue, false);
assert.equal(currentFresh.directoryClassId, "2", "only one stale course should be selected");

const watchedPast = rules.plan({
  now,
  academicYear: 2025,
  pendingCount: 1,
  classIds: [],
  yearState: { reportStatusCollectedAt: new Date(now - 25 * 60 * 60 * 1000).toISOString() }
});
assert.equal(watchedPast.reportsDue, true, "past years with unfinished work should be checked daily");
assert.equal(watchedPast.subjectsDue, true);

const dormantPast = rules.plan({
  now,
  academicYear: 2025,
  pendingCount: 0,
  classIds: [],
  yearState: {
    reportStatusCollectedAt: new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString(),
    subjectStatusCollectedAt: new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString()
  }
});
assert.equal(dormantPast.reportsDue, false, "completed past years should stay dormant for thirty days");
assert.equal(rules.plan({
  now,
  academicYear: 2025,
  pendingCount: 0,
  classIds: [],
  yearState: { reportStatusCollectedAt: new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString() },
  forceReports: true
}).reportsDue, true);

console.log("auto sync rules smoke test: ok");
