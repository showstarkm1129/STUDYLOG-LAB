(() => {
  const notifyIfScheduleRequest = (value) => {
    const url = typeof value === "string" ? value : value?.url;
    if (typeof url === "string" && /getScheduleCalendar\.php|glexa_ajax_schedule_view/.test(url)) {
      window.dispatchEvent(new CustomEvent("stalog-bridge:schedule-request", { detail: { url } }));
    }
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    notifyIfScheduleRequest(url);
    return originalOpen.apply(this, arguments);
  };

  const originalFetch = window.fetch;
  window.fetch = function (input, init) {
    notifyIfScheduleRequest(input);
    return originalFetch.call(this, input, init);
  };

  for (const method of ["pushState", "replaceState"]) {
    const original = history[method];
    history[method] = function () {
      const result = original.apply(this, arguments);
      window.dispatchEvent(new CustomEvent("stalog-bridge:location-change"));
      return result;
    };
  }
})();
