const winningLinesFor = (size) => {
  const lines = [];
  for (let row = 0; row < size; row += 1) {
    lines.push(Array.from({ length: size }, (_, col) => row * size + col));
  }
  for (let col = 0; col < size; col += 1) {
    lines.push(Array.from({ length: size }, (_, row) => row * size + col));
  }
  lines.push(
    Array.from({ length: size }, (_, index) => index * size + index),
    Array.from({ length: size }, (_, index) => index * size + size - index - 1),
  );
  return lines;
};

const winnerFor = (board, lines) => {
  for (const line of lines) {
    const first = board[line[0]];
    if (first && line.every((index) => board[index] === first)) return first;
  }
  return board.every(Boolean) ? 'Draw' : null;
};

const scoreBoard = (board, lines) => {
  let score = 0;
  for (const line of lines) {
    let xCount = 0;
    let oCount = 0;
    for (const index of line) {
      if (board[index] === 'X') xCount += 1;
      if (board[index] === 'O') oCount += 1;
    }
    if (xCount && oCount) continue;
    if (oCount) score += 4 ** oCount;
    else if (xCount) score -= 4 ** xCount;
  }
  return score;
};

const search = (board, lines, depth, maximizing, alpha, beta) => {
  const winner = winnerFor(board, lines);
  if (winner === 'O') return 10_000 + depth;
  if (winner === 'X') return -10_000 - depth;
  if (winner === 'Draw') return 0;
  if (depth === 0) return scoreBoard(board, lines);

  let best = maximizing ? -Infinity : Infinity;
  const symbol = maximizing ? 'O' : 'X';
  for (let index = 0; index < board.length; index += 1) {
    if (board[index] !== null) continue;
    board[index] = symbol;
    const score = search(board, lines, depth - 1, !maximizing, alpha, beta);
    board[index] = null;
    best = maximizing ? Math.max(best, score) : Math.min(best, score);
    if (maximizing) alpha = Math.max(alpha, best);
    else beta = Math.min(beta, best);
    if (beta <= alpha) break;
  }
  return best;
};

export function chooseAIMove(board, size, difficulty = 'medium', random = Math.random) {
  const empty = board.flatMap((cell, index) => cell === null ? [index] : []);
  if (!empty.length) return undefined;
  if (difficulty === 'easy') return empty[Math.floor(random() * empty.length)];
  if (difficulty === 'medium' && random() < 0.5) {
    return empty[Math.floor(random() * empty.length)];
  }

  const lines = winningLinesFor(size);
  const depth = difficulty === 'impossible' ? (size === 3 ? empty.length : 3) : 2;
  let bestMove = empty[0];
  let bestScore = -Infinity;
  for (const index of empty) {
    board[index] = 'O';
    const score = search(board, lines, depth, false, -Infinity, Infinity);
    board[index] = null;
    if (score > bestScore) {
      bestScore = score;
      bestMove = index;
    }
  }
  return bestMove;
}
