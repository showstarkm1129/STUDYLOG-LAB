const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const context = {};
vm.createContext(context);
vm.runInContext(fs.readFileSync("task-rules.js", "utf8"), context);
const rules = context.StudylogTaskRules;

const unnecessary = { classId: "1", directoryId: "10", title: "課題27 SSL 提出先", kind: "課題", status: "未完了", href: "/lms/class/1/10/" };
const similar = { classId: "1", directoryId: "11", title: "課題28 SSL 提出先", kind: "課題", status: "未完了", href: "/lms/class/1/11/" };
const otherCourse = { ...similar, classId: "2" };
const otherKind = { ...similar, kind: "クイズ" };
const preferences = { notRequired: [rules.reportKey(unnecessary)] };

assert.equal(rules.titlePattern(unnecessary.title), rules.titlePattern(similar.title));
assert.equal(rules.similarity(unnecessary, similar), 1);
assert.equal(rules.similarity(unnecessary, otherCourse), 0, "similarity must not leak to another course");
assert.equal(rules.similarity(unnecessary, otherKind), 0, "similarity must not cross task kinds");
assert.equal(rules.notRequiredMatch(similar, [unnecessary, similar], preferences).score, 1);
assert.equal(rules.notRequiredMatch(unnecessary, [unnecessary, similar], preferences), null, "a decided item is a status, not a suggestion");
console.log("task rule smoke test: ok");
