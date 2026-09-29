(function (root) {
  "use strict";
  const BASE = "https://portal.iwasaki.ac.jp/portal/";
  const id = (value) => /^\d{1,12}$/.test(String(value)) ? String(value) : null;
  function parseList(data) {
    if (data?.result !== "success" || !Array.isArray(data.records)) {
      throw new Error("記事を取得できません。スタログにログインしてから再取得してください。");
    }
    return data.records.map((record) => {
      if (!id(record.infoCode) || !Object.hasOwn(record, "viewDateTime") || !Object.hasOwn(record, "pastinfo")) {
        throw new Error("記事データの形式が変わったため、未読状態を確認できません。");
      }
      return {
        id: id(record.infoCode),
        title: [record.infoTitle, record.infoTitle2].filter(Boolean).join("\n"),
        body: String(record.infoDescription ?? ""),
        category: String(record.categoryName ?? ""),
        date: String(record.infoStart ?? "").slice(0, 8).replace(/^(\d{4})(\d{2})(\d{2})$/, "$1/$2/$3"),
        author: String(record.name ?? ""),
        unread: !record.viewDateTime && String(record.pastinfo) === "0",
        attachments: id(record.eventCode) ? [record.attachedFile1, record.attachedFile2]
          .filter((name) => typeof name === "string" && name.trim())
          .map((name) => ({ name, url: BASE + "zfileDownload.php?" + new URLSearchParams({ ph: String(record.eventCode), fn: name }) })) : []
      };
    });
  }
  async function request(params) {
    const response = await fetch(BASE + "api/portalApi.php?" + new URLSearchParams(params), {
      credentials: "include", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) throw new Error("iPORTALとの通信に失敗しました。時間をおいて再取得してください。");
    return response;
  }
  async function list() {
    const response = await request({ type: "infolistJ" });
    let data;
    try { data = await response.json(); }
    catch { throw new Error("記事の応答を確認できません。スタログにログインしてから再取得してください。"); }
    return parseList(data);
  }
  async function markRead(articleId) {
    if (!id(articleId)) throw new Error("記事IDが不正です。");
    await request({ type: "infoviewupdate", infoCode: String(articleId) });
    // 更新APIのHTTP成功だけでは既読としない。サーバーの一覧を再取得して確認する。
    const articles = await list();
    const article = articles.find((item) => item.id === String(articleId));
    if (!article || article.unread) throw new Error("既読への反映を確認できませんでした。再取得して確認してください。");
    return articles;
  }
  const api = { parseList, list, markRead };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.StudylogIPortal = api;
})(globalThis);
