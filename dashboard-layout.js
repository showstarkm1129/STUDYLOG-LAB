(() => {
  "use strict";

  const LAYOUT_SCHEMA_VERSION = 2;
  const BUILTIN_PAGES = Object.freeze([
    Object.freeze({ id: "home", name: "ホーム", icon: "⌂" }),
    Object.freeze({ id: "tasks", name: "課題", icon: "✓" }),
    Object.freeze({ id: "attendance", name: "出席", icon: "◔" }),
    Object.freeze({ id: "courses", name: "科目", icon: "□" })
  ]);
  const SIZE_SPECS = Object.freeze({
    small: Object.freeze({ label: "小", columns: 4, rows: 1 }),
    medium: Object.freeze({ label: "中", columns: 6, rows: 1 }),
    large: Object.freeze({ label: "大", columns: 12, rows: 2 })
  });

  const array = (value) => Array.isArray(value) ? value : [];
  const text = (value, fallback, maximum) => String(value || "").trim().slice(0, maximum) || fallback;

  function catalogMap(cardDefinitions) {
    return new Map(array(cardDefinitions).map((definition) => [String(definition.id), definition]));
  }

  function cardRect(card) {
    const spec = SIZE_SPECS[card?.size];
    if (!spec) return null;
    const maximumX = 12 - spec.columns + 1;
    const x = Math.min(maximumX, Math.max(1, Math.floor(Number(card?.x) || 1)));
    const y = Math.max(1, Math.floor(Number(card?.y) || 1));
    return { x, y, columns: spec.columns, rows: spec.rows };
  }

  function overlaps(first, second) {
    const a = cardRect(first);
    const b = cardRect(second);
    if (!a || !b) return false;
    return a.x < b.x + b.columns && a.x + a.columns > b.x && a.y < b.y + b.rows && a.y + a.rows > b.y;
  }

  function isPositionFree(cards, candidate, ignoredCard = null) {
    return !array(cards).some((card) => card !== ignoredCard && overlaps(card, candidate));
  }

  function findOpenPosition(cards, size, preferred = {}, ignoredCard = null) {
    const spec = SIZE_SPECS[size];
    if (!spec) return { x: 1, y: 1 };
    const maximumX = 12 - spec.columns + 1;
    const startX = Math.min(maximumX, Math.max(1, Math.floor(Number(preferred.x) || 1)));
    const startY = Math.max(1, Math.floor(Number(preferred.y) || 1));
    for (let y = startY; y < startY + 100; y += 1) {
      const xOrder = [];
      for (let x = startX; x <= maximumX; x += 1) xOrder.push(x);
      for (let x = 1; x < startX; x += 1) xOrder.push(x);
      for (const x of xOrder) {
        if (isPositionFree(cards, { cardId: preferred.cardId, size, x, y }, ignoredCard)) return { x, y };
      }
    }
    return { x: 1, y: startY + 100 };
  }

  function gridRows(cards, minimum = 6) {
    return Math.max(Number(minimum) || 1, ...array(cards).map((card) => {
      const rect = cardRect(card);
      return rect ? rect.y + rect.rows - 1 : 1;
    }));
  }

  function pointToGridPosition({ pointerX, pointerY, gridLeft, gridTop, gridWidth, columnGap = 0, rowGap = 0, rowHeight = 210, offsetX = 0, offsetY = 0, size }) {
    const spec = SIZE_SPECS[size];
    if (!spec) return { x: 1, y: 1 };
    const columnPitch = (Number(gridWidth) + Number(columnGap)) / 12;
    const rowPitch = Number(rowHeight) + Number(rowGap);
    const maximumX = 12 - spec.columns + 1;
    const x = Math.min(maximumX, Math.max(1, Math.round((Number(pointerX) - Number(gridLeft) - Number(offsetX)) / columnPitch) + 1));
    const y = Math.max(1, Math.round((Number(pointerY) - Number(gridTop) - Number(offsetY)) / rowPitch) + 1);
    return { x, y };
  }

  function normalizeCard(card, definitions, placedCards) {
    const definition = definitions.get(String(card?.cardId || ""));
    if (!definition) return null;
    const allowedSizes = array(definition.allowedSizes).filter((size) => SIZE_SPECS[size]);
    if (!allowedSizes.length) return null;
    const size = allowedSizes.includes(card?.size) ? card.size : allowedSizes.includes(definition.defaultSize) ? definition.defaultSize : allowedSizes[0];
    const rect = cardRect({ ...card, size });
    const requested = { cardId: definition.id, size, x: rect.x, y: rect.y };
    const position = Number.isFinite(Number(card?.x)) && Number.isFinite(Number(card?.y)) && isPositionFree(placedCards, requested)
      ? { x: rect.x, y: rect.y }
      : findOpenPosition(placedCards, size, requested);
    return { cardId: definition.id, size, ...position };
  }

  function normalizeCustomPage(page, definitions, usedPageIds) {
    const id = String(page?.id || "");
    if (!id.startsWith("custom-") || usedPageIds.has(id)) return null;
    usedPageIds.add(id);
    const cards = [];
    array(page.cards).forEach((card) => {
      const normalized = normalizeCard(card, definitions, cards);
      if (normalized) cards.push(normalized);
    });
    return {
      id,
      name: text(page.name, "マイページ", 24),
      icon: text(page.icon, "◇", 16),
      cards
    };
  }

  function normalizePreferences(storedPreferences, cardDefinitions) {
    const definitions = catalogMap(cardDefinitions);
    const preferences = storedPreferences && typeof storedPreferences === "object" ? storedPreferences : {};
    const usedPageIds = new Set(BUILTIN_PAGES.map((page) => page.id));
    const customPages = array(preferences.customPages)
      .map((page) => normalizeCustomPage(page, definitions, usedPageIds))
      .filter(Boolean);
    const allIds = [...BUILTIN_PAGES.map((page) => page.id), ...customPages.map((page) => page.id)];
    const availableIds = new Set(allIds);
    const seenOrder = new Set();
    const pageOrder = array(preferences.pageOrder)
      .map(String)
      .filter((id) => availableIds.has(id) && !seenOrder.has(id) && seenOrder.add(id));
    allIds.forEach((id) => { if (!seenOrder.has(id)) pageOrder.push(id); });
    const lastPageId = availableIds.has(String(preferences.lastPageId || ""))
      ? String(preferences.lastPageId)
      : pageOrder[0] || "home";
    const startPageId = availableIds.has(String(preferences.startPageId || ""))
      ? String(preferences.startPageId)
      : availableIds.has("home") ? "home" : pageOrder[0];
    return {
      ...preferences,
      layoutSchemaVersion: LAYOUT_SCHEMA_VERSION,
      customPages,
      pageOrder,
      lastPageId,
      startPageId
    };
  }

  function reorder(items, movedId, targetId, idOf = (item) => item) {
    const source = [...array(items)];
    const from = source.findIndex((item) => String(idOf(item)) === String(movedId));
    const to = source.findIndex((item) => String(idOf(item)) === String(targetId));
    if (from < 0 || to < 0 || from === to) return source;
    const [moved] = source.splice(from, 1);
    source.splice(to, 0, moved);
    return source;
  }

  function createPageId(existingIds, now = Date.now(), random = Math.random()) {
    const used = new Set(array(existingIds).map(String));
    const seed = `${Number(now).toString(36)}${Math.floor(Number(random) * 0x100000).toString(36)}`;
    let candidate = `custom-${seed}`;
    let suffix = 2;
    while (used.has(candidate)) candidate = `custom-${seed}-${suffix++}`;
    return candidate;
  }

  const api = Object.freeze({
    BUILTIN_PAGES,
    LAYOUT_SCHEMA_VERSION,
    SIZE_SPECS,
    createPageId,
    cardRect,
    findOpenPosition,
    gridRows,
    isPositionFree,
    normalizePreferences,
    overlaps,
    pointToGridPosition,
    reorder
  });

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  globalThis.StudylogDashboardLayout = api;
})();
