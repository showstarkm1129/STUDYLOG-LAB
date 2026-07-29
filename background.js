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

chrome.action.onClicked.addListener((tab) => {
  if (isQuizUrl(tab?.url)) return;
  openDashboard().catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === "stalog-bridge:open-dashboard") openDashboard(message.view).catch(() => {});
  if (message?.type === "stalog-bridge:page-mode" && sender.tab?.id) {
    const action = message.quiz ? chrome.action.disable(sender.tab.id) : chrome.action.enable(sender.tab.id);
    action.catch(() => {});
  }
});
