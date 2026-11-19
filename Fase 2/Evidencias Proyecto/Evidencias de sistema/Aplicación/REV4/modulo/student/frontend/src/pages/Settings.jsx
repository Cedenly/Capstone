import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { Spinner, Toast } from '../components/ui.jsx';

function Switch({ on, onClick, label, disabled = false }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      style={{
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        flexShrink: 0,
        width: 42,
        height: 24,
        padding: 0,
        border: 0,
        borderRadius: 20,
        background: on ? 'var(--brand)' : 'var(--line)',
        position: 'relative',
        transition: '.2s',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: '#fff',
          top: 3,
          left: on ? 21 : 3,
          transition: '.2s',
        }}
      />
    </button>
  );
}

const rowStyle = {
  padding: '12px 0',
  borderBottom: '1px solid var(--line)',
};

export default function Settings() {
  const {
    L,
    user,
    setUser,
    lang,
    setLang,
    dark,
    toggleTheme,
    logout,
  } = useAuth();

  const nav = useNavigate();
  const actionRef = useRef(false);
  const toastTimer = useRef(null);

  const [tests, setTests] = useState([]);
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [revision, setRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState('');
  const [delMode, setDelMode] = useState(false);
  const [pwd, setPwd] = useState('');

  const t = (es, en) => lang === 'en' ? en : es;
  const busy = saving || leaving || deleting;
  const passwordRequired = (user?.authProvider || 'password') === 'password';

  const planLabel = {
    free: L('plan_free'),
    uni: t('1 prueba ilimitada', '1 unlimited test'),
    all: t('Todas las pruebas', 'All tests'),
  }[user?.plan] || '—';

  useEffect(() => {
    return () => clearTimeout(toastTimer.current);
  }, []);

  function flash(message) {
    clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(''), 2600);
  }

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setLoadError('');

    Promise.all([
      api.get('/me/settings'),
      api.get(`/tests?lang=${encodeURIComponent(lang)}`),
    ])
      .then(([settingsResponse, testsResponse]) => {
        if (cancelled) return;

        if (!settingsResponse.data || !Array.isArray(testsResponse.data)) {
          throw new Error(
            lang === 'en'
              ? 'Your settings could not be loaded.'
              : 'No se pudieron cargar tus ajustes.'
          );
        }

        setSelected(
          Array.isArray(settingsResponse.data.selectedTests)
            ? settingsResponse.data.selectedTests
            : []
        );
        setTests(testsResponse.data);
      })
      .catch(error => {
        if (!cancelled) {
          setLoadError(
            error.message ||
            (lang === 'en'
              ? 'Your settings could not be loaded.'
              : 'No se pudieron cargar tus ajustes.')
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

  async function toggleTest(id) {
    if (actionRef.current || loading || loadError) return;

    const test = tests.find(item => item.id === id);
    const alreadySelected = selected.includes(id);

    if (!test || (!alreadySelected && test.hasQuestions !== true)) {
      return;
    }

    const next = alreadySelected
      ? selected.filter(value => value !== id)
      : [...selected, id];

    const hasAvailableSelection = next.some(value =>
      tests.some(item =>
        item.id === value && item.hasQuestions === true
      )
    );

    setActionError('');

    if (!hasAvailableSelection) {
      setActionError(t(
        'Mantén seleccionada al menos una prueba con preguntas disponibles.',
        'Keep at least one test with available questions selected.'
      ));
      return;
    }

    actionRef.current = true;
    setSaving(true);

    try {
      const { data } = await api.put('/me/preferences', {
        selectedTests: next,
        format: 'random',
      });

      const saved = Array.isArray(data?.selectedTests)
        ? data.selectedTests
        : next;

      setSelected(saved);
      setUser(current => current ? {
        ...current,
        selectedTests: saved,
      } : current);

      flash(L('set_saved'));
    } catch (error) {
      setActionError(error.message || t(
        'No se pudo guardar la selección. Vuelve a intentarlo.',
        'Your selection could not be saved. Please try again.'
      ));
    } finally {
      actionRef.current = false;
      setSaving(false);
    }
  }

  async function handleLogout() {
    if (actionRef.current) return;

    actionRef.current = true;
    setLeaving(true);
    setActionError('');

    try {
      await logout();
      nav('/login', { replace: true });
    } catch (error) {
      setActionError(error.message || t(
        'No se pudo cerrar la sesión.',
        'You could not be signed out.'
      ));
    } finally {
      actionRef.current = false;
      setLeaving(false);
    }
  }

  async function deleteAccount(event) {
    event.preventDefault();

    if (actionRef.current || (passwordRequired && !pwd)) return;

    actionRef.current = true;
    setDeleting(true);
    setActionError('');

    try {
      await api.del('/me', passwordRequired ? { password: pwd } : {});
      await logout();
      nav('/login', { replace: true });
    } catch (error) {
      setActionError(
        error.code === 'STRIPE_OPERATION_REQUIRED'
          ? t(
              'La eliminación desde esta pantalla no está disponible para cuentas vinculadas a Stripe.',
              'Accounts linked to Stripe cannot be deleted from this screen.'
            )
          : error.message || t(
              'No se pudo eliminar la cuenta.',
              'Your account could not be deleted.'
            )
      );
    } finally {
      actionRef.current = false;
      setDeleting(false);
    }
  }

  return (
    <div style={{ maxWidth: 620 }}>
      <Toast msg={toast} />
      <div className="h">{L('set_h')}</div>

      {actionError && (
        <div className="err" role="alert">
          {actionError}
        </div>
      )}

      <div
        className="card"
        style={{ marginTop: 12, padding: '6px 18px' }}
      >
        <div className="flex between" style={rowStyle}>
          <b style={{ fontSize: 13 }}>{L('set_theme')}</b>
          <Switch
            on={dark}
            onClick={toggleTheme}
            label={L('set_theme')}
            disabled={busy}
          />
        </div>

        <div className="flex between" style={rowStyle}>
          <label htmlFor="settings-language" style={{ fontSize: 13 }}>
            <b>{L('set_lang')}</b>
          </label>
          <select
            id="settings-language"
            value={lang}
            disabled={busy}
            onChange={event => setLang(event.target.value)}
            style={{
              width: 'auto',
              background: 'none',
              border: 'none',
              color: 'var(--ink)',
              fontWeight: 700,
            }}
          >
            <option value="es">Español</option>
            <option value="en">English</option>
          </select>
        </div>

        <div style={rowStyle}>
          <div className="flex between" style={{ flexWrap: 'wrap' }}>
            <b style={{ fontSize: 13 }}>{L('set_notif')}</b>
            <span className="tag">
              {t('No disponible', 'Unavailable')}
            </span>
          </div>
          <p className="note" style={{ marginTop: 6 }}>
            {t(
              'Los recordatorios automáticos todavía no están habilitados en esta versión.',
              'Automatic reminders are not available in this version yet.'
            )}
          </p>
        </div>

        <div style={rowStyle}>
          <b style={{ fontSize: 13 }}>{L('set_tests')}</b>

          {loading ? (
            <Spinner />
          ) : loadError ? (
            <>
              <div className="err" role="alert">{loadError}</div>
              <button
                type="button"
                className="btn sec"
                style={{ marginTop: 8 }}
                disabled={busy}
                onClick={() => setRevision(value => value + 1)}
              >
                {L('retry')}
              </button>
            </>
          ) : (
            <>
              <div
                className="flex"
                aria-busy={saving}
                style={{ gap: 8, flexWrap: 'wrap', marginTop: 10 }}
              >
                {tests.map(test => {
                  const chosen = selected.includes(test.id);
                  const available = test.hasQuestions === true;
                  const disabled = busy || (!available && !chosen);

                  return (
                    <button
                      key={test.id}
                      type="button"
                      className="tag"
                      aria-pressed={chosen}
                      disabled={disabled}
                      onClick={() => toggleTest(test.id)}
                      style={{
                        cursor: disabled ? 'not-allowed' : 'pointer',
                        border: '1px solid var(--line)',
                        padding: '8px 12px',
                        fontFamily: 'inherit',
                        fontSize: 12,
                        textAlign: 'left',
                        background: chosen
                          ? 'var(--brand)'
                          : 'var(--chip)',
                        color: chosen ? '#fff' : 'var(--ink)',
                        opacity: available ? 1 : 0.55,
                      }}
                    >
                      {test.label}
                      {!available && (
                        <span
                          style={{
                            display: 'block',
                            fontSize: 10,
                            marginTop: 3,
                          }}
                        >
                          {t(
                            'Sin preguntas disponibles',
                            'No questions available'
                          )}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {saving && (
                <p className="note" role="status">
                  {t('Guardando selección…', 'Saving selection…')}
                </p>
              )}

              {!tests.length && (
                <p className="note">
                  {t(
                    'No hay pruebas disponibles para tu catálogo.',
                    'There are no tests available for your catalog.'
                  )}
                </p>
              )}

              <p className="note" style={{ marginTop: 8 }}>
                {t(
                  'Selecciona al menos una prueba con preguntas disponibles.',
                  'Select at least one test with available questions.'
                )}
              </p>

              {user?.plan === 'uni' && (
                <p className="note" style={{ marginTop: 6 }}>
                  {t(
                    'Esta selección organiza tu práctica; no cambia la prueba incluida en tu suscripción.',
                    'This selection organizes your practice; it does not change the test included in your subscription.'
                  )}
                </p>
              )}
            </>
          )}
        </div>

        <button
          type="button"
          className="flex between"
          disabled={busy}
          onClick={() => nav('/plan')}
          style={{
            width: '100%',
            padding: '12px 0',
            cursor: busy ? 'not-allowed' : 'pointer',
            border: 0,
            background: 'none',
            color: 'var(--ink)',
            textAlign: 'left',
            fontFamily: 'inherit',
          }}
        >
          <b style={{ fontSize: 13 }}>{L('set_plan')}</b>
          <span className="note">{planLabel} ›</span>
        </button>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <b style={{ fontSize: 13 }}>{L('set_privacy')}</b>
        <p className="note" style={{ marginTop: 6 }}>
          {t(
            'La exportación de datos no está disponible en esta versión.',
            'Data export is not available in this version.'
          )}
        </p>
      </div>

      <button
        type="button"
        className="card"
        disabled={busy}
        onClick={handleLogout}
        style={{
          marginTop: 14,
          width: '100%',
          cursor: busy ? 'not-allowed' : 'pointer',
          textAlign: 'left',
          fontFamily: 'inherit',
          color: 'var(--ink)',
        }}
      >
        <span className="flex between">
          <b style={{ fontSize: 13 }}>
            {leaving ? L('loading') : L('set_logout')}
          </b>
          <span className="note">›</span>
        </span>
      </button>

      <div
        className="card"
        style={{
          marginTop: 14,
          borderColor: 'var(--danger)',
          background: 'rgba(239,68,68,.05)',
        }}
      >
        <b style={{ fontSize: 13, color: 'var(--danger)' }}>
          {L('set_danger')}
        </b>
        <p className="note" style={{ marginTop: 6 }}>
          {t(
            'Al eliminar la cuenta dejarás de tener acceso a ella.',
            'Deleting your account will remove your access to it.'
          )}
        </p>

        {delMode ? (
          <form onSubmit={deleteAccount}>
            {passwordRequired && (
              <>
                <label className="fld" htmlFor="delete-password">
                  {L('del_confirm')}
                </label>
                <input
                  id="delete-password"
                  type="password"
                  autoComplete="current-password"
                  value={pwd}
                  onChange={event => setPwd(event.target.value)}
                  disabled={busy}
                  required
                />
              </>
            )}

            <div className="flex" style={{ gap: 8, marginTop: 10 }}>
              <button
                type="button"
                className="btn sec"
                disabled={busy}
                onClick={() => {
                  setDelMode(false);
                  setPwd('');
                  setActionError('');
                }}
              >
                {t('Cancelar', 'Cancel')}
              </button>

              <button
                type="submit"
                className="btn"
                disabled={busy || (passwordRequired && !pwd)}
                style={{ background: 'var(--danger)', color: '#fff' }}
              >
                {deleting ? L('loading') : L('set_danger')}
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            className="btn sec"
            disabled={busy}
            style={{
              marginTop: 10,
              borderColor: 'var(--danger)',
              color: 'var(--danger)',
            }}
            onClick={() => {
              setActionError('');
              setDelMode(true);
            }}
          >
            {L('set_danger')}
          </button>
        )}
      </div>
    </div>
  );
}