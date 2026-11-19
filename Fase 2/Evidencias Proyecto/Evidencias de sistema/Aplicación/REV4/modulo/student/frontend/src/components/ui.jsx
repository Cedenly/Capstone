import React from 'react';

const EMOJI = { bronze: '\u{1F949}', silver: '\u{1F948}', gold: '\u{1F947}', diamond: '\u{1F48E}', platinum: '⬢' };
const SIZE = { sm: 'm-sm', md: 'm-md', lg: 'm-lg' };

export function Coin({ tier, size = 'sm' }) {
  return <span className={`medal-coin ${tier} ${SIZE[size] || 'm-sm'}`}>{EMOJI[tier] || '\u{1F3C5}'}</span>;
}

export function Bar({ value, color }) {
  return <div className="bar"><i style={{ width: `${Math.max(0, Math.min(100, value))}%`, ...(color ? { background: color } : {}) }} /></div>;
}

export function Spinner() { return <div className="center"><div className="spin" /></div>; }

export function Toast({ msg }) { return msg ? <div className="toast">{msg}</div> : null; }

export function initials(name = '') {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || 'E';
}

export function Logo({ size = 26 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" fill="none">
      <polygon points="3,27 9,6 13,6 8,27" fill="currentColor" />
      <polygon points="27,27 21,6 17,6 22,27" fill="currentColor" />
      <rect x="7" y="14" width="16" height="4" rx="1" fill="currentColor" />
      <rect x="12" y="14" width="6" height="10" rx="1" fill="#F5B041" />
      <polygon points="15,5 12,10 18,10" fill="#F5B041" />
    </svg>
  );
}
