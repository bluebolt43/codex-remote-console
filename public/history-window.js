export const HISTORY_BUFFER_SIZE = 36;
export const HISTORY_VIEW_SIZE = 24;
export const HISTORY_MARGIN_SIZE = 6;
export const HISTORY_PREFETCH_THRESHOLD = 3;

export function historyTriggerIndexes(length) {
  return {
    upper: Math.min(HISTORY_PREFETCH_THRESHOLD, length - 1),
    lower: Math.max(0, length - HISTORY_PREFETCH_THRESHOLD - 1),
  };
}

export class HistoryWindow {
  constructor({ maxItems = HISTORY_BUFFER_SIZE, step = HISTORY_MARGIN_SIZE } = {}) {
    this.maxItems = maxItems;
    this.step = step;
    this.items = [];
    this.start = 0;
    this.end = 0;
  }

  reset(items) {
    this.items = [...items];
    this.end = this.items.length;
    this.start = Math.max(0, this.end - this.maxItems);
  }

  prepend(items) {
    const known = new Set(this.items.map((item) => item.key));
    const older = items.filter((item) => !known.has(item.key));
    this.items.unshift(...older);
    this.start = Math.max(0, older.length - this.step);
    this.end = Math.min(this.items.length, this.start + this.maxItems);
  }

  moveOlder() {
    if (this.start === 0) return false;
    this.start = Math.max(0, this.start - this.step);
    this.end = Math.min(this.items.length, this.start + this.maxItems);
    return true;
  }

  moveNewer() {
    if (this.end === this.items.length) return false;
    this.end = Math.min(this.items.length, this.end + this.step);
    this.start = Math.max(0, this.end - this.maxItems);
    return true;
  }

  visibleItems() {
    return this.items.slice(this.start, this.end);
  }
}
