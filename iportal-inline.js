(() => {
  "use strict";
  function install() {
    const portal = document.querySelector("#toportal");
    const portalItem = portal?.closest("li");
    if (!portalItem || document.querySelector("#studylog-iportal-toggle")) return;
    const button = document.createElement("button");
    button.id = "studylog-iportal-toggle";
    button.type = "button";
    button.className = portal.className;
    button.textContent = "未読記事";
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", "studylog-iportal-panel");
    const item = document.createElement("li");
    item.append(button);
    portalItem.before(item);
    button.addEventListener("click", () => {
      const dialog = document.createElement("dialog");
      dialog.id = "studylog-iportal-panel";
      dialog.setAttribute("aria-labelledby", "studylog-iportal-title");
      dialog.innerHTML = `<div class="studylog-iportal-header"><div><h2 id="studylog-iportal-title">iPORTALの記事</h2><p>記事を開くと既読になります。</p></div><button type="button" data-close aria-label="記事パネルを閉じる">×</button></div>
        <div class="portal-toolbar"><button data-iportal="refresh" type="button">再取得</button><label><input data-iportal="unread-only" type="checkbox" checked> 未読のみ</label><input data-iportal="search" type="search" aria-label="記事を検索" placeholder="タイトル・本文を検索" maxlength="200"></div>
        <p data-iportal="status" role="status" aria-live="polite">記事を取得しています…</p>
        <div class="portal-columns"><section aria-label="記事一覧"><div data-iportal="articles"></div></section><article class="portal-detail" data-iportal="detail" aria-label="記事本文" tabindex="-1"><p>一覧から記事を選んでください。</p></article></div>`;
      dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());
      dialog.addEventListener("click", (event) => {
        if (event.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
      });
      dialog.addEventListener("close", () => {
        dialog.remove();
        button.setAttribute("aria-expanded", "false");
        button.focus();
      }, { once: true });
      document.body.append(dialog);
      dialog.showModal();
      button.setAttribute("aria-expanded", "true");
      StudylogIPortalReader.mount(dialog);
    });
  }
  // ヘッダーの遅延表示・再描画にも対応する。自分の追加で通知されても重複させない。
  new MutationObserver(install).observe(document, { childList: true, subtree: true });
  install();
})();
