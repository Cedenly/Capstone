import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { Coin, Bar, Spinner } from '../components/ui.jsx';

const TIERS = ['bronze', 'silver', 'gold', 'diamond', 'platinum'];

const TEST_LABELS = {
  lectora: ['Comp. Lectora', 'Reading Comprehension'],
  m1: ['Matemática M1', 'Mathematics M1'],
  m2: ['Matemática M2', 'Mathematics M2'],
  cien: ['Ciencias', 'Science'],
  hist: ['Historia y C. Soc.', 'History and Social Sciences'],
};

export default function Home() {
  const { L, lang } = useAuth();
  const english = lang === 'en';
  const t = (es, en) => english ? en : es;

  const testLabel = (id, fallback) =>
    TEST_LABELS[id]?.[english ? 1 : 0] ||
    fallback ||
    id ||
    t('Tu prueba contratada', 'Your subscribed test');

  const nav = useNavigate();
  const [state, setState] = useState(null);

  useEffect(() => {
    (async () => {
      const [me, quota, medals, progress] = await Promise.all([
        api.get('/me'),
        api.get('/me/quota'),
        api.get('/me/medals'),
        api.get('/me/progress'),
      ]);

      setState({
        me: me.data,
        quota: quota.data,
        medals: medals.data.wallet,
        progress: progress.data,
      });
    })().catch(() => setState({ error: true }));
  }, []);

  if (!state) return <Spinner />;
  if (state.error) return <div className="center">{L('retry')}</div>;

  const { me, quota, medals, progress } = state;
  const free = me.plan === 'free';
  const unlimitedForOneTest = me.plan === 'uni' && quota.unlimited;

  const unlimitedTestLabel = testLabel(
    quota.unlimitedTestId,
    progress.find(test => test.testId === quota.unlimitedTestId)?.label,
  );

  const prog =
    TIERS.find(tier => tier !== 'platinum' && medals[tier] > 0) ||
    'bronze';

  const nextT = {
    bronze: 'silver',
    silver: 'gold',
    gold: 'diamond',
    diamond: 'platinum',
  }[prog];

  return (
    <>
      <div
        className="flex between"
        style={{ flexWrap: 'wrap', gap: 10, marginBottom: 6 }}
      >
        <div>
          <div className="h" style={{ fontSize: 22 }}>
            {L('greeting')}, {me.name} {'\u{1F44B}'}
          </div>
          <div className="sub">{L('welcome_sub')}</div>
        </div>
        <button className="btn" onClick={() => nav('/practicar')}>
          {L('start_practice')} →
        </button>
      </div>

      <div className="dash" style={{ marginTop: 16 }}>
        <div className="card">
          <div
            className="flex between"
            style={{ gap: 10, flexWrap: 'wrap' }}
          >
            <b>{L('quota')}</b>
            <span className="note">
              {quota.unlimited
                ? unlimitedForOneTest
                  ? t(
                      `Ilimitada en ${unlimitedTestLabel}`,
                      `Unlimited for ${unlimitedTestLabel}`,
                    )
                  : L('unlimited')
                : `${quota.used} ${L('of')} ${quota.max} ${L('used')}`}
            </span>
          </div>

          <Bar
            value={
              quota.unlimited
                ? 100
                : (quota.used / quota.max) * 100
            }
          />

          <p className="note" style={{ marginTop: 8 }}>
            {unlimitedForOneTest
              ? t(
                  `Las demás pruebas comparten una cuota gratuita de ${quota.freeMax} respuestas diarias. Hoy has utilizado ${quota.used}.`,
                  `Other tests share a free quota of ${quota.freeMax} answers per day. You have used ${quota.used} today.`,
                )
              : quota.unlimited
                ? '∞'
                : L('quota_note')}
          </p>
        </div>

        <div className="card stat">
          <span className="lbl">
            {L('streak')} {'\u{1F525}'}
          </span>
          <span className="big">
            {me.streak}{' '}
            <span style={{ fontSize: 15, color: 'var(--muted)' }}>
              {L('days')}
            </span>
          </span>
          <p className="note">{L('keep_streak')}</p>
        </div>

        <div className="card">
          <div className="flex between" style={{ marginBottom: 10 }}>
            <b>{L('medals_title')}</b>
            <span
              className="note"
              style={{
                color: 'var(--brand)',
                cursor: 'pointer',
                fontWeight: 700,
              }}
              onClick={() => nav('/medallas')}
            >
              {L('view_all')} →
            </span>
          </div>

          <div className="flex between">
            {TIERS.map(tier => (
              <div
                key={tier}
                style={{
                  textAlign: 'center',
                  opacity: medals[tier] > 0 ? 1 : 0.4,
                }}
              >
                <Coin tier={tier} size="md" />
                <div
                  style={{
                    fontWeight: 800,
                    fontFamily: "'Montserrat',sans-serif",
                    marginTop: 4,
                  }}
                >
                  {medals[tier]}
                </div>
              </div>
            ))}
          </div>

          <div className="divider" />

          <span className="note">
            <Coin tier={prog} /> {medals[prog] % 5}/5{' '}
            {L('next_tier')} <Coin tier={nextT} />
          </span>
          <Bar
            value={(medals[prog] % 5) / 5 * 100}
            color="var(--bronze)"
          />
        </div>

        <div
          className="card span2"
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            background: 'linear-gradient(135deg,var(--brand),#264b80)',
            color: '#fff',
            border: 'none',
          }}
        >
          <div className="h" style={{ color: '#fff', fontSize: 20 }}>
            {L('continue_h')}
          </div>
          <p className="note" style={{ color: 'rgba(255,255,255,.8)' }}>
            {L('continue_p')}
          </p>
          <button
            className="btn"
            style={{ marginTop: 14, alignSelf: 'flex-start' }}
            onClick={() => nav('/practicar')}
          >
            {L('start_practice')}
          </button>
        </div>

        <div className="card">
          <div className="section-label" style={{ margin: '0 0 8px' }}>
            {L('quick')}
          </div>
          <div
            className="row"
            style={{ marginTop: 6, cursor: 'pointer' }}
            onClick={() => nav('/practicar')}
          >
            <span style={{ fontSize: 18 }}>✏️</span> {L('qa_practice')}
          </div>
          <div
            className="row"
            style={{ cursor: 'pointer' }}
            onClick={() => nav('/grupos')}
          >
            <span style={{ fontSize: 18 }}>{'\u{1F465}'}</span>{' '}
            {L('qa_groups')}
          </div>
          <div
            className="row"
            style={{ cursor: 'pointer' }}
            onClick={() => nav('/medallas')}
          >
            <span style={{ fontSize: 18 }}>{'\u{1F3C5}'}</span>{' '}
            {L('qa_medals')}
          </div>
        </div>

        <div className="card span3">
          <div className="flex between">
            <b>{L('progress')}</b>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))',
              gap: 18,
              marginTop: 12,
            }}
          >
            {progress.map(test => (
              <div key={test.testId}>
                <div className="flex between">
                  <span style={{ fontSize: 13 }}>
                    {testLabel(test.testId, test.label)}
                  </span>
                  <span className="note">{test.percent}%</span>
                </div>
                <Bar value={test.percent} />
              </div>
            ))}
          </div>
        </div>

        {free && (
          <div className="card span3 upgrade">
            <div
              className="flex between"
              style={{ flexWrap: 'wrap', gap: 12 }}
            >
              <div className="flex" style={{ gap: 14 }}>
                <span style={{ fontSize: 32 }}>{'\u{1F680}'}</span>
                <div>
                  <div className="h">{L('upgrade_h')}</div>
                  <p className="note">{L('upgrade_p')}</p>
                </div>
              </div>
              <button className="btn" onClick={() => nav('/plan')}>
                {L('upgrade_cta')}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}