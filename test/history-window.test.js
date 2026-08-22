import assert from "node:assert/strict";
import test from "node:test";

import {
  HISTORY_BUFFER_SIZE,
  HISTORY_MARGIN_SIZE,
  HISTORY_PREFETCH_THRESHOLD,
  HISTORY_VIEW_SIZE,
  HistoryWindow,
  historyTriggerIndexes,
} from "../public/history-window.js";

const items = (start, count) => Array.from({ length: count }, (_, index) => ({ key: `item-${start + index}` }));

test("history keeps a 36-message buffer and shifts it 6 messages at a time", () => {
  const history = new HistoryWindow({ maxItems: 36, step: 6 });
  history.reset(items(64, 36));
  history.prepend(items(52, 12));

  assert.equal(history.visibleItems().length, 36);
  assert.equal(history.visibleItems()[0].key, "item-58");
  assert.equal(history.visibleItems().at(-1).key, "item-93");

  assert.equal(history.moveNewer(), true);
  assert.equal(history.visibleItems()[0].key, "item-64");
  assert.equal(history.visibleItems().at(-1).key, "item-99");
  assert.equal(history.visibleItems().length, 36);
  assert.equal(history.moveOlder(), true);
  assert.equal(history.visibleItems()[0].key, "item-58");
});

test("36-message buffer surrounds the 24-message view and preloads at 3 messages", () => {
  assert.equal(HISTORY_BUFFER_SIZE, HISTORY_VIEW_SIZE + (2 * HISTORY_MARGIN_SIZE));
  assert.equal(HISTORY_PREFETCH_THRESHOLD, 3);
  assert.deepEqual(historyTriggerIndexes(36), { upper: 3, lower: 32 });
});
