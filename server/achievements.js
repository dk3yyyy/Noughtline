// Server-authoritative lifetime achievements.
//
// Achievements are one-time rewards unlocked by lifetime account milestones
// (wins, best streak, level, purchases) rather than by a single day's play.
// There is intentionally NO progress table: eligibility is recomputed at claim
// time from the user's stats row (and, for purchase achievements, the credited
// payment_intents) so the reward can never be claimed before its condition is
// genuinely met. Once claimed, the user_achievements row is the source of
// truth and the immutable ledger entry (`achievement:<id>`) guarantees the
// currency can never be minted twice.

const ACHIEVEMENT_CATALOG = Object.freeze([
  { id: 'first_win', title: 'First Blood', description: 'Win your first multiplayer series', check: 'wins', target: 1, reward: { currency: 'coins', amount: 100 } },
  { id: 'wins_10', title: 'Double Digits', description: 'Win 10 multiplayer series', check: 'wins', target: 10, reward: { currency: 'coins', amount: 250 } },
  { id: 'streak_5', title: 'On Fire', description: 'Reach a 5-win streak', check: 'max_streak', target: 5, reward: { currency: 'gems', amount: 15 } },
  { id: 'level_5', title: 'Seasoned', description: 'Reach level 5', check: 'level', target: 5, reward: { currency: 'gems', amount: 10 } },
  { id: 'level_10', title: 'Veteran', description: 'Reach level 10', check: 'level', target: 10, reward: { currency: 'gems', amount: 30 } },
  { id: 'first_purchase', title: 'Investor', description: 'Buy your first gem package', check: 'payments', target: 1, reward: { currency: 'coins', amount: 50 } },
]);

function achievementById(id) {
  return ACHIEVEMENT_CATALOG.find((achievement) => achievement.id === id);
}

function createAchievementService({ db, economy }) {
  // 'payments' achievements read the credited intent count instead of a column.
  const creditedPayments = db.prepare("SELECT COUNT(*) AS count FROM payment_intents WHERE user_id = ? AND status = 'credited'");
  // The check field names a users column except for 'payments'; building the
  // SELECT from the frozen catalog is safe because the column list is closed.
  const columnValue = (userId, column) => db.prepare(`SELECT ${column} AS value FROM users WHERE id = ?`).get(userId)?.value ?? 0;

  function currentValue(userId, achievement) {
    if (achievement.check === 'payments') return creditedPayments.get(userId).count;
    return columnValue(userId, achievement.check);
  }

  function achievementStateFor(user) {
    const claimed = new Set(
      db.prepare('SELECT achievement_id FROM user_achievements WHERE user_id = ?').all(user.id)
        .map((row) => row.achievement_id),
    );
    return ACHIEVEMENT_CATALOG.map((achievement) => ({
      id: achievement.id,
      title: achievement.title,
      description: achievement.description,
      reward: { ...achievement.reward },
      claimed: claimed.has(achievement.id),
      eligible: !claimed.has(achievement.id) && currentValue(user.id, achievement) >= achievement.target,
    }));
  }

  function claimAchievement(user, achievementId) {
    const achievement = typeof achievementId === 'string' ? achievementById(achievementId) : undefined;
    if (!achievement) {
      throw Object.assign(new Error('Unknown achievement'), { code: 'UNKNOWN_ACHIEVEMENT', status: 404 });
    }
    return db.transaction(() => {
      const claimed = db.prepare('SELECT 1 FROM user_achievements WHERE user_id = ? AND achievement_id = ?')
        .get(user.id, achievement.id);
      if (claimed) {
        throw Object.assign(new Error('Achievement reward already claimed'), { code: 'ACHIEVEMENT_ALREADY_CLAIMED', status: 409 });
      }
      if (currentValue(user.id, achievement) < achievement.target) {
        throw Object.assign(new Error('Achievement not unlocked yet'), { code: 'ACHIEVEMENT_INCOMPLETE', status: 409 });
      }
      // user_achievements is the one-time gate; the ledger UNIQUE(user_id,
      // reference) on `achievement:<id>` is the belt-and-suspenders guard.
      db.prepare('INSERT INTO user_achievements (user_id, achievement_id) VALUES (?, ?)').run(user.id, achievement.id);
      economy.changeBalance({
        userId: user.id,
        currency: achievement.reward.currency,
        amount: achievement.reward.amount,
        reason: 'achievement_reward',
        reference: `achievement:${achievement.id}`,
        metadata: { achievementId: achievement.id },
      });
      return { achievementId: achievement.id, reward: { ...achievement.reward } };
    })();
  }

  return { achievementStateFor, claimAchievement };
}

module.exports = { ACHIEVEMENT_CATALOG, achievementById, createAchievementService };
