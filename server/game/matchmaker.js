class Matchmaker {
  constructor({ now = () => Date.now() } = {}) {
    this.queue = [];
    this.now = now;
  }

  addToQueue(player) {
    if (!Number.isSafeInteger(player.userId)) return false;
    if (this.queue.some((entry) => entry.userId === player.userId)) return false;
    this.queue.push({ ...player, timestamp: this.now() });
    return true;
  }

  removeFromQueue(socketId) {
    this.queue = this.queue.filter((player) => player.socketId !== socketId);
  }

  removeUser(userId) {
    this.queue = this.queue.filter((player) => player.userId !== userId);
  }

  findMatch(isEligible = () => true) {
    let player1 = null;
    while (this.queue.length > 0) {
      const candidate = this.queue.shift();
      if (!isEligible(candidate)) continue;
      if (!player1) {
        player1 = candidate;
        continue;
      }
      if (player1.socketId !== candidate.socketId && player1.userId !== candidate.userId) {
        return { player1, player2: candidate };
      }
    }
    if (player1) this.queue.unshift(player1);
    return null;
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
