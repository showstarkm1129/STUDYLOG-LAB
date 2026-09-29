(() => {
  "use strict";

  // Microsoft のサインインを中断して差し込まれる画面かどうかを、URL と本文だけで判定する。
  // DOM 操作は content script 側（ms-signin.js）が行い、ここでは押してよい操作の判断だけを持つ。

  const INTERRUPT_HOSTS = Object.freeze(["login.microsoftonline.com", "login.microsoft.com", "login.windows.net"]);
  const REGISTRATION_HOSTS = Object.freeze(["mysignins.microsoft.com", "account.activedirectory.windowsazure.com"]);

  // 登録画面へ送るだけのボタン。ここを押しても登録は始まらず、スキップできる画面に移るだけ。
  const PROOF_UP_ID = /^idSubmit_ProofUp/i;

  // 「今はスキップ」に相当する明示的な文言。
  const STRONG_SKIP = /(?:セットアップ|設定|登録)を?スキップ|今はスキップ|(?:後|あと)で(?:行う|設定|確認|通知)|今は(?:行わない|設定しない)|skip for now|skip setup|skip this|ask (?:me )?later|remind me later|maybe later|i.?ll do (?:this|it) later/;
  // 上ほど確実ではないが、スキップの可能性がある文言。
  const WEAK_SKIP = /スキップ|skip\b|not now|(?:後|あと)で/;
  // 設定を進める操作と、本文へ飛ぶだけの補助リンク。スキップ語を含んでいてもこちらが優先で除外する。
  const CONTINUE = /コンテンツにスキップ|skip to (?:main )?content|設定します|設定する|セットアップ(?:を(?:開始|続行|完了)|します|する)|ダウンロード|次へ|続行|サインイン|同意|別の方法|別の認証|download|continue|next|sign ?in|get started|set up (?:a|an|another|different)/;

  const KMSI_PROMPT = /サインインの状態を維持しますか|stay signed in\?|keep me signed in|このメッセージを表示しない/;
  const SECURITY_PROMPT = /アカウント(?:を|の)セキュリティ保護|keep your account secure|詳細情報が必要|more information required|セキュリティ情報|security info|microsoft authenticator|認証アプリ|段階認証|多要素認証|multifactor|two-step verification/;

  const normalize = (value) => String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();

  function hostOf(value) {
    try {
      return new URL(String(value || "")).hostname.toLowerCase();
    } catch {
      return "";
    }
  }

  function hostKind(host) {
    if (INTERRUPT_HOSTS.includes(host)) return "interrupt";
    if (REGISTRATION_HOSTS.includes(host)) return "registration";
    return "other";
  }

  // 押してよいなら 2（明示的なスキップ）か 1（スキップの可能性）、押してはいけないなら 0。
  function labelScore(label) {
    const text = normalize(label);
    if (!text || text.length > 80) return 0;
    if (CONTINUE.test(text)) return 0;
    if (STRONG_SKIP.test(text)) return 2;
    if (WEAK_SKIP.test(text)) return 1;
    return 0;
  }

  // recentInterrupt は「直前にサインイン側の中断画面を見た」印。リダイレクトで referrer が
  // 落ちることがあるため、referrer だけに頼らずこの印でも登録画面を中断として扱う。
  function assess({ url = "", referrer = "", text = "", recentInterrupt = false } = {}) {
    const host = hostOf(url);
    const kind = hostKind(host);
    if (kind === "other") return { screen: "other", reason: "host", host, hostKind: kind };
    // 本人が設定しに来た場合まで邪魔しないよう、登録画面はサインインから飛ばされた時だけ扱う。
    if (kind === "registration" && hostKind(hostOf(referrer)) !== "interrupt" && !recentInterrupt) {
      return { screen: "other", reason: "not-interrupt", host, hostKind: kind };
    }
    const body = normalize(text);
    if (KMSI_PROMPT.test(body)) return { screen: "stay-signed-in", host, hostKind: kind };
    if (SECURITY_PROMPT.test(body)) return { screen: "security-info", host, hostKind: kind };
    return { screen: "other", reason: "no-prompt", host, hostKind: kind };
  }

  const actionable = (candidate) => Boolean(candidate) && candidate.visible !== false && candidate.disabled !== true;

  function chooseSkip(candidates) {
    const ranked = (Array.isArray(candidates) ? candidates : [])
      .map((candidate, order) => ({ candidate, order, score: actionable(candidate) ? labelScore(candidate.label) : 0 }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.order - b.order);
    return ranked.length ? ranked[0].candidate : null;
  }

  // 「アカウントをセキュリティ保護しましょう」にはスキップが無く、次へ（ProofUp）で
  // スキップできる登録画面に移るしかない。文言ではなく id で限定して許可する。
  function chooseProofUpAdvance(candidates) {
    return (Array.isArray(candidates) ? candidates : []).find(
      (candidate) => actionable(candidate) && PROOF_UP_ID.test(String(candidate.id || ""))
    ) || null;
  }

  function chooseKeepSignedIn(candidates) {
    return (Array.isArray(candidates) ? candidates : []).find((candidate) =>
      actionable(candidate) && candidate.id === "idSIButton9" && /^(はい|yes)$/.test(normalize(candidate.label))
    ) || null;
  }

  globalThis.StudylogMsSigninRules = Object.freeze({
    interruptHosts: INTERRUPT_HOSTS,
    registrationHosts: REGISTRATION_HOSTS,
    normalize,
    hostOf,
    hostKind,
    labelScore,
    assess,
    chooseSkip,
    chooseProofUpAdvance,
    chooseKeepSignedIn
  });
})();
