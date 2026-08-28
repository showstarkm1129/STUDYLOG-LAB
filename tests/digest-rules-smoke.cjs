const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const context = {};
vm.createContext(context);
vm.runInContext(fs.readFileSync("digest-rules.js", "utf8"), context);
const rules = context.StudylogDigestRules;
const pair = (status) => [
  { classId: "1", directoryId: "10", title: "（D）ダイジェスト_01", status },
  { classId: "1", directoryId: "10", title: "(H)ダイジェスト_01補講", status: "未完了" }
];

for (const [status, expected] of [
  ["未完了", "deferred"],
  ["完了 (59/100点)", "required"],
  ["完了 (60/100点)", "auto-complete"],
  ["完了 (6/10点)", "auto-complete"]
]) {
  const reports = pair(status);
  assert.equal(rules.resolution(reports[1], reports).state, expected, status);
}

const unrelated = pair("完了 (100/100点)");
unrelated[1].directoryId = "11";
assert.equal(rules.resolution(unrelated[1], unrelated).state, "normal", "different lessons must not pair");
console.log("digest rule smoke test: ok");
