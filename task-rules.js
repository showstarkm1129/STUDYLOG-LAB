(() => {
  "use strict";

  const array = (value) => Array.isArray(value) ? value : [];
  const normalize = (value) => String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();

  function reportKey(report) {
    return [report?.classId, report?.directoryId, report?.kind, normalize(report?.title), report?.href]
      .map((value) => String(value || ""))
      .join("::");
  }

  function titlePattern(value) {
    return normalize(value)
      .replace(/20\d{2}\s*[年/.\-]\s*\d{1,2}\s*[月/.\-]\s*\d{1,2}\s*日?/g, " #date ")
      .replace(/(?:第\s*)?\d+(?:\.\d+)?\s*(?:回|週|章|限|日|問|点)?/g, " # ")
      .replace(/[\s_\-‐‑‒–—―・:：/\\()[\]{}「」『』【】（）]+/g, " ")
      .trim();
  }

  function comparableKind(value) {
    const normalized = normalize(value);
    if (/課題|レポート|report/.test(normalized)) return "report";
    if (/クイズ|テスト|試験|quiz|test/.test(normalized)) return "test";
    return normalized;
  }

  function bigrams(value) {
    const compact = value.replace(/\s+/g, "");
    if (compact.length < 2) return compact ? [compact] : [];
    return Array.from({ length: compact.length - 1 }, (_, index) => compact.slice(index, index + 2));
  }

  function diceSimilarity(left, right) {
    const leftParts = bigrams(left);
    const rightParts = bigrams(right);
    if (!leftParts.length || !rightParts.length) return 0;
    const available = new Map();
    rightParts.forEach((part) => available.set(part, (available.get(part) || 0) + 1));
    let intersection = 0;
    leftParts.forEach((part) => {
      const count = available.get(part) || 0;
      if (!count) return;
      intersection += 1;
      available.set(part, count - 1);
    });
    return (2 * intersection) / (leftParts.length + rightParts.length);
  }

  function similarity(left, right) {
    if (String(left?.classId || "") !== String(right?.classId || "")) return 0;
    if (comparableKind(left?.kind) !== comparableKind(right?.kind)) return 0;
    const leftPattern = titlePattern(left?.title);
    const rightPattern = titlePattern(right?.title);
    if (!leftPattern || !rightPattern) return 0;
    if (leftPattern === rightPattern) return 1;
    return diceSimilarity(leftPattern, rightPattern);
  }

  function notRequiredSet(preferences) {
    return new Set(array(preferences?.notRequired));
  }

  function isNotRequired(report, preferences) {
    return notRequiredSet(preferences).has(reportKey(report));
  }

  function notRequiredMatch(report, reports, preferences) {
    const key = reportKey(report);
    if (notRequiredSet(preferences).has(key)) return null;
    let best = null;
    array(reports).forEach((candidate) => {
      if (!isNotRequired(candidate, preferences)) return;
      if (candidate?.status && !/未完了|未提出|未回答|未受験|未実施/.test(candidate.status)) return;
      const score = similarity(report, candidate);
      if (score < 0.72 || score <= (best?.score || 0)) return;
      best = {
        score,
        reference: candidate,
        reason: score === 1
          ? `同じ科目・種別の「${candidate.title || "名称なし"}」と同じ名称パターン`
          : `同じ科目・種別の「${candidate.title || "名称なし"}」と類似`
      };
    });
    return best;
  }

  globalThis.StudylogTaskRules = Object.freeze({
    normalize,
    reportKey,
    titlePattern,
    similarity,
    isNotRequired,
    notRequiredMatch
  });
})();
