// Server-authoritative daily rewards and daily quests.
//
// Quest progress is recorded by the series-settlement hook (see
// server/app.js settleSeries) ONLY for reward-eligible multiplayer series that
// were played to completion — forfeits and private rooms never progress
// quests. Every payout flows through economy.changeBalance, so all credits are
// atomic ledger entries with unique references (`daily:<day>:<currency>`,
// `quest:<questId>:<day>:<currency>`) and the users balance can never be
// double-minted. Days are UTC calendar days ('YYYY-MM-DD') everywhere.

const DAILY_REWARD = Object.freeze({ coins: 50, gems: 10 });

// kind: 'play' quests progress on any played outcome; 'win' quests progress
// only when the player won the series; 'draw' quests progress only when the
// series ended in a draw (a win never satisfies a draw quest).
const QUEST_CATALOG = Object.freeze([
  { id: 'play_1', description: 'Play a multiplayer series', kind: 'play', target: 1, reward: { currency: 'coins', amount: 40 } },
  { id: 'play_3', description: 'Play 3 multiplayer series', kind: 'play', target: 3, reward: { currency: 'coins', amount: 75 } },
  { id: 'play_5', description: 'Play 5 multiplayer series', kind: 'play', target: 5, reward: { currency: 'gems', amount: 10 } },
  { id: 'win_1', description: 'Win 1 multiplayer series', kind: 'win', target: 1, reward: { currency: 'coins', amount: 50 } },
  { id: 'win_3', description: 'Win 3 multiplayer series', kind: 'win', target: 3, reward: { currency: 'coins', amount: 150 } },
  { id: 'win_5', description: 'Win 5 multiplayer series', kind: 'win', target: 5, reward: { currency: 'gems', amount: 20 } },
  { id: 'draw_1', description: 'Draw a multiplayer series', kind: 'draw', target: 1, reward: { currency: 'coins', amount: 30 } },
]);

function questById(id) {
  return QUEST_CATALOG.find((quest) => quest.id === id);
}

// Pure: 'YYYY-MM-DD' for the UTC calendar day containing `date`.
function utcDayString(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function createQuestService({ db, economy, now = () => Date.now() }) {
  const today = () => utcDayString(new Date(now()));

  const bumpProgress = db.prepare(`
    INSERT INTO quest_progress (user_id, quest_id, day, progress, claimed)
    VALUES (?, ?, ?, 1, 0)
    ON CONFLICT(user_id, quest_id, day) DO UPDATE SET progress = progress + 1
  `);

  // Runs inside the settlement transaction from app.js (better-sqlite3 nests
  // this transaction as a savepoint) and is also safe to call standalone.
  const recordSettledSeries = db.transaction(({ userId, outcome, day }) => {
    if (!['won', 'lost', 'draw'].includes(outcome)) {
      throw new Error(`Invalid series outcome: ${outcome}`);
    }
    if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      throw new Error('Invalid quest day');
    }
    // Base set: 'play' quests progress on every played outcome. Wins add the
    // 'win' quests and draws add the 'draw' quests — a win never progresses a
    // draw quest.
    const progressed = QUEST_CATALOG.filter((quest) => {
      if (quest.kind === 'play') return true;
      if (quest.kind === 'win') return outcome === 'won';
      if (quest.kind === 'draw') return outcome === 'draw';
      return false;
    });
    for (const quest of progressed) bumpProgress.run(userId, quest.id, day);
  });

  function getDailyState(user) {
    const day = today();
    const row = db.prepare('SELECT last_daily_reward_date FROM users WHERE id = ?').get(user.id);
    return { day, dailyRewardClaimed: row?.last_daily_reward_date === day };
  }

  function getQuestsForUser(user, day) {
    const rows = db.prepare('SELECT quest_id, progress, claimed FROM quest_progress WHERE user_id = ? AND day = ?')
      .all(user.id, day);
    const byId = new Map(rows.map((row) => [row.quest_id, row]));
    return QUEST_CATALOG.map((quest) => {
      const row = byId.get(quest.id);
      return {
        id: quest.id,
        description: quest.description,
        kind: quest.kind,
        target: quest.target,
        reward: quest.reward,
        progress: row ? row.progress : 0,
        claimed: row ? row.claimed === 1 : false,
      };
    });
  }

  function claimDailyReward(user) {
    const day = today();
    return db.transaction(() => {
      const row = db.prepare('SELECT last_daily_reward_date FROM users WHERE id = ?').get(user.id);
      if (row?.last_daily_reward_date === day) {
        throw Object.assign(new Error('Daily reward already claimed for today'), { code: 'DAILY_REWARD_CLAIMED', status: 409 });
      }
      economy.changeBalance({
        userId: user.id,
        currency: 'coins',
        amount: DAILY_REWARD.coins,
        reason: 'daily_reward',
        reference: `daily:${day}:coins`,
        metadata: { day },
      });
      economy.changeBalance({
        userId: user.id,
        currency: 'gems',
        amount: DAILY_REWARD.gems,
        reason: 'daily_reward',
        reference: `daily:${day}:gems`,
        metadata: { day },
      });
      db.prepare('UPDATE users SET last_daily_reward_date = ? WHERE id = ?').run(day, user.id);
      return { day, granted: { coins: DAILY_REWARD.coins, gems: DAILY_REWARD.gems } };
    })();
  }

  function claimQuest(user, questId) {
    const quest = typeof questId === 'string' ? questById(questId) : undefined;
    if (!quest) {
      throw Object.assign(new Error('Unknown quest'), { code: 'UNKNOWN_QUEST', status: 404 });
    }
    const day = today();
    return db.transaction(() => {
      const row = db.prepare('SELECT progress, claimed FROM quest_progress WHERE user_id = ? AND quest_id = ? AND day = ?')
        .get(user.id, quest.id, day);
      if (!row || row.progress < quest.target) {
        throw Object.assign(new Error('Quest not completed yet'), { code: 'QUEST_INCOMPLETE', status: 409 });
      }
      if (row.claimed === 1) {
        throw Object.assign(new Error('Quest reward already claimed'), { code: 'QUEST_ALREADY_CLAIMED', status: 409 });
      }
      economy.changeBalance({
        userId: user.id,
        currency: quest.reward.currency,
        amount: quest.reward.amount,
        reason: 'quest_reward',
        reference: `quest:${quest.id}:${day}:${quest.reward.currency}`,
        metadata: { questId: quest.id, day },
      });
      db.prepare('UPDATE quest_progress SET claimed = 1 WHERE user_id = ? AND quest_id = ? AND day = ?')
        .run(user.id, quest.id, day);
      return { questId: quest.id, reward: { ...quest.reward } };
    })();
  }

  return {
    utcDayString,
    currentDay: today,
    recordSettledSeries,
    getDailyState,
    getQuestsForUser,
    claimDailyReward,
    claimQuest,
  };
}

module.exports = { DAILY_REWARD, QUEST_CATALOG, questById, utcDayString, createQuestService };
