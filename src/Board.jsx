import React from 'react';
import { Mark } from './ui.jsx';

/* The winning line is the product's name made visible: one stroke drawn
 * through the three (or four/five) cells that won, in the accent colour. */
const lineGeometry = (winningLine, size) => {
  if (!Array.isArray(winningLine) || winningLine.length < 3 || !size) return null;
  const first = winningLine[0];
  const last = winningLine[winningLine.length - 1];
  const col = (index) => index % size;
  const row = (index) => Math.floor(index / size);
  const startCol = col(first);
  const endCol = col(last);
  const sameRow = row(first) === row(last);
  const sameCol = startCol === endCol;

  if (sameRow) {
    return {
      x1: (startCol + 0.16) / size, x2: (endCol + 0.84) / size,
      y1: (row(first) + 0.5) / size, y2: (row(first) + 0.5) / size,
    };
  }
  if (sameCol) {
    return {
      x1: (startCol + 0.5) / size, x2: (startCol + 0.5) / size,
      y1: (row(first) + 0.16) / size, y2: (row(last) + 0.84) / size,
    };
  }
  return {
    x1: (startCol + 0.16) / size, x2: (endCol + 0.84) / size,
    y1: (row(first) + 0.16) / size, y2: (row(last) + 0.84) / size,
  };
};

const Board = ({ board, size, winningLine = [], onPlay, disabled = false, locked = false }) => {
  const line = lineGeometry(winningLine, size);
  const side = Math.round(1000 / size) / 1000;
  return (
    <div
      className={`board board-${size}${locked ? ' is-locked' : ''}`}
      style={{ '--board-size': size, '--cell-pct': `${side * 100}%` }}
      role="grid"
      aria-label={`${size} by ${size} board`}
      aria-disabled={disabled || undefined}
    >
      {board.map((square, index) => {
        const row = Math.floor(index / size) + 1;
        const column = (index % size) + 1;
        const winning = winningLine.includes(index);
        return (
          <button
            key={index}
            type="button"
            role="gridcell"
            className={`board-cell${square ? ' is-filled' : ''}${winning ? ' is-winning' : ''}`}
            onClick={() => onPlay?.(index)}
            disabled={disabled || Boolean(square)}
            aria-label={`Row ${row}, column ${column}${square ? `, ${square === 'X' ? 'cross' : 'nought'}` : ', empty'}`}
            aria-selected={Boolean(square)}
          >
            {square && <Mark symbol={square} strokeWidth={size >= 5 ? 11 : 9} />}
          </button>
        );
      })}
      {line && (
        <svg className="board-line" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <line
            x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      )}
    </div>
  );
};

export default Board;
