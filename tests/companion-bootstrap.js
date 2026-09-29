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
  snapshot.reports.unshift({ classId: "10183", directoryId: "990004", title: "日付表示の確認", status: "未完了", kind: "課題", href: "/lms/class/10183/990004/" });
  if (/\/lms\/class\/10183\/153094\/?$/.test(location.pathname)) {
    snapshot.reports.unshift(
      { classId: "10183", directoryId: "153094", title: "課題27 SSL 提出先", status: "未完了", kind: "課題", href: "/lms/class/10183/153094/" },
      { classId: "10183", directoryId: "153094", title: "課題28 SSL 提出先", status: "未完了", kind: "課題", href: "/lms/class/10183/153094/" }
    );
  }
  snapshot.directories.push({ classId: "10183", directoryId: "990004", title: "第99回", lessonDate: "2026-07-31" });
  const state = {
    studylogBridgeSnapshotV1: snapshot,
    studylogDashboardPreferencesV1: { manualCompleted: [] }
  };
  const route = location.pathname.match(/\/lms\/class\/(?:grade\/)?(?<classId>\d+)(?:\/(?<directoryId>\d+))?/);
  if (route?.groups?.classId) document.querySelector("#input-current-class-id").value = route.groups.classId;
  if (route?.groups?.directoryId) document.querySelector("#div-class-contents").setAttribute("directory_id", route.groups.directoryId);
  if (route?.groups?.directoryId === "153094") {
    document.querySelector("#div-class-contents").innerHTML = `
      <table><tbody>
        <tr><td><a href="/lms/content/10183/report/27/">課題27 SSL 提出先</a></td><td>-</td></tr>
        <tr><td><a href="/lms/content/10183/report/28/">課題28 SSL 提出先</a></td><td>-</td></tr>
      </tbody></table>`;
  }
  if (new URLSearchParams(location.search).get("quizDom") === "1") {
    document.querySelector("#portal-fixture").insertAdjacentHTML("beforeend", '<div id="div-quiz-question">quiz</div>');
  }
  if (location.pathname === "/lms/") {
    document.querySelector("#portal-fixture").insertAdjacentHTML("beforeend", `
      <table id="div-top-timetable">
        <thead><tr><th>時限</th><th>7/28</th><th>7/29</th><th>7/30</th></tr></thead>
        <tbody>
          <tr><th>1限</th><td class="top-timetable-table-td"><div class="div-class-name"><a href="/lms/class/10184/">オブジェクト指向設計</a><div class="text-right"><small>高橋先生</small></div><div class="text-right"><small>教室 :</small> 902A</div></div></td><td class="top-timetable-table-td"><div class="div-class-name"><a href="/lms/class/10067/">Webアプリ基礎S</a><div class="text-right"><small>片寄先生</small></div><div class="text-right"><small>教室 :</small> 603</div></div></td><td class="top-timetable-table-td"><div class="div-class-name"><a href="/lms/class/10171/">LinuxⅠ</a><div class="text-right"><small>大久保先生</small></div><div class="text-right"><small>教室 :</small> 601</div></div></td></tr>
          <tr><th>4限</th><td></td><td class="top-timetable-table-td"><div class="div-class-name"><a href="/lms/class/10019/">簿記入門a</a><div class="text-right"><small>山尾先生</small></div><div class="text-right"><small>教室 :</small> 603</div></div></td><td class="top-timetable-table-td"><div class="div-class-name"><a href="/lms/class/10175/153362/">データベース</a><div class="text-right"><small>中山先生</small></div><div class="text-right"><small>教室 :</small> 601</div></div></td></tr>
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
          document.body.dataset.manualCompleted = String(state.studylogDashboardPreferencesV1?.manualCompleted?.length || 0);
          document.body.dataset.notRequired = String(state.studylogDashboardPreferencesV1?.notRequired?.length || 0);
        }
      }
    },
    runtime: {
      getURL(path) { return new URL(`/${path}`, location.origin).href; },
      sendMessage(message) {
        if (message?.type === "studylog-bridge:page-mode") document.body.dataset.pageMode = message.quiz ? "quiz" : "normal";
        if (message?.type === "studylog-bridge:open-dashboard") document.body.dataset.dashboardView = message.view || "home";
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
  await loadScript("/date-rules.js");
  await loadScript("/attendance-rules.js");
  await loadScript("/attendance-watch-rules.js");
  await loadScript("/digest-rules.js");
  await loadScript("/task-rules.js");
  await loadScript("/auto-sync-rules.js");
  await loadScript("/content.js");
})();
