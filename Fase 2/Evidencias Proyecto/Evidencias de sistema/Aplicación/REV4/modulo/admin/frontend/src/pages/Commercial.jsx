import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { Kpi, Card, Loading, LineChart, Funnel, Bars, HBars, COIN, ErrorBox } from '../components/ui.jsx';

export default function Commercial({ ctx }) {
  const { L, fmt } = ctx;
  const [d, setD] = useState(null);
  const [ov, setOv] = useState(null);
  const [err, setErr] = useState(null);

  const load = async () => {
    setErr(null);
    try {
      // Se piden juntos para no renderizar con la serie mensual a medias.
      // La serie vive en el resumen, ya legible por finanzas.
      const [c, o] = await Promise.all([api.get('/metrics/commercial'), api.get('/metrics/overview')]);
      setD(c.data); setOv(o.data);
    } catch (e) { setErr(e.message); }
  };
  useEffect(() => { load(); }, []);

  if (err) return <Card><ErrorBox msg={err} onRetry={load} L={L} /></Card>;
  if (!d || !ov) return <Loading L={L} />;

  const months = ov?.downloadsByMonth || [];
  const planColor = { uni: 'var(--brand)', all: 'var(--cta)' };
  const revBars = (d.revenueByPlan || []).map((r) => ({ label: r.plan, value: r.value, color: planColor[r.plan] || 'var(--brand)', disp: '$' + fmt(r.value) }));
  const badgeBars = (d.badgesByType || []).map((b) => ({ label: `${COIN[b.tier]} ${L('tier_' + b.tier)}`, value: b.value, disp: fmt(b.value), color: `var(--${b.tier})` }));

  return (
    <>
      <div className="grid g4">
        <Kpi ic="⬇️" label={L('k_downloads')} value={fmt(d.downloads)} up />
        <Kpi ic="👤" label={L('k_dau')} value={fmt(d.dau)} />
        <Kpi ic="📈" label={L('k_mau')} value={fmt(d.mau)} up />
        <Kpi ic="⭐" label={L('k_converted')} value={`${fmt(d.converted)} · ${d.convRate}%`} up />
        <Kpi ic="💰" label={L('k_mrr')} value={`$${fmt(d.mrr)}`} up />
        <Kpi ic="🎁" label={L('k_benefits')} value={fmt(d.benefitsRedeemed)} />
      </div>
      <div className="grid g2" style={{ marginTop: 16 }}>
        <Card><b>{L('c_downloads_trend')}</b><LineChart vals={months.map((m) => m.value)} labels={months.map((m) => m.month)} /></Card>
        <Card><b>{L('c_funnel')}</b><Funnel data={(d.funnel || []).map((f) => ({ label: `${f.label}: ${fmt(f.value)}`, value: f.value }))} /></Card>
        <Card>
          <b>{L('c_rev_plan')}</b><Bars data={revBars} />
          <div className="flex between note" style={{ marginTop: 6 }}><span>{L('c_rev_total')}</span><b style={{ color: 'var(--ink)' }}>${fmt(d.mrr)}{L('mo')}</b></div>
        </Card>
        <Card><b>{L('c_badges_type')}</b><HBars data={badgeBars} /></Card>
      </div>
    </>
  );
}
