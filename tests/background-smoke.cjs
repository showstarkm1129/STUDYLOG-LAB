const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const listeners = {};
const createdTabs = [];
const disabledTabs = [];
const enabledTabs = [];
const localState = {};
const badges = [];
const notifications = [];
const offscreenDocuments = [];
const sentMessages = [];
const slackPosts = [];
const discordPosts = [];
const granted = { permissions: new Set(), origins: new Set() };
const chrome = {
  action: {
    onClicked: { addListener(listener) { listeners.clicked = listener; } },
    disable(id) { disabledTabs.push(id); return Promise.resolve(); },
    enable(id) { enabledTabs.push(id); return Promise.resolve(); },
    setBadgeText(options) { badges.push(options.text); return Promise.resolve(); },
    setBadgeBackgroundColor() { return Promise.resolve(); },
    setTitle() { return Promise.resolve(); }
  },
  permissions: {
    async contains(query) {
      return (query.permissions || []).every((item) => granted.permissions.has(item))
        && (query.origins || []).every((item) => granted.origins.has(item));
    }
  },
  notifications: {
    async create(id, options) { notifications.push({ id, options }); return id; },
    async clear() { return true; },
    onClicked: { addListener(listener) { listeners.notificationClicked = listener; } },
    onClosed: { addListener() {} }
  },
  offscreen: {
    async createDocument(options) { offscreenDocuments.push(options); }
  },
  runtime: {
    getURL(path) { return `chrome-extension://test/${path}`; },
    async getContexts() { return offscreenDocuments.map(() => ({ contextType: "OFFSCREEN_DOCUMENT" })); },
    async sendMessage(message) { sentMessages.push(message); },
    onMessage: { addListener(listener) { listeners.message = listener; } }
  },
  tabs: { create(options) { createdTabs.push(options); return Promise.resolve(); } },
  storage: {
    local: {
      async get(key) { return { [key]: localState[key] }; },
      async set(values) { Object.assign(localState, values); }
    }
  }
};

async function fetchStub(url, options) {
  const post = { url, body: JSON.parse(options.body) };
  (url.startsWith("https://discord.com/") ? discordPosts : slackPosts).push(post);
  return { ok: true };
}

vm.runInNewContext(fs.readFileSync("background.js", "utf8"), { chrome, URL, fetch: fetchStub, crypto: { randomUUID: () => "test-uuid" } });

listeners.clicked({ url: "https://portal.iwasaki.ac.jp/lms/content/1/quiz/2/" });
listeners.clicked({ url: "https://portal.iwasaki.ac.jp/lms/content/1/?module=quiz" });
assert.equal(createdTabs.length, 0, "quiz tabs must not open the dashboard");

listeners.clicked({ url: "https://portal.iwasaki.ac.jp/lms/" });
listeners.message({ type: "studylog-bridge:open-dashboard", view: "courses" }, { tab: { id: 8 } });
assert.equal(createdTabs.length, 2);
assert.match(createdTabs[1].url, /dashboard\.html\?view=courses$/);

listeners.message({ type: "studylog-bridge:page-mode", quiz: true }, { tab: { id: 8 } });
listeners.message({ type: "studylog-bridge:page-mode", quiz: false }, { tab: { id: 8 } });
assert.deepEqual(disabledTabs, [8]);
assert.deepEqual(enabledTabs, [8]);

const sendMessage = (message) => new Promise((resolve) => listeners.message(message, { tab: { id: 8 } }, resolve));
(async () => {
  const first = await sendMessage({ type: "studylog-bridge:auto-collection-acquire", leaseMs: 300000 });
  const second = await sendMessage({ type: "studylog-bridge:auto-collection-acquire", leaseMs: 300000 });
  assert.equal(first.granted, true);
  assert.equal(second.granted, false, "a second tab must not acquire the active automatic collection lease");
  assert.equal((await sendMessage({ type: "studylog-bridge:auto-collection-release", leaseId: first.leaseId })).released, true);
  assert.equal((await sendMessage({ type: "studylog-bridge:auto-collection-acquire", leaseMs: 300000 })).granted, true);

  const notice = {
    type: "studylog-bridge:attendance-open",
    courseName: "データベース",
    periodLabel: "4限",
    url: "https://portal.iwasaki.ac.jp/lms/class/10175/",
    slackWebhookUrl: "https://hooks.slack.com/services/T000/B000/xxx",
    discordWebhookUrl: "https://discord.com/api/webhooks/1234567890/abcdefghijklmnopqrstuvwxyz012345"
  };

  const badgeOnly = await sendMessage({ ...notice, channels: ["badge"], quiet: true });
  assert.deepEqual({ ...badgeOnly }, { badge: true, desktop: false, sound: false, slack: false, discord: false });
  assert.deepEqual([...badges], ["", "出席"], "opening the dashboard clears the badge before the notice sets it");
  assert.equal(notifications.length, 0, "a quiet notice must not open a desktop notification");

  const withoutPermission = await sendMessage({ ...notice, channels: ["badge", "desktop", "slack"] });
  assert.equal(withoutPermission.desktop, false, "desktop notifications need the optional permission");
  assert.equal(withoutPermission.slack, false, "Slack needs the optional host permission");
  assert.equal(slackPosts.length, 0);

  granted.permissions.add("notifications");
  granted.origins.add("https://hooks.slack.com/*");
  const full = await sendMessage({ ...notice, channels: ["badge", "desktop", "sound", "slack"] });
  assert.deepEqual({ ...full }, { badge: true, desktop: true, sound: true, slack: true, discord: false });
  assert.equal(notifications.length, 1);
  assert.match(notifications[0].options.message, /データベース/);
  assert.equal(notifications[0].options.silent, false, "the sound channel keeps the notification audible");
  assert.equal(offscreenDocuments.length, 1, "one offscreen document is enough for repeated alerts");
  assert.deepEqual({ ...sentMessages.at(-1) }, { type: "studylog-bridge:play-alert", target: "offscreen" });
  assert.equal(slackPosts.length, 1);
  assert.equal(slackPosts[0].url, notice.slackWebhookUrl);
  assert.match(slackPosts[0].body.text, /データベース（4限）/);
  assert.match(slackPosts[0].body.text, /\/lms\/class\/10175\//);
  assert.ok(!/starkm|20251250128|廣川/.test(slackPosts[0].body.text), "no personal identifiers leave the device");
  assert.ok(localState.studylogAttendanceLastNoticeV1.at, "the last notice is recorded locally");

  const otherWebhook = await sendMessage({ ...notice, channels: ["slack"], slackWebhookUrl: "https://example.com/hook" });
  assert.equal(otherWebhook.slack, false, "only Slack webhook URLs are accepted");
  assert.equal(slackPosts.length, 1);

  // Discord も同じ扱い。権限が無いうちは送らず、宛先の形も確かめる。
  const discordWithoutPermission = await sendMessage({ ...notice, channels: ["discord"] });
  assert.equal(discordWithoutPermission.discord, false, "Discord needs the optional host permission");
  assert.equal(discordPosts.length, 0);

  granted.origins.add("https://discord.com/*");
  const bothWebhooks = await sendMessage({ ...notice, channels: ["slack", "discord"] });
  assert.equal(bothWebhooks.slack, true);
  assert.equal(bothWebhooks.discord, true, "both webhooks receive the same notice");
  assert.equal(discordPosts.length, 1);
  assert.equal(discordPosts[0].url, notice.discordWebhookUrl);
  assert.match(discordPosts[0].body.content, /データベース（4限）/, "Discord takes the text in content, not text");
  assert.deepEqual([...discordPosts[0].body.allowed_mentions.parse], [], "a notice never triggers a mention");
  assert.ok(!/starkm|20251250128|廣川/.test(discordPosts[0].body.content), "no personal identifiers leave the device");

  const otherDiscordWebhook = await sendMessage({ ...notice, channels: ["discord"], discordWebhookUrl: "https://example.com/api/webhooks/1/x" });
  assert.equal(otherDiscordWebhook.discord, false, "only Discord webhook URLs are accepted");
  assert.equal(discordPosts.length, 1);

  const notificationsBefore = notifications.length;
  const badgesBefore = badges.length;
  const tested = await sendMessage({ ...notice, type: "studylog-bridge:attendance-test", channels: ["badge", "desktop", "slack"] });
  assert.deepEqual({ ...tested }, { badge: true, desktop: true, sound: false, slack: true, discord: false });
  assert.equal(notifications.length, notificationsBefore + 1);
  assert.equal(notifications.at(-1).options.title, "通知のテストです");
  assert.match(slackPosts.at(-1).body.text, /テスト/);
  assert.equal(badges.length, badgesBefore, "a test must not leave the attendance badge behind");
  assert.equal(localState.studylogAttendanceLastNoticeV1.courseName, "データベース", "a test does not overwrite the last real notice");

  listeners.notificationClicked(notifications[0].id);
  assert.equal(createdTabs.at(-1).url, notice.url, "clicking the notification opens the course page");

  console.log("background quiz guard, collection lease and attendance notice smoke test: ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
