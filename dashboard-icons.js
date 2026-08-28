(() => {
  "use strict";

  const ICONS = Object.freeze([
    { id: "home", glyph: "⌂", label: "ホーム" },
    { id: "tasks", glyph: "✓", label: "チェック" },
    { id: "attendance", glyph: "◔", label: "出席" },
    { id: "courses", glyph: "□", label: "科目" },
    { id: "dashboard", glyph: "◇", label: "ダッシュボード" },
    { id: "brief", glyph: "✦", label: "ブリーフ" },
    { id: "clock", glyph: "◷", label: "時計" },
    { id: "calendar", glyph: "▣", label: "カレンダー" },
    { id: "progress", glyph: "◒", label: "進捗" },
    { id: "priority", glyph: "⚑", label: "優先" },
    { id: "inbox", glyph: "⇩", label: "受信箱" },
    { id: "book", glyph: "📘", label: "教科書" },
    { id: "books", glyph: "📚", label: "本" },
    { id: "note", glyph: "📝", label: "ノート" },
    { id: "pencil", glyph: "✎", label: "鉛筆" },
    { id: "target", glyph: "◎", label: "目標" },
    { id: "chart", glyph: "📊", label: "グラフ" },
    { id: "trophy", glyph: "🏆", label: "トロフィー" },
    { id: "bell", glyph: "🔔", label: "通知" },
    { id: "flag", glyph: "🚩", label: "旗" },
    { id: "folder", glyph: "📁", label: "フォルダー" },
    { id: "file", glyph: "📄", label: "ファイル" },
    { id: "calculator", glyph: "🧮", label: "計算" },
    { id: "idea", glyph: "💡", label: "アイデア" },
    { id: "fire", glyph: "🔥", label: "集中" },
    { id: "favorite", glyph: "❤️", label: "お気に入り" },
    { id: "shield", glyph: "🛡️", label: "安全" },
    { id: "search", glyph: "⌕", label: "検索" },
    { id: "list", glyph: "☷", label: "リスト" },
    { id: "grid", glyph: "▦", label: "グリッド" },
    { id: "pin", glyph: "📌", label: "ピン" },
    { id: "rocket", glyph: "🚀", label: "開始" },
    { id: "lab", glyph: "⚗", label: "実験" },
    { id: "code", glyph: "⌘", label: "コード" },
    { id: "database", glyph: "🗄️", label: "データベース" },
    { id: "network", glyph: "🌐", label: "ネットワーク" },
    { id: "palette", glyph: "🎨", label: "デザイン" },
    { id: "music", glyph: "♫", label: "音楽" },
    { id: "coffee", glyph: "☕", label: "休憩" },
    { id: "moon", glyph: "☾", label: "夜" },
    { id: "sun", glyph: "☀", label: "昼" },
    { id: "settings", glyph: "⚙", label: "設定" },
    { id: "star", glyph: "★", label: "スター" }
  ].map(Object.freeze));

  const byId = new Map(ICONS.map((icon) => [icon.id, icon]));
  const byGlyph = new Map(ICONS.map((icon) => [icon.glyph, icon]));
  const fallback = byId.get("dashboard");

  function resolve(value) {
    return byId.get(String(value || "")) || byGlyph.get(String(value || "")) || fallback;
  }

  const api = Object.freeze({ ICONS, resolve });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  globalThis.StudylogDashboardIcons = api;
})();
