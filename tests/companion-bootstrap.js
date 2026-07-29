(async () => {
  const snapshot = await fetch("/__fixture").then((response) => response.json());
  snapshot.reports.push(
    { classId: "10183", directoryId: "990001", title: "(D)テスト用ダイジェスト未実施", status: "未完了", kind: "クイズ", href: "/lms/class/10183/990001/" },
    { classId: "10183", directoryId: "990001", title: "(H)テスト用ダイジェスト未実施補講", status: "未完了", kind: "クイズ", href: "/lms/class/10183/990001/" },
    { classId: "10183", directoryId: "990002", title: "(D)テスト用ダイジェスト59点", status: "完了 (59/100点)", kind: "クイズ", href: "/lms/class/10183/990002/" },
    { classId: "10183", directoryId: "990002", title: "(H)テスト用ダイジェスト59点補講", status: "未完了", kind: "クイズ", href: "/lms/class/10183/990002/" },
    { classId: "10183", directoryId: "990003", title: "(D)テスト用ダイジェスト60点", status: "完了 (60/100点)", kind: "クイズ", href: "/lms/class/10183/990003/" },
    { classId: "10183", directoryId: "990003", title: "(H)テスト用ダイジェスト60点補講", status: "未完了", kind: "クイズ", href: "/lms/class/10183/990003/" }
  );
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

  const loadScript = (src) => new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = src;
    script.addEventListener("load", resolve, { once: true });
    document.head.append(script);
  });
  await loadScript("/digest-rules.js");
  await loadScript("/content.js");
})();
