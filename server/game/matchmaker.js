class Matchmaker {
  constructor({ now = () => Date.now() } = {}) {
    this.queue = [];
    this.now = now;
  }

  addToQueue(player, queueType = player.queueType || 'ranked') {
    if (!Number.isSafeInteger(player.userId)) return false;
    if (!['ranked', 'casual'].includes(queueType)) return false;
    if (this.queue.some((entry) => entry.userId === player.userId)) return false;
    this.queue.push({ ...player, queueType, timestamp: this.now() });
    return true;
  }

  removeFromQueue(socketId) {
    this.queue = this.queue.filter((player) => player.socketId !== socketId);
  }

  removeUser(userId) {
    this.queue = this.queue.filter((player) => player.userId !== userId);
  }

  findMatch(isEligible = () => true) {
    this.queue = this.queue.filter(isEligible);
    let bestPair = null;
    let bestRatingGap = Infinity;
    for (let first = 0; first < this.queue.length; first += 1) {
      for (let second = first + 1; second < this.queue.length; second += 1) {
        const player1 = this.queue[first];
        const player2 = this.queue[second];
        if (player1.queueType !== player2.queueType) continue;
        if (player1.socketId === player2.socketId || player1.userId === player2.userId) continue;
        if (player1.queueType === 'casual') {
          this.queue = this.queue.filter((_, index) => index !== first && index !== second);
          return { player1, player2 };
        }
        const rating1 = Number.isFinite(player1.rating) ? player1.rating : 1000;
        const rating2 = Number.isFinite(player2.rating) ? player2.rating : 1000;
        const ratingGap = Math.abs(rating1 - rating2);
        if (ratingGap < bestRatingGap) {
          bestRatingGap = ratingGap;
          bestPair = [first, second];
        }
      }
    }
    if (!bestPair) return null;
    const [first, second] = bestPair;
    const [player1, player2] = [this.queue[first], this.queue[second]];
    this.queue = this.queue.filter((_, index) => index !== first && index !== second);
    return { player1, player2 };
  }

  expiredPlayers(timeoutMs) {
    const cutoff = this.now() - timeoutMs;
    const expired = this.queue.filter((player) => player.timestamp < cutoff);
    const expiredIds = new Set(expired.map((player) => player.socketId));
    this.queue = this.queue.filter((player) => !expiredIds.has(player.socketId));
    return expired;
  }
}

module.exports = { Matchmaker };
