const crypto = require('crypto');

const GEM_PACKAGES = Object.freeze([
  { id: 'gems_120', gems: 120, amountNgn: 1000 },
  { id: 'gems_250', gems: 250, amountNgn: 2000 },
  { id: 'gems_800', gems: 800, amountNgn: 5000 },
  { id: 'gems_1500', gems: 1500, amountNgn: 10000 },
]);

function packageById(id) {
  return GEM_PACKAGES.find((item) => item.id === id);
}

function createEconomy({ db, config, fetchImpl = global.fetch }) {
  const changeBalance = db.transaction(({ userId, currency, amount, reason, reference, metadata = {} }) => {
    if (!['coins', 'gems'].includes(currency) || !Number.isSafeInteger(amount) || amount === 0) {
      throw new Error('Invalid ledger entry');
    }
    const user = db.prepare(`SELECT id, ${currency} AS balance FROM users WHERE id = ?`).get(userId);
    if (!user) throw new Error('User not found');
    const nextBalance = user.balance + amount;
    if (nextBalance < 0) throw new Error(`Insufficient ${currency}`);

    db.prepare(`UPDATE users SET ${currency} = ? WHERE id = ?`).run(nextBalance, userId);
    db.prepare(`
      INSERT INTO currency_ledger (id, user_id, currency, amount, balance_after, reason, reference, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), userId, currency, amount, nextBalance, reason, reference, JSON.stringify(metadata));
    return nextBalance;
  });

  function buyAvatar(userId, avatarId) {
    if (!Number.isSafeInteger(avatarId) || avatarId <= 0) throw new Error('Invalid avatar');
    return db.transaction(() => {
      const avatar = db.prepare('SELECT * FROM avatars WHERE id = ?').get(avatarId);
      if (!avatar) throw new Error('Avatar not found');
      const owned = db.prepare('SELECT 1 FROM user_avatars WHERE user_id = ? AND avatar_id = ?').get(userId, avatarId);
      if (owned) throw new Error('Avatar already owned');
      const currency = avatar.currency === 'coins' ? 'coins' : 'gems';
      const cost = currency === 'coins' ? avatar.cost_coins : avatar.cost_gems;
      if (cost > 0) {
        changeBalance({
          userId,
          currency,
          amount: -cost,
          reason: 'avatar_purchase',
          reference: `avatar:${avatarId}`,
          metadata: { avatarId },
        });
      }
      db.prepare('INSERT INTO user_avatars (user_id, avatar_id) VALUES (?, ?)').run(userId, avatarId);
      return { avatarId, currency, cost };
    })();
  }

  async function initializePayment(user, packageId) {
    if (!config.paystackSecretKey) throw Object.assign(new Error('Payments are not configured'), { status: 503 });
    if (!user.email) throw Object.assign(new Error('Add a verified email before purchasing gems'), { status: 400 });
    const selected = packageById(packageId);
    if (!selected) throw Object.assign(new Error('Invalid gem package'), { status: 400 });

    const localReference = `TT_${crypto.randomUUID()}`;
    const response = await fetchImpl('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.paystackSecretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: user.email,
        amount: selected.amountNgn * 100,
        reference: localReference,
        callback_url: `${config.publicAppUrl}/?payment=complete`,
        metadata: { packageId: selected.id, userId: user.id },
      }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.status || !payload.data?.reference) {
      throw Object.assign(new Error('Payment provider initialization failed'), { status: 502 });
    }

    db.prepare(`
      INSERT INTO payment_intents (reference, user_id, package_id, amount_ngn, gems, provider_payload)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(payload.data.reference, user.id, selected.id, selected.amountNgn, selected.gems, JSON.stringify(payload.data));
    return { reference: payload.data.reference, authorizationUrl: payload.data.authorization_url };
  }

  async function verifyAndCreditPayment(reference) {
    if (!config.paystackSecretKey) throw Object.assign(new Error('Payments are not configured'), { status: 503 });
    const intent = db.prepare('SELECT * FROM payment_intents WHERE reference = ?').get(reference);
    if (!intent) throw Object.assign(new Error('Unknown payment reference'), { status: 404 });
    if (intent.status === 'credited') return { alreadyCredited: true };

    const response = await fetchImpl(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${config.paystackSecretKey}` },
    });
    const payload = await response.json();
    const data = payload.data;
    const valid = response.ok && payload.status && data?.status === 'success'
      && data.reference === reference
      && data.amount === intent.amount_ngn * 100
      && data.currency === 'NGN';
    if (!valid) {
      db.prepare("UPDATE payment_intents SET status = 'failed', provider_payload = ? WHERE reference = ?")
        .run(JSON.stringify(data || payload), reference);
      throw Object.assign(new Error('Payment could not be verified'), { status: 400 });
    }

    return db.transaction(() => {
      const current = db.prepare('SELECT status FROM payment_intents WHERE reference = ?').get(reference);
      if (current.status === 'credited') return { alreadyCredited: true };
      const balance = changeBalance({
        userId: intent.user_id,
        currency: 'gems',
        amount: intent.gems,
        reason: 'paystack_purchase',
        reference: `payment:${reference}`,
        metadata: { packageId: intent.package_id },
      });
      db.prepare("UPDATE payment_intents SET status = 'credited', credited_at = CURRENT_TIMESTAMP, provider_payload = ? WHERE reference = ?")
        .run(JSON.stringify(data), reference);
      return { gemsAdded: intent.gems, balance };
    })();
  }

  return { changeBalance, buyAvatar, initializePayment, verifyAndCreditPayment };
}

module.exports = { GEM_PACKAGES, createEconomy };
