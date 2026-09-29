(() => {
  "use strict";

  const TRAFFIC_EVENT = "studylog-bridge:quiz-traffic";
  const SAVE_REQUEST_EVENT = "studylog-bridge:quiz-save-request";
  const SAVE_RESULT_EVENT = "studylog-bridge:quiz-save-result";
  const LEARNING_WRITE_EVENT = "studylog-bridge:learning-write";
  const HINT_FIELDS = new Set(["action", "back", "timeover", "select_page_number_flg", "page_number", "prev_page_number"]);
  let requestSequence = 0;

  function safeUrl(value) {
    try {
      const url = new URL(typeof value === "string" ? value : value?.url, location.href);
      const queryKeys = [...new Set(url.searchParams.keys())];
      return `${url.origin === location.origin ? "" : url.origin}${url.pathname}${queryKeys.length ? `?${queryKeys.map(encodeURIComponent).join("&")}` : ""}`;
    } catch {
      return "(URLを取得できません)";
    }
  }

  function safeFieldName(value) {
    return String(value || "")
      .replace(/[^\p{L}\p{N}_.:[\]-]/gu, "?")
      .slice(0, 80);
  }

  function bodyFields(body) {
    try {
      if (!body) return [];
      if (body instanceof FormData || body instanceof URLSearchParams) {
        return [...new Set([...body.keys()].map(safeFieldName).filter(Boolean))];
      }
      if (typeof body !== "string") return [];
      const trimmed = body.trim();
      if (!trimmed) return [];
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return Object.keys(parsed).map(safeFieldName).filter(Boolean);
        }
        return [];
      }
      if (trimmed.includes("=")) {
        return [...new Set([...new URLSearchParams(trimmed).keys()].map(safeFieldName).filter(Boolean))];
      }
    } catch {
      // 本文の解析に失敗しても、元の通信には影響させない。
    }
    return [];
  }

  function bodyEntries(body) {
    try {
      if (!body) return [];
      if (body instanceof FormData || body instanceof URLSearchParams) return [...body.entries()];
      if (typeof body !== "string") return [];
      const trimmed = body.trim();
      if (!trimmed) return [];
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        const parsed = JSON.parse(trimmed);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? Object.entries(parsed) : [];
      }
      return trimmed.includes("=") ? [...new URLSearchParams(trimmed).entries()] : [];
    } catch {
      return [];
    }
  }

  function commandHints(body) {
    return Object.fromEntries(bodyEntries(body)
      .filter(([key]) => HINT_FIELDS.has(String(key)))
      .map(([key, value]) => [String(key), String(value ?? "").slice(0, 100)]));
  }

  function callSource() {
    try {
      return String(new Error().stack || "")
        .split("\n")
        .slice(2, 6)
        .map((line) => line.trim().replaceAll(location.origin, "").replace(/\?[^\s):]+/g, "?…"))
        .filter(Boolean)
        .join(" ← ")
        .slice(0, 600);
    } catch {
      return "";
    }
  }

  function emit(detail) {
    window.dispatchEvent(new CustomEvent(TRAFFIC_EVENT, {
      detail: {
        at: new Date().toISOString(),
        elapsedMs: Math.round(performance.now()),
        ...detail
      }
    }));
  }

  function learningWrite(url, body) {
    const safe = safeUrl(url);
    const hints = commandHints(body);
    const action = String(hints.action || "");
    if (/quiz/i.test(`${safe} ${action}`) && /page_view_accept/i.test(action)) return null;
    const haystack = `${safe} ${action}`;
    if (!/report|assignment|quiz|test|exam|submit|finish|complete|提出|終了|完了/i.test(haystack)) return null;
    return { url: safe, action: action.slice(0, 100) };
  }

  function emitLearningWrite(detail) {
    window.dispatchEvent(new CustomEvent(LEARNING_WRITE_EVENT, {
      detail: { at: new Date().toISOString(), ...detail }
    }));
  }

  const notifyIfScheduleRequest = (value) => {
    const url = typeof value === "string" ? value : value?.url;
    if (typeof url === "string" && /getScheduleCalendar\.php|glexa_ajax_schedule_view/.test(url)) {
      window.dispatchEvent(new CustomEvent("studylog-bridge:schedule-request", { detail: { url } }));
    }
  };

  const xhrMetadata = new WeakMap();
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    notifyIfScheduleRequest(url);
    xhrMetadata.set(this, { method: String(method || "GET").toUpperCase(), url: safeUrl(url) });
    return originalOpen.apply(this, arguments);
  };

  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (body) {
    const requestId = `xhr-${++requestSequence}`;
    const metadata = xhrMetadata.get(this) || { method: "GET", url: "(URLを取得できません)" };
    const write = metadata.method === "GET" ? null : learningWrite(metadata.url, body);
    if (write) emitLearningWrite({ phase: "submitted" });
    emit({ phase: "request", transport: "xhr", requestId, ...metadata, fields: bodyFields(body), hints: commandHints(body), source: callSource() });
    this.addEventListener("loadend", () => {
      emit({ phase: "response", transport: "xhr", requestId, ...metadata, status: Number(this.status) || 0 });
      if (write) emitLearningWrite({ phase: "response", status: Number(this.status) || 0 });
    }, { once: true });
    return originalSend.apply(this, arguments);
  };

  const originalFetch = window.fetch;
  window.fetch = function (input, init) {
    notifyIfScheduleRequest(input);
    const requestId = `fetch-${++requestSequence}`;
    const method = String(init?.method || input?.method || "GET").toUpperCase();
    const url = safeUrl(input);
    const fields = bodyFields(init?.body);
    const write = method === "GET" ? null : learningWrite(input, init?.body);
    if (write) emitLearningWrite({ phase: "submitted" });
    emit({ phase: "request", transport: "fetch", requestId, method, url, fields, hints: commandHints(init?.body), source: callSource() });
    let result;
    try {
      result = originalFetch.call(this, input, init);
    } catch (error) {
      emit({ phase: "response", transport: "fetch", requestId, method, url, status: 0, failed: true });
      throw error;
    }
    return Promise.resolve(result).then((response) => {
      emit({ phase: "response", transport: "fetch", requestId, method, url, status: Number(response.status) || 0 });
      if (write) emitLearningWrite({ phase: "response", status: Number(response.status) || 0 });
      return response;
    }, (error) => {
      emit({ phase: "response", transport: "fetch", requestId, method, url, status: 0, failed: true });
      throw error;
    });
  };

  if (navigator.sendBeacon) {
    const originalSendBeacon = navigator.sendBeacon.bind(navigator);
    try {
      navigator.sendBeacon = function (url, data) {
        const requestId = `beacon-${++requestSequence}`;
        const safe = safeUrl(url);
        emit({ phase: "request", transport: "beacon", requestId, method: "POST", url: safe, fields: bodyFields(data), hints: commandHints(data), source: callSource() });
        const accepted = originalSendBeacon(url, data);
        emit({ phase: "response", transport: "beacon", requestId, method: "POST", url: safe, status: accepted ? "accepted" : "rejected" });
        return accepted;
      };
    } catch {
      // 読み取り専用プロパティのブラウザでは Beacon 観測だけを省略する。
    }
  }

  const formMetadata = (form) => ({
    method: String(form?.method || "GET").toUpperCase(),
    url: safeUrl(form?.action || location.href),
    fields: form ? [...new Set([...form.elements].map((element) => safeFieldName(element.name)).filter(Boolean))] : []
  });

  document.addEventListener("submit", (event) => {
    emit({ phase: "signal", transport: "form", signal: "submit-event", ...formMetadata(event.target), hints: commandHints(new FormData(event.target)) });
    if (learningWrite(event.target?.action || location.href, new FormData(event.target))) emitLearningWrite({ phase: "submitted" });
  }, true);

  for (const method of ["submit", "requestSubmit"]) {
    const original = HTMLFormElement.prototype[method];
    if (!original) continue;
    HTMLFormElement.prototype[method] = function () {
      emit({ phase: "signal", transport: "form", signal: `programmatic-${method}`, ...formMetadata(this), hints: commandHints(new FormData(this)), source: callSource() });
      if (learningWrite(this.action || location.href, new FormData(this))) emitLearningWrite({ phase: "submitted" });
      return original.apply(this, arguments);
    };
  }

  window.addEventListener(SAVE_REQUEST_EVENT, async (event) => {
    const requestId = String(event.detail?.requestId || "").slice(0, 80);
    const finish = (detail) => window.dispatchEvent(new CustomEvent(SAVE_RESULT_EVENT, { detail: { requestId, ...detail } }));
    try {
      const form = [...document.forms].find((candidate) =>
        candidate.querySelector('[name="quiz_id"]')
        && candidate.querySelector('[name="content_id"]')
        && candidate.querySelector('[name="page_number"]')
        && candidate.querySelector('[name^="question_ids["]'));
      if (!form) throw new Error("クイズ回答フォームを特定できませんでした。");

      const formData = new FormData(form);
      const data = new URLSearchParams();
      let hasFile = false;
      for (const [key, value] of formData.entries()) {
        if (typeof value === "string") data.append(key, value);
        else hasFile = true;
      }
      if (hasFile) throw new Error("ファイル回答を含むページでは実験保存を利用できません。");

      const currentPage = String(form.querySelector('[name="page_number"]')?.value || form.querySelector('[name="prev_page_number"]')?.value || "");
      if (!currentPage) throw new Error("現在のページ番号を取得できませんでした。");
      data.set("action", "plugin_quiz_student_page_view_accept");
      data.set("page_number", currentPage);
      data.set("prev_page_number", currentPage);
      data.set("back", "");
      data.set("timeover", "0");
      data.set("select_page_number_flg", "1");

      const response = await window.fetch("/lms/", {
        method: "POST",
        credentials: "same-origin",
        headers: { "X-Requested-With": "XMLHttpRequest" },
        body: data
      });
      if (!response.ok) {
        finish({ ok: false, status: Number(response.status) || 0, pageNumber: currentPage, redirected: response.redirected });
        return;
      }

      const quizId = String(form.querySelector('[name="quiz_id"]')?.value || "");
      const formAction = new URL(form.getAttribute("action") || location.href, location.href);
      if (/\/undefined\/?$/.test(formAction.pathname) && quizId) formAction.pathname = `/lms/plugin/quiz/view/${encodeURIComponent(quizId)}`;
      const frameName = `studylog-quiz-save-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const frame = document.createElement("iframe");
      frame.name = frameName;
      frame.hidden = true;
      frame.setAttribute("sandbox", "allow-forms allow-same-origin");
      frame.src = "about:blank";
      document.documentElement.append(frame);

      const commitForm = document.createElement("form");
      commitForm.method = "post";
      commitForm.action = formAction.href;
      commitForm.target = frameName;
      for (const [key, value] of data.entries()) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = key;
        input.value = value;
        commitForm.append(input);
      }
      document.documentElement.append(commitForm);
      try {
        await new Promise((resolve, reject) => {
          const timeout = window.setTimeout(() => reject(new Error("保存確定フォームがタイムアウトしました。")), 10000);
          frame.addEventListener("load", () => {
            try {
              if (["about:blank", "about:srcdoc"].includes(frame.contentWindow?.location?.href)) return;
            } catch {
              // 同一オリジン応答を想定するが、読み取れなくてもロード完了として扱う。
            }
            window.clearTimeout(timeout);
            resolve();
          });
          commitForm.submit();
        });
      } finally {
        commitForm.remove();
        frame.remove();
      }
      finish({ ok: true, status: Number(response.status) || 0, pageNumber: currentPage, redirected: response.redirected, committed: true });
    } catch (error) {
      finish({ ok: false, status: 0, error: String(error?.message || error).slice(0, 180) });
    }
  });

  const ENTRY_REQUEST_EVENT = "studylog-bridge:attendance-entry-request";
  const ENTRY_RESULT_EVENT = "studylog-bridge:attendance-entry-result";
  const ENTRY_TIMEOUT_MS = 15000;

  // 出席確認ボタンが押された時にスタログ自身が行う問い合わせだけを再現する。
  // 受付フォームは開かず、コードの送信も受付の確定も行わない。
  window.addEventListener(ENTRY_REQUEST_EVENT, (event) => {
    const requestId = String(event.detail?.requestId || "").slice(0, 80);
    const classId = String(event.detail?.classId || "").replace(/\D/g, "");
    let settled = false;
    const settle = (detail) => {
      if (settled) return;
      settled = true;
      window.dispatchEvent(new CustomEvent(ENTRY_RESULT_EVENT, { detail: { requestId, ...detail } }));
    };
    if (!classId) {
      settle({ ok: false, error: "科目を特定できませんでした。" });
      return;
    }
    const api = window.glexa;
    if (!api || typeof api.ajax !== "function") {
      settle({ ok: false, error: "スタログの通信処理が見つかりません。科目のページで試してください。" });
      return;
    }
    window.setTimeout(() => settle({ ok: false, error: "応答がありませんでした。" }), ENTRY_TIMEOUT_MS);
    try {
      api.ajax({
        action: "glexa_modal_entry_form",
        params: { class_id: classId, is_ajax: 1 },
        withoutLoading: true,
        onSuccess: (result) => settle({
          ok: true,
          hasData: Boolean(result?.data && typeof result.data === "object"),
          isAccepted: String(result?.data?.is_accepted ?? "")
        }),
        onError: () => settle({ ok: false, error: "問い合わせに失敗しました。" })
      });
    } catch (error) {
      settle({ ok: false, error: String(error?.message || error).slice(0, 120) });
    }
  });

  const INSPECT_REQUEST_EVENT = "studylog-bridge:inspect-globals-request";
  const INSPECT_RESULT_EVENT = "studylog-bridge:inspect-globals-result";
  const INSPECT_SOURCE_LIMIT = 2000;
  const INSPECT_MAX_FUNCTIONS = 8;

  function globalFunction(name) {
    try {
      const value = window[name];
      return typeof value === "function" ? value : null;
    } catch {
      return null;
    }
  }

  // ページ側の関数の中身を読むだけの調査用。呼び出しはしない。
  window.addEventListener(INSPECT_REQUEST_EVENT, (event) => {
    const requestId = String(event.detail?.requestId || "").slice(0, 80);
    const queue = (Array.isArray(event.detail?.names) ? event.detail.names : []).map(String).slice(0, 5);
    const sources = {};
    while (queue.length && Object.keys(sources).length < INSPECT_MAX_FUNCTIONS) {
      const name = queue.shift();
      if (sources[name] !== undefined) continue;
      const target = globalFunction(name);
      if (!target) continue;
      const source = String(target).slice(0, INSPECT_SOURCE_LIMIT);
      sources[name] = source;
      // 呼び出している関数も1段だけたどり、通信先が書かれた場所まで届くようにする。
      for (const match of source.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)) {
        if (sources[match[1]] === undefined && globalFunction(match[1])) queue.push(match[1]);
      }
    }
    window.dispatchEvent(new CustomEvent(INSPECT_RESULT_EVENT, { detail: { requestId, sources } }));
  });

  for (const method of ["pushState", "replaceState"]) {
    const original = history[method];
    history[method] = function () {
      const result = original.apply(this, arguments);
      window.dispatchEvent(new CustomEvent("studylog-bridge:location-change"));
      return result;
    };
  }
})();
