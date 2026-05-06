class RoomManager {
    constructor() {
        this.rooms = new Map(); // roomId -> { players: [], state: {}, spectators: [] }
    }

    createRoom(roomId, config = { size: 3, rounds: 3 }) {
        if (this.rooms.has(roomId)) return false;
        const size = config.size || 3;
        this.rooms.set(roomId, {
            id: roomId,
            config: { size, rounds: config.rounds || 3 },
            players: [], // { id, socketId, symbol, username }
            spectators: [],
            state: {
                board: Array(size * size).fill(null),
                isXNext: true,
                winner: null,
                winningLine: []
            }
        });
        return true;
    }

    joinRoom(roomId, player) {
        const room = this.rooms.get(roomId);
        if (!room) return { error: 'Room not found' };

        // Check if player is already in room
        const existingPlayer = room.players.find(p => p.socketId === player.socketId);
        if (existingPlayer) {
            return { success: true, room, player: existingPlayer };
        }

        if (room.players.length >= 2) {
            return { error: 'Room full' };
        }

        const symbol = room.players.length === 0 ? 'X' : 'O';
        const newPlayer = { ...player, symbol };
        room.players.push(newPlayer);

        return { success: true, room, player: newPlayer };
    }

    getRoom(roomId) {
        return this.rooms.get(roomId);
    }

    makeMove(roomId, index, playerId) {
        const room = this.rooms.get(roomId);
        if (!room) return null;

        const { board, isXNext, winner } = room.state;
        const { size } = room.config;
        const player = room.players.find(p => p.id === playerId);

        // Basic validation
        if (winner || board[index] || !player) return null;
        if ((isXNext && player.symbol !== 'X') || (!isXNext && player.symbol !== 'O')) return null;

        // Update board
        const newBoard = [...board];
        newBoard[index] = player.symbol;

        // Check winner
        const result = this.calculateWinner(newBoard, size);

        room.state = {
            board: newBoard,
            isXNext: !isXNext,
            winner: result ? result.winner : null,
            winningLine: result ? result.line : []
        };

        return room;
    }

    leaveRoom(socketId) {
        for (const [roomId, room] of this.rooms.entries()) {
            const pIndex = room.players.findIndex(p => p.socketId === socketId);
            if (pIndex !== -1) {
                room.players.splice(pIndex, 1);
                // Reset game if a player leaves to avoid stuck state
                const { size } = room.config;
                room.state = {
                    board: Array(size * size).fill(null),
                    isXNext: true,
                    winner: null,
                    winningLine: []
                };
                return { roomId, room };
            }
        }
        return null;
    }

    calculateWinner(squares, size) {
        const lines = [];
        // Rows
        for (let i = 0; i < size; i++) {
            const row = [];
            for (let j = 0; j < size; j++) row.push(i * size + j);
            lines.push(row);
        }
        // Columns
        for (let i = 0; i < size; i++) {
            const col = [];
            for (let j = 0; j < size; j++) col.push(i + j * size);
            lines.push(col);
        }
        // Diagonals
        const diag1 = [];
        const diag2 = [];
        for (let i = 0; i < size; i++) {
            diag1.push(i * size + i);
            diag2.push(i * size + (size - 1 - i));
        }
        lines.push(diag1, diag2);

        for (const line of lines) {
            const first = squares[line[0]];
            if (first && line.every(index => squares[index] === first)) {
                return { winner: first, line: line };
            }
        }

        if (squares.every(s => s !== null)) return { winner: 'Draw', line: [] };
        return null;
    }
}

module.exports = new RoomManager();
