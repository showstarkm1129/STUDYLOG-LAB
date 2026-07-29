(async () => {
  const snapshot = await fetch("/__fixture").then((response) => response.json());
  const state = {
    stalogBridgeSnapshotV1: snapshot,
    stalogDashboardPreferencesV1: { manualCompleted: [] }
  };
  const route = location.pathname.match(/\/lms\/class\/(?:grade\/)?(?<classId>\d+)(?:\/(?<directoryId>\d+))?/);
  if (route?.groups?.classId) document.querySelector("#input-current-class-id").value = route.groups.classId;
  if (route?.groups?.directoryId) document.querySelector("#div-class-contents").setAttribute("directory_id", route.groups.directoryId);
  if (new URLSearchParams(location.search).get("quizDom") === "1") {
    document.querySelector("#portal-fixture").insertAdjacentHTML("beforeend", '<div id="div-quiz-question">quiz</div>');
  }

  window.chrome = {
    storage: {
      local: {
        async get(key) {
          if (Array.isArray(key)) return Object.fromEntries(key.map((item) => [item, state[item]]));
          return { [key]: state[key] };
        },
        async set(values) {
          Object.assign(state, values);
          document.body.dataset.manualCompleted = String(state.stalogDashboardPreferencesV1?.manualCompleted?.length || 0);
        }
      }
    },
    runtime: {
      getURL(path) { return new URL(`/${path}`, location.origin).href; },
      sendMessage(message) {
        if (message?.type === "stalog-bridge:page-mode") document.body.dataset.pageMode = message.quiz ? "quiz" : "normal";
        if (message?.type === "stalog-bridge:open-dashboard") document.body.dataset.dashboardView = message.view || "home";
        return Promise.resolve();
      },
      onMessage: { addListener() {} }
    }
  };

  const script = document.createElement("script");
  script.src = "/content.js";
  document.head.append(script);
})();
