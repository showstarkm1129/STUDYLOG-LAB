async function openDashboard() {
  const url = chrome.runtime.getURL("dashboard.html");
  await chrome.tabs.create({ url });
}

chrome.action.onClicked.addListener(() => {
  openDashboard().catch(() => {});
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "stalog-bridge:open-dashboard") openDashboard().catch(() => {});
});
