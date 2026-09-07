// Pure helpers for the Paystack payment-completion loop (server GET
// /api/economy/payments/pending + POST /api/economy/payments/:reference/verify).
// Kept free of React/DOM so they can be unit-tested with node:test (see
// test/payments.test.js).
//
// The buy-gems flow redirects the browser to Paystack and never hears back:
// initializePayment sets callback_url to `${PUBLIC_APP_URL}/?payment=complete`
// (server/economy.js), so the app recognizes the return by that query
// parameter and resumes the interrupted purchase at boot.

// True when the current location query announces a return from the Paystack
// checkout (the callback_url set at payment initialization).
export function parsePaymentComplete(locationSearch) {
  if (typeof locationSearch !== 'string') return false;
  return new URLSearchParams(locationSearch).get('payment') === 'complete';
}

// What the boot-time payment resumption should do after the provider return:
// 'verifying'  -> a Paystack return AND the server reported a pending intent;
//                 verify it (idempotent server-side) and refresh the balance.
// 'noPending'  -> a Paystack return but nothing to verify for this account
//                 (already webhook-credited, or a guest that never paid);
//                 surface a gentle notice instead of a silent no-op.
// 'none'       -> not a Paystack return at all; do nothing.
export function providerReturnState(locationSearch, hasPending) {
  if (!parsePaymentComplete(locationSearch)) return 'none';
  return hasPending ? 'verifying' : 'noPending';
}
