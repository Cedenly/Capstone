import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { Kpi, Card, StatusPill, Loading, LineChart, Donut, Bars, ErrorBox } from '../components/ui.jsx';

export default function Overview({ ctx }) {
  const { L, fmt } = ctx;
  const nav = useNavigate();
  const [d, setD] = useState(null);
  const [services, setServices] = useState([]);
  const [err, setErr] = useState(null);

  const load = async () => {
    setErr(null);
    try {
      setD((await api.get('/metrics/overview')).data);
      // El detalle de servicios solo lo puede leer operaciones: si el rol no
      // llega, la tarjeta cae al resumen agregado de systemHealth.
      try { setServices((await api.get('/services')).data); } catch { setServices([]); }
    } catch (e) { setErr(e.message); }
  };
  useEffect(() => { load(); }, []);

  if (err) return <Card><ErrorBox msg={err} onRetry={load} L={L} /></Card>;
  if (!d) return <Loading L={L} />;

  const down = services.filter((s) => s.state !== 'ok').length;
  const planColor = { uni: 'var(--brand)', all: 'var(--cta)' };
  const revBars = (d.revenueByPlan || []).map((r) => ({ label: r.plan, value: r.value, color: planColor[r.plan] || 'var(--brand)', disp: '$' + fmt(r.value) }));

  return (
    <>
      <div className="grid g4">
        <Kpi ic="⬇️" label={L('k_downloads')} value={fmt(d.downloads?.total)} delta={`${fmt(d.downloads?.month)} ${L('this_month')}`} up />
        <Kpi ic="👤" label={L('k_mau')} value={fmt(d.mau?.value)} delta={`${d.mau?.deltaPct}% ${L('vs_prev')}`} up />
        <Kpi ic="⭐" label={L('k_converted')} value={fmt(d.converted?.value)} delta={`${d.converted?.rate}% ${L('conv_of_mau')}`} up />
        <Kpi ic="💰" label={L('k_mrr')} value={`$${fmt(d.mrr?.value)}`} delta={`${d.mrr?.deltaPct}% ${L('vs_prev')}`} up />
      </div>
      <div className="grid g3" style={{ marginTop: 16 }}>
        <Card className="span2">
          <div className="flex between"><b>{L('c_downloads_trend')}</b><span className="note">{L('this_month')}: {fmt(d.downloads?.month)}</span></div>
          <LineChart vals={(d.downloadsByMonth || []).map((m) => m.value)} labels={(d.downloadsByMonth || []).map((m) => m.month)} />
        </Card>
        <Card>
          <b>{L('c_funnel')}</b>
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}><Donut pct={d.converted?.rate || 0} /></div>
        </Card>
      </div>
      <div className="grid g2" style={{ marginTop: 16 }}>
        <Card>
          <div className="flex between" style={{ marginBottom: 10 }}>
            <b>{L('health')}</b>
            <span className={`tag ${down ? 'w' : 'g'}`}>{down ? `${down} ⚠` : L('all_ok')}</span>
          </div>
          {services.length === 0 && <div className="note">{d.systemHealth?.status} · {d.systemHealth?.servicesDown} ⚠</div>}
          {services.map((s) => (
            <div key={s.id} className="flex between" style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
              <span>{s.name}</span><StatusPill state={s.state} L={L} />
            </div>
          ))}
          <div style={{ textAlign: 'right', marginTop: 8 }}>
            <span className="note" style={{ color: 'var(--brand)', cursor: 'pointer', fontWeight: 700 }} onClick={() => nav('/operativa')}>{L('see_detail')} →</span>
          </div>
        </Card>
        <Card>
          <b>{L('c_rev_plan')}</b>
          <Bars data={revBars} />
          <div className="divider" />
          <div className="grid g2">
            <Kpi ic="🤝" label={L('k_sponsors')} value={fmt(d.sponsorsActive)} />
            <Kpi ic="🏅" label={L('k_badges')} value={fmt(d.badgesIssued)} />
          </div>
        </Card>
      </div>
    </>
  );
}
