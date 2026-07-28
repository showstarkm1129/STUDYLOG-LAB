(async () => {
  const response = await fetch("/__fixture");
  const snapshot = await response.json();
  localStorage.setItem("stalogBridgeSnapshotV1", JSON.stringify(snapshot));
  const params = new URLSearchParams(location.search);
  const view = params.get("view") || "home";
  const now = params.get("now");
  const destination = new URL("/dashboard.html", location.origin);
  destination.searchParams.set("view", view);
  if (now) destination.searchParams.set("now", now);
  location.replace(destination);
})();
