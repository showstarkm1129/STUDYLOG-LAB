function isQuizUrl(value) {
  try {
    const url = new URL(value);
    return /\/quiz(?:\/|\.php(?:\/|$)|$)/i.test(url.pathname) || /quiz/i.test(url.search);
  }
  catch { return false; }
}

async function openDashboard(view) {
  const url = new URL(chrome.runtime.getURL("dashboard.html"));
  if (["home", "tasks", "attendance", "courses"].includes(view)) url.searchParams.set("view", view);
  await chrome.tabs.create({ url: url.href });
}

const AUTO_COLLECTION_LEASE_KEY = "studylogBridgeAutoCollectionLeaseV1";
let activeAutoCollectionLease;

async function acquireAutoCollectionLease(requestedMs) {
  const now = Date.now();
  const leaseMs = Math.min(Math.max(Number(requestedMs) || 5 * 60 * 1000, 60 * 1000), 10 * 60 * 1000);
  if (activeAutoCollectionLease?.expiresAt > now) return { granted: false };
  const candidate = { leaseId: `${now}-${crypto.randomUUID()}`, expiresAt: now + leaseMs };
  activeAutoCollectionLease = candidate;
  const stored = (await chrome.storage.local.get(AUTO_COLLECTION_LEASE_KEY))[AUTO_COLLECTION_LEASE_KEY];
  if (stored?.expiresAt > now && stored.leaseId !== candidate.leaseId) {
    activeAutoCollectionLease = undefined;
    return { granted: false };
  }
  await chrome.storage.local.set({ [AUTO_COLLECTION_LEASE_KEY]: candidate });
  return { granted: true, leaseId: candidate.leaseId };
}

async function releaseAutoCollectionLease(leaseId) {
  if (!leaseId || activeAutoCollectionLease?.leaseId !== leaseId) return { released: false };
  activeAutoCollectionLease = undefined;
  await chrome.storage.local.set({ [AUTO_COLLECTION_LEASE_KEY]: null });
  return { released: true };
}

const ATTENDANCE_NOTIFICATION_PREFIX = "studylog-attendance-";
const OFFSCREEN_DOCUMENT = "offscreen.html";
const attendanceNotificationUrls = new Map();

async function hasPermission(query) {
  try {
    return await chrome.permissions.contains(query);
  } catch {
    return false;
  }
}

async function showAttendanceBadge() {
  try {
    await chrome.action.setBadgeText({ text: "出席" });
    await chrome.action.setBadgeBackgroundColor({ color: "#d92d20" });
    await chrome.action.setTitle({ title: "出席確認の受付を検知しました" });
  } catch {
    // バッジを出せない環境でも、ほかの通知手段は続ける。
  }
}

async function clearAttendanceBadge() {
  try {
    await chrome.action.setBadgeText({ text: "" });
    await chrome.action.setTitle({ title: "Studylog Dashboard を開く" });
  } catch {
    // 表示を戻せなくても処理は続ける。
  }
}

async function showAttendanceNotification({ courseName, periodLabel, url, silent, test }) {
  if (!chrome.notifications || !(await hasPermission({ permissions: ["notifications"] }))) return false;
  const notificationId = `${ATTENDANCE_NOTIFICATION_PREFIX}${Date.now()}`;
  attendanceNotificationUrls.set(notificationId, url);
  try {
    await chrome.notifications.create(notificationId, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/studylog-128.png"),
      title: test ? "通知のテストです" : "出席確認の受付を検知しました",
      message: test ? "この知らせ方で受付開始をお伝えします。" : `${courseName}（${periodLabel}）\nスタログを開いて出席確認を行ってください。`,
      priority: 2,
      requireInteraction: true,
      silent: Boolean(silent)
    });
    return true;
  } catch {
    attendanceNotificationUrls.delete(notificationId);
    return false;
  }
}

// Service Worker では音を再生できないため、音声再生専用の非表示ページを一時的に開く。
async function playAttendanceSound() {
  if (!chrome.offscreen) return false;
  try {
    const existing = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
    if (!existing.length) {
      await chrome.offscreen.createDocument({
        url: OFFSCREEN_DOCUMENT,
        reasons: ["AUDIO_PLAYBACK"],
        justification: "出席確認の受付を検知したことを音で知らせます。"
      });
    }
    await chrome.runtime.sendMessage({ type: "studylog-bridge:play-alert", target: "offscreen" });
    return true;
  } catch {
    return false;
  }
}

// Webhook で知らせるサービス。宛先の形と本文の作り方だけが違い、送る中身は共通である。
const WEBHOOK_TARGETS = Object.freeze({
  slack: {
    pattern: /^https:\/\/hooks\.slack\.com\//,
    origin: "https://hooks.slack.com/*",
    body: (text) => ({ text })
  },
  discord: {
    pattern: /^https:\/\/discord\.com\/api\/webhooks\//,
    origin: "https://discord.com/*",
    // メンションを解釈させない。本文に @everyone のような字面が入っても鳴らさない。
    body: (text) => ({ content: text, allowed_mentions: { parse: [] } })
  }
});

async function postAttendanceWebhook(service, { webhookUrl, courseName, periodLabel, url, test }) {
  const target = WEBHOOK_TARGETS[service];
  if (!target) return false;
  if (!target.pattern.test(String(webhookUrl || ""))) return false;
  if (!(await hasPermission({ origins: [target.origin] }))) return false;
  const text = test
    ? "Studylog Bridge の通知テストです。この知らせ方で出席確認の受付開始をお伝えします。"
    : `出席確認の受付を検知しました\n${courseName}（${periodLabel}）\n${url}`;
  try {
    // 送るのは科目名・時限・検知時刻とリンクだけで、成績や課題の情報は含めない。
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(target.body(text))
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function announceAttendance(message, { test = false } = {}) {
  const channels = new Set(Array.isArray(message.channels) ? message.channels : []);
  const delivered = { badge: false, desktop: false, sound: false, slack: false, discord: false };
  if (channels.has("badge")) {
    // テストで「出席」バッジを残さない。
    if (!test) await showAttendanceBadge();
    delivered.badge = true;
  }
  if (channels.has("desktop")) {
    delivered.desktop = await showAttendanceNotification({
      courseName: message.courseName,
      periodLabel: message.periodLabel,
      url: message.url,
      silent: !channels.has("sound"),
      test
    });
  }
  if (channels.has("sound")) delivered.sound = await playAttendanceSound();
  const notice = { courseName: message.courseName, periodLabel: message.periodLabel, url: message.url, test };
  if (channels.has("slack")) {
    delivered.slack = await postAttendanceWebhook("slack", { ...notice, webhookUrl: message.slackWebhookUrl });
  }
  if (channels.has("discord")) {
    delivered.discord = await postAttendanceWebhook("discord", { ...notice, webhookUrl: message.discordWebhookUrl });
  }
  if (test) return delivered;
  await chrome.storage.local.set({
    studylogAttendanceLastNoticeV1: { at: new Date().toISOString(), courseName: message.courseName, periodLabel: message.periodLabel, delivered }
  });
  return delivered;
}

if (chrome.notifications) {
  chrome.notifications.onClicked.addListener((notificationId) => {
    const url = attendanceNotificationUrls.get(notificationId);
    if (!url) return;
    attendanceNotificationUrls.delete(notificationId);
    chrome.notifications.clear(notificationId).catch(() => {});
    clearAttendanceBadge().catch(() => {});
    chrome.tabs.create({ url }).catch(() => {});
  });
  chrome.notifications.onClosed.addListener((notificationId) => attendanceNotificationUrls.delete(notificationId));
}

chrome.action.onClicked.addListener((tab) => {
  if (isQuizUrl(tab?.url)) return;
  clearAttendanceBadge().catch(() => {});
  openDashboard().catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "studylog-bridge:open-dashboard") openDashboard(message.view).catch(() => {});
  if (message?.type === "studylog-bridge:page-mode" && sender.tab?.id) {
    const action = message.quiz ? chrome.action.disable(sender.tab.id) : chrome.action.enable(sender.tab.id);
    action.catch(() => {});
  }
  if (message?.type === "studylog-bridge:auto-collection-acquire") {
    acquireAutoCollectionLease(message.leaseMs).then(sendResponse, () => sendResponse({ granted: false }));
    return true;
  }
  if (message?.type === "studylog-bridge:attendance-open") {
    announceAttendance(message).then(sendResponse, () => sendResponse(null));
    return true;
  }
  if (message?.type === "studylog-bridge:attendance-test") {
    announceAttendance(message, { test: true }).then(sendResponse, () => sendResponse(null));
    return true;
  }
  if (message?.type === "studylog-bridge:attendance-clear") {
    clearAttendanceBadge().catch(() => {});
  }
  if (message?.type === "studylog-bridge:auto-collection-release") {
    releaseAutoCollectionLease(message.leaseId).then(sendResponse, () => sendResponse({ released: false }));
    return true;
  }
});
