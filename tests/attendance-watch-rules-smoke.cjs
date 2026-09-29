const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const context = { Date, Math, URL };
context.globalThis = context;
vm.runInNewContext(fs.readFileSync("attendance-watch-rules.js", "utf8"), context);
const rules = context.StudylogAttendanceWatchRules;

const periodTimes = {
  1: { start: "09:00", end: "09:50" },
  2: { start: "10:00", end: "10:50" },
  3: { start: "11:00", end: "11:50" },
  4: { start: "12:40", end: "13:30" },
  5: { start: "13:40", end: "14:30" },
  6: { start: "14:40", end: "15:30" }
};
const slots = [
  { date: "2026-09-02", period: 1, classId: "101" },
  { date: "2026-09-02", period: 2, classId: "101" },
  { date: "2026-09-02", period: 3, classId: "202" },
  { date: "2026-09-03", period: 1, classId: "303" }
];
const at = (time) => new Date(`2026-09-02T${time.length === 5 ? `${time}:00` : time}+09:00`).valueOf();
const fixedRandom = () => 0.5;

const merged = rules.blocks(slots, periodTimes, "2026-09-02");
assert.equal(merged.length, 2, "consecutive periods of the same course become one window");
assert.deepEqual([...merged[0].periods], [1, 2]);
assert.equal(merged[0].endMinutes, 10 * 60 + 50, "the merged window ends with the last period");
assert.equal(merged[1].classId, "202");
assert.equal(merged[0].key, "2026-09-02:101:1");

assert.equal(rules.plan({ now: at("08:00"), slots, periodTimes, random: fixedRandom }).reason, "outside-window");
assert.equal(rules.plan({ now: at("08:56"), slots, periodTimes, random: fixedRandom }).watching, true, "the window opens five minutes early");
assert.equal(rules.plan({ now: at("11:01"), slots, periodTimes, random: fixedRandom }).block.classId, "202");
assert.equal(rules.plan({ now: at("11:59"), slots, periodTimes, random: fixedRandom }).watching, true, "the window stays open ten minutes past the bell");
assert.equal(rules.plan({ now: at("12:01"), slots, periodTimes, random: fixedRandom }).reason, "outside-window");
assert.equal(rules.plan({ now: at("09:10"), slots, periodTimes, enabled: false }).reason, "disabled");
assert.equal(rules.plan({ now: at("09:10"), slots, periodTimes, snoozedUntil: at("16:00") }).reason, "snoozed");
assert.equal(rules.plan({ now: at("09:10"), slots: [], periodTimes }).reason, "no-lesson");

const key = "2026-09-02:101:1";
assert.equal(rules.plan({ now: at("09:10"), slots, periodTimes, state: { [key]: { detectedAt: "x" } } }).reason, "detected");
assert.equal(rules.plan({ now: at("09:10"), slots, periodTimes, state: { [key]: { requests: 40 } } }).reason, "budget");
assert.equal(rules.plan({ now: at("09:10"), slots, periodTimes, state: { [key]: { failures: 3 } } }).reason, "failed");
assert.equal(rules.plan({ now: at("09:10"), slots, periodTimes, state: { [key]: { backoffUntil: at("09:12") } } }).reason, "backoff");
assert.equal(rules.plan({
  now: at("09:10"),
  slots,
  periodTimes,
  state: { [key]: { lastCheckedAt: new Date(at("09:09:30")).toISOString() } }
}).reason, "interval", "a check within the interval is skipped");

assert.equal(rules.intervalFor(merged[0], 9 * 60 + 10), rules.activeIntervalMs, "the first minutes are watched closely");
assert.equal(rules.intervalFor(merged[0], 10 * 60 + 30), rules.relaxedIntervalMs, "later minutes relax the interval");

const jittered = rules.plan({ now: at("09:10"), slots, periodTimes, random: () => 0 });
assert.ok(jittered.nextDelayMs < rules.activeIntervalMs, "jitter can shorten the delay");
assert.ok(jittered.nextDelayMs > rules.activeIntervalMs * 0.7, "jitter stays close to the interval");

const failedOnce = rules.afterCheck({}, { ok: false, now: at("09:10") });
assert.equal(failedOnce.requests, 1);
assert.equal(failedOnce.failures, 1);
assert.equal(failedOnce.backoffUntil, at("09:10") + rules.failureBackoffMs);
assert.equal(rules.afterCheck(failedOnce, { ok: true, now: at("09:12") }).failures, 0, "a success clears the backoff");

const away = rules.notification({ channels: { desktop: true, sound: true, slack: true, discord: true } });
assert.deepEqual([...away.channels], ["badge", "desktop", "sound", "slack", "discord"]);
assert.deepEqual([...rules.notification({ channels: { discord: true } }).channels], ["badge", "discord"], "each destination is independent");
const viewing = rules.notification({ viewingClass: true, channels: { desktop: true, sound: true, slack: true } });
assert.deepEqual([...viewing.channels], ["badge"], "no sound while the student is already on the course page");
assert.equal(viewing.quiet, true);
assert.equal(rules.notification({ blockState: { notifiedAt: "x" }, channels: { desktop: true } }).notify, false);
assert.equal(rules.notification({ snoozedUntil: Date.now() + 1000, channels: { desktop: true } }).notify, false);
assert.deepEqual([...rules.notification({ channels: {} }).channels], ["badge"], "the badge is always available");

assert.deepEqual(
  Object.keys(rules.prune({ "2026-09-01:1:1": {}, "2026-09-02:101:1": {} }, "2026-09-02")),
  ["2026-09-02:101:1"],
  "yesterday's windows are dropped"
);

const fakeElement = (tagName, attributes = {}, textContent = "") => ({
  tagName,
  textContent,
  id: attributes.id || "",
  getAttribute: (name) => attributes[name] ?? null,
  hasAttribute: (name) => name in attributes
});
const fakeDocument = (elements) => ({ querySelectorAll: () => elements });

const link = fakeElement("A", { href: "/lms/attendance/10175/", class: "btn btn-attendance" }, " 出席確認 ");
const entry = rules.entryFrom(fakeDocument([fakeElement("A", { href: "/lms/" }, "トップ"), link]));
assert.equal(entry.tag, "a");
assert.equal(entry.label, "出席確認", "surrounding whitespace is trimmed away");
assert.equal(entry.href, "/lms/attendance/10175/");
assert.equal(entry.disabled, false);
assert.equal(rules.entryFrom(fakeDocument([fakeElement("A", { href: "/lms/" }, "トップ")])), null);
assert.equal(rules.entryFrom(fakeDocument([])), null);
assert.equal(rules.signature(null), "absent");
assert.notEqual(rules.signature(entry), rules.signature({ ...entry, className: "btn btn-attendance is-open" }));

const origin = "https://portal.iwasaki.ac.jp";
assert.equal(rules.entryUrl(entry, origin), "https://portal.iwasaki.ac.jp/lms/attendance/10175/");
assert.equal(rules.entryUrl({ href: "#" }, origin), null);
assert.equal(rules.entryUrl({ href: "javascript:void(0)" }, origin), null);
assert.equal(rules.entryUrl({ href: "" }, origin), null);
assert.equal(rules.entryUrl({ href: "https://example.com/steal" }, origin), null, "links off the portal are never fetched");

assert.equal(rules.classifyScreen("<p>出席コードを入力してください</p>"), "open");
assert.equal(rules.classifyScreen("<p>出席を受け付けるためボタンを押してください</p>"), "open");
assert.equal(rules.classifyScreen("<p>現在、出席確認の受付を行っていません。</p>"), "closed");
assert.equal(rules.classifyScreen("<p>受付時間外です</p>"), "closed");
assert.equal(rules.classifyScreen("<p>この授業は出席済です</p>"), "done");
assert.equal(rules.classifyScreen("<p>受付していません</p>"), "closed");
assert.equal(rules.classifyScreen("<p>お知らせ</p>"), "unknown", "an unrecognised screen must not be reported as open");
assert.equal(rules.classifyScreen(""), "unknown");
assert.equal(
  rules.classifyScreen("<p>コードを入力してください</p><p>受付は終了しました</p>"),
  "closed",
  "a finished reception wins over a leftover input prompt"
);

// スタログ本体の分岐は is_accepted != '1' なので、その通りに写す。
assert.equal(rules.classifyEntry({ isAccepted: "0" }), "open", "anything but '1' means a reception is waiting");
assert.equal(rules.classifyEntry({ isAccepted: 0 }), "open");
assert.equal(rules.classifyEntry({ isAccepted: "2" }), "open");
assert.equal(rules.classifyEntry({ isAccepted: "1" }), "quiet", "'1' means the reception is already settled");
assert.equal(rules.classifyEntry({ isAccepted: 1 }), "quiet");
assert.equal(rules.classifyEntry({ isAccepted: " 1 " }), "quiet");
assert.equal(
  rules.classifyEntry({ isAccepted: "", hasData: true }),
  "open",
  "the site opens the form when the flag is absent, so a missed alarm is the worse mistake"
);
assert.equal(rules.classifyEntry({ isAccepted: null, hasData: true }), "open");
assert.equal(
  rules.classifyEntry({ hasData: false }),
  "unknown",
  "an answer without a data object is not a reading at all"
);

console.log("attendance watch rules smoke test: ok");
