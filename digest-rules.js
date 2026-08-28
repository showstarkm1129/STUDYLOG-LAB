(() => {
  "use strict";

  const normalize = (value) => String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim();
  const role = (report) => normalize(report?.title).match(/^\(\s*([DH])\s*\)/i)?.[1]?.toUpperCase() || null;
  const pending = (report) => /未完了|未提出|未回答|未受験|未実施/.test(report?.status || "");
  const done = (report) => !pending(report) && /完了|提出済|回答済|受験済/.test(report?.status || "");

  function scoreRate(report) {
    const match = normalize(report?.status).match(/([0-9]+(?:\.[0-9]+)?)\s*\/\s*([0-9]+(?:\.[0-9]+)?)\s*点?/);
    if (!match) return null;
    const earned = Number(match[1]);
    const possible = Number(match[2]);
    return Number.isFinite(earned) && possible > 0 ? earned / possible : null;
  }

  function sameLesson(a, b) {
    return String(a?.classId || "") === String(b?.classId || "")
      && String(a?.directoryId || "") === String(b?.directoryId || "");
  }

  function resolution(report, reports) {
    const reportRole = role(report);
    if (reportRole !== "H" || !pending(report)) return { state: "normal", role: reportRole };
    const digest = (Array.isArray(reports) ? reports : []).find((candidate) => sameLesson(report, candidate) && role(candidate) === "D");
    if (!digest) return { state: "normal", role: reportRole };
    if (pending(digest)) return { state: "deferred", role: reportRole, digest, scoreRate: null };
    const rate = scoreRate(digest);
    if (done(digest) && rate !== null && rate >= 0.6) return { state: "auto-complete", role: reportRole, digest, scoreRate: rate };
    if (done(digest)) return { state: "required", role: reportRole, digest, scoreRate: rate };
    return { state: "normal", role: reportRole, digest, scoreRate: rate };
  }

  globalThis.StudylogDigestRules = Object.freeze({ role, scoreRate, resolution });
})();
