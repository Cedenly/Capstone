import { useEffect, useState } from 'react';
import { api, qs } from '../api/client.js';
import { Card, Kpi, Tabs, Loading, ErrorBox } from '../components/ui.jsx';

export default function Billing({ ctx }) {
  const { L, lang } = ctx;
  const t = (es, en) => lang === 'en' ? en : es;
  const locale = lang === 'en' ? 'en-US' : 'es-CL';
  const [kind, setKind] = useState('subscriptions');
  const [cursors, setCursors] = useState([null]);
  const [page, setPage] = useState(0);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const cursor = cursors[page];
  const subscriptions = kind === 'subscriptions';

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setError('');
    api.get(`/billing/${kind}${qs({ cursor })}`)
      .then(response => { if (!cancelled) setResult(response); })
      .catch(err => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [kind, cursor, revision]);

  function changeTab(value) {
    if (value === kind) return;
    setResult(null); setError(''); setSearch('');
    setKind(value); setCursors([null]); setPage(0);
  }
  function refresh() {
    setResult(null); setError(''); setCursors([null]); setPage(0);
    setRevision(value => value + 1);
  }
  function move(next) {
    if (next) {
      setCursors(values => [...values.slice(0, page + 1), result.meta.pagination.nextCursor]);
    }
    setResult(null); setSearch(''); setPage(value => value + (next ? 1 : -1));
  }
  const needle = search.trim().toLowerCase();
  const rows = (result?.data || []).filter(row =>
    [row.id, row.user.name, row.user.email, row.subscriptionId]
      .some(value => String(value || '').toLowerCase().includes(needle)));
  const paid = rows.filter(row => row.status === 'paid');
  const paidCents = paid.every(row => Number.isSafeInteger(row.amountCents))
    ? paid.reduce((total, row) => total + row.amountCents, 0) : null;
  const money = cents => Number.isSafeInteger(cents)
    ? `USD ${(cents / 100).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
  const date = value => value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleDateString(locale) : '—';
  const status = value => ({
    active: t('Activa', 'Active'), canceled: t('Cancelada', 'Canceled'),
    past_due: t('Pago atrasado', 'Past due'), unpaid: t('Impaga', 'Unpaid'),
    incomplete: t('Incompleta', 'Incomplete'), incomplete_expired: t('Expirada', 'Expired'),
    trialing: t('En prueba', 'Trialing'), paused: t('Pausada', 'Paused'),
    paid: t('Pagada', 'Paid'), open: t('Pendiente', 'Open'),
    draft: t('Borrador', 'Draft'), void: t('Anulada', 'Void'),
    uncollectible: t('Incobrable', 'Uncollectible'),
  }[value] || value || '—');
  const plan = value => ({ uni: t('1 prueba ilimitada', '1 unlimited test'),
    all: t('Todas las pruebas', 'All tests') }[value] || value || '—');
  const busy = !result && !error;
  const nextCursor = result?.meta?.pagination?.nextCursor;

  return <>
    <div className="flex between wrap" style={{ marginBottom: 16 }}>
      <div>
        <h2>{t('Facturación', 'Billing')}</h2>
        <p className="note">{t('Suscripciones y facturas sincronizadas con Stripe.', 'Subscriptions and invoices synced with Stripe.')}</p>
        <span className="tag w">{t('Modo de prueba · Sin cobros reales', 'Test mode · No real charges')}</span>
      </div>
      <button className="btn sec" onClick={refresh} disabled={busy}>{t('Actualizar', 'Refresh')}</button>
    </div>
    <Tabs active={kind} onChange={changeTab} tabs={[
      { id: 'subscriptions', label: t('Suscripciones', 'Subscriptions') },
      { id: 'invoices', label: t('Facturas', 'Invoices') },
    ]} />
    {error && <ErrorBox msg={error} onRetry={refresh} L={L} />}
    {busy && <Loading L={L} />}
    {result && <>
      <input value={search} onChange={event => setSearch(event.target.value)}
        aria-label={t('Buscar en esta página', 'Search this page')}
        placeholder={t('Buscar en esta página por usuario, correo o ID', 'Search this page by user, email or ID')}
        style={{ width: '100%', marginBottom: 16 }} />
      <div className="grid g3" style={{ marginBottom: 16 }}>
        <Kpi label={t('Registros mostrados', 'Displayed records')} value={rows.length} />
        <Kpi label={subscriptions ? t('Con acceso habilitado', 'Access enabled') : t('Facturas pagadas mostradas', 'Displayed paid invoices')}
          value={subscriptions ? rows.filter(row => row.accessActive).length : paid.length} />
        <Kpi label={subscriptions ? t('Renovaciones canceladas', 'Canceled renewals') : t('Pagado en esta página', 'Paid on this page')}
          value={subscriptions ? rows.filter(row => row.status === 'active' && row.cancelAtPeriodEnd).length : money(paidCents)} />
      </div>
      <Card>
        <p className="note">{t('Los indicadores corresponden a las filas mostradas. Se incluyen solo registros de Stripe en modo de prueba.', 'Indicators cover the displayed rows. Only Stripe test records are included.')}</p>
        <div className="tbl-wrap">
          <table style={{ minWidth: 850 }}>
            <thead><tr>{(subscriptions
              ? [t('Usuario', 'User'), t('Plan y suscripción', 'Plan and subscription'), t('Estado', 'Status'), t('Acceso', 'Access'), t('Vigencia y renovación', 'Period and renewal')]
              : [t('Usuario', 'User'), t('Factura', 'Invoice'), t('Estado', 'Status'), t('Importe', 'Amount'), t('Documentos', 'Documents')]
            ).map(label => <th key={label}>{label}</th>)}</tr></thead>
            <tbody>{rows.map(row => <tr key={row.id}>
              <td><b>{row.user.name || t('Usuario no disponible', 'User unavailable')}</b><div className="note">{row.user.email || row.user.id}</div></td>
              <td style={{ maxWidth: 290, overflowWrap: 'anywhere' }}>
                {subscriptions && <>
                  <b>{plan(row.plan)}</b>
                  {row.plan === 'uni' && (
                    <div className="note">
                      {t('Prueba ilimitada:', 'Unlimited test:')}{' '}
                      {row.testLabel || row.testId || t('No informada', 'Not specified')}
                    </div>
                  )}
                  <div className="note">
                    {row.billingCycle === 'monthly'
                      ? t('Mensual', 'Monthly')
                      : row.billingCycle === 'yearly'
                        ? t('Anual', 'Yearly')
                        : '—'}
                  </div>
                </>}
                <div className="note">{row.id}</div>
                {!subscriptions && <div className="note">{t('Emitida:', 'Issued:')} {date(row.createdAt)}<br />{t('Pagada:', 'Paid:')} {date(row.paidAt)}</div>}
              </td>
              <td>
                <span className={`tag ${['active', 'paid'].includes(row.status) ? 'g' : 'w'}`}>
                  {status(row.status)}
                </span>
                {subscriptions && row.paymentPending === true && (
                  <div style={{ marginTop: 6 }}>
                    <span className="tag w">
                      {t('Pago pendiente', 'Payment pending')}
                    </span>
                    {row.accessActive && (
                      <div className="note" style={{ marginTop: 4 }}>
                        {t('Acceso ya pagado vigente', 'Previously paid access remains valid')}
                      </div>
                    )}
                  </div>
                )}
              </td>
              <td>{subscriptions ? (row.accessActive ? t('Habilitado', 'Enabled') : t('No habilitado', 'Not enabled')) : money(row.amountCents)}</td>
              <td>{subscriptions ? <>
                <div>{t('Fin del período:', 'Period end:')} {date(row.currentPeriodEnd)}</div>
                <div className="note">{row.cancelAtPeriodEnd ? t('Renovación cancelada', 'Renewal canceled') : row.status === 'active' ? t('Renovación automática', 'Automatic renewal') : '—'}</div>
              </> : <div className="flex wrap">
                {row.hostedInvoiceUrl && <a className="btn sec sm" href={row.hostedInvoiceUrl} target="_blank" rel="noopener noreferrer">{t('Ver factura', 'View invoice')}</a>}
                {row.pdfUrl && <a className="btn sec sm" href={row.pdfUrl} target="_blank" rel="noopener noreferrer">PDF</a>}
                {!row.hostedInvoiceUrl && !row.pdfUrl && '—'}
              </div>}</td>
            </tr>)}</tbody>
          </table>
          {!rows.length && <p className="note">{t('No hay registros para mostrar.', 'No records to display.')}</p>}
        </div>
        <div className="pager">
          <span className="note">{t('Página', 'Page')} {page + 1} · {t('Hasta 25 registros por página', 'Up to 25 records per page')}</span>
          <div className="flex">
            <button className="btn sec sm" disabled={page === 0} onClick={() => move(false)}>{t('Anterior', 'Previous')}</button>
            <button className="btn sec sm" disabled={!nextCursor} onClick={() => move(true)}>{t('Siguiente', 'Next')}</button>
          </div>
        </div>
      </Card>
    </>}
  </>;
}
