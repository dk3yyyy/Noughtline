class Matchmaker {
  constructor() {
    this.queue = [];
  }

  addToQueue(player) {
    if (!Number.isSafeInteger(player.userId)) return false;
    if (this.queue.some((entry) => entry.userId === player.userId)) return false;
    this.queue.push({ ...player, timestamp: Date.now() });
    return true;
  }

  removeFromQueue(socketId) {
    this.queue = this.queue.filter((player) => player.socketId !== socketId);
  }

  findMatch() {
    while (this.queue.length >= 2) {
      const player1 = this.queue.shift();
      const player2 = this.queue.shift();
      if (player1.socketId !== player2.socketId && player1.userId !== player2.userId) return { player1, player2 };
    }
    return null;
  }

  expiredPlayers(timeoutMs) {
    const cutoff = Date.now() - timeoutMs;
    const expired = this.queue.filter((player) => player.timestamp < cutoff);
    const expiredIds = new Set(expired.map((player) => player.socketId));
    this.queue = this.queue.filter((player) => !expiredIds.has(player.socketId));
    return expired;
  }
}

module.exports = { Matchmaker };
