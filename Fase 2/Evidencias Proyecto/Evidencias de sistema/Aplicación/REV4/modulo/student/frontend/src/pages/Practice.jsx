import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { Bar, Spinner } from '../components/ui.jsx';

const LETTERS = ['A', 'B', 'C', 'D', 'E'];

const fmt = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export default function Practice() {
  const { L, lang, refreshUser } = useAuth();
  const nav = useNavigate();

  const [step, setStep] = useState('loading');
  const [q, setQ] = useState(null);
  const [progress, setProgress] = useState(null);
  const [sel, setSel] = useState(null);
  const [result, setResult] = useState(null);
  const [detail, setDetail] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [quotaCode, setQuotaCode] = useState(null);
  const [rc, setRc] = useState({
    open: false,
    reason: 'wrong_answer',
    comment: '',
    sent: false,
  });

  const startRef = useRef(0);
  const timerRef = useRef(null);
  const submittingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);

  const stopTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  const startTimer = () => {
    startRef.current = Date.now();
    setElapsed(0);
    stopTimer();
    timerRef.current = setInterval(
      () => setElapsed(Date.now() - startRef.current),
      250
    );
  };

  const loadNext = useCallback(async () => {
    setStep('loading');
    setSel(null);
    setResult(null);
    setDetail(null);
    setRc({
      open: false,
      reason: 'wrong_answer',
      comment: '',
      sent: false,
    });

    try {
      const res = await api.get('/practice/next');
      setQ(res.data);
      setProgress(res.data.progress);
      setStep('question');
      startTimer();
    } catch (e) {
      if (
        e.code === 'QUOTA_BASE_REACHED' ||
        e.code === 'QUOTA_DAILY_LIMIT'
      ) {
        setQuotaCode(e.code);
        setStep('quota');
      } else if (e.code === 'NO_QUESTIONS_AVAILABLE') {
        setStep('empty');
      } else if (e.code === 'ACCOUNT_SUSPENDED') {
        setStep('suspended');
      } else {
        setStep('error');
      }
    }
  }, []);

  useEffect(() => {
    loadNext();
    return stopTimer;
  }, [loadNext]);

  const check = async () => {
    if (sel == null || !q || submittingRef.current) return;

    if (!q.sessionId) {
      setStep('error');
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    stopTimer();

    const ms = Date.now() - startRef.current;

    try {
      const res = await api.post(`/questions/${q.id}/answer`, {
        selected: LETTERS[sel],
        elapsedMs: ms,
        sessionId: q.sessionId,
      });

      setResult({
        ...res.data,
        elapsedMs: res.data.elapsedMs ?? ms,
      });

      setStep('result');
      refreshUser();
    } catch (e) {
      if (e.code === 'QUOTA_DAILY_LIMIT') {
        setQuotaCode(e.code);
        setStep('quota');
      } else if (e.code === 'ACCOUNT_SUSPENDED') {
        setStep('suspended');
      } else {
        setStep('error');
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const openExplanation = async () => {
    setStep('explanation');

    try {
      const [exp, sk] = await Promise.all([
        api.get(`/questions/${q.id}/explanation`),
        api.get(`/questions/${q.id}/skill`),
      ]);

      setDetail({
        explanation: exp.data,
        skill: sk.data,
      });
    } catch {
      setDetail({
        explanation: null,
        skill: null,
      });
    }
  };

  const sendCorrection = async () => {
    try {
      await api.post('/corrections', {
        questionId: q.id,
        reason: rc.reason,
        comment: rc.comment,
      });

      setRc({ ...rc, sent: true, open: true });
    } catch (e) {
      alert(e.message);
    }
  };

  if (step === 'loading') return <Spinner />;

  if (step === 'suspended') {
    return (
      <div className="center">
        <div className="card" role="alert" style={{ maxWidth: 520 }}>
          <h2>
            {lang === 'en' ? 'Account suspended' : 'Cuenta suspendida'}
          </h2>
          <p>
            {lang === 'en'
              ? 'Contact the administrator. You can continue practicing once your account is reactivated.'
              : 'Contacta al administrador. Podrás continuar practicando cuando reactive tu cuenta.'}
          </p>
          <button className="btn sec" onClick={loadNext}>
            {lang === 'en' ? 'Check access' : 'Comprobar acceso'}
          </button>
        </div>
      </div>
    );
  }

  if (step === 'error') {
    return (
      <div className="center">
        <div role="alert">
          <p>
            {lang === 'en'
              ? 'We could not complete this action. Please try again.'
              : 'No pudimos completar esta acción. Inténtalo nuevamente.'}
          </p>
          <button className="btn sec" onClick={loadNext}>
            {L('retry')}
          </button>
        </div>
      </div>
    );
  }

  if (step === 'empty') {
    return <div className="center">{L('empty_q')}</div>;
  }

  if (step === 'quota') {
    return (
      <QuotaWall
        code={quotaCode}
        L={L}
        lang={lang}
        onUnlocked={loadNext}
        goPlan={() => nav('/plan')}
        refreshUser={refreshUser}
      />
    );
  }

  if (step === 'question') {
    return (
      <div style={{ maxWidth: 680, margin: '0 auto' }}>
        <div className="flex between">
          <span className="note">
            {L('q_of')} {progress?.current} {L('of')} {progress?.total}
          </span>
          <span className="flex" style={{ gap: 6, fontSize: 13 }}>
            ⏱️ <span className="timer">{fmt(elapsed)}</span>
          </span>
        </div>

        <Bar value={(progress?.current / progress?.total) * 100} />

        <span
          className="tag"
          style={{ marginTop: 14, display: 'inline-block' }}
        >
          {q.testId?.toUpperCase()} · {q.axis}
        </span>

        <div className="card" style={{ marginTop: 12 }}>
          <div className="h" style={{ fontSize: 19 }}>
            {q.statement}
          </div>

          {q.options.map((o, i) => (
            <div
              key={i}
              className={`opt ${sel === i ? 'sel' : ''}`}
              onClick={() => {
                if (!submittingRef.current) setSel(i);
              }}
            >
              <span className="k">{LETTERS[i]}</span>
              {o}
            </div>
          ))}
        </div>

        <p className="note" style={{ marginTop: 12 }}>
          {lang === 'en'
            ? 'The timer records your response time.'
            : 'El cronómetro registra tu tiempo de respuesta.'}
        </p>

        <button
          className="btn full"
          style={{ marginTop: 12 }}
          disabled={sel == null || submitting}
          onClick={check}
        >
          {submitting
            ? (lang === 'en' ? 'Checking…' : 'Comprobando…')
            : L('check')}
        </button>
      </div>
    );
  }

  if (step === 'result') {
    const ok = result.correct;
    const correctIdx = LETTERS.indexOf(result.correctAnswer);

    return (
      <div style={{ maxWidth: 680, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', margin: '10px 0 4px' }}>
          <div style={{ fontSize: 46 }}>{ok ? '✅' : '❌'}</div>
          <div
            className="h"
            style={{ color: ok ? 'var(--accent)' : 'var(--danger)' }}
          >
            {ok ? L('correct') : L('incorrect')}
          </div>
        </div>

        <div className="card">
          {q.options.map((o, i) => (
            <div
              key={i}
              className={`opt ${
                i === correctIdx
                  ? 'ok'
                  : (i === sel && !ok ? 'no' : '')
              }`}
            >
              <span className="k">{LETTERS[i]}</span>
              {o}
            </div>
          ))}

          <div className="divider" />
          <p className="note" style={{ margin: 0 }}>
            {result.shortExplanation}
          </p>
        </div>

        <div
          className="card flat"
          style={{ marginTop: 12, borderColor: 'var(--accent)' }}
        >
          <span className="note">
            ⏱️ {lang === 'en'
              ? `Response time: ${fmt(result.elapsedMs)}`
              : `Tiempo de respuesta: ${fmt(result.elapsedMs)}`}
          </span>
        </div>

        <div
          className="flex"
          style={{ gap: 10, marginTop: 14, flexWrap: 'wrap' }}
        >
          <button className="btn sec" onClick={openExplanation}>
            {'\u{1F4D6}'} {L('see_exp')}
          </button>

          <button className="btn sec" onClick={() => nav('/grupos')}>
            {'\u{1F465}'} {L('share_group')}
          </button>

          <button
            className="btn"
            style={{ marginLeft: 'auto' }}
            onClick={loadNext}
          >
            {L('next_q')} →
          </button>
        </div>
      </div>
    );
  }

  const exp = detail?.explanation;
  const skill = detail?.skill;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1.6fr 1fr',
        gap: 18,
        alignItems: 'start',
      }}
    >
      <div className="card">
        <div className="flex" style={{ gap: 10 }}>
          <span style={{ fontSize: 26 }}>{'\u{1F4D6}'}</span>
          <div>
            <div className="h" style={{ margin: 0 }}>
              {exp?.title || L('exp_h')}
            </div>
            <p className="note">{exp?.subject}</p>
          </div>
        </div>

        <div
          className="card flat"
          style={{
            textAlign: 'center',
            fontWeight: 700,
            marginTop: 14,
          }}
        >
          {q.statement}
        </div>

        {(exp?.steps || []).map((s, i) => (
          <div key={i} className="card flat" style={{ marginTop: 10 }}>
            <b>{s.label}</b>
            <p className="note">{s.body}</p>
          </div>
        ))}

        {exp?.verification ? (
          <div
            className="card flat"
            style={{ marginTop: 10, borderColor: 'var(--accent)' }}
          >
            <b>✅ {L('verify')}</b>
            <p className="note">{exp.verification}</p>
          </div>
        ) : null}

        {exp?.keyConcept ? (
          <div
            className="card flat"
            style={{ marginTop: 10, borderColor: 'var(--brand)' }}
          >
            <b>{'\u{1F4A1}'} {L('key_concept')}</b>
            <p className="note">{exp.keyConcept}</p>
          </div>
        ) : null}

        <div
          className="flex"
          style={{ gap: 10, marginTop: 14, flexWrap: 'wrap' }}
        >
          <button className="btn sec" onClick={loadNext}>
            {'\u{1F3AF}'} {L('related')}
          </button>

          <button
            className="btn gho"
            onClick={() => setStep('result')}
          >
            ← {L('back_result')}
          </button>
        </div>
      </div>

      <div>
        <div className="card">
          <div className="section-label" style={{ margin: '0 0 4px' }}>
            {'\u{1F9E0}'} {L('skill_h')}
          </div>

          <p className="note">{skill?.skill?.name}</p>

          {skill && (
            <>
              <div className="flex between" style={{ marginTop: 8 }}>
                <span className="note">{L('mastery')}</span>
                <b>{skill.mastery.percent}%</b>
              </div>
              <Bar value={skill.mastery.percent} />
            </>
          )}

          {(skill?.prerequisites || []).map((p, i) => (
            <div
              key={i}
              className={`skill-node ${
                p.status === 'done'
                  ? 'done'
                  : p.status === 'active'
                    ? 'active'
                    : 'locked'
              }`}
            >
              <span>
                {p.status === 'done'
                  ? '✅'
                  : p.status === 'active'
                    ? '\u{1F3AF}'
                    : '\u{1F512}'}
              </span>{' '}
              {p.name}
            </div>
          ))}

          {skill?.resources?.length ? (
            <>
              <div
                className="section-label"
                style={{ margin: '14px 0 4px' }}
              >
                {L('resources')}
              </div>

              {skill.resources.map((rsc, i) => (
                <a
                  key={i}
                  className="row"
                  href={rsc.url}
                  target="_blank"
                  rel="noreferrer"
                  style={{ textDecoration: 'none' }}
                >
                  <span>
                    {rsc.type === 'video' ? '\u{1F3A5}' : '\u{1F4C4}'}
                  </span>
                  <span style={{ fontSize: 13 }}>
                    {rsc.title}
                    {rsc.duration ? ` · ${rsc.duration}` : ''}
                  </span>
                </a>
              ))}
            </>
          ) : null}
        </div>

        <div
          className="card"
          style={{ marginTop: 16, borderColor: 'var(--danger)' }}
        >
          <div className="flex" style={{ gap: 8 }}>
            <span style={{ fontSize: 18 }}>⚑</span>
            <b style={{ fontSize: 13 }}>{L('rc_btn')}</b>
          </div>

          <p className="note" style={{ marginTop: 6 }}>
            {L('rc_intro')}
          </p>

          {rc.sent ? (
            <div className="okmsg">{L('rc_sent')}</div>
          ) : rc.open ? (
            <>
              <label className="fld">{L('rc_reason')}</label>
              <select
                value={rc.reason}
                onChange={(e) => setRc({ ...rc, reason: e.target.value })}
              >
                {[
                  'wrong_answer',
                  'ambiguous',
                  'typo',
                  'bad_explanation',
                  'other',
                ].map((r) => (
                  <option key={r} value={r}>
                    {L('reason_' + r)}
                  </option>
                ))}
              </select>

              <label className="fld">{L('rc_comment')}</label>
              <textarea
                value={rc.comment}
                onChange={(e) => setRc({ ...rc, comment: e.target.value })}
              />

              <button
                className="btn sec full"
                style={{
                  marginTop: 10,
                  borderColor: 'var(--danger)',
                  color: 'var(--danger)',
                }}
                onClick={sendCorrection}
              >
                {L('rc_send')}
              </button>
            </>
          ) : (
            <button
              className="btn sec full"
              style={{
                marginTop: 10,
                borderColor: 'var(--danger)',
                color: 'var(--danger)',
              }}
              onClick={() => setRc({ ...rc, open: true })}
            >
              {L('rc_btn')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function QuotaWall({ code, L, lang, onUnlocked, goPlan, refreshUser }) {
  const [type, setType] = useState(null);
  const [val, setVal] = useState('');
  const [err, setErr] = useState('');

  const canUnlockBonus = code === 'QUOTA_BASE_REACHED';

  const message = canUnlockBonus
    ? L('quota_reached_p')
    : lang === 'en'
      ? 'You have used your free quota for today. You can return when it resets or upgrade your plan.'
      : 'Has agotado tu cuota gratuita de hoy. Puedes volver cuando se restablezca o mejorar tu plan.';

  const submit = async () => {
    setErr('');

    try {
      await api.post(
        '/me/quota/unlock',
        type === 'school'
          ? { type: 'school', school: val }
          : { type: 'address', region: val }
      );

      await refreshUser();
      onUnlocked();
    } catch (e) {
      setErr(e.message);
    }
  };

  return (
    <div style={{ maxWidth: 520, margin: '24px auto' }}>
      <div className="card" style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 44 }}>{'\u{1F4AA}'}</div>
        <div className="h">{L('quota_reached_h')}</div>
        <p className="p">{message}</p>

        {canUnlockBonus ? (
          <div style={{ textAlign: 'left', marginTop: 10 }}>
            <div className="seg" style={{ width: '100%' }}>
              <div
                className={type === 'school' ? 'on' : ''}
                onClick={() => setType('school')}
              >
                {L('unlock_school')}
              </div>

              <div
                className={type === 'address' ? 'on' : ''}
                onClick={() => setType('address')}
              >
                {L('unlock_address')}
              </div>
            </div>

            {type && (
              <>
                <input
                  style={{ marginTop: 10 }}
                  placeholder={
                    type === 'school' ? L('school_ph') : L('region_ph')
                  }
                  value={val}
                  onChange={(e) => setVal(e.target.value)}
                />

                {err && <div className="err">{err}</div>}

                <button
                  className="btn full"
                  style={{ marginTop: 10 }}
                  disabled={!val}
                  onClick={submit}
                >
                  {L('unlock_btn')}
                </button>
              </>
            )}
          </div>
        ) : null}

        <button
          className="btn sec full"
          style={{ marginTop: 10 }}
          onClick={goPlan}
        >
          {L('go_plan')}
        </button>
      </div>
    </div>
  );
}