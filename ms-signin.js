(() => {
  "use strict";

  // Microsoft のサインイン中に差し込まれる「アカウントをセキュリティ保護しましょう」を、
  // Microsoft 自身が用意した「今はスキップ」リンクを押して閉じる。
  // 認証情報には一切触れず、押すのは判定済みのスキップ操作だけに限る。

  const rules = globalThis.StudylogMsSigninRules;
  if (!rules) return;

  const SETTINGS_KEY = "studylogMsSigninV1";
  const MARK_KEY = "studylogMsSigninSeenV1";
  const DEFAULTS = Object.freeze({ skipSecurityInfo: true, advanceProofUp: true, keepSignedIn: false });
  // 中断画面を見てから登録画面に着くまでの猶予。これを過ぎたら自分で設定しに来たとみなす。
  const MARK_TTL_MS = 2 * 60 * 1000;
  const LOG = "[studylog:ms-signin]";
  const SELECTOR = 'a, button, input[type="button"], input[type="submit"], [role="button"], [role="link"]';
  const WATCH_MS = 30 * 1000;
  const EXTEND_MS = 10 * 1000;
  const COOLDOWN_MS = 1200;
  const MAX_CLICKS = 3;

  let settings = { ...DEFAULTS };
  let clicks = 0;
  let lastClickAt = 0;
  let deadline = Date.now() + WATCH_MS;
  let observer = null;
  let timer = 0;
  let recentInterrupt = false;
  let marked = false;

  function visible(element) {
    if (element.closest('[aria-hidden="true"], [hidden]')) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function labelOf(element) {
    return element.getAttribute("aria-label")
      || (element.tagName === "INPUT" ? element.value : "")
      || element.textContent
      || "";
  }

  function candidates() {
    return [...document.querySelectorAll(SELECTOR)].map((element) => ({
      element,
      id: element.id || "",
      label: labelOf(element),
      disabled: element.disabled === true || element.getAttribute("aria-disabled") === "true",
      visible: visible(element)
    }));
  }

  // 登録画面側の content script に「サインインから飛ばされてきた」ことを伝える。
  function markInterrupt() {
    if (marked) return;
    marked = true;
    try {
      chrome.storage.local.set({ [MARK_KEY]: { at: Date.now() } });
    } catch {
      // 印が残せなくても referrer で判定できる場合がある。
    }
  }

  function clearInterruptMark() {
    try {
      chrome.storage.local.remove(MARK_KEY);
    } catch {
      // 消せなくても TTL で失効する。
    }
  }

  function remember(entry) {
    try {
      chrome.storage.local.set({ [SETTINGS_KEY]: { ...settings, lastAction: { ...entry, at: new Date().toISOString() } } });
    } catch {
      // ストレージが使えない場合でも動作そのものは止めない。
    }
  }

  function press(candidate, screen) {
    clicks += 1;
    lastClickAt = Date.now();
    deadline = Math.max(deadline, lastClickAt + EXTEND_MS);
    console.info(LOG, `${screen}: 「${rules.normalize(candidate.label)}」を押しました`);
    remember({ screen, label: rules.normalize(candidate.label), url: location.href });
    candidate.element.click();
  }

  function tick() {
    if (Date.now() > deadline || clicks >= MAX_CLICKS) return stop();
    if (Date.now() - lastClickAt < COOLDOWN_MS) return;
    if (!document.body) return;

    const state = rules.assess({
      url: location.href,
      referrer: document.referrer,
      text: document.body.innerText || document.body.textContent || "",
      recentInterrupt
    });

    if (state.screen === "security-info" && settings.skipSecurityInfo) {
      if (state.hostKind === "interrupt") markInterrupt();
      const list = candidates();
      const skip = rules.chooseSkip(list);
      if (skip) {
        if (state.hostKind === "registration") clearInterruptMark();
        return press(skip, "security-info");
      }
      // 「アカウントをセキュリティ保護しましょう」にはスキップが無いので、
      // Microsoft 自身が用意した次へで、スキップできる登録画面まで進める。
      if (settings.advanceProofUp && state.hostKind === "interrupt") {
        const advance = rules.chooseProofUpAdvance(list);
        if (advance) return press(advance, "proof-up");
      }
      console.debug(LOG, "スキップできる操作が見つかりません", list.filter((item) => item.visible && !item.disabled).map((item) => rules.normalize(item.label)).filter(Boolean));
      return;
    }

    if (state.screen === "stay-signed-in" && settings.keepSignedIn) {
      const checkbox = document.querySelector("#KmsiCheckboxField");
      if (checkbox && !checkbox.checked) checkbox.click();
      const yes = rules.chooseKeepSignedIn(candidates());
      if (yes) press(yes, "stay-signed-in");
    }
  }

  function stop() {
    observer?.disconnect();
    observer = null;
    if (timer) clearInterval(timer);
    timer = 0;
  }

  function start() {
    tick();
    observer = new MutationObserver(() => tick());
    observer.observe(document.documentElement, { childList: true, subtree: true });
    // 画面が静かなまま描画が終わる場合に備えて、監視期間だけは定期的にも見る。
    timer = setInterval(tick, 500);
  }

  function boot() {
    try {
      chrome.storage.local.get([SETTINGS_KEY, MARK_KEY], (stored) => {
        settings = { ...DEFAULTS, ...(stored?.[SETTINGS_KEY] || {}) };
        const seenAt = Number(stored?.[MARK_KEY]?.at) || 0;
        recentInterrupt = seenAt > 0 && Date.now() - seenAt < MARK_TTL_MS;
        if (!settings.skipSecurityInfo && !settings.keepSignedIn) return;
        start();
      });
    } catch {
      start();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
