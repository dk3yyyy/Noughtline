class Matchmaker {
    constructor() {
        this.queue = []; // Array of { socketId, username, uuid, timestamp }
    }

    addToQueue(player) {
        // Avoid duplicates
        if (this.queue.find(p => p.uuid === player.uuid)) return;

        this.queue.push({
            ...player,
            timestamp: Date.now()
        });
        console.log(`Player ${player.username} added to matchmaker queue. Queue size: ${this.queue.length}`);
    }

    removeFromQueue(socketId) {
        this.queue = this.queue.filter(p => p.socketId !== socketId);
    }

    findMatch() {
        if (this.queue.length >= 2) {
            const player1 = this.queue.shift();
            const player2 = this.queue.shift();
            return { player1, player2 };
        }
        return null;
    }

    getQueuePlayers() {
        return this.queue;
    }
}

module.exports = new Matchmaker();
