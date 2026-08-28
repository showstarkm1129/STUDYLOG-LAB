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

chrome.action.onClicked.addListener((tab) => {
  if (isQuizUrl(tab?.url)) return;
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
  if (message?.type === "studylog-bridge:auto-collection-release") {
    releaseAutoCollectionLease(message.leaseId).then(sendResponse, () => sendResponse({ released: false }));
    return true;
  }
});
