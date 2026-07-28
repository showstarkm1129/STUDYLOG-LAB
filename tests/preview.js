(async () => {
  const response = await fetch("/__fixture");
  const snapshot = await response.json();
  localStorage.setItem("stalogBridgeSnapshotV1", JSON.stringify(snapshot));
  const view = new URLSearchParams(location.search).get("view") || "home";
  location.replace(`/dashboard.html?view=${encodeURIComponent(view)}`);
})();
