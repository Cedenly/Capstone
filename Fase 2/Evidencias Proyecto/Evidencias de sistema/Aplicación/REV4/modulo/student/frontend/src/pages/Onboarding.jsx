import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { Logo, Spinner } from '../components/ui.jsx';

export default function Onboarding() {
  const { L, lang, setUser } = useAuth();
  const nav = useNavigate();
  const savingRef = useRef(false);

  const [tests, setTests] = useState([]);
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);

  const t = (es, en) => lang === 'en' ? en : es;

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setLoadError('');

    Promise.all([
      api.get(`/tests?lang=${encodeURIComponent(lang)}`),
      api.get('/me/settings'),
    ])
      .then(([testsResponse, settingsResponse]) => {
        if (cancelled) return;

        if (!Array.isArray(testsResponse.data)) {
          throw new Error(
            lang === 'en'
              ? 'The test list could not be loaded.'
              : 'No se pudo cargar la lista de pruebas.'
          );
        }

        const available = testsResponse.data;
        const saved = Array.isArray(settingsResponse.data?.selectedTests)
          ? settingsResponse.data.selectedTests
          : [];

        setTests(available);
        setSelected(saved.filter(id =>
          available.some(test =>
            test.id === id && test.hasQuestions === true
          )
        ));
      })
      .catch(error => {
        if (!cancelled) {
          setLoadError(
            error.message ||
            (lang === 'en'
              ? 'Your preferences could not be loaded.'
              : 'No se pudieron cargar tus preferencias.')
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [lang, revision]);

  function toggle(id) {
    if (savingRef.current) return;

    const available = tests.some(test =>
      test.id === id && test.hasQuestions === true
    );

    if (!available) return;

    setErr('');
    setSelected(current =>
      current.includes(id)
        ? current.filter(value => value !== id)
        : [...current, id]
    );
  }

  async function finish() {
    if (savingRef.current || loading || loadError) return;

    setErr('');

    const chosen = selected.filter(id =>
      tests.some(test =>
        test.id === id && test.hasQuestions === true
      )
    );

    if (!chosen.length) {
      setErr(t(
        'Selecciona al menos una prueba con preguntas disponibles.',
        'Select at least one test with available questions.'
      ));
      return;
    }

    savingRef.current = true;
    setBusy(true);

    try {
      const { data } = await api.put('/me/preferences', {
        selectedTests: chosen,
        format: 'random',
      });

      const saved = Array.isArray(data?.selectedTests)
        ? data.selectedTests
        : chosen;

      setUser(current => current ? {
        ...current,
        selectedTests: saved,
        onboarded: true,
      } : current);

      nav('/', { replace: true });
    } catch (error) {
      setErr(error.message || t(
        'No se pudieron guardar tus preferencias.',
        'Your preferences could not be saved.'
      ));
    } finally {
      savingRef.current = false;
      setBusy(false);
    }
  }

  if (loading) return <Spinner />;

  const hasAvailableTests = tests.some(test =>
    test.hasQuestions === true
  );

  return (
    <div
      className="auth-wrap"
      style={{ alignItems: 'flex-start', paddingTop: 40 }}
    >
      <div className="auth-card" style={{ maxWidth: 560 }}>
        <div className="auth-logo">
          <Logo size={28} /> Aprueba
        </div>

        <div className="h">{L('ob_h')}</div>
        <p className="sub">{L('ob_sub')}</p>

        {loadError ? (
          <>
            <div className="err" role="alert">
              {loadError}
            </div>
            <button
              type="button"
              className="btn sec full"
              style={{ marginTop: 14 }}
              onClick={() => setRevision(value => value + 1)}
            >
              {L('retry')}
            </button>
          </>
        ) : (
          <>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
                gap: 10,
                marginTop: 14,
              }}
            >
              {tests.map(test => {
                const available = test.hasQuestions === true;
                const chosen = selected.includes(test.id);
                const disabled = busy || !available;

                return (
                  <button
                    key={test.id}
                    type="button"
                    className={`opt ${chosen ? 'sel' : ''}`}
                    aria-pressed={chosen}
                    disabled={disabled}
                    onClick={() => toggle(test.id)}
                    style={{
                      marginTop: 0,
                      width: '100%',
                      textAlign: 'left',
                      fontFamily: 'inherit',
                      color: 'var(--ink)',
                      background: chosen
                        ? 'rgba(26,54,93,.06)'
                        : 'var(--panel)',
                      opacity: available ? 1 : 0.55,
                      cursor: disabled ? 'not-allowed' : 'pointer',
                    }}
                  >
                    <span
                      className="k"
                      aria-hidden="true"
                      style={chosen ? {
                        background: test.color || 'var(--brand)',
                        borderColor: test.color || 'var(--brand)',
                        color: '#fff',
                      } : {}}
                    >
                      {chosen ? '✓' : ''}
                    </span>

                    <span>
                      {test.label}
                      {!available && (
                        <span
                          className="note"
                          style={{ display: 'block', marginTop: 4 }}
                        >
                          {t(
                            'Sin preguntas disponibles',
                            'No questions available'
                          )}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>

            {!hasAvailableTests && (
              <p className="note" role="status">
                {t(
                  'Todavía no hay preguntas disponibles para tu catálogo.',
                  'There are no questions available for your catalog yet.'
                )}
              </p>
            )}

            <div className="section-label">{L('ob_format')}</div>
            <div className="card flat">
              <b>{L('ob_random')}</b>
              <p className="note" style={{ marginTop: 6 }}>
                {t(
                  'Practicarás con preguntas aleatorias de las pruebas seleccionadas. El modo facsímil y el filtro por dificultad aún no están disponibles.',
                  'You will practice random questions from your selected tests. Mock exams and difficulty filters are not available yet.'
                )}
              </p>
            </div>

            {err && (
              <div className="err" role="alert">
                {err}
              </div>
            )}

            <button
              type="button"
              className="btn full"
              style={{ marginTop: 18 }}
              disabled={busy || !selected.length || !hasAvailableTests}
              onClick={finish}
            >
              {busy ? L('loading') : L('ob_finish')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}