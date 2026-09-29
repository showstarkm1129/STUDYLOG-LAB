(() => {
  "use strict";
  function mount(root) {
    const $ = (selector) => root.querySelector(`[data-iportal="${selector}"]`);
    let articles = [];
    let selectedId = null;
    let busy = false;
    function element(tag, text, className) {
      const node = document.createElement(tag);
      node.textContent = text;
      if (className) node.className = className;
      return node;
    }
    function renderList() {
      const query = $("search").value.trim().toLocaleLowerCase();
      const visible = articles.filter((article) => (!$("unread-only").checked || article.unread) &&
        `${article.title}\n${article.body}`.toLocaleLowerCase().includes(query));
      $("articles").replaceChildren(...visible.map((article) => {
        const button = element("button", "", "portal-item");
        button.type = "button";
        button.disabled = busy;
        button.setAttribute("aria-current", String(selectedId === article.id));
        button.append(element("strong", article.title), element("small", `${article.unread ? "未読 · " : "既読 · "}${article.category} · ${article.date}`));
        button.addEventListener("click", () => openArticle(article));
        return button;
      }));
      if (!visible.length) $("articles").append(element("p", $("unread-only").checked && !query ? "未読記事はありません。" : "条件に一致する記事はありません。"));
    }
    function renderDetail(article) {
      const detail = $("detail");
      const body = element("div", "", "portal-body");
      // HTMLは実行しない。本文中のHTTP(S)リンクだけをリンクにする。
      for (const part of article.body.split(/(https?:\/\/[^\s<>"']+)/g)) {
        if (/^https?:\/\//.test(part)) {
          const link = element("a", part);
          link.href = part; link.target = "_blank"; link.rel = "noopener noreferrer";
          body.append(link);
        } else body.append(document.createTextNode(part));
      }
      detail.replaceChildren(element("h2", article.title), element("p", `${article.category} · ${article.date} · ${article.author}`), body);
      const attachments = element("div", "", "portal-attachments");
      for (const file of article.attachments) {
        const link = element("a", file.name);
        link.href = file.url; link.target = "_blank"; link.rel = "noopener noreferrer";
        attachments.append(link);
      }
      detail.append(attachments);
      if (article.unread) {
        const retry = element("button", "既読にする", "secondary-button");
        retry.type = "button"; retry.disabled = busy;
        retry.addEventListener("click", () => openArticle(article));
        detail.append(retry);
      }
    }
    async function run(action) {
      if (busy) return;
      busy = true;
      $("refresh").disabled = true;
      renderList();
      try { await action(); }
      catch (error) { $("status").textContent = `取得・更新できませんでした。${error.message}`; }
      finally {
        busy = false;
        $("refresh").disabled = false;
        renderList();
        const selected = articles.find((article) => article.id === selectedId);
        if (selected) renderDetail(selected);
      }
    }
    function summary() {
      $("status").textContent = `未読 ${articles.filter((article) => article.unread).length}件 / 全 ${articles.length}件 · ${new Date().toLocaleTimeString("ja-JP")} 確認`;
    }
    async function openArticle(article) {
      if (busy) return;
      selectedId = article.id;
      renderDetail(article);
      $("detail").focus();
      await run(async () => {
        if (article.unread) {
          $("status").textContent = "既読を反映しています…";
          articles = await StudylogIPortal.markRead(article.id);
        }
        summary();
      });
    }
    function refresh() {
      return run(async () => {
        $("status").textContent = "記事を取得しています…";
        articles = await StudylogIPortal.list();
        if (selectedId && !articles.some((article) => article.id === selectedId)) {
          selectedId = null;
          $("detail").replaceChildren(element("p", "この記事は現在の一覧にはありません。"));
        }
        summary();
      });
    }
    $("refresh").addEventListener("click", refresh);
    $("unread-only").addEventListener("change", renderList);
    $("search").addEventListener("input", renderList);
    refresh();
  }
  globalThis.StudylogIPortalReader = { mount };
  const page = document.querySelector(".portal-reader");
  if (page) mount(page);
})();
