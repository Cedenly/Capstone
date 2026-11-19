import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { Spinner } from '../components/ui.jsx';

const normalizeText = value =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

const FEATURES_EN = {
  '20 preguntas al dia': '20 questions per day',
  'explicaciones paso a paso': 'Step-by-step explanations',
  'preguntas ilimitadas de 1 prueba a eleccion':
    'Unlimited questions for one test of your choice',
  'recorreccion de preguntas': 'Question corrections',
  'acceso ilimitado a todas las pruebas paes':
    'Unlimited access to all PAES tests',
  'modo facsimil': 'Practice exam mode',
  'modo facsimil (ensayos)': 'Practice exam mode',
  'estadisticas avanzadas': 'Advanced statistics',
};

const TEST_NAMES = {
  lectora: {
    es: 'Comp. Lectora',
    en: 'Reading Comprehension',
  },
  m1: {
    es: 'Matemática M1',
    en: 'Mathematics M1',
  },
  m2: {
    es: 'Matemática M2',
    en: 'Mathematics M2',
  },
  cien: {
    es: 'Ciencias',
    en: 'Science',
  },
  hist: {
    es: 'Historia y C. Soc.',
    en: 'History and Social Sciences',
  },
};

const ERROR_TEXT = {
  TEST_REQUIRED: [
    'Elige la prueba incluida antes de continuar al pago.',
    'Choose the included test before proceeding to payment.',
  ],
  TEST_NOT_APPLICABLE: [
    'Este plan no necesita elegir una prueba.',
    'This plan does not require choosing a test.',
  ],
  INVALID_TEST: [
    'La prueba elegida no está disponible.',
    'The selected test is unavailable.',
  ],
  TEST_NO_QUESTIONS: [
    'La prueba elegida todavía no tiene preguntas disponibles.',
    'The selected test does not have available questions yet.',
  ],
  INVALID_PLAN: [
    'El plan no está disponible.',
    'This plan is unavailable.',
  ],
  INVALID_BILLING_CYCLE: [
    'El ciclo de facturación no es válido.',
    'The billing cycle is invalid.',
  ],
  CATALOG_UNAVAILABLE: [
    'No se pudo verificar el catálogo. Reintenta más tarde.',
    'The catalog could not be verified. Please try again later.',
  ],
  PRICE_MISMATCH: [
    'El precio de Stripe no coincide con el catálogo.',
    'The Stripe price does not match the catalog.',
  ],
  ALREADY_SUBSCRIBED: [
    'Ya tienes una suscripción. Gestiona el plan actual.',
    'You already have a subscription. Manage your current plan.',
  ],
  CHECKOUT_IN_PROGRESS: [
    'Tienes un pago pendiente para otro plan. Descarta ese intento primero.',
    'You have a pending payment for another plan. Discard that attempt first.',
  ],
  CHECKOUT_REVIEW_REQUIRED: [
    'La sesión pendiente necesita revisión antes de reintentar.',
    'The pending checkout needs to be reviewed before retrying.',
  ],
  CHECKOUT_UNAVAILABLE: [
    'No se pudo abrir el pago. Espera unos segundos y reintenta.',
    'Checkout could not be opened. Wait a few seconds and try again.',
  ],
  CHECKOUT_BUSY: [
    'Se está comprobando tu intento de pago. Espera unos segundos y actualiza su estado.',
    'Your checkout attempt is being checked. Wait a few seconds and refresh its status.',
  ],
  CHECKOUT_CANCELLING: [
    'El descarte anterior quedó pendiente. Vuelve a pulsar «Descartar intento» para completar la comprobación.',
    'The previous discard is still pending. Select “Discard attempt” again to finish the check.',
  ],
  CHECKOUT_RECONCILIATION_PENDING: [
    'No se pudo confirmar si se abrió el pago anterior. Conservamos ese intento para evitar cobros duplicados. Reintenta más tarde.',
    'We could not confirm whether the previous checkout opened. That attempt is reserved to avoid duplicate charges. Try again later.',
  ],
  CHECKOUT_ATTEMPT_NOT_FOUND: [
    'Ese intento ya no está disponible. Actualiza el estado de tu compra.',
    'That attempt is no longer available. Refresh your checkout status.',
  ],
  INVALID_CHECKOUT_SESSION: [
    'La respuesta de Stripe no corresponde a esta compra.',
    'The Stripe response does not match this purchase.',
  ],
  CHECKOUT_CHANGED: [
    'La sesión cambió. Actualiza la página.',
    'The checkout session changed. Refresh the page.',
  ],
  CHECKOUT_EXPIRED: [
    'La sesión venció. Vuelve a elegir el plan.',
    'The checkout session expired. Choose your plan again.',
  ],
  PAYMENT_PROCESSING: [
    'El pago ya fue enviado. Espera su confirmación.',
    'The payment has already been submitted. Wait for confirmation.',
  ],
  ACCOUNT_UNAVAILABLE: [
    'La cuenta no está disponible.',
    'Your account is unavailable.',
  ],
  ACCOUNT_SUSPENDED: [
    'Tu cuenta está suspendida. Contacta al administrador.',
    'Your account is suspended. Contact the administrator.',
  ],
  AUTH_INVALID: [
    'Tu sesión no es válida o expiró. Inicia sesión nuevamente.',
    'Your session is invalid or has expired. Sign in again.',
  ],
  AUTH_REQUIRED: [
    'Inicia sesión para continuar.',
    'Sign in to continue.',
  ],
  AUTH_FORBIDDEN: [
    'No tienes permiso para realizar esta acción.',
    'You do not have permission to perform this action.',
  ],
  FIRESTORE_REQUIRED: [
    'Los pagos requieren Firestore.',
    'Payments require Firestore.',
  ],
  PORTAL_UNAVAILABLE: [
    'No se pudo abrir el portal. Reintenta más tarde.',
    'The billing portal could not be opened. Please try again later.',
  ],
  INVALID_PORTAL_URL: [
    'No se recibió una dirección válida del portal.',
    'A valid billing portal address was not received.',
  ],
  INVALID_CHECKOUT_URL: [
    'No se recibió una dirección de pago válida.',
    'A valid checkout address was not received.',
  ],
};

export default function Plan() {
  const { user, refreshUser, lang, L } = useAuth();
  const language = lang === 'en' ? 'en' : 'es';
  const english = language === 'en';
  const locale = english ? 'en-US' : 'es-CL';
  const t = (es, en) => english ? en : es;

  const location = useLocation();
  const navigate = useNavigate();
  const action = useRef(false);
  const hasLoadedOnce = useRef(false);

  const [plans, setPlans] = useState([]);
  const [tests, setTests] = useState([]);
  const [testsError, setTestsError] = useState(false);
  const [testsLoading, setTestsLoading] = useState(true);
  const [selectedTestId, setSelectedTestId] = useState('');
  const [state, setState] = useState({
    subscription: null,
    checkout: null,
  });

  const [billing, setBilling] = useState('monthly');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState(null);
  const [revision, setRevision] = useState(0);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [quota, setQuota] = useState(null);

  const params = new URLSearchParams(location.search);
  const returned = params.get('checkout');
  const sessionId = params.get('session_id');
  const returnedFromPortal = params.get('portal') === 'return';

  const sub = state.subscription;
  const checkout = state.checkout;

  const cycleName = value =>
    value === 'yearly'
      ? t('Anual', 'Yearly')
      : t('Mensual', 'Monthly');

  const periodName = value =>
    value === 'yearly'
      ? t('año', 'year')
      : t('mes', 'month');

  const dateLabel = value =>
    value && Number.isFinite(Date.parse(value))
      ? new Date(value).toLocaleDateString(locale)
      : t('Por confirmar', 'To be confirmed');

  const amountLabel = value =>
    typeof value === 'number' && Number.isFinite(value)
      ? value.toLocaleString(locale, {
          minimumFractionDigits: 0,
          maximumFractionDigits: 2,
        })
      : '—';

  const nameOf = id => {
    const catalogName = plans.find(plan => plan.id === id)?.name;

    if (english) {
      if (id === 'uni') return '1 unlimited test';
      if (id === 'all') return 'All tests';
      if (id === 'free') return 'Free';
    }

    return catalogName || id || '—';
  };

  const testName = id =>
    TEST_NAMES[id]?.[language] ||
    tests.find(test => test.id === id)?.label ||
    id ||
    '—';

  const featureLabel = feature =>
    english
      ? FEATURES_EN[normalizeText(feature)] || feature
      : feature;

  const errorLabel = value => {
    if (!value) return '';

    const known = ERROR_TEXT[value.code];

    if (known) return known[english ? 1 : 0];

    return english
      ? 'Unable to complete the request. Refresh the status and try again.'
      : value.message ||
          'No se pudo completar la solicitud. Actualiza el estado y reintenta.';
  };

  const paymentMethod = sub?.paymentMethod;

  const paymentMethodLabel =
    typeof paymentMethod?.last4 === 'string' &&
    /^\d{4}$/.test(paymentMethod.last4)
      ? `${
          typeof paymentMethod.brand === 'string' &&
          paymentMethod.brand.trim()
            ? paymentMethod.brand.trim().toUpperCase()
            : t('Tarjeta', 'Card')
        } •••• ${paymentMethod.last4}`
      : t('No informado por Stripe', 'Not provided by Stripe');

  const uniAssignment = sub?.uniAssignment;

  const uniAssignmentLabel = uniAssignment?.testId
    ? (
        TEST_NAMES[uniAssignment.testId]?.[language] ||
        uniAssignment.testLabel ||
        testName(uniAssignment.testId)
      )
    : null;

  const selectedTestAvailable =
    !testsLoading &&
    !testsError &&
    tests.some(test => test.id === selectedTestId);

  useEffect(() => {
    let cancelled = false;

    setTestsLoading(true);
    setTestsError(false);

    api.get(`/tests?lang=${language}`)
      .then(({ data }) => {
        if (cancelled) return;

        const available = (data || []).filter(
          test => test.hasQuestions === true,
        );

        setTests(available);

        setSelectedTestId(current =>
          available.some(test => test.id === current)
            ? current
            : '',
        );

        setTestsError(false);
        setTestsLoading(false);
      })
      .catch(() => {
        if (cancelled) return;

        setTests([]);
        setTestsError(true);
        setTestsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [language]);

  useEffect(() => {
    let cancelled = false;
    let timer;
    let polls = 0;
    let catalogLoaded = false;

    if (hasLoadedOnce.current) {
      setRefreshing(true);
    } else {
      setLoading(true);
      setState({ subscription: null, checkout: null });
    }

    setWaiting(false);
    setError(null);

    async function load() {
      try {
        const path =
          '/billing/status' +
          (
            sessionId
              ? `?session_id=${encodeURIComponent(sessionId)}`
              : ''
          );

        const [status, catalog, quotaInfo] = await Promise.all([
          api.get(path),
          catalogLoaded ? Promise.resolve(null) : api.get('/plans'),
          // The quota only informs the free view; its failure must not block the plan page.
          api.get('/me/quota').catch(() => null),
        ]);

        if (cancelled) return;

        if (catalog) {
          setPlans(catalog.data || []);
          catalogLoaded = true;
        }

        setQuota(quotaInfo?.data || null);

        setState(status.data);
        setLoading(false);
        setRefreshing(false);
        hasLoadedOnce.current = true;

        if (
          status.data.subscription?.accessActive ||
          returnedFromPortal
        ) {
          await refreshUser();
        }

        if (cancelled) return;

        const pending =
          returnedFromPortal ||
          (
            returned === 'success' &&
            status.data.checkout?.status === 'pending'
          );

        if (pending && polls < 15) {
          setWaiting(true);
          polls++;
          timer = setTimeout(load, 2000);
        } else {
          setWaiting(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e);
          setLoading(false);
          setRefreshing(false);
          setWaiting(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    sessionId,
    returned,
    returnedFromPortal,
    revision,
    refreshUser,
  ]);

  // When the user presses Back from Stripe Checkout or the Portal, Chrome can
  // restore this page from the back/forward cache with the buttons still
  // disabled ("Abriendo pago…"). Release the lock and re-read the attempt
  // from the server so the user can continue or discard without reloading.
  // Re-reading the status never creates a checkout session.
  useEffect(() => {
    const onPageShow = event => {
      if (!event.persisted) return;

      action.current = false;
      setBusy(false);
      setRevision(value => value + 1);
    };

    window.addEventListener('pageshow', onPageShow);

    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  async function openPortal() {
    if (action.current) return;

    action.current = true;
    setBusy(true);
    setError(null);

    let redirecting = false;

    try {
      const { data } = await api.post('/billing/portal', {});
      const target = new URL(data.url);

      if (
        target.protocol !== 'https:' ||
        target.hostname !== 'billing.stripe.com' ||
        target.username ||
        target.password
      ) {
        throw Object.assign(
          new Error('No se recibió una dirección válida del portal.'),
          { code: 'INVALID_PORTAL_URL' },
        );
      }

      window.location.assign(target.href);
      redirecting = true;
    } catch (e) {
      setError(e);
    } finally {
      if (!redirecting) {
        action.current = false;
        setBusy(false);
      }
    }
  }

  async function startCheckout(plan, cycle, testId = null) {
    if (action.current) return;

    if (plan === 'uni' && !testId) {
      setError({ code: 'TEST_REQUIRED' });
      return;
    }

    action.current = true;
    setBusy(true);
    setError(null);

    let redirecting = false;

    try {
      const { data } = await api.post('/checkout/sessions', {
        plan,
        billingCycle: cycle,
        ...(plan === 'uni' ? { testId } : {}),
      });

      const target = new URL(data.url);

      if (
        target.protocol !== 'https:' ||
        target.hostname !== 'checkout.stripe.com' ||
        target.username ||
        target.password
      ) {
        throw Object.assign(
          new Error('No se recibió una dirección de pago válida.'),
          { code: 'INVALID_CHECKOUT_URL' },
        );
      }

      window.location.assign(target.href);
      redirecting = true;
    } catch (e) {
      if (e.code === 'PAYMENT_PROCESSING') {
        navigate(
          '/plan?checkout=success' +
          (
            checkout?.id
              ? `&session_id=${encodeURIComponent(checkout.id)}`
              : ''
          ),
          { replace: true },
        );

        setRevision(value => value + 1);
      } else {
        setError(e);
        // La API pudo reservar el intento antes de que fallara la respuesta.
        // Mostrarlo permite retomarlo o descartarlo sin recargar la página.
        try {
          const status = await api.get('/billing/status');
          setState(status.data);
        } catch {
          // Conservar el error original y el botón de actualización manual.
        }
      }
    } finally {
      if (!redirecting) {
        action.current = false;
        setBusy(false);
      }
    }
  }

  async function discardCheckout() {
    if (action.current || !(checkout?.attemptId || checkout?.id)) return;

    action.current = true;
    setBusy(true);
    setError(null);

    try {
      await api.post(
        checkout.attemptId
          ? `/checkout/attempts/${encodeURIComponent(checkout.attemptId)}/cancel`
          : `/checkout/sessions/${encodeURIComponent(checkout.id)}/cancel`,
        {},
      );

      navigate('/plan', { replace: true });
      setRevision(value => value + 1);
    } catch (e) {
      if (e.code === 'PAYMENT_PROCESSING') {
        navigate(
          '/plan?checkout=success' +
          (checkout.id ? `&session_id=${encodeURIComponent(checkout.id)}` : ''),
          { replace: true },
        );

        setRevision(value => value + 1);
      } else {
        setError(e);
      }
    } finally {
      action.current = false;
      setBusy(false);
    }
  }

  const refresh = () => setRevision(value => value + 1);

  if (loading) return <Spinner />;

  const active = sub?.accessActive === true;

  const success =
    returned === 'success' &&
    checkout?.status === 'active' &&
    active;

  const pending = checkout?.status === 'pending';

  const paymentIssue =
    sub &&
    ['active', 'trialing', 'past_due', 'unpaid', 'paused']
      .includes(sub.status) &&
    !active;

  // Subject chosen for a pending "1 unlimited test" attempt. It is not an
  // active benefit until Stripe confirms the payment.
  const checkoutTestLabel =
    checkout?.plan === 'uni' && checkout.testId
      ? testName(checkout.testId)
      : null;

  const selectedTestLabel = selectedTestAvailable
    ? testName(selectedTestId)
    : null;

  const quotaReady =
    quota &&
    Number.isFinite(quota.used) &&
    Number.isFinite(quota.freeMax);

  const quotaResetLabel =
    quota?.resetsAt && Number.isFinite(Date.parse(quota.resetsAt))
      ? new Date(quota.resetsAt).toLocaleTimeString(locale, {
          hour: '2-digit',
          minute: '2-digit',
        })
      : null;

  return (
    <div style={{ maxWidth: 780 }}>
      <style>{`
        .ap-plan-card {
          position: relative;
          border-radius: 18px;
          box-shadow: 0 1px 3px rgba(15, 42, 74, 0.08);
          transition: transform 0.18s ease, box-shadow 0.18s ease;
        }
        .ap-plan-card:hover {
          transform: translateY(-3px);
          box-shadow: 0 12px 28px rgba(15, 42, 74, 0.12);
        }
        .ap-plan-card--selected {
          background: linear-gradient(
            180deg,
            rgba(15, 42, 74, 0.04),
            rgba(15, 42, 74, 0) 65%
          );
        }
        .ap-plan-icon {
          font-size: 22px;
          line-height: 1;
          margin-bottom: 6px;
        }
        .ap-price-tag {
          color: var(--brand);
        }
        .ap-check {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 18px;
          height: 18px;
          border-radius: 999px;
          background: var(--accent);
          color: #fff;
          font-size: 11px;
          flex: none;
        }
        .ap-status-card {
          border-radius: 18px;
          padding: 22px;
          transition: box-shadow 0.18s ease;
        }
        .ap-status-card:hover {
          box-shadow: 0 12px 28px rgba(15, 42, 74, 0.1);
        }
        .ap-status-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 44px;
          height: 44px;
          border-radius: 999px;
          font-size: 20px;
          flex: none;
        }
        .ap-status-icon--ok {
          background: rgba(16, 185, 129, 0.16);
          box-shadow: 0 0 0 6px rgba(16, 185, 129, 0.08);
        }
        .ap-status-icon--warn {
          background: rgba(245, 176, 65, 0.22);
          box-shadow: 0 0 0 6px rgba(245, 176, 65, 0.1);
        }
        .ap-status-icon--danger {
          background: rgba(239, 68, 68, 0.14);
          box-shadow: 0 0 0 6px rgba(239, 68, 68, 0.07);
        }
        .ap-status-icon--brand {
          background: rgba(26, 54, 93, 0.1);
          box-shadow: 0 0 0 6px rgba(26, 54, 93, 0.05);
        }
        .ap-stat-tile {
          flex: 1;
          background: var(--soft);
          border-radius: 12px;
          padding: 12px 14px;
          display: flex;
          flex-direction: column;
          gap: 3px;
        }
        .ap-stat-tile .lbl {
          font-size: 10.5px;
          color: var(--muted);
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .ap-stat-tile .val {
          font-size: 17px;
          font-weight: 800;
          color: var(--brand);
          font-family: 'Montserrat', sans-serif;
        }
        .ap-warn-box {
          background: rgba(245, 176, 65, 0.14);
          border: 1px solid rgba(245, 176, 65, 0.35);
          border-radius: 10px;
          padding: 10px 12px;
        }
        .ap-assignment-box {
          margin-top: 16px;
          background: var(--soft);
          border-radius: 10px;
          padding: 12px 14px;
          overflow-wrap: anywhere;
        }
      `}</style>

      <div className="flex between">
        <div className="h">{t('Mi plan', 'My plan')}</div>
        <span className="tag">{t('Modo de prueba', 'Test mode')}</span>
      </div>

      <p className="p">
        {t(
          'Planes y suscripciones de Aprueba. Precios en dólares estadounidenses.',
          'Aprueba plans and subscriptions. Prices in US dollars.',
        )}
      </p>

      {refreshing && (
        <p className="note" role="status">
          {t('Actualizando…', 'Refreshing…')}
        </p>
      )}

      {sub && (
        <div
          className="card ap-status-card"
          style={{
            marginBottom: 16,
            background:
              'linear-gradient(135deg, rgba(26, 54, 93, 0.05), rgba(255, 255, 255, 0) 55%)',
            borderColor: 'rgba(26, 54, 93, 0.18)',
          }}
        >
          <div className="flex" style={{ gap: 14 }}>
            <span className="ap-status-icon ap-status-icon--brand">
              💳
            </span>

            <div>
              <b style={{ fontSize: 15 }}>
                {t('Gestiona tu suscripción', 'Manage your subscription')}
              </b>

              <p className="note" style={{ margin: '2px 0 0' }}>
                {t(
                  'Cambia tu plan, gestiona la renovación y consulta tu tarjeta y facturas.',
                  'Change your plan, manage renewal, and view your card and invoices.',
                )}
              </p>

              <p className="note" style={{ margin: '10px 0 0' }}>
                <strong>
                  {t('Medio de pago registrado:', 'Registered payment method:')}
                </strong>{' '}
                {paymentMethodLabel}
              </p>
            </div>
          </div>

          <div className="ap-assignment-box">
            <b>
              {t(
                'Prueba incluida al elegir 1 prueba ilimitada',
                'Included test when choosing 1 unlimited test',
              )}
            </b>

            {uniAssignmentLabel ? (
              <p className="note" style={{ margin: '6px 0 0' }}>
                {t(
                  `Si eliges ese plan en Stripe, la prueba asignada será ${uniAssignmentLabel}.`,
                  `If you choose that plan in Stripe, the assigned test will be ${uniAssignmentLabel}.`,
                )}
              </p>
            ) : (
              <p className="note" style={{ margin: '6px 0 0' }}>
                {t(
                  'No se pudo identificar la prueba que se asignaría. Consulta al administrador antes de cambiar a ese plan.',
                  'The test that would be assigned could not be identified. Contact the administrator before switching to that plan.',
                )}
              </p>
            )}

            <p className="note" style={{ margin: '8px 0 0' }}>
              {t(
                'La prueba se elige en Aprueba al realizar la primera compra. Cambiar esa elección en una suscripción existente todavía no está disponible en esta versión.',
                'The test is chosen in Aprueba when making the first purchase. Changing that choice on an existing subscription is not available in this version yet.',
              )}
            </p>
          </div>

          <button
            className="btn sec"
            disabled={busy}
            onClick={openPortal}
            style={{ marginTop: 18 }}
          >
            {busy
              ? t('Espera…', 'Please wait…')
              : t(
                  'Gestionar suscripción en Stripe',
                  'Manage subscription in Stripe',
                )}
          </button>
        </div>
      )}

      {returnedFromPortal && waiting && (
        <p className="note" role="status">
          {t(
            'Comprobando el estado de tu suscripción…',
            'Checking your subscription status…',
          )}
        </p>
      )}

      {error && (
        <div
          className="card ap-status-card"
          role="alert"
          style={{
            marginBottom: 14,
            background:
              'linear-gradient(135deg, rgba(239, 68, 68, 0.08), rgba(255, 255, 255, 0) 55%)',
            borderColor: 'rgba(239, 68, 68, 0.35)',
          }}
        >
          <div
            className="flex"
            style={{ gap: 14, alignItems: 'flex-start' }}
          >
            <span className="ap-status-icon ap-status-icon--danger">
              ❗
            </span>

            <p
              style={{
                margin: 0,
                fontWeight: 700,
                color: 'var(--danger)',
              }}
            >
              {errorLabel(error)}
            </p>
          </div>

          <button
            className="btn sec"
            disabled={busy}
            onClick={() => {
              navigate('/plan', { replace: true });
              refresh();
            }}
            style={{ marginTop: 18 }}
          >
            {t('Actualizar estado', 'Refresh status')}
          </button>
        </div>
      )}

      {success && (
        <div
          className="card"
          role="status"
          style={{
            marginBottom: 14,
            borderColor: 'var(--accent)',
          }}
        >
          <div className="h" style={{ color: 'var(--accent)' }}>
            {t('¡Pago confirmado!', 'Payment confirmed!')}
          </div>

          <p className="p">
            {t('Tu suscripción está activa.', 'Your subscription is active.')}
          </p>

          <button className="btn" onClick={() => navigate('/')}>
            {t('Ir al inicio', 'Go to home')}
          </button>
        </div>
      )}

      {!active && !paymentIssue && user?.plan === 'free' && (
        <div
          className="card ap-status-card"
          style={{ marginBottom: 16 }}
        >
          <div className="flex between">
            <div className="flex" style={{ gap: 14 }}>
              <span className="ap-status-icon ap-status-icon--brand">
                🎓
              </span>

              <div>
                <b style={{ fontSize: 16 }}>
                  {t('Plan actual', 'Current plan')}
                </b>

                <p className="note" style={{ margin: '2px 0 0' }}>
                  {t(
                    'Practicas con la cuota gratuita diaria.',
                    'You practice with the free daily quota.',
                  )}
                </p>
              </div>
            </div>

            <span className="tag">{L('plan_free')}</span>
          </div>

          {quotaReady ? (
            <>
              <div className="flex" style={{ gap: 12, marginTop: 20 }}>
                <div className="ap-stat-tile">
                  <span className="lbl">
                    {t('Cuota diaria', 'Daily quota')}
                  </span>
                  <span className="val">
                    {t(
                      `${quota.freeMax} preguntas`,
                      `${quota.freeMax} questions`,
                    )}
                  </span>
                </div>

                <div className="ap-stat-tile">
                  <span className="lbl">
                    {t('Usadas hoy', 'Used today')}
                  </span>
                  <span className="val">
                    {Math.min(quota.used, quota.freeMax)} / {quota.freeMax}
                  </span>
                </div>
              </div>

              <p className="note" style={{ marginTop: 14 }}>
                {t(
                  'La cuota base es de 10 preguntas al día. Declarar tu colegio y tu dirección suma 5 cada uno, hasta 20.',
                  'The base quota is 10 questions per day. Declaring your school and your address adds 5 each, up to 20.',
                )}
                {quotaResetLabel &&
                  t(
                    ` Se reinicia a las ${quotaResetLabel}`,
                    ` It resets at ${quotaResetLabel}`,
                  ) + (quotaResetLabel.endsWith('.') ? '' : '.')}
              </p>
            </>
          ) : (
            <p className="note" style={{ marginTop: 14 }}>
              {t(
                'No se pudo cargar tu cuota diaria. Actualiza el estado para reintentar.',
                'Your daily quota could not be loaded. Refresh the status to try again.',
              )}
            </p>
          )}
        </div>
      )}

      {active ? (
        <div
          className="card ap-status-card"
          style={{
            background:
              'linear-gradient(135deg, rgba(16, 185, 129, 0.07), rgba(255, 255, 255, 0) 55%)',
            borderColor: 'rgba(16, 185, 129, 0.3)',
          }}
        >
          <div className="flex between">
            <div className="flex" style={{ gap: 14 }}>
              <span className="ap-status-icon ap-status-icon--ok">
                ✅
              </span>

              <div>
                <b style={{ fontSize: 16 }}>
                  {t('Plan actual', 'Current plan')}
                </b>

                <p className="note" style={{ margin: '2px 0 0' }}>
                  {sub.paymentPending
                    ? t(
                        'Pago pendiente, acceso ya pagado vigente',
                        'Payment pending, previously paid access remains valid',
                      )
                    : sub.cancelAtPeriodEnd
                      ? t(
                          'Renovación cancelada, acceso vigente',
                          'Renewal canceled, access remains valid',
                        )
                      : t('Suscripción activa', 'Active subscription')}
                </p>
              </div>
            </div>

            <span className="tag g">{nameOf(sub.plan)}</span>
          </div>

          <div className="flex" style={{ gap: 12, marginTop: 20 }}>
            <div className="ap-stat-tile">
              <span className="lbl">{t('Ciclo', 'Billing cycle')}</span>
              <span className="val">{cycleName(sub.billingCycle)}</span>
            </div>

            <div className="ap-stat-tile">
              <span className="lbl">
                {sub.cancelAtPeriodEnd || sub.paymentPending
                  ? t('Acceso hasta', 'Access until')
                  : t('Fin del período', 'Period end')}
              </span>
              <span className="val">{dateLabel(sub.currentPeriodEnd)}</span>
            </div>
          </div>

          {sub.plan === 'uni' && sub.testId && (
            <p className="note" style={{ marginTop: 14 }}>
              {t('Prueba ilimitada:', 'Unlimited test:')}{' '}
              {testName(sub.testId)}
            </p>
          )}

          {sub.paymentPending && (
            <div
              className="ap-warn-box"
              role="status"
              style={{ marginTop: 14 }}
            >
              <p className="note" style={{ color: '#B45309' }}>
                {t(
                  'Hay un pago pendiente en Stripe. Conservas el plan ya pagado hasta la fecha indicada. Un cambio de plan que requiera pago se habilitará cuando se confirme su cobro.',
                  'There is a pending payment in Stripe. You retain your previously paid plan until the date shown. A plan change requiring payment will take effect once that payment is confirmed.',
                )}
              </p>
            </div>
          )}

          {sub.cancelAtPeriodEnd && (
            <div className="ap-warn-box" style={{ marginTop: 14 }}>
              <p className="note" style={{ color: '#B45309' }}>
                {t(
                  'La renovación está cancelada. Mantienes el acceso hasta el fin del período.',
                  'Renewal is canceled. You retain access until the end of the period.',
                )}
              </p>
            </div>
          )}

          <button
            className="btn sec"
            disabled={busy}
            onClick={refresh}
            style={{ marginTop: 18 }}
          >
            {t('Actualizar estado', 'Refresh status')}
          </button>
        </div>
      ) : pending ? (
        <div className="card" aria-live="polite">
          <div className="h">
            {returned === 'success'
              ? t('Confirmando tu pago', 'Confirming your payment')
              : t('Tienes un pago pendiente', 'You have a pending payment')}
          </div>

          <p className="p">
            {nameOf(checkout.plan)}
            {checkoutTestLabel && ` · ${checkoutTestLabel}`}
            {' · '}
            {cycleName(checkout.billingCycle)}
            {' · '}USD {amountLabel(checkout.amount)}
          </p>

          {checkoutTestLabel && (
            <p className="note">
              {t(
                `Prueba elegida para esta compra: ${checkoutTestLabel}. Quedará ilimitada cuando se confirme el pago.`,
                `Test chosen for this purchase: ${checkoutTestLabel}. It becomes unlimited once the payment is confirmed.`,
              )}
            </p>
          )}

          <p className="note">
            {returned === 'success'
              ? t(
                  'Estamos esperando la confirmación del pago. Si ya lo completaste, actualiza el estado en unos instantes.',
                  'We are waiting for payment confirmation. If you have already completed it, refresh the status in a few moments.',
                )
              : t(
                  'Puedes continuar con esta compra o descartarla para elegir otro plan.',
                  'You can continue this purchase or discard it to choose another plan.',
                )}
          </p>

          {waiting && (
            <p className="note">
              {t('Comprobando automáticamente…', 'Checking automatically…')}
            </p>
          )}

          <div className="flex" style={{ gap: 10, flexWrap: 'wrap' }}>
            {returned !== 'success' && (
              <button
                className="btn"
                disabled={
                  busy ||
                  (checkout.plan === 'uni' && !checkout.testId)
                }
                onClick={() => startCheckout(
                  checkout.plan,
                  checkout.billingCycle,
                  checkout.testId,
                )}
              >
                {busy
                  ? t('Espera…', 'Please wait…')
                  : t('Continuar al pago', 'Proceed to payment')}
              </button>
            )}

            {checkout.plan === 'uni' && !checkout.testId && (
              <p className="note">
                {t(
                  'Este intento no tiene una prueba elegida. Descártalo y selecciona la prueba para iniciar otra compra.',
                  'No test was selected for this attempt. Discard it and choose a test to start another purchase.',
                )}
              </p>
            )}

            <button
              className="btn sec"
              disabled={busy || waiting}
              onClick={refresh}
            >
              {t('Actualizar estado', 'Refresh status')}
            </button>

            {returned !== 'success' && (checkout.attemptId || checkout.id) && (
              <button
                className="btn gho"
                disabled={busy}
                onClick={discardCheckout}
              >
                {t('Descartar intento', 'Discard attempt')}
              </button>
            )}
          </div>
        </div>
      ) : paymentIssue ? (
        <div
          className="card ap-status-card"
          style={{
            background:
              'linear-gradient(135deg, rgba(245, 176, 65, 0.12), rgba(255, 255, 255, 0) 55%)',
            borderColor: 'rgba(245, 176, 65, 0.45)',
          }}
        >
          <div
            className="flex"
            style={{ gap: 14, alignItems: 'flex-start' }}
          >
            <span className="ap-status-icon ap-status-icon--warn">
              ⚠️
            </span>

            <div>
              <div
                className="h"
                style={{ color: '#B45309', marginBottom: 4 }}
              >
                {t(
                  'Suscripción pendiente de regularización',
                  'Subscription requires attention',
                )}
              </div>

              <p className="note">
                {t(
                  'El plan de pago todavía no tiene acceso activo. Actualiza el estado antes de intentar otra compra.',
                  'The paid plan does not have active access yet. Refresh the status before attempting another purchase.',
                )}
              </p>
            </div>
          </div>

          <button
            className="btn sec"
            onClick={refresh}
            style={{ marginTop: 18 }}
          >
            {t('Actualizar estado', 'Refresh status')}
          </button>
        </div>
      ) : (
        <>
          {checkout?.status === 'expired' && (
            <p className="note">
              {t(
                'La sesión de pago terminó. Puedes iniciar otra compra.',
                'The checkout session ended. You can start another purchase.',
              )}
            </p>
          )}

          {checkout?.status === 'ended' && (
            <p className="note">
              {t(
                'Esta compra ya no corresponde a una suscripción activa.',
                'This purchase no longer corresponds to an active subscription.',
              )}
            </p>
          )}

          <div className="flex" style={{ gap: 10, marginTop: 12 }}>
            <button
              className={`btn ${billing === 'monthly' ? '' : 'sec'}`}
              disabled={busy}
              onClick={() => setBilling('monthly')}
            >
              {t('Mensual', 'Monthly')}
            </button>

            <button
              className={`btn ${billing === 'yearly' ? '' : 'sec'}`}
              disabled={busy}
              onClick={() => setBilling('yearly')}
            >
              {t('Anual · 2 meses gratis', 'Yearly · 2 months free')}
            </button>
          </div>

          <div className="plan-grid">
            {plans.map(plan => {
              const isSelected = selectedPlan
                ? selectedPlan === plan.id
                : plan.popular;

              return (
                <div
                  key={plan.id}
                  className={`card ap-plan-card${
                    isSelected ? ' ap-plan-card--selected' : ''
                  }`}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedPlan(plan.id)}
                  onKeyDown={e => {
                    if (e.target !== e.currentTarget) return;

                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedPlan(plan.id);
                    }
                  }}
                  style={{
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    minHeight: 340,
                    ...(isSelected
                      ? {
                          border: '2px solid var(--brand)',
                          boxShadow: '0 0 0 1px var(--brand)',
                        }
                      : {}),
                  }}
                >
                  <div className="ap-plan-icon">
                    {plan.id === 'all' ? '🚀' : '🎯'}
                  </div>

                  <div className="flex between">
                    <b>{nameOf(plan.id)}</b>

                    {plan.popular && (
                      <span className="tag g">
                        {t('Más elegido', 'Most popular')}
                      </span>
                    )}
                  </div>

                  <div
                    className="ap-price-tag"
                    style={{
                      fontSize: 28,
                      fontWeight: 800,
                      margin: '14px 0 18px',
                    }}
                  >
                    USD {amountLabel(plan.price[billing])}
                    <small style={{ fontSize: 14 }}>
                      /{periodName(billing)}
                    </small>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10,
                    }}
                  >
                    {(plan.features || []).map((feature, i) => (
                      <p
                        className="note"
                        key={i}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          margin: 0,
                          lineHeight: 1.4,
                        }}
                      >
                        <span className="ap-check">✓</span>
                        {featureLabel(feature)}
                      </p>
                    ))}
                  </div>

                  {plan.id === 'uni' && (
                    <div
                      style={{ marginTop: 18 }}
                      onClick={event => event.stopPropagation()}
                    >
                      <label
                        htmlFor="plan-test"
                        className="note"
                        style={{
                          display: 'block',
                          marginBottom: 6,
                        }}
                      >
                        {t(
                          'Elige la prueba que tendrás ilimitada',
                          'Choose your unlimited test',
                        )}
                      </label>

                      <select
                        id="plan-test"
                        value={selectedTestId}
                        disabled={
                          busy || testsLoading || tests.length === 0
                        }
                        onChange={event => {
                          setSelectedTestId(event.target.value);
                          setSelectedPlan('uni');
                          setError(null);
                        }}
                        onKeyDown={event => event.stopPropagation()}
                        style={{ width: '100%' }}
                      >
                        <option value="">
                          {t('Selecciona una prueba', 'Select a test')}
                        </option>

                        {tests.map(test => (
                          <option key={test.id} value={test.id}>
                            {test.label}
                          </option>
                        ))}
                      </select>

                      {testsLoading && (
                        <p className="note" role="status">
                          {t('Cargando pruebas…', 'Loading tests…')}
                        </p>
                      )}

                      {testsError && (
                        <p className="note" role="alert">
                          {t(
                            'No se pudieron cargar las pruebas disponibles. Recarga la página.',
                            'Available tests could not be loaded. Reload the page.',
                          )}
                        </p>
                      )}

                      {selectedTestLabel && (
                        <p
                          className="note"
                          role="status"
                          style={{ marginTop: 8 }}
                        >
                          {t(
                            `Vas a contratar 1 prueba ilimitada en ${selectedTestLabel}.`,
                            `You are purchasing 1 unlimited test in ${selectedTestLabel}.`,
                          )}
                        </p>
                      )}

                      {!testsLoading &&
                        !testsError &&
                        tests.length === 0 && (
                          <p className="note">
                            {t(
                              'No hay pruebas disponibles para este grado.',
                              'There are no available tests for this grade.',
                            )}
                          </p>
                        )}
                    </div>
                  )}

                  <p
                    className="note"
                    style={{ marginTop: 16, marginBottom: 0 }}
                  >
                    {billing === 'yearly'
                      ? t(
                          'Cobro anual recurrente.',
                          'Recurring yearly billing.',
                        )
                      : t(
                          'Cobro mensual recurrente.',
                          'Recurring monthly billing.',
                        )}
                  </p>

                  <button
                    className={`btn ${isSelected ? '' : 'sec'} full`}
                    disabled={
                      busy ||
                      (plan.id === 'uni' && !selectedTestAvailable)
                    }
                    style={{ marginTop: 'auto' }}
                    onClick={e => {
                      e.stopPropagation();
                      setSelectedPlan(plan.id);

                      startCheckout(
                        plan.id,
                        billing,
                        selectedTestId,
                      );
                    }}
                  >
                    {busy
                      ? t('Abriendo pago…', 'Opening checkout…')
                      : t('Continuar al pago', 'Proceed to payment')}
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
