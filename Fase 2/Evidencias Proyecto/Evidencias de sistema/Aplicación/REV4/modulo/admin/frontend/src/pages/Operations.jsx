import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { Card, StatusPill, Loading } from '../components/ui.jsx';

export default function Operations({ ctx }) {
  const { L, fmt } = ctx;
  const [platforms, setPlatforms] = useState(null);
  const [services, setServices] = useState([]);
  const [containers, setContainers] = useState([]);
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);

  const load = async () => {
    try {
      const [p, s, c] = await Promise.all([api.get('/platforms'), api.get('/services'), api.get('/containers')]);
      setPlatforms(p.data); setServices(s.data); setContainers(c.data);
    } catch (e) { setErr(e.message); }
  };
  useEffect(() => { load(); }, []);

  const restart = async (name) => {
    await api.post(`/containers/${encodeURIComponent(name)}/restart`);
    setMsg(`${L('restarted')}: ${name}`); load();
    setTimeout(() => setMsg(null), 2500);
  };

  if (err) return <Card><b>⛔ {err}</b></Card>;
  if (!platforms) return <Loading L={L} />;
  const dotClass = (st) => (st === 'ok' ? 'ok' : st === 'deg' ? 'deg' : 'down');

  return (
    <>
      {msg && <div className="tag g" style={{ marginBottom: 12 }}>{msg}</div>}
      <Card>
        <b>{L('o_stores')}</b>
        <div className="tbl-wrap" style={{ marginTop: 8 }}><table>
          <thead><tr><th>{L('o_platform')}</th><th>{L('o_version')}</th><th>{L('o_available')}</th><th>{L('o_dl')}</th><th>{L('o_updated')}</th></tr></thead>
          <tbody>{platforms.map((p) => (
            <tr key={p.id}><td><b>{p.platform}</b></td><td><span className="tag">v{p.version}</span></td>
              <td>{p.available ? <span className="tag g">{L('yes')}</span> : <span className="tag d">{L('no')}</span>}</td>
              <td>{p.downloads ? fmt(p.downloads) : '—'}</td><td className="note">{p.updatedAt}</td></tr>
          ))}</tbody>
        </table></div>
      </Card>
      <div className="grid g2" style={{ marginTop: 16 }}>
        <Card>
          <b>{L('o_services')}</b>
          {services.map((s) => (
            <div key={s.id} className="svc-row">
              <span className={`dot ${dotClass(s.state)}`} />
              <div style={{ flex: 1 }}><div style={{ fontWeight: 600, fontSize: 13 }}>{s.name}</div><div className="note">{L('o_uptime')} {s.uptime} · {L('o_latency')} {s.latency || '—'}</div></div>
              <StatusPill state={s.state} L={L} />
            </div>
          ))}
        </Card>
        <Card>
          <b>{L('o_containers')}</b>
          <div className="tbl-wrap" style={{ marginTop: 8 }}><table>
            <thead><tr><th></th><th>{L('o_cpu')}</th><th>{L('o_mem')}</th><th></th></tr></thead>
            <tbody>{containers.map((c) => (
              <tr key={c.id}>
                <td><span className={`dot ${dotClass(c.state)}`} style={{ marginRight: 7 }} /><b style={{ fontSize: 12.5 }}>{c.name}</b><div className="note">{c.region} · {c.state === 'down' ? L('st_stop') : L('st_run')}</div></td>
                <td style={{ minWidth: 70 }}><div className="note">{c.cpu}%</div><div className="bar"><i style={{ width: `${c.cpu}%`, background: c.cpu > 75 ? 'var(--down)' : 'var(--brand)' }} /></div></td>
                <td style={{ minWidth: 70 }}><div className="note">{c.mem}%</div><div className="bar"><i style={{ width: `${c.mem}%`, background: c.mem > 80 ? 'var(--down)' : 'var(--accent)' }} /></div></td>
                <td><button className="btn sec sm" onClick={() => restart(c.name)}>{L('o_restart')}</button></td>
              </tr>
            ))}</tbody>
          </table></div>
        </Card>
      </div>
    </>
  );
}
