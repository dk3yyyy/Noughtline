import React, { useEffect, useState } from 'react';
import Board from '../Board.jsx';
import { Avatar, Brand, Chip, Mark } from '../ui.jsx';
import {
  Check, ChevronLeft, Copy, RotateCcw, Swords, Trophy, Users,
} from 'lucide-react';

const PlayerCard = ({ name, avatar, symbol, active, disconnected, isYou, finished }) => (
  <div className={`game-player${active ? ' is-active' : ''}${disconnected ? ' is-disconnected' : ''}`}>
    <Avatar src={avatar} name={name} size={44} />
    <div className="game-player-copy">
      <span className="game-player-name">
        {name}
        {isYou && <em>You</em>}
      </span>
      <span className="game-player-state">
        {disconnected ? 'Disconnected' : finished ? 'Round over' : active ? 'To move' : 'Waiting'}
      </span>
    </div>
    <span className={`game-player-mark mark-${String(symbol).toLowerCase()}`} aria-label={`Plays ${symbol === 'X' ? 'crosses' : 'noughts'}`}>
      <Mark symbol={symbol} strokeWidth={12} />
    </span>
  </div>
);

export default function GameScreen({
  user,
  gameConfig,
  board,
  winningLine,
  onPlay,
  isXNext,
  mySymbol,
  gameStatus,
  round,
  score,
  roomPlayers,
  disconnectSeconds,
  completionReason,
  actionError,
  resultWinner,
  ratingChip,
  opponentDisconnected,
  onBack,
  onReadyNextRound,
  onRematch,
  onReturnHome,
  onReset,
  onCopyInvite,
  copied,
  chatSlot,
}) {
  const [rematchSent, setRematchSent] = useState(false);
  useEffect(() => { setRematchSent(false); }, [gameStatus]);

  const requestRematch = () => {
    if (rematchSent) return;
    setRematchSent(true);
    onRematch?.();
  };

  const size = Number(gameConfig?.size) || 3;
  const multiplayer = gameConfig?.mode === 'multiplayer';
  const opponent = roomPlayers?.find((player) => player.id !== user?.id);
  const opponentName = multiplayer ? (gameConfig?.opponentName || opponent?.username || 'Waiting for opponent') : `${String(gameConfig?.difficulty || 'easy')} AI`;
  const opponentAvatar = multiplayer ? (gameConfig?.opponentAvatar || opponent?.avatar) : `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent('AI-' + (gameConfig?.difficulty || 'easy'))}`;
  const myTurn = multiplayer ? gameStatus === 'active' && isXNext === (mySymbol === 'X') : gameStatus === 'active' && isXNext;
  const opponentTurn = multiplayer ? gameStatus === 'active' && isXNext === (mySymbol === 'O') : gameStatus === 'active' && !isXNext;
  const opponentSymbol = mySymbol === 'X' ? 'O' : 'X';
  const rounds = Number(gameConfig?.rounds) || 3;
  const roundCells = Array.from({ length: rounds }, (_, index) => index + 1);
  const forfeit = ['disconnect_forfeit', 'voluntary_forfeit'].includes(completionReason);
  const roomCode = String(gameConfig?.roomId || '');
  const tournamentRoom = multiplayer && roomCode.startsWith('TM_');
  const rankedRoom = multiplayer && roomCode.startsWith('MATCH_');
  const matchKind = tournamentRoom ? 'Tournament match' : rankedRoom ? 'Ranked duel' : 'Private room';
  const MatchIcon = tournamentRoom ? Trophy : rankedRoom ? Swords : Users;

  const statusText = () => {
    if (multiplayer && gameStatus === 'waiting') return 'Waiting for your opponent to join…';
    if (multiplayer && gameStatus === 'paused') {
      return opponentDisconnected
        ? `Opponent disconnected · ${disconnectSeconds > 0 ? `${disconnectSeconds}s to forfeit` : 'resolving match…'}`
        : 'Connection interrupted · reconnecting…';
    }
    if (gameStatus === 'cancelled') return 'Match cancelled — neither player returned in time.';
    if (resultWinner === 'Draw') {
      if (tournamentRoom) return 'Draw — the lower seed advances on a tie-break.';
      return multiplayer && gameStatus === 'complete' ? 'Series complete — draw.' : 'Round drawn.';
    }
    if (resultWinner) {
      if (forfeit) return resultWinner === mySymbol ? 'Opponent forfeited — you win the series.' : 'You forfeited — opponent wins the series.';
      const youWon = resultWinner === mySymbol;
      return multiplayer && gameStatus === 'complete'
        ? `Series complete — ${youWon ? 'you win.' : 'opponent wins.'}`
        : youWon ? 'You won the round.' : 'Opponent won the round.';
    }
    if (multiplayer && gameStatus === 'round_complete') return 'Round complete — ready up for the next one.';
    if (gameStatus === 'complete') return 'Series complete.';
    return myTurn ? 'Your turn.' : 'Opponent to move.';
  };

  return (
    <div className="game-screen">
      <h1 className="visually-hidden">{multiplayer ? 'Multiplayer match' : 'Practice board'}</h1>
      <header className="game-head">
        <div className="game-head-left">
          <span className="game-brand" aria-hidden="true"><Brand compact /></span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onBack} aria-label={multiplayer ? 'Leave match' : 'Leave practice'}>
            <ChevronLeft size={17} aria-hidden="true" />
            {multiplayer ? 'Leave match' : 'Leave practice'}
          </button>
        </div>

        <div className="game-head-center">
          <span className="game-mode">
            {multiplayer
              ? <><MatchIcon size={14} aria-hidden="true" /> {matchKind}</>
              : <><Swords size={14} aria-hidden="true" /> Practice</>}
          </span>
          {multiplayer ? (
            <span className="game-room">
              {gameConfig?.roomId}
              {onCopyInvite && (
                <button type="button" className="icon-btn" onClick={onCopyInvite} aria-label="Copy room invite">
                  {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                </button>
              )}
            </span>
          ) : (
            <span className="game-room">{size} × {size} · {String(gameConfig?.difficulty || 'easy')}</span>
          )}
        </div>

        <div className="game-head-right">
          {multiplayer ? (
            <span className="game-score num" aria-label={`Series score: you ${mySymbol === 'X' ? score?.X : score?.O}, opponent ${mySymbol === 'X' ? score?.O : score?.X}`}>
              <span className={mySymbol === 'X' ? 'is-you' : ''}>{mySymbol === 'X' ? score?.X : score?.O}</span>
              <span className="game-score-sep">–</span>
              <span className={mySymbol === 'O' ? 'is-you' : ''}>{mySymbol === 'X' ? score?.O : score?.X}</span>
            </span>
          ) : (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onReset}>
              <RotateCcw size={15} aria-hidden="true" />
              Reset board
            </button>
          )}
        </div>
      </header>

      <div className="game-layout">
        <div className="game-main">
          <div className="game-players">
            <PlayerCard
              name={user?.username || 'You'}
              avatar={user?.avatar}
              symbol={mySymbol}
              active={myTurn}
              isYou
              finished={Boolean(resultWinner)}
            />
            <span className="game-vs" aria-hidden="true">vs</span>
            <PlayerCard
              name={opponentName}
              avatar={opponentAvatar}
              symbol={opponentSymbol}
              active={opponentTurn}
              disconnected={opponentDisconnected}
              finished={Boolean(resultWinner)}
            />
          </div>

          {multiplayer && rounds > 1 && (
            <div className="round-strip" aria-label={`Best of ${rounds}, round ${round}`}>
              <span className="round-strip-label">Round {Math.min(round, rounds)} of {rounds}</span>
              <div className="round-cells" aria-hidden="true">
                {roundCells.map((number) => (
                  <span key={number} className={`round-cell${number < round ? ' is-done' : ''}${number === round ? ' is-current' : ''}`} />
                ))}
              </div>
            </div>
          )}

          <div className={`game-status${resultWinner ? ' is-result' : ''}${gameStatus === 'paused' ? ' is-paused' : ''}`} aria-live="polite">
            <span className="game-status-text">{statusText()}</span>
            {ratingChip && (
              <span className={`rating-chip${ratingChip.gained ? ' is-gain' : ' is-loss'}`} role="status">
                Rating {ratingChip.label}
              </span>
            )}
          </div>

          <Board
            board={board}
            size={size}
            winningLine={winningLine || []}
            onPlay={onPlay}
            disabled={gameStatus !== 'active' || Boolean(resultWinner) || (multiplayer && !myTurn)}
          />
        </div>

        <aside className="game-rail">
          {chatSlot}
          <section className="panel game-rail-panel" aria-labelledby="series-info-title">
            <div className="panel-head">
              <h2 id="series-info-title" className="panel-title">This series</h2>
            </div>
            <dl className="kv-list">
              <div className="kv"><dt>Format</dt><dd>{multiplayer ? `Best of ${rounds}` : 'Single board'}</dd></div>
              <div className="kv"><dt>Board</dt><dd className="num">{size} × {size}</dd></div>
              {multiplayer ? (
                <>
                  <div className="kv"><dt>You play</dt><dd>{mySymbol === 'X' ? 'Crosses' : 'Noughts'}</dd></div>
                  <div className="kv"><dt>Score</dt><dd className="num">{score?.X}–{score?.O}</dd></div>
                </>
              ) : (
                <div className="kv"><dt>Strength</dt><dd>{String(gameConfig?.difficulty || 'easy')}</dd></div>
              )}
            </dl>
            <p className="panel-note">
              {multiplayer
                ? 'Every move is validated by the server. A disconnect has 30 seconds before the series is forfeited.'
                : 'Practice games run in your browser and never affect rating, XP or quests.'}
            </p>
          </section>
        </aside>
      </div>

      <footer className="game-actions">
        {gameStatus === 'round_complete' && (
          <button type="button" className="btn btn-primary" onClick={onReadyNextRound}>Ready for round {Math.min(round + 1, rounds)}</button>
        )}
        {gameStatus === 'complete' && !forfeit && !tournamentRoom && (
          <button type="button" className="btn btn-primary" onClick={requestRematch} disabled={rematchSent}>
            {rematchSent ? 'Rematch requested — waiting for opponent' : 'Request rematch'}
          </button>
        )}
        {gameStatus === 'complete' && tournamentRoom && (
          <button type="button" className="btn btn-primary" onClick={onReturnHome}>Back to the bracket</button>
        )}
        {gameStatus === 'complete' && forfeit && (
          <button type="button" className="btn btn-primary" onClick={onReturnHome}>Return home</button>
        )}
        {gameStatus === 'cancelled' && (
          <button type="button" className="btn btn-primary" onClick={onReturnHome}>Return home</button>
        )}
        {!multiplayer && (gameStatus === 'active' || resultWinner) && (
          <button type="button" className="btn btn-ghost" onClick={onReset}>
            <RotateCcw size={15} aria-hidden="true" />
            {resultWinner ? 'Play another board' : 'Restart this board'}
          </button>
        )}
        {actionError && <p className="game-error" role="alert">{actionError}</p>}
      </footer>
    </div>
  );
}
