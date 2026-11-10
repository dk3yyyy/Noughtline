import React, { useMemo, useState } from 'react';
import { Coins, Gem, Plus, ShieldCheck, ShoppingBag } from 'lucide-react';
import { formatNumber, formatCoins } from '../format';
import {Chip, Empty, Loading} from '../ui.jsx';

const RARITY_ORDER = ['common', 'rare', 'epic', 'legendary', 'god'];

export default function ShopScreen({
  user,
  inventory,
  shopItems,
  gemPackages,
  loading,
  onSelectItem,
  onEquip,
  onBuyGems,
  paymentsEnabled,
}) {
  const [rarity, setRarity] = useState('all');
  const ownedIds = useMemo(() => new Set((inventory || []).map((item) => Number(item.id))), [inventory]);
  const equippedId = Number(user?.active_avatar_id);

  const items = useMemo(() => {
    const list = Array.isArray(shopItems) ? shopItems : [];
    const filtered = rarity === 'all' ? list : list.filter((item) => item.rarity === rarity);
    return [...filtered].sort((a, b) => Number(ownedIds.has(Number(b.id))) - Number(ownedIds.has(Number(a.id))) || Number(a.id) - Number(b.id));
  }, [shopItems, rarity, ownedIds]);

  const raritiesPresent = useMemo(() => {
    const present = new Set((shopItems || []).map((item) => item.rarity));
    const known = RARITY_ORDER.filter((value) => present.has(value));
    const extra = [...present].filter((value) => value && !RARITY_ORDER.includes(value));
    return ['all', ...known, ...extra];
  }, [shopItems]);

  return (
    <div className="screen shop-screen">
      <header className="screen-head">
        <div>
          <h1>Shop</h1>
          <p className="screen-sub">Avatars are cosmetic. Every price and purchase is checked on the server.</p>
        </div>
        <div className="balance-strip" aria-label="Your balances">
          <span className="balance balance-coins num"><Coins size={15} aria-hidden="true" />{formatCoins(user?.coins || 0)}</span>
          <button type="button" className="balance balance-gems num" onClick={onBuyGems} aria-label={`Buy gems. Current balance ${user?.gems || 0}`}>
            <Gem size={15} aria-hidden="true" />
            {formatNumber(user?.gems || 0)}
            <span className="balance-add" aria-hidden="true"><Plus size={11} /></span>
          </button>
        </div>
      </header>

      <section className="panel shop-panel" aria-labelledby="avatars-title">
        <div className="panel-head shop-head">
          <div>
            <h2 id="avatars-title" className="panel-title">Avatars</h2>
            <p className="panel-sub">
              {items.length} avatar{items.length === 1 ? '' : 's'} · {ownedIds.size} owned
            </p>
          </div>
          <div className="filter-row" role="group" aria-label="Filter by rarity">
            {raritiesPresent.map((value) => (
              <button
                key={value}
                type="button"
                className={`filter-chip${rarity === value ? ' is-active' : ''}`}
                aria-pressed={rarity === value}
                onClick={() => setRarity(value)}
              >
                {value === 'all' ? 'All' : value}
              </button>
            ))}
          </div>
        </div>

        {loading && items.length === 0 ? (
          <Loading label="Loading the shop…" />
        ) : items.length === 0 ? (
          <Empty title="Nothing in this rarity">Choose another filter.</Empty>
        ) : (
          <ul className="shop-grid">
            {items.map((item) => {
              const owned = ownedIds.has(Number(item.id));
              const equipped = equippedId === Number(item.id);
              const isCoins = item.currency === 'coins';
              const price = isCoins ? item.cost_coins : item.cost_gems;
              return (
                <li key={item.id} className={`shop-card${owned ? ' is-owned' : ''}${equipped ? ' is-equipped' : ''}`}>
                  <div className="shop-art">
                    <img src={item.url} alt="" loading="lazy" />
                    <span className={`rarity rarity-${item.rarity}`}>{item.rarity}</span>
                  </div>
                  <div className="shop-card-body">
                    <h3 className="shop-name">{item.name}</h3>
                    {owned ? (
                      <p className="shop-owned">Owned</p>
                    ) : (
                      <p className="shop-price num">
                        {isCoins ? <Coins size={14} aria-hidden="true" /> : <Gem size={14} aria-hidden="true" />}
                        {formatNumber(price)}
                        <span className="shop-currency">{isCoins ? 'coins' : 'gems'}</span>
                      </p>
                    )}
                    {equipped ? (
                      <button type="button" className="btn btn-ghost btn-sm" disabled>Equipped</button>
                    ) : owned ? (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => onEquip(item.id)}>Equip</button>
                    ) : (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => onSelectItem(item)}>Buy</button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="panel gems-panel" aria-labelledby="gems-title">
        <div className="panel-head">
          <div>
            <h2 id="gems-title" className="panel-title">Gems</h2>
            <p className="panel-sub">Premium currency for the rarest avatars. Server-verified before anything is credited.</p>
          </div>
          <ShieldCheck size={18} className="panel-icon" aria-hidden="true" />
        </div>

        {!Array.isArray(gemPackages) || gemPackages.length === 0 ? (
          <Empty title="Gem packages are unavailable">
            Paid currency stays closed until the payment keys are configured on the server.
          </Empty>
        ) : (
          <ul className="gem-list">
            {gemPackages.map((pkg) => (
              <li key={pkg.id} className="gem-pack">
                <span className="gem-pack-amount num"><Gem size={18} aria-hidden="true" />{formatNumber(pkg.gems)}</span>
                <span className="gem-pack-label">gems</span>
                <span className="gem-pack-price num">₦{Number(pkg.amountNgn || 0).toLocaleString('en-US')}</span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => onBuyGems(pkg.id)}
                  disabled={!paymentsEnabled}
                >
                  Buy
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="panel-note">
          <ShoppingBag size={14} aria-hidden="true" />
          {paymentsEnabled
            ? 'Checkout opens in Paystack. Gems appear after the server verifies the reference, webhook and amount.'
            : 'Payments are not configured in this environment. Nothing can be charged.'}
        </p>
        {Array.isArray(gemPackages) && gemPackages.length > 0 && (
          <div className="gems-cta">
            <Chip tone="accent">Balance {formatNumber(user?.gems || 0)} gems</Chip>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onBuyGems()}>See all packages</button>
          </div>
        )}
      </section>
    </div>
  );
}
