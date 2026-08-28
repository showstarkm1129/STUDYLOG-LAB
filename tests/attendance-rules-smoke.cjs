const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const context = {};
vm.createContext(context);
vm.runInContext(fs.readFileSync("attendance-rules.js", "utf8"), context);
const rules = context.StudylogAttendanceRules;

assert.equal(rules.threshold, 0.75);
assert.equal(rules.requiredAttendance(30), 22, "30コマの必要出席数は22コマへ切り捨てる");
assert.equal(rules.maximumAbsences(30), 8, "30コマの欠席可能数は8コマへ切り上げる");
assert.equal(rules.minimumAttendanceRate(30), 22 / 30);
assert.equal(rules.absenceMargin({ totalLessons: 30, absent: 1 }), 7);
assert.equal(rules.meetsRequirement(22, 30), true, "22/30でも整数化した基準内");
assert.equal(rules.meetsRequirement(21, 30), false);
assert.equal(rules.requiredAttendance(15), 11);
assert.equal(rules.maximumAbsences(15), 4);
assert.equal(rules.requiredAttendance(32), 24, "割り切れる場合は丸めない");
assert.equal(rules.maximumAbsences(32), 8);
assert.equal(rules.absenceMargin({ totalLessons: 0, absent: 0 }), null);

console.log("attendance rules smoke test: ok");
