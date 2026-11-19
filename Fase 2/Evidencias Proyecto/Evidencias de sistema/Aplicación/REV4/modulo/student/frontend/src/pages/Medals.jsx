import React, { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { Coin, Spinner, Toast, initials } from '../components/ui.jsx';

const TIERS = ['bronze', 'silver', 'gold', 'diamond', 'platinum'];
const NEXT = { bronze: 'silver', silver: 'gold', gold: 'diamond', diamond: 'platinum' };

export default function Medals() {
  const { L, refreshUser } = useAuth();
  const [wallet, setWallet] = useState(null);
  const [gifts, setGifts] = useState(null);
  const [benefits, setBenefits] = useState([]);
  const [toast, setToast] = useState('');

  const load = async () => {
    const [m, g, b] = await Promise.all([api.get('/me/medals'), api.get('/me/gifts'), api.get('/benefits')]);
    setWallet(m.data.wallet); setGifts(g.data); setBenefits(b.data);
  };
  useEffect(() => { load().catch(() => setWallet({})); }, []);
  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2500); };

  const exchange = async (from) => {
    try { const { data } = await api.post('/me/medals/exchange', { from, quantity: 5 }); setWallet(data.wallet); refreshUser(); flash('✅'); }
    catch (e) { flash(e.message); }
  };
  const gift = async (userId) => {
    try { const { data } = await api.post('/me/gifts', { recipients: [{ userId, amount: 1 }] }); await load(); refreshUser(); flash(`${L('gift_btn')} ✓`); }
    catch (e) { flash(e.message); }
  };
  const redeem = async (id) => {
    try { const { data } = await api.post(`/benefits/${id}/redeem`, {}); await load(); refreshUser(); flash(`${L('redeemed')} ${data.couponCode}`); }
    catch (e) { flash(e.message); }
  };

  if (!wallet) return <Spinner />;
  return (
    <>
      <Toast msg={toast} />
      <div className="card">
        <div className="flex between"><b>{L('med_have')}</b></div>
        <div className="flex" style={{ justifyContent: 'space-around', marginTop: 14, flexWrap: 'wrap', gap: 14 }}>
          {TIERS.map((t) => (
            <div key={t} style={{ textAlign: 'center', opacity: wallet[t] > 0 ? 1 : .45 }}>
              <Coin tier={t} size="lg" />
              <div style={{ fontWeight: 800, fontFamily: "'Montserrat',sans-serif", fontSize: 18, marginTop: 6 }}>{wallet[t] || 0}</div>
              <div className="note">{L('med_' + t)}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="dash" style={{ gridTemplateColumns: 'repeat(2,1fr)', marginTop: 18 }}>
        <div className="card">
          <b>{L('med_exchange')}</b><p className="note">{L('med_exchange_p')}</p>
          {['bronze', 'silver', 'gold', 'diamond'].map((from) => (
            <div key={from} className="row"><Coin tier={from} /> 5 → <Coin tier={NEXT[from]} /> 1
              <button className="btn sec" style={{ marginLeft: 'auto', padding: '8px 12px' }} disabled={(wallet[from] || 0) < 5} onClick={() => exchange(from)}>{L('exchange_btn')}</button></div>
          ))}
        </div>
        <div className="card">
          <b>{L('med_gift')}</b><p className="note">{L('med_gift_p')}</p>
          <p className="note">{gifts?.daily?.used || 0}/{gifts?.daily?.max || 10} · {gifts?.bronzeAvailable} <Coin tier="bronze" /></p>
          {gifts?.friends?.length ? gifts.friends.map((f) => (
            <div key={f.userId} className="row"><div className="mavatar" style={{ background: '#1A365D', margin: 0 }}>{initials(f.name)}</div> {f.name}
              <button className="btn sec" style={{ marginLeft: 'auto', padding: '8px 12px' }} onClick={() => gift(f.userId)}>{L('gift_btn')}</button></div>
          )) : <p className="note">{L('gift_none')}</p>}
        </div>
        <div className="card">
          <b>{L('how_earn')}</b>
          <div className="row"><Coin tier="bronze" /> +1 · {L('earn_correct')}</div>
          <div className="row"><Coin tier="bronze" /> +1 · {L('earn_login')}</div>
          <div className="row"><Coin tier="bronze" /> +250 · {L('earn_rc')}</div>
        </div>
        <div className="card" style={{ borderColor: 'var(--platinum)' }}>
          <b>{L('med_benefits')}</b><p className="note">{L('med_benefits_p')}</p>
          {benefits.map((b) => (
            <div key={b.id} className="row" style={{ opacity: b.unlocked ? 1 : .6 }}>
              <div className="avatar-sq" style={{ background: 'var(--platinum)' }}>{'\u{1F381}'}</div>
              <div style={{ flex: 1 }}><div style={{ fontWeight: 700, fontSize: 13 }}>{b.name}</div><span className="note">{b.description}</span><br /><span className="tag"><Coin tier="platinum" /> {b.costPlatinum}{b.unlocked ? '' : ` · ${L('locked')}`}</span></div>
              <button className="btn sec" style={{ padding: '8px 12px' }} disabled={!b.unlocked} onClick={() => redeem(b.id)}>{L('redeem')}</button>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
