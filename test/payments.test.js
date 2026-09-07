import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePaymentComplete, providerReturnState } from '../src/services/payments.js';

// Pure helpers for the Paystack payment-completion loop (server GET
// /api/economy/payments/pending + POST /api/economy/payments/:reference/verify).
// The Paystack callback_url is `${PUBLIC_APP_URL}/?payment=complete`, so the
// app detects the return by that query parameter on boot.

test('parsePaymentComplete recognizes the Paystack callback query', () => {
  assert.equal(parsePaymentComplete('?payment=complete'), true);
  assert.equal(parsePaymentComplete('?payment=complete&utm=return'), true);
  assert.equal(parsePaymentComplete('?ref=abc&payment=complete'), true);
});

test('parsePaymentComplete is false when there is no callback query', () => {
  assert.equal(parsePaymentComplete(''), false);
  assert.equal(parsePaymentComplete('?'), false);
  assert.equal(parsePaymentComplete('?payment=incomplete'), false);
  assert.equal(parsePaymentComplete('?complete=payment'), false);
  assert.equal(parsePaymentComplete('?payment=completeX'), false);
  assert.equal(parsePaymentComplete('?next=/play'), false);
});

test('parsePaymentComplete tolerates missing or malformed search input', () => {
  assert.equal(parsePaymentComplete(null), false);
  assert.equal(parsePaymentComplete(undefined), false);
  assert.equal(parsePaymentComplete(42), false);
});

test('providerReturnState asks for verification only on a return with a pending intent', () => {
  assert.equal(providerReturnState('?payment=complete', true), 'verifying');
  assert.equal(providerReturnState('?payment=complete&ref=abc', true), 'verifying');
});

test('providerReturnState distinguishes a return with nothing pending', () => {
  // Back from Paystack but no intent to verify (already webhook-credited, or
  // a fresh guest that never purchased): surface a gentle notice.
  assert.equal(providerReturnState('?payment=complete', false), 'noPending');
  assert.equal(providerReturnState('?payment=complete', undefined), 'noPending');
});

test('providerReturnState is none outside a Paystack return', () => {
  assert.equal(providerReturnState('', true), 'none');
  assert.equal(providerReturnState('?payment=completeX', true), 'none');
  assert.equal(providerReturnState(null, true), 'none');
});
