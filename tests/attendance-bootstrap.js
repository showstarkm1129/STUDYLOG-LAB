(async () => {
  // 監視窓は時計に依存するため、1限の最中に固定した時計で読み込む。
  const RealDate = Date;
  const fixed = new RealDate();
  fixed.setHours(9, 10, 0, 0);
  const fixedValue = fixed.valueOf();
  class FixedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(fixedValue);
      else super(...args);
    }
    static now() { return fixedValue; }
  }
  window.Date = FixedDate;

  const pad = (value) => String(value).padStart(2, "0");
  const today = `${fixed.getFullYear()}-${pad(fixed.getMonth() + 1)}-${pad(fixed.getDate())}`;
  const state = {
    studylogBridgeSnapshotV1: {
      schemaVersion: 1,
      academicYear: 2026,
      collectedAt: new RealDate().toISOString(),
      courses: [{ classId: "10175", name: "データベース", academicYear: 2026, totalLessons: 30, attended: 10, absent: 1, publicAbsent: 0 }],
      reports: [],
      directories: [],
      directoryItems: [],
      visibleTimetable: [],
      timetableSlots: [{ date: today, period: 1, classId: "10175", room: "601" }]
    },
    studylogDashboardPreferencesV1: {
      manualCompleted: [],
      attendanceWatch: {
        enabled: new URLSearchParams(location.search).get("watch") !== "off",
        mode: new URLSearchParams(location.search).get("watchMode") === "screen" ? "screen" : "entry",
        channels: { desktop: true, sound: true, slack: false },
        slackWebhookUrl: "",
        snoozedUntil: 0
      }
    }
  };

  // 実機と同じく、ボタンが表示中の画面にだけあり、押すとページ側の関数を呼ぶ場合を再現する。
  if (new URLSearchParams(location.search).get("handler") === "1") {
    document.querySelector("#attendance-entry")?.remove();
    document.querySelector(".page-head").insertAdjacentHTML(
      "beforeend",
      '<button id="checkEntryBtn" class="btn btn-sm btn-info" onclick="checkAttendEntry(10175);">出席確認</button>'
    );
    window.checkAttendEntry = function (classId) {
      return openAttendanceDialog("/lms/?action=glexa_ajax_attend_entry_check&class_id=" + classId);
    };
    window.openAttendanceDialog = function (url) { return url; };
  }

  window.glexa = {
    entryCalls: [],
    ajax(options) {
      window.glexa.entryCalls.push(options);
      fetch("/lms/entry-state", { method: "POST", body: JSON.stringify(options.params) })
        .then((response) => response.json())
        .then((data) => options.onSuccess({ data }))
        .catch(() => options.onError?.());
    }
  };

  const messageListeners = [];
  window.chrome = {
    storage: {
      local: {
        async get(key) {
          if (Array.isArray(key)) return Object.fromEntries(key.map((item) => [item, state[item]]));
          return { [key]: state[key] };
        },
        async set(values) { Object.assign(state, values); }
      }
    },
    runtime: {
      getURL(path) { return new URL(`/${path}`, location.origin).href; },
      sendMessage(message) {
        if (message?.type === "studylog-bridge:attendance-open") {
          const notices = JSON.parse(document.body.dataset.attendanceNotices || "[]");
          notices.push({ courseName: message.courseName, periodLabel: message.periodLabel, channels: message.channels, url: message.url, quiet: message.quiet });
          document.body.dataset.attendanceNotices = JSON.stringify(notices);
        }
        return Promise.resolve();
      },
      onMessage: {
        addListener(listener) { messageListeners.push(listener); }
      }
    }
  };
  // 拡張機能から届くメッセージを、試験側から差し込めるようにする。
  window.studylogSendMessage = (message) => new Promise((resolve) => {
    for (const listener of messageListeners) {
      if (listener(message, { id: "test" }, resolve) === true) return;
    }
    resolve(null);
  });
  const seededBaseline = new URLSearchParams(location.search).get("baseline");
  if (seededBaseline) {
    state.studylogAttendanceWatchStateV1 = { blocks: {}, baselines: { "10175": { signature: seededBaseline, at: new RealDate().toISOString(), source: "browsing" } }, probes: [] };
  }
  window.studylogTestState = state;

  const loadScript = (src) => new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = src;
    script.addEventListener("load", resolve, { once: true });
    document.head.append(script);
  });
  await loadScript("/attendance-rules.js");
  await loadScript("/attendance-watch-rules.js");
  await loadScript("/digest-rules.js");
  await loadScript("/task-rules.js");
  await loadScript("/auto-sync-rules.js");
  await loadScript("/content.js");
})();
