import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, qs } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import {
  Kpi, Card, Loading, ErrorBox, EmptyState, Modal, Field, FormGrid, Select,
  Tabs, Toast, useToast, KV, Pill, Pager,
} from '../components/ui.jsx';

const USER_STATES = ['active', 'suspended', 'churned'];
const STATE_TAG = { active: ['g', 'us_active'], suspended: ['w', 'us_suspended'], churned: ['d', 'us_churned'] };
const PRI_TAG = { high: ['d', 'pri_high'], med: ['w', 'pri_med'], low: ['', 'pri_low'] };
const TICKET_TAG = { open: ['d', 'ts_open'], progress: ['w', 'ts_progress'], closed: ['g', 'ts_closed'] };
const COR_TAG = { pending: ['w', 'cs_pending'], confirmed: ['g', 'cs_confirmed'], rejected: ['d', 'cs_rejected'] };
// Recompensa fija que el backend otorga al confirmar (routes/corrections.js).
const CONFIRM_REWARD = 250;
// Planes conocidos por si el rol no puede leer /admin/plans (solo gerencia).
const FALLBACK_PLANS = [{ id: 'free', name: 'Gratis' }, { id: 'uni', name: '1 prueba' }, { id: 'all', name: 'Todas' }];

const PAGE_SIZE = 20;
const initials = (name) => String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

export default function Users({ ctx }) {
  const { L, fmt, lang } = ctx;
  const { isAdmin, user: me } = useAuth();
  const t = useToast();

  const [tab, setTab] = useState('users');
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState(null);

  // ── usuarios (paginados por cursor) ──
  const [uFilters, setUFilters] = useState({ q: '', plan: '', state: '' });
  const [search, setSearch] = useState('');
  const [cursors, setCursors] = useState([null]);
  const [page, setPage] = useState(0);
  const [users, setUsers] = useState(null);
  const [uTotal, setUTotal] = useState(0);
  const [uNext, setUNext] = useState(null);
  const [uErr, setUErr] = useState(null);

  // ── tickets / recorrecciones ──
  const [tFilters, setTFilters] = useState({ state: '', priority: '' });
  const [tickets, setTickets] = useState(null);
  const [tErr, setTErr] = useState(null);
  const [cFilters, setCFilters] = useState({ state: '' });
  const [corrections, setCorrections] = useState(null);
  const [cErr, setCErr] = useState(null);

  // ── catálogos auxiliares ──
  const [plans, setPlans] = useState(null);
  const [questionsById, setQuestionsById] = useState(null);

  const planOptions = (plans || FALLBACK_PLANS).map((p) => ({ value: p.id, label: p.name }));
  const planName = (id) => (plans || FALLBACK_PLANS).find((p) => p.id === id)?.name || id || L('none');

  const loadUsers = useCallback(async (f, cursor) => {
    setUErr(null);
    try {
      const r = await api.get(`/users${qs({ ...f, limit: PAGE_SIZE, cursor })}`);
      setUsers(r.data);
      setUTotal(r.meta?.pagination?.total ?? r.data.length);
      setUNext(r.meta?.pagination?.nextCursor ?? null);
    } catch (e) { setUErr(e.message); }
  }, []);

  const loadTickets = useCallback(async (f) => {
    setTErr(null);
    try { setTickets((await api.get(`/tickets${qs(f)}`)).data); } catch (e) { setTErr(e.message); }
  }, []);

  const loadCorrections = useCallback(async (f) => {
    setCErr(null);
    try { setCorrections((await api.get(`/corrections${qs(f)}`)).data); } catch (e) { setCErr(e.message); }
  }, []);

  // El catálogo de planes solo lo puede leer gerencia; si falla, se usa el fallback.
  useEffect(() => { api.get('/plans').then((r) => setPlans(r.data)).catch(() => setPlans(null)); }, []);

  // Cada bloque recarga cuando cambian sus filtros (la primera ejecución hace la carga inicial).
  useEffect(() => { setCursors([null]); setPage(0); loadUsers(uFilters, null); }, [uFilters, loadUsers]);
  useEffect(() => { loadTickets(tFilters); }, [tFilters, loadTickets]);
  useEffect(() => { loadCorrections(cFilters); }, [cFilters, loadCorrections]);
  useEffect(() => {
    const id = setTimeout(() => setUFilters((f) => (f.q === search ? f : { ...f, q: search })), 300);
    return () => clearTimeout(id);
  }, [search]);

  // El enunciado de la pregunta recorregida vive en /questions (rol gerencia).
  useEffect(() => {
    if (tab !== 'corrections' || !isAdmin || questionsById) return;
    api.get('/questions')
      .then((r) => setQuestionsById(Object.fromEntries(r.data.map((q) => [q.id, q]))))
      .catch(() => setQuestionsById({}));
  }, [tab, isAdmin, questionsById]);

  const goNext = () => {
    if (!uNext) return;
    setCursors([...cursors.slice(0, page + 1), uNext]);
    setPage(page + 1);
    loadUsers(uFilters, uNext);
  };
  const goPrev = () => {
    if (page === 0) return;
    setPage(page - 1);
    loadUsers(uFilters, cursors[page - 1]);
  };

  const openTickets = (tickets || []).filter((x) => x.state !== 'closed').length;
  const pendingCor = (corrections || []).filter((x) => (x.state || 'pending') === 'pending').length;

  const kpis = useMemo(() => {
    const list = users || [];
    return {
      active: list.filter((x) => x.state === 'active').length,
      suspended: list.filter((x) => x.state === 'suspended').length,
    };
  }, [users]);

  const run = async (fn, okMsg) => {
    setBusy(true);
    try {
      const out = await fn();
      setDialog(null);
      if (okMsg) t.ok(okMsg);
      return out;
    } catch (e) { t.err(e.message); return null; } finally { setBusy(false); }
  };

  const patchUser = async (u, patch) => {
    if (await run(() => api.patch(`/users/${u.id}`, patch), L('saved_ok'))) loadUsers(uFilters, cursors[page]);
  };

  const patchTicket = async (tk, patch) => {
    if (await run(() => api.patch(`/tickets/${tk.id}`, patch), L('saved_ok'))) loadTickets(tFilters);
  };

  const resolveCorrection = async (cor, body) => {
    const out = await run(() => api.patch(`/corrections/${cor.id}`, body));
    if (!out) return;
    const reward = out.data?.rewardGranted;
    t.ok(reward ? L('co_reward_granted', { n: reward.amount ?? CONFIRM_REWARD }) : L('co_rejected'));
    loadCorrections(cFilters);
    // Confirmar acredita badges al alumno: refrescamos también la tabla de usuarios.
    if (reward) loadUsers(uFilters, cursors[page]);
  };

  const openUser = async (u) => {
    setDialog({ kind: 'user', user: u, loading: true });
    try { setDialog({ kind: 'user', user: (await api.get(`/users/${u.id}`)).data }); }
    catch (e) { t.err(e.message); setDialog({ kind: 'user', user: u }); }
  };

  if (!users && !uErr) return <Loading L={L} />;

  return (
    <>
      <div className="grid g4">
        <Kpi ic="👥" label={L('u_total')} value={fmt(uTotal)} />
        <Kpi ic="🟢" label={L('u_active')} value={fmt(kpis.active)} />
        <Kpi ic="⛔" label={L('u_suspended')} value={fmt(kpis.suspended)} />
        <Kpi ic="🎫" label={L('u_tickets')} value={fmt(openTickets)} />
      </div>

      <div style={{ marginTop: 18 }}>
        <Tabs active={tab} onChange={setTab} tabs={[
          { id: 'users', ic: '👥', label: L('tab_users'), count: uTotal },
          { id: 'tickets', ic: '🎫', label: L('tab_tickets'), count: openTickets },
          { id: 'corrections', ic: '⚑', label: L('tab_corrections'), count: pendingCor },
        ]} />
      </div>

      {tab === 'users' && (
        <Card>
          <p className="note">{lang === 'en' ? 'Suspending an account does not cancel its Stripe subscription or future charges.' : 'Suspender la cuenta no cancela su suscripción en Stripe ni los próximos cobros.'}</p>
          <div className="filters" style={{ marginBottom: 12 }}>
            <input className="grow" placeholder={L('u_search')} value={search} onChange={(e) => setSearch(e.target.value)} />
            <Select value={uFilters.plan} onChange={(v) => setUFilters((f) => ({ ...f, plan: v }))}
              options={planOptions} placeholder={`${L('u_plan')}: ${L('filter_all')}`} />
            <Select value={uFilters.state} onChange={(v) => setUFilters((f) => ({ ...f, state: v }))}
              options={USER_STATES.map((s) => ({ value: s, label: L(STATE_TAG[s][1]) }))} placeholder={`${L('u_state')}: ${L('filter_all')}`} />
            <button className="btn sec sm" onClick={() => { setSearch(''); setUFilters({ q: '', plan: '', state: '' }); }}>{L('clear_filters')}</button>
          </div>
          {uErr && <ErrorBox msg={uErr} onRetry={() => loadUsers(uFilters, cursors[page])} L={L} />}
          {users?.length === 0 ? <EmptyState msg={L('u_no_users')} ic="👥" /> : (
            <div className="tbl-wrap"><table>
              <thead><tr>
                <th>{L('u_name')}</th><th>{L('u_plan')}</th><th>{L('u_state')}</th>
                <th>{L('u_last')}</th><th>{L('u_badges')}</th><th />
              </tr></thead>
              <tbody>{(users || []).map((x) => (
                <tr key={x.id}>
                  <td><div className="flex">
                    <div className="avatar">{initials(x.name)}</div>
                    <div><b style={{ fontSize: 13 }}>{x.name}</b><div className="note">{x.email}</div></div>
                  </div></td>
                  <td><span className="tag">{planName(x.plan)}</span></td>
                  <td><Pill value={x.state} map={STATE_TAG} L={L} /></td>
                  <td className="note">{x.lastActivity || L('none')}</td>
                  <td><b>{fmt(x.badges)}</b> 🏅</td>
                  <td><div className="row-acts">
                    <button className="btn sec sm" onClick={() => openUser(x)}>{L('view')}</button>
                    <button className="btn sec sm"
                      onClick={() => patchUser(x, { state: x.state === 'suspended' ? 'active' : 'suspended', reason: 'Acción rápida desde consola' })}>
                      {x.state === 'suspended' ? L('u_reactivate') : L('u_suspend')}
                    </button>
                  </div></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
          <Pager page={page} shown={users?.length || 0} total={uTotal} hasNext={!!uNext} onNext={goNext} onPrev={goPrev} L={L} />
        </Card>
      )}

      {tab === 'tickets' && (
        <Card>
          <div className="filters" style={{ marginBottom: 12 }}>
            <b style={{ marginRight: 'auto' }}>{L('t_table')}</b>
            <Select value={tFilters.state} onChange={(v) => setTFilters((f) => ({ ...f, state: v }))}
              options={Object.keys(TICKET_TAG).map((s) => ({ value: s, label: L(TICKET_TAG[s][1]) }))} placeholder={`${L('t_state')}: ${L('filter_all')}`} />
            <Select value={tFilters.priority} onChange={(v) => setTFilters((f) => ({ ...f, priority: v }))}
              options={Object.keys(PRI_TAG).map((s) => ({ value: s, label: L(PRI_TAG[s][1]) }))} placeholder={`${L('t_pri')}: ${L('filter_all')}`} />
            <button className="btn sec sm" onClick={() => setTFilters({ state: '', priority: '' })}>{L('clear_filters')}</button>
          </div>
          {tErr && <ErrorBox msg={tErr} onRetry={() => loadTickets(tFilters)} L={L} />}
          {!tickets ? <Loading L={L} /> : tickets.length === 0 ? <EmptyState msg={L('t_no_tickets')} ic="🎫" /> : (
            <div className="tbl-wrap"><table>
              <thead><tr>
                <th>{L('t_id')}</th><th>{L('t_subj')}</th><th>{L('t_user')}</th>
                <th>{L('t_pri')}</th><th>{L('t_state')}</th><th>{L('t_age')}</th><th />
              </tr></thead>
              <tbody>{tickets.map((x) => (
                <tr key={x.id}>
                  <td className="note">#{x.id}</td>
                  <td>
                    <b className="clamp" style={{ fontSize: 13 }}>{x.subject}</b>
                    {x.lastReply && <div className="note clamp">↩ {x.lastReply}</div>}
                  </td>
                  <td>{x.user}</td>
                  <td><Pill value={x.priority} map={PRI_TAG} L={L} /></td>
                  <td><Pill value={x.state} map={TICKET_TAG} L={L} /></td>
                  <td className="note">{x.age}</td>
                  <td><div className="row-acts">
                    <button className="btn sec sm" onClick={() => setDialog({ kind: 'ticket', ticket: x })}>{L('t_manage')}</button>
                  </div></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>
      )}

      {tab === 'corrections' && (
        <Card>
          <div className="filters" style={{ marginBottom: 12 }}>
            <b style={{ marginRight: 'auto' }}>{L('co_table')}</b>
            <Select value={cFilters.state} onChange={(v) => setCFilters({ state: v })}
              options={Object.keys(COR_TAG).map((s) => ({ value: s, label: L(COR_TAG[s][1]) }))} placeholder={`${L('t_state')}: ${L('filter_all')}`} />
            <button className="btn sec sm" onClick={() => setCFilters({ state: '' })}>{L('clear_filters')}</button>
          </div>
          {!isAdmin && <p className="note" style={{ marginBottom: 10 }}>ℹ️ {L('co_needs_admin')}</p>}
          {cErr && <ErrorBox msg={cErr} onRetry={() => loadCorrections(cFilters)} L={L} />}
          {!corrections ? <Loading L={L} /> : corrections.length === 0 ? <EmptyState msg={L('co_no_items')} ic="⚑" /> : (
            <div className="tbl-wrap"><table>
              <thead><tr>
                <th>{L('co_question')}</th><th>{L('co_user')}</th><th>{L('co_reason')}</th>
                <th>{L('co_comment')}</th><th>{L('t_state')}</th><th>{L('co_created')}</th><th />
              </tr></thead>
              <tbody>{corrections.map((c) => {
                const q = questionsById?.[c.questionId];
                return (
                  <tr key={c.id}>
                    <td>
                      <b className="clamp" style={{ fontSize: 13 }}>{q?.statement || c.questionId}</b>
                      <div className="note">{c.questionId}</div>
                    </td>
                    <td>{c.userId}</td>
                    <td><span className="tag">{L(`reason_${c.reason}`)}</span></td>
                    <td><span className="note clamp">{c.comment}</span></td>
                    <td><Pill value={c.state || 'pending'} map={COR_TAG} L={L} /></td>
                    <td className="note">{c.createdAt ? new Date(c.createdAt).toLocaleDateString(lang === 'es' ? 'es-CL' : 'en-US') : L('none')}</td>
                    <td><div className="row-acts">
                      <button className="btn sec sm" disabled={(c.state || 'pending') !== 'pending'}
                        onClick={() => setDialog({ kind: 'correction', correction: c, question: q })}>
                        {L('co_resolve')}
                      </button>
                    </div></td>
                  </tr>
                );
              })}</tbody>
            </table></div>
          )}
        </Card>
      )}

      {dialog?.kind === 'user' && (
        <UserDialog user={dialog.user} loading={dialog.loading} ctx={ctx} busy={busy} planOptions={planOptions}
          plansUnavailable={!plans} onClose={() => setDialog(null)}
          onSave={(patch) => patchUser(dialog.user, patch)} />
      )}

      {dialog?.kind === 'ticket' && (
        <TicketDialog ticket={dialog.ticket} ctx={ctx} busy={busy} me={me}
          onClose={() => setDialog(null)} onSave={(patch) => patchTicket(dialog.ticket, patch)} />
      )}

      {dialog?.kind === 'correction' && (
        <CorrectionDialog correction={dialog.correction} question={dialog.question} ctx={ctx} busy={busy}
          isAdmin={isAdmin} onClose={() => setDialog(null)}
          onResolve={(body) => resolveCorrection(dialog.correction, body)} />
      )}

      <Toast toast={t.toast} onDone={t.clear} />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function UserDialog({ user, loading, ctx, busy, planOptions, plansUnavailable, onClose, onSave }) {
  const { L, fmt } = ctx;
  const [state, setState] = useState(user.state || 'active');
  const [reason, setReason] = useState('');

  // Cuando llega el detalle completo del API se refrescan los campos editables.
  useEffect(() => {
    setState(user.state || 'active'); setReason('');
  }, [user]);

  const dirty = state !== (user.state || 'active');
  const validReason = reason.trim().length >= 3 && reason.trim().length <= 500;

  // El PATCH del API es parcial: solo se envía lo que cambió.
  const submit = () => {
    if (!dirty || !validReason) return;
    const patch = {};
    if (state !== (user.state || 'active')) patch.state = state;
    if (reason.trim()) patch.reason = reason.trim();
    if (!Object.keys(patch).length) { onClose(); return; }
    onSave(patch);
  };

  return (
    <Modal wide busy={busy} title={L('u_detail')} subtitle={user.id} onClose={onClose}
      footer={<>
        <button className="btn sec" onClick={onClose} disabled={busy}>{L('close')}</button>
        <button className="btn" onClick={submit} disabled={busy || loading || !dirty || !validReason}>{busy ? '…' : L('save')}</button>
      </>}>
      {loading ? <Loading L={L} /> : (
        <>
          <div className="flex" style={{ gap: 12, marginBottom: 14 }}>
            <div className="avatar" style={{ width: 44, height: 44, fontSize: 15 }}>{initials(user.name)}</div>
            <div>
              <b style={{ fontSize: 15 }}>{user.name}</b>
              <div className="note">{user.email}</div>
            </div>
            <div style={{ marginLeft: 'auto' }}><Pill value={user.state} map={STATE_TAG} L={L} /></div>
          </div>

          <div className="grid g2">
            <Card className="flat">
              <div className="section-label" style={{ marginTop: 0 }}>{L('u_detail')}</div>
              <KV k={L('u_id')} v={user.id} />
              <KV k={L('u_country')} v={user.country} />
              <KV k={L('u_badges')} v={`${fmt(user.badges)} 🏅`} />
              <KV k={L('u_groups')} v={user.groups ?? 0} />
              <KV k={L('u_last')} v={user.lastActivity} />
              <KV k={L('u_subscription')} v={user.subscription ? `${user.subscription.id} · ${user.subscription.status}` : L('none')} />
            </Card>
            <Card className="flat">
              <div className="section-label" style={{ marginTop: 0 }}>{L('u_audit')}</div>
              <KV k={L('u_audit_by')} v={user.auditedBy} />
              <KV k={L('u_audit')} v={user.auditedAt ? new Date(user.auditedAt).toLocaleString() : L('none')} />
              <KV k={L('u_last_reason')} v={user.lastActionReason} />
            </Card>
          </div>

          <div className="section-label">{L('edit')}</div>
          <p className="note">{ctx.lang === 'en' ? 'Suspending an account does not cancel its Stripe subscription or future charges.' : 'Suspender la cuenta no cancela su suscripción en Stripe ni los próximos cobros.'}</p>
          <FormGrid>
            <Field label={L('u_email')}><input type="email" value={user.email || ''} readOnly /></Field>
            <Field label={L('u_plan')} hint={ctx.lang === 'en' ? 'Managed through the subscription.' : 'Se gestiona mediante la suscripción.'}>
              <input readOnly value={planOptions.find(option => option.value === user.plan)?.label || user.plan || '—'} />
            </Field>
            <Field label={L('u_state')}>
              <Select value={state} onChange={setState} options={USER_STATES.filter(s => s !== 'churned').map((s) => ({ value: s, label: L(STATE_TAG[s][1]) }))} />
            </Field>
            <Field label={L('u_reason')} hint={ctx.lang === 'en' ? 'Required: 3 to 500 characters.' : 'Obligatorio: entre 3 y 500 caracteres.'}>
              <input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
            </Field>
          </FormGrid>
        </>
      )}
    </Modal>
  );
}

function TicketDialog({ ticket, ctx, busy, me, onClose, onSave }) {
  const { L } = ctx;
  const [state, setState] = useState(ticket.state || 'open');
  const [priority, setPriority] = useState(ticket.priority || 'med');
  const [assigneeId, setAssigneeId] = useState(ticket.assigneeId || '');
  const [reply, setReply] = useState('');

  const submit = () => {
    const patch = {};
    if (state !== (ticket.state || 'open')) patch.state = state;
    if (priority !== (ticket.priority || 'med')) patch.priority = priority;
    if (assigneeId !== (ticket.assigneeId || '')) patch.assigneeId = assigneeId;
    if (reply.trim()) patch.reply = reply.trim();
    if (!Object.keys(patch).length) { onClose(); return; }
    onSave(patch);
  };

  return (
    <Modal busy={busy} title={L('t_manage')} subtitle={`#${ticket.id} · ${ticket.user}`} onClose={onClose}
      footer={<>
        <button className="btn sec" onClick={onClose} disabled={busy}>{L('cancel')}</button>
        <button className="btn" onClick={submit} disabled={busy}>{busy ? '…' : L('save')}</button>
      </>}>
      <p style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 4 }}>{ticket.subject}</p>
      <div className="note" style={{ marginBottom: 6 }}>{L('t_age')}: {ticket.age}</div>
      {ticket.lastReply && (
        <>
          <div className="section-label" style={{ marginTop: 10 }}>{L('t_last_reply')}</div>
          <p className="note">{ticket.lastReply}</p>
        </>
      )}
      <FormGrid>
        <Field label={L('t_state')}>
          <Select value={state} onChange={setState} options={Object.keys(TICKET_TAG).map((s) => ({ value: s, label: L(TICKET_TAG[s][1]) }))} />
        </Field>
        <Field label={L('t_pri')}>
          <Select value={priority} onChange={setPriority} options={Object.keys(PRI_TAG).map((s) => ({ value: s, label: L(PRI_TAG[s][1]) }))} />
        </Field>
        <Field wide label={L('t_assignee')}>
          <div className="flex" style={{ gap: 8 }}>
            <input style={{ flex: 1 }} value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} placeholder={me?.id} />
            <button className="btn sec sm" onClick={() => setAssigneeId(me?.id || '')}>{me?.name}</button>
          </div>
        </Field>
        <Field wide label={L('t_reply')} hint={L('t_reply_ph')}>
          <textarea value={reply} onChange={(e) => setReply(e.target.value)} />
        </Field>
      </FormGrid>
    </Modal>
  );
}

function CorrectionDialog({ correction, question, ctx, busy, isAdmin, onClose, onResolve }) {
  const { L } = ctx;
  const [resolution, setResolution] = useState('confirmed');
  const [fix, setFix] = useState(false);
  const [statement, setStatement] = useState(question?.statement || '');
  const [correctAnswer, setCorrectAnswer] = useState(question?.correctAnswer || '');
  const [explanation, setExplanation] = useState(question?.explanation || '');

  const submit = () => {
    const body = { resolution };
    // El backend solo aplica questionPatch cuando la resolución es 'confirmed'.
    if (resolution === 'confirmed' && fix) {
      const patch = {};
      if (statement.trim() && statement !== question?.statement) patch.statement = statement.trim();
      if (correctAnswer.trim() && correctAnswer !== question?.correctAnswer) patch.correctAnswer = correctAnswer.trim().toUpperCase();
      if (explanation !== (question?.explanation || '')) patch.explanation = explanation;
      if (Object.keys(patch).length) body.questionPatch = patch;
    }
    onResolve(body);
  };

  return (
    <Modal wide busy={busy} title={L('co_resolve')} subtitle={correction.id} onClose={onClose}
      footer={<>
        <button className="btn sec" onClick={onClose} disabled={busy}>{L('cancel')}</button>
        <button className={`btn ${resolution === 'rejected' ? 'dgr' : ''}`} onClick={submit} disabled={busy}>
          {busy ? '…' : L(resolution === 'confirmed' ? 'co_confirm' : 'co_reject', { n: CONFIRM_REWARD })}
        </button>
      </>}>
      <Card className="flat">
        <KV k={L('co_user')} v={correction.userId} />
        <KV k={L('co_reason')} v={L(`reason_${correction.reason}`)} />
        <KV k={L('co_comment')} v={correction.comment} />
        <KV k={L('co_question')} v={correction.questionId} />
      </Card>

      {question && (
        <>
          <div className="section-label">{L('co_question')}</div>
          <p style={{ fontSize: 13.5, fontWeight: 600 }}>{question.statement}</p>
          <div className="chips" style={{ marginTop: 8 }}>
            {(question.options || []).map((o, i) => (
              <span key={i} className={`chip ${'ABCDEF'[i] === question.correctAnswer ? 'on' : ''}`}>{'ABCDEF'[i]}. {o}</span>
            ))}
          </div>
        </>
      )}
      {!question && !isAdmin && <p className="note" style={{ marginTop: 10 }}>ℹ️ {L('co_needs_admin')}</p>}

      <div className="section-label">{L('co_resolution')}</div>
      <div className="chips">
        <button type="button" className={`chip ${resolution === 'confirmed' ? 'on' : ''}`} onClick={() => setResolution('confirmed')}>
          ✓ {L('co_confirm', { n: CONFIRM_REWARD })}
        </button>
        <button type="button" className={`chip ${resolution === 'rejected' ? 'on' : ''}`} onClick={() => setResolution('rejected')}>
          ✕ {L('co_reject')}
        </button>
      </div>

      {resolution === 'confirmed' && question && (
        <>
          <label className="check" style={{ marginTop: 12 }}>
            <input type="checkbox" checked={fix} onChange={(e) => setFix(e.target.checked)} />
            <span>{L('co_fix_question')}</span>
          </label>
          <div className="note" style={{ marginBottom: 8 }}>{L('co_fix_hint')}</div>
          {fix && (
            <FormGrid>
              <Field wide label={L('q_statement')}><textarea value={statement} onChange={(e) => setStatement(e.target.value)} /></Field>
              <Field label={L('q_correct')}><input value={correctAnswer} maxLength={1} onChange={(e) => setCorrectAnswer(e.target.value)} /></Field>
              <Field wide label={L('q_explanation')}><textarea value={explanation} onChange={(e) => setExplanation(e.target.value)} /></Field>
            </FormGrid>
          )}
        </>
      )}
    </Modal>
  );
}
