(() => {
  "use strict";

  const MINUTE_MS = 60 * 1000;
  const WINDOW_LEAD_MINUTES = 5;
  const WINDOW_TAIL_MINUTES = 10;
  const FOCUS_MINUTES = 25;
  const ACTIVE_INTERVAL_MS = 60 * 1000;
  const RELAXED_INTERVAL_MS = 3 * MINUTE_MS;
  const JITTER_RATIO = 0.25;
  const REQUEST_BUDGET = 40;
  const FAILURE_BACKOFF_MS = 5 * MINUTE_MS;
  const MAX_FAILURES = 3;

  const clockMinutes = (value) => {
    const [hour, minute] = String(value || "").split(":").map(Number);
    return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : null;
  };

  const pad = (value) => String(value).padStart(2, "0");
  const isoDay = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

  function blockKey(block) {
    return `${block.date}:${block.classId}:${block.period}`;
  }

  // 同じ科目が続く時限はひとつの監視窓にまとめる。2コマ連続でも受付は通常1回だけのため。
  function blocks(slots, periodTimes, date) {
    const ordered = (Array.isArray(slots) ? slots : [])
      .filter((slot) => slot && slot.date === date && periodTimes[Number(slot.period)])
      .sort((left, right) => Number(left.period) - Number(right.period));
    const merged = [];
    for (const slot of ordered) {
      const period = Number(slot.period);
      const times = periodTimes[period];
      const previous = merged.at(-1);
      if (previous && String(previous.classId) === String(slot.classId) && period === previous.lastPeriod + 1) {
        previous.lastPeriod = period;
        previous.endMinutes = clockMinutes(times.end);
        previous.periods.push(period);
        continue;
      }
      merged.push({
        date,
        classId: String(slot.classId),
        period,
        lastPeriod: period,
        periods: [period],
        startMinutes: clockMinutes(times.start),
        endMinutes: clockMinutes(times.end)
      });
    }
    return merged.filter((block) => block.classId && block.startMinutes !== null && block.endMinutes !== null)
      .map((block) => ({ ...block, key: blockKey(block) }));
  }

  function windowFor(block) {
    return { openMinutes: block.startMinutes - WINDOW_LEAD_MINUTES, closeMinutes: block.endMinutes + WINDOW_TAIL_MINUTES };
  }

  function intervalFor(block, minutes) {
    return minutes <= block.startMinutes + FOCUS_MINUTES ? ACTIVE_INTERVAL_MS : RELAXED_INTERVAL_MS;
  }

  // 同じ秒に複数端末が並ぶことを避けるため、間隔にゆらぎを持たせる。
  function jitter(intervalMs, random = Math.random) {
    const spread = intervalMs * JITTER_RATIO;
    return Math.round(intervalMs - spread / 2 + random() * spread);
  }

  function plan({ now = Date.now(), slots = [], periodTimes = {}, state = {}, enabled = true, snoozedUntil = 0, random = Math.random } = {}) {
    if (!enabled) return { watching: false, reason: "disabled" };
    const date = new Date(now);
    const today = isoDay(date);
    if (Number(snoozedUntil) > now) return { watching: false, reason: "snoozed" };
    const minutes = date.getHours() * 60 + date.getMinutes();
    const todaysBlocks = blocks(slots, periodTimes, today);
    if (!todaysBlocks.length) return { watching: false, reason: "no-lesson" };

    const open = todaysBlocks.find((block) => {
      const bounds = windowFor(block);
      return bounds.openMinutes <= minutes && minutes < bounds.closeMinutes;
    });
    if (!open) return { watching: false, reason: "outside-window", blocks: todaysBlocks };

    const blockState = state[open.key] || {};
    if (blockState.detectedAt) return { watching: false, reason: "detected", block: open };
    if (blockState.completedAt) return { watching: false, reason: "completed", block: open };
    if (Number(blockState.failures || 0) >= MAX_FAILURES) return { watching: false, reason: "failed", block: open };
    if (Number(blockState.requests || 0) >= REQUEST_BUDGET) return { watching: false, reason: "budget", block: open };
    if (Number(blockState.backoffUntil || 0) > now) return { watching: false, reason: "backoff", block: open };

    const interval = intervalFor(open, minutes);
    const lastCheckedAt = Date.parse(blockState.lastCheckedAt || "") || 0;
    if (lastCheckedAt && now - lastCheckedAt < interval) return { watching: false, reason: "interval", block: open };

    return {
      watching: true,
      block: open,
      intervalMs: interval,
      nextDelayMs: jitter(interval, random),
      remainingBudget: REQUEST_BUDGET - Number(blockState.requests || 0)
    };
  }

  function afterCheck(blockState = {}, { ok, at = new Date().toISOString(), now = Date.now() } = {}) {
    const next = { ...blockState, requests: Number(blockState.requests || 0) + 1, lastCheckedAt: at };
    if (ok) {
      next.failures = 0;
      next.backoffUntil = 0;
      return next;
    }
    next.failures = Number(blockState.failures || 0) + 1;
    next.backoffUntil = now + FAILURE_BACKOFF_MS;
    return next;
  }

  // 起きている人に鳴らさないための抑制。既にその科目を開いている場合は音を出さず、バッジだけにする。
  function notification({ blockState = {}, viewingClass = false, channels = {}, now = Date.now(), snoozedUntil = 0 } = {}) {
    if (blockState.notifiedAt) return { notify: false, channels: [], reason: "already-notified" };
    if (Number(snoozedUntil) > now) return { notify: false, channels: [], reason: "snoozed" };
    const selected = ["badge"];
    if (!viewingClass) {
      if (channels.desktop) selected.push("desktop");
      if (channels.sound) selected.push("sound");
      if (channels.slack) selected.push("slack");
      if (channels.discord) selected.push("discord");
    }
    return { notify: true, channels: selected, quiet: Boolean(viewingClass), reason: viewingClass ? "viewing" : "away" };
  }

  const ENTRY_LABEL = /出席確認|出席登録|出欠確認|出欠登録/;
  const OPEN_HINTS = [/受付中/, /受付を開始/, /コードを入力/, /出席コード/, /出席を受け付け/, /ボタンを押して/, /認証コード/];
  const CLOSED_HINTS = [/受付していません/, /受付を行っていません/, /受付時間外/, /受付は終了/, /受付が終了/, /実施されていません/, /対象の授業がありません/];
  const DONE_HINTS = [/出席済/, /受付済/, /登録されました/, /出席を登録しました/];

  const CLICKABLE_SELECTOR = 'a, button, input[type="button"], input[type="submit"], [onclick], [role="button"]';
  const EXACT_LABEL = /^(出席|出欠)(確認|登録)$/;

  const clean = (value) => String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim();

  function elementText(element) {
    const tag = String(element?.tagName || "").toUpperCase();
    if (tag === "INPUT") return clean(element.value ?? element.getAttribute?.("value"));
    if (tag === "IMG") return clean(element.getAttribute?.("alt"));
    return clean(element?.textContent);
  }

  // 学校ごとにボタンの作りが違うため、まずクリックできる要素から探し、
  // 見つからない場合は文字列が一致する最も内側の要素とその祖先まで広げる。
  function entryFrom(doc) {
    const clickable = [...(doc?.querySelectorAll?.(CLICKABLE_SELECTOR) || [])];
    const direct = clickable.find((candidate) => ENTRY_LABEL.test(elementText(candidate)));
    if (direct) return describeEntry(direct, direct, "clickable");

    const all = [...(doc?.querySelectorAll?.("*") || [])];
    const labelled = all.filter((candidate) => EXACT_LABEL.test(elementText(candidate)));
    if (!labelled.length) return null;
    const innermost = labelled.find((candidate) => !labelled.some((other) => other !== candidate && candidate.contains?.(other))) || labelled.at(-1);
    const host = innermost.closest?.(CLICKABLE_SELECTOR) || innermost;
    return describeEntry(host, innermost, host === innermost ? "text" : "text-ancestor");
  }

  function describeEntry(host, labelSource, via) {
    const attribute = (name) => String(host.getAttribute?.(name) || "");
    return {
      via,
      label: elementText(labelSource).slice(0, 40),
      tag: String(host.tagName || "").toLowerCase(),
      href: attribute("href").slice(0, 200),
      id: String(host.id || "").slice(0, 60),
      className: attribute("class").slice(0, 120),
      onclick: attribute("onclick").slice(0, 200),
      disabled: Boolean(host.hasAttribute?.("disabled")) || /disabled/.test(attribute("class"))
    };
  }

  function signature(entry) {
    if (!entry) return "absent";
    return [entry.tag, entry.label, entry.href, entry.id, entry.className, entry.onclick, entry.disabled ? "disabled" : ""].join("|");
  }

  function entryUrl(entry, origin) {
    const href = String(entry?.href || "").trim();
    if (!href || href.startsWith("#") || /^javascript:/i.test(href)) return null;
    try {
      const url = new URL(href, origin);
      return url.origin === new URL(origin).origin ? url.href : null;
    } catch {
      return null;
    }
  }

  // 画面を開いて表示を読むだけで判定する。コード送信も受付ボタンの押下も行わない。
  function classifyScreen(html) {
    const body = String(html || "").replace(/<[^>]*>/g, " ").normalize("NFKC").replace(/\s+/g, " ");
    if (DONE_HINTS.some((pattern) => pattern.test(body))) return "done";
    if (CLOSED_HINTS.some((pattern) => pattern.test(body))) return "closed";
    if (OPEN_HINTS.some((pattern) => pattern.test(body))) return "open";
    return "unknown";
  }

  // 出席確認ボタンが押された時にスタログ自身が見ている値。スタログ本体は
  // is_accepted != '1' なら受付フォームを開くので、その分岐をそのまま写す。
  // 値が空でも受付中と見なすのはそのため。応答に data が無かったときだけは
  // 想定と違う返り方なので、判定せず通知もしない。
  function classifyEntry({ isAccepted, hasData } = {}) {
    if (hasData === false) return "unknown";
    return String(isAccepted ?? "").trim() === "1" ? "quiet" : "open";
  }

  function prune(state = {}, today) {
    return Object.fromEntries(Object.entries(state).filter(([key]) => key.startsWith(`${today}:`)));
  }

  globalThis.StudylogAttendanceWatchRules = Object.freeze({
    windowLeadMinutes: WINDOW_LEAD_MINUTES,
    windowTailMinutes: WINDOW_TAIL_MINUTES,
    activeIntervalMs: ACTIVE_INTERVAL_MS,
    relaxedIntervalMs: RELAXED_INTERVAL_MS,
    requestBudget: REQUEST_BUDGET,
    maxFailures: MAX_FAILURES,
    failureBackoffMs: FAILURE_BACKOFF_MS,
    isoDay,
    blockKey,
    blocks,
    windowFor,
    intervalFor,
    plan,
    entryFrom,
    signature,
    entryUrl,
    classifyScreen,
    classifyEntry,
    afterCheck,
    notification,
    prune
  });
})();
