// Weekend boost events (E-1): a deterministic, preset-driven events calendar
// plus 2x coin rewards on daily rewards and quest claims during UTC weekends.
// Claim ledger references are unchanged, so idempotency survives the boost.

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createDatabase } = require('../database');
const { createEconomy } = require('../economy');
const { createRuntime } = require('../app');
const { createEventService } = require('../events');
const { createQuestService } = require('../quests');

function config() {
  return {
    nodeEnv: 'test',
    jwtSecret: 'test-secret-at-least-local',
    jwtExpiresIn: '1h',
    databasePath: ':memory:',
    corsOrigins: ['http://localhost'],
    paystackSecretKey: '',
    publicAppUrl: 'http://localhost',
  };
}

// Fixed noon clocks so each timestamp sits firmly inside its UTC calendar day.
const WEDNESDAY_UTC = Date.parse('2026-09-09T12:00:00Z'); // getUTCDay() === 3
const SATURDAY_UTC = Date.parse('2026-09-12T12:00:00Z'); // getUTCDay() === 6
const SUNDAY_UTC = Date.parse('2026-09-13T12:00:00Z'); // getUTCDay() === 0
const SATURDAY = '2026-09-12';
const WEDNESDAY = '2026-09-09';

const WEEKEND_X2_EVENT = {
  slug: 'weekend_x2',
  name: 'Weekend Boost',
  description: 'Double coins from daily rewards and quests on weekends',
  multiplier: 2,
  currency: 'coins',
  active: true,
};

test('no event is active on a UTC weekday and the coin multiplier stays 1', () => {
  const events = createEventService({ now: () => WEDNESDAY_UTC });
  assert.deepEqual(events.active(), []);
  assert.equal(events.coinMultiplier(), 1);
});

test('weekend_x2 is active on Saturday UTC and doubles coins', () => {
  const events = createEventService({ now: () => SATURDAY_UTC });
  assert.deepEqual(events.active(), [WEEKEND_X2_EVENT]);
  assert.equal(events.coinMultiplier(), 2);
});

test('weekend_x2 is active on Sunday UTC and doubles coins', () => {
  const events = createEventService({ now: () => SUNDAY_UTC });
  assert.deepEqual(events.active(), [WEEKEND_X2_EVENT]);
  assert.equal(events.coinMultiplier(), 2);
});

test('coinMultiplier composes overlapping coin presets and ignores non-coin presets', () => {
  const presets = [
    { slug: 'weekend_x2', name: 'Weekend Boost', description: '', multiplier: 2, currency: 'coins', activeDays: [6, 0] },
    { slug: 'weekday_x1_5', name: 'Weekday Bonus', description: '', multiplier: 1.5, currency: 'coins', activeDays: [3] },
    { slug: 'gems_weekend', name: 'Gem Weekend', description: '', multiplier: 3, currency: 'gems', activeDays: [6, 0] },
  ];
  const saturday = createEventService({ presets, now: () => SATURDAY_UTC });
  // weekend_x2 (x2) is active and gems_weekend (x3) must not change coin math.
  assert.deepEqual(saturday.active().map((event) => event.slug), ['weekend_x2', 'gems_weekend']);
  assert.equal(saturday.coinMultiplier(), 2);
  const wednesday = createEventService({ presets, now: () => WEDNESDAY_UTC });
  assert.deepEqual(wednesday.active().map((event) => event.slug), ['weekday_x1_5']);
  assert.equal(wednesday.coinMultiplier(), 1.5);
});

async function guest(runtime) {
  const response = await request(runtime.app).post('/api/auth/guest').send({});
  assert.equal(response.status, 201);
  return response.body;
}

test('GET /api/events/active is public and lists weekend_x2 during a weekend', async (t) => {
  const eventsService = createEventService({ now: () => SUNDAY_UTC });
  const runtime = createRuntime({ config: config(), database: createDatabase(':memory:'), startTimers: false, eventsService });
  t.after(() => runtime.db.close());
  assert.equal(runtime.eventsService, eventsService);
  // No Authorization header: the endpoint is deliberately public.
  const response = await request(runtime.app).get('/api/events/active');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { events: [WEEKEND_X2_EVENT] });
});

test('GET /api/events/active lists no events on a weekday', async (t) => {
  const eventsService = createEventService({ now: () => WEDNESDAY_UTC });
  const runtime = createRuntime({ config: config(), database: createDatabase(':memory:'), startTimers: false, eventsService });
  t.after(() => runtime.db.close());
  const response = await request(runtime.app).get('/api/events/active');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { events: [] });
});

// Mirrors the quests.test.js composition pattern: an events service frozen on a
// boost day feeds its coin multiplier into a quest service frozen on the same
// day, and both are injected into a runtime that serves the claim endpoints.
function createBoostedRuntime(clockMs) {
  const eventsService = createEventService({ now: () => clockMs });
  const db = createDatabase(':memory:');
  const economy = createEconomy({ db, config: { paystackSecretKey: '', publicAppUrl: 'http://localhost' } });
  const questService = createQuestService({
    db,
    economy,
    now: () => clockMs,
    coinMultiplier: () => eventsService.coinMultiplier(),
  });
  const runtime = createRuntime({ config: config(), database: db, startTimers: false, questService });
  return { runtime, questService };
}

function ledgerRow(runtime, reference) {
  return runtime.db.prepare('SELECT currency, amount, reason, reference FROM currency_ledger WHERE reference = ?').get(reference);
}

test('Saturday boost doubles daily reward coins and coin quests; gems never boosted; references and idempotency unchanged', async (t) => {
  const { runtime, questService } = createBoostedRuntime(SATURDAY_UTC);
  t.after(() => runtime.db.close());
  const session = await guest(runtime);

  // Five completed wins reach play_5 and win_1 without minting any coins
  // (progress recording only — no settlement payout).
  for (let i = 0; i < 5; i += 1) {
    questService.recordSettledSeries({ userId: session.user.id, outcome: 'won', day: SATURDAY });
  }

  // Daily claim: coins doubled 50 -> 100; gems stay 10 (never boosted).
  const daily = await request(runtime.app).post('/api/quests/daily-claim').set('Authorization', `Bearer ${session.token}`);
  assert.equal(daily.status, 200);
  assert.deepEqual(daily.body, { day: SATURDAY, granted: { coins: 100, gems: 10 } });
  assert.deepEqual(
    runtime.db.prepare('SELECT coins, gems FROM users WHERE id = ?').get(session.user.id),
    { coins: 100, gems: 110 },
  );

  // win_1 (a 50-coin quest) pays 100 on the boost.
  const winClaim = await request(runtime.app).post('/api/quests/win_1/claim').set('Authorization', `Bearer ${session.token}`);
  assert.equal(winClaim.status, 200);
  assert.deepEqual(winClaim.body, { questId: 'win_1', reward: { currency: 'coins', amount: 100 } });
  assert.equal(runtime.db.prepare('SELECT coins FROM users WHERE id = ?').get(session.user.id).coins, 200);

  // play_5 is a GEM quest: 10 gems, untouched by the coin-only boost.
  const gemClaim = await request(runtime.app).post('/api/quests/play_5/claim').set('Authorization', `Bearer ${session.token}`);
  assert.equal(gemClaim.status, 200);
  assert.deepEqual(gemClaim.body, { questId: 'play_5', reward: { currency: 'gems', amount: 10 } });
  assert.equal(runtime.db.prepare('SELECT gems FROM users WHERE id = ?').get(session.user.id).gems, 120);

  // Exact ledger references are unchanged: daily:<day>:<currency>,
  // quest:<questId>:<day>:<currency>.
  assert.deepEqual(ledgerRow(runtime, `daily:${SATURDAY}:coins`), { currency: 'coins', amount: 100, reason: 'daily_reward', reference: `daily:${SATURDAY}:coins` });
  assert.deepEqual(ledgerRow(runtime, `daily:${SATURDAY}:gems`), { currency: 'gems', amount: 10, reason: 'daily_reward', reference: `daily:${SATURDAY}:gems` });
  assert.deepEqual(ledgerRow(runtime, `quest:win_1:${SATURDAY}:coins`), { currency: 'coins', amount: 100, reason: 'quest_reward', reference: `quest:win_1:${SATURDAY}:coins` });
  assert.deepEqual(ledgerRow(runtime, `quest:play_5:${SATURDAY}:gems`), { currency: 'gems', amount: 10, reason: 'quest_reward', reference: `quest:play_5:${SATURDAY}:gems` });
  assert.equal(runtime.db.prepare('SELECT COUNT(*) AS count FROM currency_ledger').get().count, 4);

  // Retries are still rejected with the same codes and never double-credit.
  const dailyAgain = await request(runtime.app).post('/api/quests/daily-claim').set('Authorization', `Bearer ${session.token}`);
  assert.equal(dailyAgain.status, 409);
  assert.equal(dailyAgain.body.code, 'DAILY_REWARD_CLAIMED');
  const winAgain = await request(runtime.app).post('/api/quests/win_1/claim').set('Authorization', `Bearer ${session.token}`);
  assert.equal(winAgain.status, 409);
  assert.equal(winAgain.body.code, 'QUEST_ALREADY_CLAIMED');
  assert.deepEqual(
    runtime.db.prepare('SELECT coins, gems FROM users WHERE id = ?').get(session.user.id),
    { coins: 200, gems: 120 },
  );
  assert.equal(runtime.db.prepare('SELECT COUNT(*) AS count FROM currency_ledger').get().count, 4);
});

test('claims outside the boost window (weekday clock) credit base amounts', async (t) => {
  const { runtime, questService } = createBoostedRuntime(WEDNESDAY_UTC);
  t.after(() => runtime.db.close());
  const session = await guest(runtime);
  questService.recordSettledSeries({ userId: session.user.id, outcome: 'won', day: WEDNESDAY });

  const daily = await request(runtime.app).post('/api/quests/daily-claim').set('Authorization', `Bearer ${session.token}`);
  assert.equal(daily.status, 200);
  assert.deepEqual(daily.body, { day: WEDNESDAY, granted: { coins: 50, gems: 10 } });

  const win = await request(runtime.app).post('/api/quests/win_1/claim').set('Authorization', `Bearer ${session.token}`);
  assert.equal(win.status, 200);
  assert.deepEqual(win.body, { questId: 'win_1', reward: { currency: 'coins', amount: 50 } });
  assert.deepEqual(
    runtime.db.prepare('SELECT coins, gems FROM users WHERE id = ?').get(session.user.id),
    { coins: 100, gems: 110 },
  );
});

test('createRuntime wires an injected events service into internally-built quest rewards', async (t) => {
  // Exercises the production composition path (eventsService -> questService
  // created inside createRuntime) without injecting a questService. The events
  // clock is frozen on a Saturday, so credited amounts are deterministic no
  // matter which real-world day the suite runs on.
  const eventsService = createEventService({ now: () => SATURDAY_UTC });
  const runtime = createRuntime({ config: config(), database: createDatabase(':memory:'), startTimers: false, eventsService });
  t.after(() => runtime.db.close());
  const session = await guest(runtime);

  const daily = await request(runtime.app).post('/api/quests/daily-claim').set('Authorization', `Bearer ${session.token}`);
  assert.equal(daily.status, 200);
  assert.deepEqual(daily.body.granted, { coins: 100, gems: 10 });
  assert.deepEqual(
    runtime.db.prepare('SELECT coins, gems FROM users WHERE id = ?').get(session.user.id),
    { coins: 100, gems: 110 },
  );
  assert.equal(runtime.db.prepare("SELECT COUNT(*) AS count FROM currency_ledger WHERE reference LIKE 'daily:%:coins'").get().count, 1);
  assert.equal(runtime.db.prepare("SELECT amount FROM currency_ledger WHERE reference LIKE 'daily:%:coins'").get().amount, 100);

  const duplicate = await request(runtime.app).post('/api/quests/daily-claim').set('Authorization', `Bearer ${session.token}`);
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.code, 'DAILY_REWARD_CLAIMED');
});
