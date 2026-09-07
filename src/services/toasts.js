/**
 * Pure helpers for the in-app toast notification stack.
 *
 * Kept free of React/DOM imports so `node --test test/*.test.js` can load it
 * directly, mirroring how the room helpers in ./rooms.js are unit-tested.
 */

/**
 * Append a toast to the stack unless an identical one (same message and tone)
 * is already visible. Deduplication stops repeated failures (e.g. rapid
 * "Failed to equip" clicks) from stacking identical notices.
 *
 * @param {Array<{id: string, message: string, tone: string}>} current
 * @param {{id: string, message: string, tone: string}} toast
 * @returns {{toasts: Array<object>, added: boolean}}
 */
export function mergeToast(current, toast) {
  const isDuplicate = current.some(
    t => t.message === toast.message && t.tone === toast.tone,
  );
  if (isDuplicate) return { toasts: current, added: false };
  return { toasts: [...current, toast], added: true };
}
