import React, { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { Bar, Spinner, Toast, initials } from '../components/ui.jsx';

const COLORS = ['#1A365D', '#10B981', '#6366F1', '#F5B041', '#EF4444'];

export default function Groups() {
  const { L, user } = useAuth();
  const [groups, setGroups] = useState(null);
  const [open, setOpen] = useState(null); // group detail
  const [tests, setTests] = useState([]);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', subjectTestId: '' });
  const [toast, setToast] = useState('');
  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2500); };

  const loadList = async () => { const { data } = await api.get('/groups'); setGroups(data); };
  useEffect(() => { loadList().catch(() => setGroups([])); api.get('/tests').then(({ data }) => { setTests(data); setForm((f) => ({ ...f, subjectTestId: data[0]?.id || '' })); }); }, []);

  const create = async () => {
    if (!form.name) return;
    try { await api.post('/groups', form); setCreating(false); setForm({ name: '', subjectTestId: tests[0]?.id || '' }); await loadList(); flash('✓'); }
    catch (e) { flash(e.message); }
  };

  if (open) return <GroupDetail id={open} onBack={() => { setOpen(null); loadList(); }} L={L} user={user} flash={flash} toast={toast} />;
  if (!groups) return <Spinner />;

  return (
    <>
      <Toast msg={toast} />
      <div className="flex between" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div className="h">{L('grp_my')}</div>
        <button className="btn" onClick={() => setCreating(!creating)}>+ {L('grp_create')}</button>
      </div>
      {creating && (
        <div className="card" style={{ marginTop: 12 }}>
          <label className="fld">{L('grp_name_ph')}</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={L('grp_name_ph')} />
          <label className="fld">{L('grp_subject')}</label>
          <select value={form.subjectTestId} onChange={(e) => setForm({ ...form, subjectTestId: e.target.value })}>
            {tests.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          <button className="btn full" style={{ marginTop: 12 }} onClick={create}>{L('grp_create_btn')}</button>
        </div>
      )}
      <div className="dash" style={{ gridTemplateColumns: 'repeat(2,1fr)', marginTop: 14 }}>
        {groups.map((g, i) => (
          <div key={g.id} className="card group-card" onClick={() => setOpen(g.id)}>
            <div className="flex" style={{ gap: 12 }}><div className="avatar-sq" style={{ background: COLORS[i % COLORS.length] }}>{g.name[0]}</div>
              <div style={{ flex: 1 }}><div style={{ fontWeight: 700 }}>{g.name}</div><div className="note">{g.subject}</div></div></div>
            <div className="flex between" style={{ marginTop: 12 }}><span className="note">{g.memberCount} {L('grp_members')}</span></div>
            <div className="divider" />
            <div className="flex between"><span className="note">{L('grp_your')}: <b style={{ color: 'var(--accent)' }}>{g.yourScore}%</b></span><span className="note">{L('grp_avg')}: <b>{g.avgScore}%</b></span></div>
          </div>
        ))}
        <div className="card flat" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', borderStyle: 'dashed', cursor: 'pointer', minHeight: 160 }} onClick={() => setCreating(true)}>
          <div style={{ fontSize: 30 }}>➕</div><b style={{ marginTop: 8 }}>{L('grp_create')}</b><p className="note">{L('grp_invite')}</p>
        </div>
      </div>
    </>
  );
}

function GroupDetail({ id, onBack, L, user, flash }) {
  const [g, setG] = useState(null);
  const [stats, setStats] = useState(null);
  const [shared, setShared] = useState([]);
  const [inviteEmail, setInviteEmail] = useState('');

  const load = async () => {
    const [d, s, sh] = await Promise.all([api.get(`/groups/${id}`), api.get(`/groups/${id}/stats`), api.get(`/groups/${id}/shared`)]);
    setG(d.data); setStats(s.data); setShared(sh.data);
  };
  useEffect(() => { load().catch(() => {}); }, [id]);

  const invite = async () => { if (!inviteEmail) return; try { await api.post(`/groups/${id}/invitations`, { email: inviteEmail }); setInviteEmail(''); flash(L('grp_invite_sent')); } catch (e) { flash(e.message); } };
  const leave = async () => { try { await api.del(`/groups/${id}/members/${user.id}`); onBack(); } catch (e) { flash(e.message); } };
  const remove = async () => { try { await api.del(`/groups/${id}`); onBack(); } catch (e) { flash(e.message); } };

  if (!g) return <Spinner />;
  const isOwner = g.ownerId === user.id;
  return (
    <>
      <button className="btn gho" onClick={onBack}>← {L('grp_back')}</button>
      <div className="card" style={{ marginTop: 10 }}>
        <div className="flex" style={{ gap: 14 }}><div className="avatar-sq" style={{ background: '#1A365D', width: 52, height: 52, fontSize: 20 }}>{g.name[0]}</div>
          <div style={{ flex: 1 }}><div className="h" style={{ margin: 0 }}>{g.name}</div><div className="note">{g.subject} · {g.members.length} {L('grp_members')}</div></div>
          {isOwner ? <button className="btn gho" style={{ color: 'var(--danger)' }} onClick={remove}>{L('grp_delete')}</button>
            : <button className="btn gho" style={{ color: 'var(--danger)' }} onClick={leave}>{L('grp_leave')}</button>}
        </div>
        <div className="divider" />
        <div className="mstack">{g.members.map((m, i) => <div key={m.userId} className="mavatar" style={{ background: COLORS[i % COLORS.length] }} title={m.name}>{initials(m.name)}</div>)}</div>
      </div>
      <div className="dash" style={{ gridTemplateColumns: 'repeat(2,1fr)', marginTop: 16 }}>
        <div className="card"><b>{L('grp_stats')}</b>
          <div className="flex between" style={{ marginTop: 10 }}><span className="note">{L('grp_avg')}</span><b>{stats?.avgScore}%</b></div><Bar value={stats?.avgScore || 0} />
          <div className="section-label" style={{ margin: '14px 0 4px' }}>{L('grp_best')}</div>
          {(stats?.best || []).map((b, i) => <div key={i} className="flex between" style={{ fontSize: 13, marginTop: 4 }}><span>{b.area}</span><span className="tag g">{b.avg}%</span></div>)}
          <div className="section-label" style={{ margin: '14px 0 4px' }}>{L('grp_weak')}</div>
          {(stats?.weak || []).map((b, i) => <div key={i} className="flex between" style={{ fontSize: 13, marginTop: 4 }}><span>{b.area}</span><span className="tag w">{b.avg}%</span></div>)}
        </div>
        <div className="card"><b>{L('grp_invite')}</b>
          <div className="flex" style={{ gap: 8, marginTop: 10 }}>
            <input placeholder={L('grp_invite_ph')} value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
            <button className="btn" style={{ padding: '10px 14px' }} onClick={invite}>{L('grp_invite_btn')}</button>
          </div>
          <div className="section-label" style={{ margin: '16px 0 4px' }}>{L('grp_shared')}</div>
          {shared.length ? shared.map((s) => (
            <div key={s.id} className="row"><span style={{ fontSize: 18 }}>{'\u{1F4D0}'}</span><div style={{ flex: 1, fontSize: 13 }}>{s.comment || s.questionId}<div className="note">{s.sharedBy}</div></div><span className={`tag ${s.result === 'correct' ? 'g' : 'w'}`}>{s.result}</span></div>
          )) : <p className="note">{L('grp_no_shared')}</p>}
        </div>
      </div>
    </>
  );
}
