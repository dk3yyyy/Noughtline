import React, { useState } from 'react';
import {
  AlertTriangle, Check, Coins, Copy, Gem, LogOut, Share2, ShieldCheck, Swords, Trash2,
  Volume2, VolumeX, Zap,
} from 'lucide-react';
import { Dialog, Segmented } from './ui.jsx';
import { formatNumber } from './format';
import { createInviteUrl } from './services/rooms';

export const ShopItemDialog = ({ item, user, onClose, onBuy, onCannotAfford, busy }) => {
  const [buying, setBuying] = useState(false);
  if (!item) return null;
  const currency = item.currency === 'coins' ? 'coins' : 'gems';
  const cost = currency === 'coins' ? Number(item.cost_coins) : Number(item.cost_gems);
  const balance = Number(user?.[currency]) || 0;
  const canAfford = balance >= cost;

  const buy = async () => {
    if (buying) return;
    if (!canAfford) { onCannotAfford?.(item); return; }
    setBuying(true);
    try { await onBuy(item.id); } finally { setBuying(false); }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={item.name || 'Avatar'}
      description={`${item.rarity || 'cosmetic'} avatar`}
      size="sm"
      busy={buying || busy}
      footer={(
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={buying}>Close</button>
          <button type="button" className={`btn ${canAfford ? 'btn-primary' : 'btn-ghost'}`} onClick={buy} disabled={buying} data-autofocus>
            {buying ? 'Unlocking…' : canAfford ? `Unlock for ${formatNumber(cost)} ${currency}` : `Need ${formatNumber(cost - balance)} more ${currency}`}
          </button>
        </>
      )}
    >
      <div className="item-preview">
        <img src={item.url} alt="" />
      </div>
      <p className="dialog-copy">{item.description || 'A cosmetic avatar for your collection. Purely a look — it never changes a match.'}</p>
      <div className="item-facts">
        <div className="kv"><span>Price</span><span className="num">{currency === 'coins' ? <Coins size={14} aria-hidden="true" /> : <Gem size={14} aria-hidden="true" />}{formatNumber(cost)} {currency}</span></div>
        <div className="kv"><span>Your balance</span><span className="num">{formatNumber(balance)} {currency}</span></div>
      </div>
    </Dialog>
  );
};

export const BuyGemsDialog = ({ open, packages, onClose, onBuy, paymentsEnabled }) => {
  const [buyingId, setBuyingId] = useState(null);
  const buy = async (id) => {
    if (buyingId) return;
    setBuyingId(id);
    try { await onBuy(id); } finally { setBuyingId(null); }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Buy gems"
      description="Prices and amounts are defined by the server and verified before a single gem is credited."
      size="md"
      footer={<button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>}
    >
      {!paymentsEnabled && (
        <p className="dialog-notice"><ShieldCheck size={15} aria-hidden="true" /> Payments are not configured in this environment. Nothing can be charged.</p>
      )}
      {!Array.isArray(packages) || packages.length === 0 ? (
        <p className="dialog-copy">No gem packages are available right now.</p>
      ) : (
        <ul className="gem-dialog-list">
          {packages.map((pkg) => (
            <li key={pkg.id} className="gem-dialog-row">
              <span className="gem-dialog-amount num"><Gem size={16} aria-hidden="true" />{formatNumber(pkg.gems)}</span>
              <span className="gem-dialog-price num">₦{Number(pkg.amountNgn || 0).toLocaleString('en-US')}</span>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => buy(pkg.id)} disabled={!paymentsEnabled || Boolean(buyingId)}>
                {buyingId === pkg.id ? 'Opening…' : 'Buy'}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="dialog-note">Payment opens Paystack in this tab. On return, the server verifies the reference, currency and amount exactly once.</p>
    </Dialog>
  );
};

export const GameCreatedDialog = ({ roomId, onClose, onStart }) => {
  const [status, setStatus] = useState('');
  if (!roomId) return null;
  const inviteUrl = createInviteUrl(roomId, window.location.origin);

  const copy = async (value, next) => {
    try {
      await navigator.clipboard.writeText(value);
      setStatus(next);
    } catch {
      setStatus('error');
    }
  };

  const share = async () => {
    if (!navigator.share) return copy(inviteUrl, 'link');
    try {
      await navigator.share({ title: 'Join my Noughtline match', text: `Join my Noughtline room ${roomId}`, url: inviteUrl });
      setStatus('shared');
    } catch (error) {
      if (error.name !== 'AbortError') setStatus('error');
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Room ready"
      description="Send the invite, then take your seat. The board opens as soon as your opponent joins."
      size="md"
      footer={(
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Not now</button>
          <button type="button" className="btn btn-primary" onClick={onStart} data-autofocus>Enter waiting room</button>
        </>
      )}
    >
      <div className="invite-block">
        <span className="field-label">Room code</span>
        <strong className="invite-code">{roomId}</strong>
        <span className="invite-link">{inviteUrl}</span>
      </div>
      <div className="invite-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => copy(inviteUrl, 'link')}>
          {status === 'link' ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
          {status === 'link' ? 'Link copied' : 'Copy link'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => copy(roomId, 'code')}>
          {status === 'code' ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
          {status === 'code' ? 'Code copied' : 'Copy code'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={share}>
          <Share2 size={15} aria-hidden="true" /> Share
        </button>
      </div>
      <p className="dialog-note" role="status" aria-live="polite">
        {status === 'shared' && 'Invite shared.'}
        {status === 'error' && 'Could not share automatically. Copy the room code instead.'}
      </p>
    </Dialog>
  );
};

export const FallbackDialog = ({ onPlayAI, onClose }) => (
  <Dialog
    open
    onClose={onClose}
    title="No opponent found"
    description="Nobody joined the queue in time. Play a medium 3 × 3 practice game instead?"
    size="sm"
    footer={(
      <>
        <button type="button" className="btn btn-ghost" onClick={onClose} data-autofocus>Back</button>
        <button type="button" className="btn btn-primary" onClick={onPlayAI}><Zap size={16} aria-hidden="true" /> Play vs AI</button>
      </>
    )}
  />
);

export const LeaveRoomDialog = ({ gameStatus, hasOpponent, pending, onCancel, onConfirm }) => {
  const waiting = gameStatus === 'waiting' && !hasOpponent;
  return (
    <Dialog
      open
      onClose={onCancel}
      title={waiting ? 'Leave this waiting room?' : 'Forfeit this series?'}
      description={waiting
        ? 'The room closes and the invite link stops working. Nothing is recorded.'
        : 'Your opponent wins the series immediately. This cannot be undone.'}
      size="sm"
      tone="danger"
      busy={pending}
      footer={(
        <>
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={pending} data-autofocus>
            {waiting ? 'Stay in room' : 'Stay in match'}
          </button>
          <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={pending}>
            <LogOut size={15} aria-hidden="true" />
            {pending ? 'Leaving…' : waiting ? 'Leave room' : 'Forfeit series'}
          </button>
        </>
      )}
    >
      {!waiting && <p className="dialog-note"><AlertTriangle size={15} aria-hidden="true" /> No XP, coins or rating change is awarded for a forfeit.</p>}
    </Dialog>
  );
};

export const ConfirmDialog = ({ title, description, confirmLabel, pendingLabel = 'Working…', busy, onCancel, onConfirm, tone = 'danger', children }) => (
  <Dialog
    open
    onClose={onCancel}
    title={title}
    description={description}
    size="sm"
    tone={tone}
    busy={busy}
    footer={(
      <>
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy} data-autofocus>Cancel</button>
        <button type="button" className={`btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} disabled={busy}>
          {busy ? pendingLabel : confirmLabel}
        </button>
      </>
    )}
  >
    {children}
  </Dialog>
);

export const ActiveRoomDialog = ({ roomId, pending, onResume, onLeave, onCopy, onClose }) => (
  <Dialog
    open
    onClose={onClose}
    title="You already have a match"
    description="A player can hold one room at a time. Resume it, or leave it and start something else."
    size="sm"
    busy={pending}
    footer={(
      <>
        <button type="button" className="btn btn-danger-ghost" onClick={onLeave} disabled={pending}>Leave that room</button>
        <button type="button" className="btn btn-primary" onClick={onResume} disabled={pending} data-autofocus>
          <Swords size={15} aria-hidden="true" />
          {pending ? 'Resuming…' : 'Resume match'}
        </button>
      </>
    )}
  >
    <div className="invite-block">
      <span className="field-label">Active room</span>
      <strong className="invite-code">{roomId}</strong>
    </div>
    <button type="button" className="btn btn-ghost btn-sm" onClick={onCopy}><Copy size={15} aria-hidden="true" /> Copy invite</button>
    <p className="dialog-note">Leaving forfeits an in-progress series and pays nothing.</p>
  </Dialog>
);

export const SettingsDialog = ({
  open, config, setConfig, onClose, onExport, onDelete, onLogout,
}) => (
  <Dialog
    open={open}
    onClose={onClose}
    title="Settings"
    description="Preferences are stored on this device. Account actions apply to this server account."
    size="md"
    footer={<button type="button" className="btn btn-primary" onClick={onClose}>Done</button>}
  >
    <div className="setting-block">
      <div className="setting-row">
        <div>
          <span className="setting-label">Theme</span>
          <span className="setting-note">System follows your device&rsquo;s light or dark setting.</span>
        </div>
        <Segmented
          label="Theme"
          value={config.theme}
          onChange={(value) => setConfig((previous) => ({ ...previous, theme: value }))}
          options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]}
        />
      </div>
      <div className="setting-row">
        <div>
          <span className="setting-label">Sound effects</span>
          <span className="setting-note">Move, win and loss cues. Off by default on silent devices.</span>
        </div>
        <button
          type="button"
          className={`toggle${config.sound ? ' is-on' : ''}`}
          role="switch"
          aria-checked={Boolean(config.sound)}
          onClick={() => setConfig((previous) => ({ ...previous, sound: !previous.sound }))}
        >
          <span className="toggle-knob">
            {config.sound ? <Volume2 size={13} aria-hidden="true" /> : <VolumeX size={13} aria-hidden="true" />}
          </span>
          <span className="toggle-label">{config.sound ? 'On' : 'Off'}</span>
        </button>
      </div>
    </div>

    <div className="setting-block">
      <h3 className="setting-heading">Data &amp; account</h3>
      <div className="setting-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onExport}>Export my data</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onLogout}><LogOut size={15} aria-hidden="true" /> Log out (new guest)</button>
        <button type="button" className="btn btn-danger-ghost btn-sm" onClick={onDelete}><Trash2 size={15} aria-hidden="true" /> Delete account</button>
      </div>
      <p className="dialog-note">
        Logging out abandons this guest account. Coins, rating and unlocks cannot be recovered without a linked Google account.
      </p>
    </div>
  </Dialog>
);
