import React from 'react';
import {
  Coins, Gem, Home, Plus, Settings, ShoppingBag, Swords, Trophy, User,
} from 'lucide-react';
import { formatNumber, formatCoins } from './format';
import {Avatar, Brand} from './ui.jsx';

const NAV = [
  { id: 'home', view: 'HOME', label: 'Home', icon: Home },
  { id: 'ranks', view: 'LEADERBOARD', label: 'Ranks', icon: Trophy },
  { id: 'play', view: 'BATTLE', label: 'Play', icon: Swords },
  { id: 'profile', view: 'PROFILE', label: 'Profile', icon: User },
  { id: 'shop', view: 'SHOP', label: 'Shop', icon: ShoppingBag },
];

const viewToNav = (view) => {
  if (view === 'LEADERBOARD') return 'ranks';
  if (view === 'BATTLE' || view === 'AI_CONFIG' || view === 'TOURNAMENTS') return 'play';
  if (view === 'PROFILE') return 'profile';
  if (view === 'SHOP') return 'shop';
  return 'home';
};

export const Sidebar = ({ view, onNavigate, user, connected, onOpenSettings }) => {
  const active = viewToNav(view);
  return (
    <aside className="sidebar" aria-label="Main navigation">
      <button type="button" className="brand-button" onClick={() => onNavigate('home')} aria-label="Noughtline home">
        <Brand />
        <span className="brand-scope">Arena</span>
      </button>

      <nav className="nav" aria-label="Sections">
        {NAV.map((item) => {
          const Icon = item.icon;
          const isActive = active === item.id;
          return (
            <button
              key={item.id}
              type="button"
              className={`nav-item${isActive ? ' is-active' : ''}`}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => onNavigate(item.id)}
            >
              <Icon size={17} aria-hidden="true" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="sidebar-foot">
        <button type="button" className="nav-account" onClick={onOpenSettings}>
          <Avatar src={user?.avatar} name={user?.username} size={30} />
          <span className="nav-account-copy">
            <span className="nav-account-name">{user?.username || 'Guest'}</span>
            <span className="nav-account-meta">Level {user?.level || 1}</span>
          </span>
          <Settings size={15} aria-hidden="true" />
        </button>
        <p className={`connection${connected ? ' is-live' : ' is-offline'}`}>
          <span className="connection-dot" aria-hidden="true" />
          {connected ? 'Realtime live' : connected === false ? 'Reconnecting…' : 'Connecting…'}
        </p>
      </div>
    </aside>
  );
};

export const TopBar = ({ user, connected, onBuyGems, onOpenSettings, onNavigate }) => (
  <header className="topbar">
    <div className="topbar-left">
      <span className="topbar-scope">Noughtline arena</span>
      <span className={`connection connection-inline${connected ? ' is-live' : ' is-offline'}`}>
        <span className="connection-dot" aria-hidden="true" />
        {connected ? 'Live' : connected === false ? 'Offline' : 'Connecting'}
      </span>
    </div>

    <div className="topbar-right">
      <span className="topbar-chip num" aria-label={`Win streak ${user?.streak || 0}`}>
        <span className="topbar-chip-label">Streak</span>
        {formatNumber(user?.streak || 0)}
      </span>
      <span className="topbar-chip num" aria-label={`Level ${user?.level || 1}, ${user?.xp || 0} experience`}>
        <span className="topbar-chip-label">Lv</span>
        {formatNumber(user?.level || 1)}
      </span>
      <span className="topbar-chip topbar-coins num" aria-label={`${user?.coins || 0} coins`}>
        <Coins size={14} aria-hidden="true" />
        {formatCoins(user?.coins || 0)}
      </span>
      <button type="button" className="topbar-chip topbar-gems num" onClick={onBuyGems} aria-label={`Buy gems. Current balance ${user?.gems || 0}`}>
        <Gem size={14} aria-hidden="true" />
        {formatNumber(user?.gems || 0)}
        <span className="topbar-plus" aria-hidden="true"><Plus size={10} /></span>
      </button>
      <button type="button" className="topbar-avatar" onClick={() => onNavigate('profile')} aria-label="Open your profile">
        <Avatar src={user?.avatar} name={user?.username} size={30} />
      </button>
      <button type="button" className="icon-btn topbar-settings" onClick={onOpenSettings} aria-label="Open settings">
        <Settings size={17} />
      </button>
    </div>
  </header>
);

export const BottomNav = ({ view, onNavigate }) => {
  const active = viewToNav(view);
  return (
    <nav className="bottomnav" aria-label="Main navigation">
      {NAV.map((item) => {
        const Icon = item.icon;
        const isActive = active === item.id;
        return (
          <button
            key={item.id}
            type="button"
            className={`bottomnav-item${isActive ? ' is-active' : ''}`}
            aria-current={isActive ? 'page' : undefined}
            onClick={() => onNavigate(item.id)}
          >
            <Icon size={20} aria-hidden="true" />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
};
