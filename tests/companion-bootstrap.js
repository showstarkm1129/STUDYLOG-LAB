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
  if (location.pathname === "/lms/") {
    document.querySelector("#portal-fixture").insertAdjacentHTML("beforeend", `
      <table id="div-top-timetable">
        <thead><tr><th>時限</th><th>7/28</th><th>7/29</th><th>7/30</th></tr></thead>
        <tbody>
          <tr><th>1限</th><td class="top-timetable-table-td"><a href="/lms/class/10184/">オブジェクト指向設計</a> 教室 : 902A</td><td class="top-timetable-table-td"><a href="/lms/class/10067/">Webアプリ基礎S</a> 教室 : 603</td><td class="top-timetable-table-td"><a href="/lms/class/10171/">LinuxⅠ</a> 教室 : 601</td></tr>
          <tr><th>4限</th><td></td><td class="top-timetable-table-td"><a href="/lms/class/10019/">簿記入門a</a> 教室 : 603</td><td class="top-timetable-table-td"><a href="/lms/class/10175/153362/">データベース</a> 教室 : 601</td></tr>
        </tbody>
      </table>`);
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
