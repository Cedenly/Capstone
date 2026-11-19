import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, qs } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import {
  Kpi, Card, Loading, ErrorBox, EmptyState, Modal, Confirm, Field, FormGrid, Select, Check,
  Chips, TagInput, Stars, Toast, useToast, KV, Pill,
} from '../components/ui.jsx';

// Catálogos cerrados: coinciden con las constantes del backend (routes/tutors.js).
const MODES = ['online', 'in_person'];
const STATUSES = ['active', 'paused', 'rejected'];
const CRITERIA = ['teaching', 'punctuality', 'mastery'];
const STATUS_TAG = { active: ['g', 'ts_active'], paused: ['w', 'ts_paused'], rejected: ['d', 'ts_rejected'] };

const initialsOf = (name) => String(name || '')
  .split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

const numOr = (v, d = 0) => (v === '' || v == null || Number.isNaN(Number(v)) ? d : Number(v));

const emptyForm = () => ({
  name: '', initials: '', avatarColor: '#1A365D', textColor: '#FFFFFF',
  subjects: [], subjectsLabelEs: '', subjectsLabelEn: '',
  modes: ['online'], modesLabelEs: '', modesLabelEn: '',
  pricePerHour: '', currency: 'CLP', country: 'CL', languages: ['es'],
  bioEs: '', bioEn: '', yearsExperience: '',
  featured: false, verified: false, status: 'active',
  seedTeaching: '', seedPunctuality: '', seedMastery: '', reviewCountSeed: '',
  contactEmail: '', contactWhatsapp: '', contactSharingDefault: true,
});

const formFrom = (t) => ({
  ...emptyForm(),
  name: t.name || '',
  initials: t.initials || '',
  avatarColor: t.avatarColor || '#1A365D',
  textColor: t.textColor || '#FFFFFF',
  subjects: t.subjects || [],
  subjectsLabelEs: t.subjectsLabel?.es || '',
  subjectsLabelEn: t.subjectsLabel?.en || '',
  modes: t.modes || ['online'],
  modesLabelEs: t.modesLabel?.es || '',
  modesLabelEn: t.modesLabel?.en || '',
  pricePerHour: t.pricePerHour ?? '',
  currency: t.currency || 'CLP',
  country: t.country || 'CL',
  languages: t.languages || ['es'],
  bioEs: t.bio?.es || '',
  bioEn: t.bio?.en || '',
  yearsExperience: t.yearsExperience ?? '',
  featured: !!t.featured,
  verified: !!t.verified,
  status: t.status || 'active',
  seedTeaching: t.ratingSeed?.teaching ?? '',
  seedPunctuality: t.ratingSeed?.punctuality ?? '',
  seedMastery: t.ratingSeed?.mastery ?? '',
  reviewCountSeed: t.reviewCountSeed ?? '',
  contactEmail: t.contact?.email || '',
  contactWhatsapp: t.contact?.whatsapp || '',
  contactSharingDefault: t.contactSharingDefault !== false,
});

// Traduce el formulario al contrato del API. `verified` solo viaja en el alta:
// en la edición la verificación se gestiona con PATCH /tutors/:id/verification,
// que además registra quién y cuándo la concedió.
function toPayload(f, { isCreate }) {
  const modeLabel = (lang) => f.modes.map((m) => (lang === 'es'
    ? (m === 'online' ? 'Online' : 'Presencial')
    : (m === 'online' ? 'Online' : 'In-person'))).join(' · ');
  const seed = {
    teaching: numOr(f.seedTeaching),
    punctuality: numOr(f.seedPunctuality),
    mastery: numOr(f.seedMastery),
  };
  const hasSeed = CRITERIA.some((c) => seed[c] > 0);
  const payload = {
    name: f.name.trim(),
    initials: (f.initials || initialsOf(f.name) || 'TU').trim(),
    avatarColor: f.avatarColor,
    textColor: f.textColor,
    subjects: f.subjects,
    subjectsLabel: {
      es: f.subjectsLabelEs.trim() || f.subjects.join(' · '),
      en: f.subjectsLabelEn.trim() || f.subjects.join(' · '),
    },
    modes: f.modes,
    modesLabel: {
      es: f.modesLabelEs.trim() || modeLabel('es'),
      en: f.modesLabelEn.trim() || modeLabel('en'),
    },
    pricePerHour: numOr(f.pricePerHour),
    currency: f.currency.trim() || 'CLP',
    country: f.country.trim() || 'CL',
    languages: f.languages,
    bio: { es: f.bioEs, en: f.bioEn },
    yearsExperience: numOr(f.yearsExperience),
    featured: f.featured,
    // El backend valida los 3 criterios cuando ratingSeed no es null, así que se
    // envían siempre los tres o null.
    ratingSeed: hasSeed ? seed : null,
    reviewCountSeed: numOr(f.reviewCountSeed),
    contact: { email: f.contactEmail.trim(), whatsapp: f.contactWhatsapp.trim() },
    contactSharingDefault: f.contactSharingDefault,
    status: f.status,
  };
  if (isCreate) payload.verified = f.verified;
  return payload;
}

export default function Tutors({ ctx }) {
  const { L, lang, fmt } = ctx;
  const { isAdmin } = useAuth();
  const t = useToast();

  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [filters, setFilters] = useState({ status: '', subject: '', verified: '', q: '' });
  const [search, setSearch] = useState('');
  const [dialog, setDialog] = useState(null); // {kind, tutor?, review?}
  const [busy, setBusy] = useState(false);
  const seenSubjects = useRef(new Set());

  const load = useCallback(async (f = filters) => {
    setErr(null);
    try {
      const r = await api.get(`/tutors${qs(f)}`);
      setRows(r.data);
      r.data.forEach((x) => (x.subjects || []).forEach((s) => seenSubjects.current.add(s)));
    } catch (e) { setErr(e.message); }
  }, [filters]);

  useEffect(() => { load(filters); }, [filters, load]);
  // Debounce de la búsqueda por texto (el filtro `q` lo resuelve el backend).
  useEffect(() => {
    const id = setTimeout(() => setFilters((f) => (f.q === search ? f : { ...f, q: search })), 300);
    return () => clearTimeout(id);
  }, [search]);

  const setF = (k, v) => setFilters((f) => ({ ...f, [k]: v }));
  const clearFilters = () => { setSearch(''); setFilters({ status: '', subject: '', verified: '', q: '' }); };

  const subjectOptions = useMemo(
    () => [...seenSubjects.current].sort().map((s) => ({ value: s, label: s })),
    [rows],
  );

  const kpis = useMemo(() => {
    const list = rows || [];
    const rated = list.filter((x) => Number(x.rating) > 0);
    return {
      total: list.length,
      active: list.filter((x) => (x.status || 'active') === 'active').length,
      verified: list.filter((x) => x.verified).length,
      avg: rated.length ? (rated.reduce((s, x) => s + Number(x.rating), 0) / rated.length) : 0,
    };
  }, [rows]);

  // ── acciones ──
  const run = async (fn, okMsg) => {
    setBusy(true);
    try {
      await fn();
      setDialog(null);
      if (okMsg) t.ok(okMsg);
      await load(filters);
      return true;
    } catch (e) {
      t.err(e.message);
      return false;
    } finally { setBusy(false); }
  };

  const saveTutor = (form, tutor) => {
    if (!form.name.trim()) { t.err(L('required_field')); return; }
    if (!form.subjects.length) { t.err(L('tu_err_subjects')); return; }
    const payload = toPayload(form, { isCreate: !tutor });
    run(
      () => (tutor ? api.put(`/tutors/${tutor.id}`, payload) : api.post('/tutors', payload)),
      tutor ? L('tu_updated') : L('tu_created'),
    );
  };

  const openDetail = async (tutor) => {
    setDialog({ kind: 'detail', tutor, loading: true });
    try {
      const r = await api.get(`/tutors/${tutor.id}`);
      setDialog({ kind: 'detail', tutor: r.data });
    } catch (e) {
      t.err(e.message);
      setDialog(null);
    }
  };

  if (err && !rows) return <Card><ErrorBox msg={err} onRetry={() => load(filters)} L={L} /></Card>;
  if (!rows) return <Loading L={L} />;

  return (
    <>
      <p className="sub" style={{ marginBottom: 14 }}>{L('tu_intro')}</p>

      <div className="grid g4">
        <Kpi ic="🎓" label={L('tu_kpi_total')} value={fmt(kpis.total)} />
        <Kpi ic="🟢" label={L('tu_kpi_active')} value={fmt(kpis.active)} />
        <Kpi ic="✅" label={L('tu_kpi_verified')} value={fmt(kpis.verified)} />
        <Kpi ic="⭐" label={L('tu_kpi_avg')} value={kpis.avg ? kpis.avg.toFixed(1) : '—'} />
      </div>

      <Card style={{ marginTop: 16 }}>
        <div className="flex between wrap" style={{ gap: 10, marginBottom: 12 }}>
          <b>{L('tu_table')}</b>
          <button className="btn sm" onClick={() => setDialog({ kind: 'form' })}>+ {L('tu_add')}</button>
        </div>

        <div className="filters" style={{ marginBottom: 12 }}>
          <input className="grow" placeholder={L('tu_search')} value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select value={filters.status} onChange={(v) => setF('status', v)} placeholder={`${L('tu_status')}: ${L('filter_all')}`}
            options={STATUSES.map((s) => ({ value: s, label: L(STATUS_TAG[s][1]) }))} />
          <Select value={filters.subject} onChange={(v) => setF('subject', v)} placeholder={`${L('tu_filter_subject')}: ${L('filter_all')}`}
            options={subjectOptions} />
          <Select value={filters.verified} onChange={(v) => setF('verified', v)} placeholder={`${L('tu_filter_verified')}: ${L('filter_all')}`}
            options={[{ value: 'true', label: L('tu_only_verified') }, { value: 'false', label: L('tu_only_unverified') }]} />
          <button className="btn sec sm" onClick={clearFilters}>{L('clear_filters')}</button>
        </div>

        {rows.length === 0 ? <EmptyState msg={L('tu_no_tutors')} ic="🎓" /> : (
          <div className="tbl-wrap"><table>
            <thead><tr>
              <th>{L('tu_name')}</th><th>{L('tu_subjects')}</th><th>{L('tu_modes')}</th>
              <th>{L('tu_price')}</th><th>{L('tu_rating')}</th><th>{L('tu_status')}</th><th />
            </tr></thead>
            <tbody>{rows.map((x) => (
              <tr key={x.id}>
                <td>
                  <div className="flex">
                    <div className="tavatar" style={{ background: x.avatarColor || 'var(--brand)', color: x.textColor || '#fff' }}>
                      {x.initials || initialsOf(x.name)}
                    </div>
                    <div>
                      <b style={{ fontSize: 13 }}>{x.name}</b>
                      {x.verified && <span className="tag g" style={{ marginLeft: 6 }}>✓ {L('tu_verified')}</span>}
                      {x.featured && <span className="tag w" style={{ marginLeft: 4 }}>★ {L('tu_featured')}</span>}
                      <div className="note">{x.contact?.email || L('none')}</div>
                    </div>
                  </div>
                </td>
                <td><span className="note">{x.subjectsLabel?.[lang] || (x.subjects || []).join(' · ') || L('none')}</span></td>
                <td>
                  <div className="chips">
                    {(x.modes || []).map((m) => <span key={m} className="tag">{L(`mode_${m}`)}</span>)}
                  </div>
                </td>
                <td>{x.pricePerHour ? `${fmt(x.pricePerHour)} ${x.currency || ''}` : L('none')}</td>
                <td>{Number(x.rating) > 0 ? <Stars value={x.rating} count={x.reviewCount} /> : <span className="note">{L('none')}</span>}</td>
                <td><Pill value={x.status || 'active'} map={STATUS_TAG} L={L} /></td>
                <td>
                  <div className="row-acts">
                    <button className="btn sec sm" onClick={() => openDetail(x)}>{L('view')}</button>
                    <button className="btn sec sm" onClick={() => setDialog({ kind: 'form', tutor: x })}>{L('edit')}</button>
                    <button className="btn sec sm" onClick={() => setDialog({ kind: 'verify', tutor: x })}>
                      {x.verified ? L('tu_unverify') : L('tu_verify')}
                    </button>
                    {/* PUT admite parches parciales: se envía solo el campo que cambia. */}
                    <button className="btn sec sm" title={L(x.featured ? 'tu_unfeature' : 'tu_feature')}
                      onClick={() => run(() => api.put(`/tutors/${x.id}`, { featured: !x.featured }), L('saved_ok'))}>
                      {x.featured ? '★' : '☆'}
                    </button>
                    {(x.status || 'active') === 'active'
                      ? <button className="btn sec sm" onClick={() => setDialog({ kind: 'pause', tutor: x })}>{L('tu_pause')}</button>
                      : <button className="btn sec sm" onClick={() => run(() => api.put(`/tutors/${x.id}`, { status: 'active' }), L('saved_ok'))}>{L('tu_activate')}</button>}
                    {isAdmin && <button className="btn dgr sm" onClick={() => setDialog({ kind: 'delete', tutor: x })}>🗑</button>}
                  </div>
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        {err && <ErrorBox msg={err} onRetry={() => load(filters)} L={L} />}
      </Card>

      {dialog?.kind === 'form' && (
        <TutorForm tutor={dialog.tutor} ctx={ctx} busy={busy} suggestions={[...seenSubjects.current]}
          onClose={() => setDialog(null)} onSave={saveTutor} />
      )}

      {dialog?.kind === 'detail' && (
        <TutorDetail tutor={dialog.tutor} loading={dialog.loading} ctx={ctx} busy={busy}
          onClose={() => setDialog(null)}
          onDeleteReview={(review) => setDialog({ kind: 'review', tutor: dialog.tutor, review })} />
      )}

      {dialog?.kind === 'verify' && (
        <VerifyDialog tutor={dialog.tutor} ctx={ctx} busy={busy} onClose={() => setDialog(null)}
          onConfirm={(note) => run(
            () => api.patch(`/tutors/${dialog.tutor.id}/verification`, { verified: !dialog.tutor.verified, note: note || null }),
            L('saved_ok'),
          )} />
      )}

      {/* La pausa se hace con PUT {status,featured} y no con el DELETE «suave»:
          ese DELETE exige rol admin en el backend, mientras que el resto de la
          gestión de tutores es de soporte. PUT logra lo mismo para ambos roles. */}
      {dialog?.kind === 'pause' && (
        <Confirm title={L('tu_pause_title')} message={L('tu_pause_msg', { name: dialog.tutor.name })}
          confirmLabel={L('tu_pause')} cancelLabel={L('cancel')} busy={busy} onClose={() => setDialog(null)}
          onConfirm={() => run(() => api.put(`/tutors/${dialog.tutor.id}`, { status: 'paused', featured: false }), L('saved_ok'))} />
      )}

      {dialog?.kind === 'delete' && (
        <Confirm danger title={L('tu_delete_title')} message={L('tu_delete_msg', { name: dialog.tutor.name })}
          confirmLabel={L('tu_delete')} cancelLabel={L('cancel')} busy={busy} onClose={() => setDialog(null)}
          onConfirm={() => run(() => api.del(`/tutors/${dialog.tutor.id}?hard=true`), L('deleted_ok'))} />
      )}

      {dialog?.kind === 'review' && (
        <Confirm danger title={L('tu_del_review')} message={L('tu_del_review_msg')}
          confirmLabel={L('del')} cancelLabel={L('cancel')} busy={busy}
          onClose={() => openDetail(dialog.tutor)}
          onConfirm={async () => {
            const tutor = dialog.tutor; const review = dialog.review;
            const okDone = await run(() => api.del(`/tutors/${tutor.id}/reviews/${review.id}`), L('tu_review_deleted'));
            if (okDone) openDetail(tutor);
          }} />
      )}

      <Toast toast={t.toast} onDone={t.clear} />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function TutorForm({ tutor, ctx, busy, suggestions, onClose, onSave }) {
  const { L } = ctx;
  const [f, setF] = useState(() => (tutor ? formFrom(tutor) : emptyForm()));
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));
  const onText = (k) => (e) => set(k)(e.target.value);

  return (
    <Modal wide busy={busy} title={tutor ? L('tu_edit') : L('tu_new')} subtitle={tutor ? tutor.id : undefined}
      onClose={onClose}
      footer={<>
        <button className="btn sec" onClick={onClose} disabled={busy}>{L('cancel')}</button>
        <button className="btn" onClick={() => onSave(f, tutor)} disabled={busy}>{busy ? '…' : (tutor ? L('save') : L('create'))}</button>
      </>}
    >
      <div className="section-label" style={{ marginTop: 0 }}>{L('tu_sec_identity')}</div>
      <FormGrid>
        <Field label={`${L('tu_name')} *`}><input value={f.name} onChange={onText('name')} /></Field>
        <Field label={L('tu_initials')}>
          <input value={f.initials} onChange={onText('initials')} placeholder={initialsOf(f.name)} maxLength={3} />
        </Field>
        <Field label={L('tu_avatar_color')}>
          <div className="flex" style={{ gap: 8 }}>
            <input type="color" value={f.avatarColor} onChange={onText('avatarColor')} />
            <input value={f.avatarColor} onChange={onText('avatarColor')} className="mono" />
          </div>
        </Field>
        <Field label={L('tu_text_color')}>
          <div className="flex" style={{ gap: 8 }}>
            <input type="color" value={f.textColor} onChange={onText('textColor')} />
            <input value={f.textColor} onChange={onText('textColor')} className="mono" />
          </div>
        </Field>
      </FormGrid>

      <div className="section-label">{L('tu_sec_offer')}</div>
      <FormGrid>
        <Field wide label={`${L('tu_subjects')} *`} hint={L('tu_subjects_hint')}>
          <TagInput value={f.subjects} onChange={set('subjects')} suggestions={suggestions} placeholder="m1, b1, lectora…" />
        </Field>
        <Field label={`${L('tu_subjects_label')} · ${L('tu_label_es')}`}>
          <input value={f.subjectsLabelEs} onChange={onText('subjectsLabelEs')} placeholder={f.subjects.join(' · ')} />
        </Field>
        <Field label={`${L('tu_subjects_label')} · ${L('tu_label_en')}`}>
          <input value={f.subjectsLabelEn} onChange={onText('subjectsLabelEn')} placeholder={f.subjects.join(' · ')} />
        </Field>
        <Field wide label={L('tu_modes')}>
          <Chips value={f.modes} onChange={set('modes')} options={MODES.map((m) => ({ value: m, label: L(`mode_${m}`) }))} />
        </Field>
        <Field label={`${L('tu_modes_label')} · ${L('tu_label_es')}`}><input value={f.modesLabelEs} onChange={onText('modesLabelEs')} /></Field>
        <Field label={`${L('tu_modes_label')} · ${L('tu_label_en')}`}><input value={f.modesLabelEn} onChange={onText('modesLabelEn')} /></Field>
        <Field label={L('tu_price')}><input type="number" min="0" value={f.pricePerHour} onChange={onText('pricePerHour')} /></Field>
        <Field label={L('tu_currency')}><input value={f.currency} onChange={onText('currency')} maxLength={4} /></Field>
      </FormGrid>

      <div className="section-label">{L('tu_sec_profile')}</div>
      <FormGrid>
        <Field label={L('tu_country')}><input value={f.country} onChange={onText('country')} maxLength={4} /></Field>
        <Field label={L('tu_years')}><input type="number" min="0" value={f.yearsExperience} onChange={onText('yearsExperience')} /></Field>
        <Field wide label={L('tu_languages')}>
          <TagInput value={f.languages} onChange={set('languages')} suggestions={['es', 'en']} placeholder="es, en…" />
        </Field>
        <Field wide label={L('tu_bio_es')}><textarea value={f.bioEs} onChange={onText('bioEs')} /></Field>
        <Field wide label={L('tu_bio_en')}><textarea value={f.bioEn} onChange={onText('bioEn')} /></Field>
        <Field label={L('tu_status')}>
          <Select value={f.status} onChange={set('status')} options={STATUSES.map((s) => ({ value: s, label: L(STATUS_TAG[s][1]) }))} />
        </Field>
        <div className="field">
          <Check label={`★ ${L('tu_featured')}`} checked={f.featured} onChange={set('featured')} />
          {!tutor && <Check label={`✓ ${L('tu_verified')}`} checked={f.verified} onChange={set('verified')} />}
        </div>
      </FormGrid>

      <div className="section-label">{L('tu_sec_reputation')}</div>
      <p className="note" style={{ marginBottom: 8 }}>{L('tu_seed_hint')}</p>
      <FormGrid>
        {CRITERIA.map((c, i) => (
          <Field key={c} label={L(`crit_${c}`)}>
            <input type="number" min="0" max="5" step="0.1"
              value={[f.seedTeaching, f.seedPunctuality, f.seedMastery][i]}
              onChange={onText(['seedTeaching', 'seedPunctuality', 'seedMastery'][i])} />
          </Field>
        ))}
        <Field label={L('tu_review_count_seed')}>
          <input type="number" min="0" value={f.reviewCountSeed} onChange={onText('reviewCountSeed')} />
        </Field>
      </FormGrid>

      <div className="section-label">{L('tu_sec_contact')}</div>
      <FormGrid>
        <Field label={L('tu_contact_email')}><input type="email" value={f.contactEmail} onChange={onText('contactEmail')} /></Field>
        <Field label="WhatsApp"><input value={f.contactWhatsapp} onChange={onText('contactWhatsapp')} placeholder="+569…" /></Field>
        <div className="field span-2">
          <Check label={L('tu_contact_sharing')} checked={f.contactSharingDefault} onChange={set('contactSharingDefault')} />
        </div>
      </FormGrid>
    </Modal>
  );
}

function TutorDetail({ tutor, loading, ctx, busy, onClose, onDeleteReview }) {
  const { L, lang, fmt } = ctx;
  const reviews = tutor.reviews || [];
  const date = (s) => (s ? new Date(s).toLocaleDateString(lang === 'es' ? 'es-CL' : 'en-US') : L('none'));

  return (
    <Modal wide busy={busy} title={L('tu_detail')} subtitle={tutor.id} onClose={onClose}
      footer={<button className="btn sec" onClick={onClose}>{L('close')}</button>}>
      {loading ? <Loading L={L} /> : (
        <>
          <div className="flex" style={{ gap: 12, marginBottom: 14 }}>
            <div className="tavatar" style={{ width: 48, height: 48, fontSize: 15, background: tutor.avatarColor, color: tutor.textColor || '#fff' }}>
              {tutor.initials}
            </div>
            <div style={{ flex: 1 }}>
              <div className="flex wrap" style={{ gap: 6 }}>
                <b style={{ fontSize: 15 }}>{tutor.name}</b>
                {tutor.verified && <span className="tag g">✓ {L('tu_verified')}</span>}
                {tutor.featured && <span className="tag w">★ {L('tu_featured')}</span>}
                <Pill value={tutor.status || 'active'} map={STATUS_TAG} L={L} />
                {tutor.online && <span className="tag g"><span className="dot ok" style={{ marginRight: 5 }} />online</span>}
              </div>
              <div className="note">{tutor.subjectsLabel?.[lang] || (tutor.subjects || []).join(' · ')}</div>
            </div>
            <Stars value={tutor.rating} count={tutor.reviewCount} />
          </div>

          <div className="grid g2">
            <Card className="flat">
              <div className="section-label" style={{ marginTop: 0 }}>{L('tu_sec_offer')}</div>
              <KV k={L('tu_price')} v={tutor.pricePerHour ? `${fmt(tutor.pricePerHour)} ${tutor.currency || ''}` : L('none')} />
              <KV k={L('tu_modes')} v={(tutor.modes || []).map((m) => L(`mode_${m}`)).join(' · ')} />
              <KV k={L('tu_country')} v={tutor.country} />
              <KV k={L('tu_languages')} v={(tutor.languages || []).join(', ')} />
              <KV k={L('tu_years')} v={tutor.yearsExperience} />
            </Card>
            <Card className="flat">
              <div className="section-label" style={{ marginTop: 0 }}>{L('tu_sec_reputation')}</div>
              <KV k={L('tu_rating_computed')} v={<Stars value={tutor.rating} count={tutor.reviewCount} />} />
              {CRITERIA.map((c) => <KV key={c} k={`${L(`crit_${c}`)} (histórico)`} v={tutor.ratingSeed?.[c] ?? L('none')} />)}
              <KV k={L('tu_review_count_seed')} v={tutor.reviewCountSeed ?? 0} />
            </Card>
            <Card className="flat">
              <div className="section-label" style={{ marginTop: 0 }}>{L('tu_sec_contact')}</div>
              <KV k={L('tu_contact_email')} v={tutor.contact?.email} />
              <KV k="WhatsApp" v={tutor.contact?.whatsapp} />
              <KV k={L('tu_contact_sharing')} v={tutor.contactSharingDefault !== false ? L('yes') : L('no')} />
              <KV k={L('tu_contact_requests')} v={fmt(tutor.contactRequests || 0)} />
            </Card>
            <Card className="flat">
              <div className="section-label" style={{ marginTop: 0 }}>{L('tu_verify_title')}</div>
              <KV k={L('tu_verified')} v={tutor.verified ? L('yes') : L('no')} />
              <KV k={L('tu_verified_at')} v={date(tutor.verifiedAt)} />
              <KV k={L('tu_verified_by')} v={tutor.verifiedBy} />
              <KV k={L('tu_verify_note_saved')} v={tutor.verificationNote} />
            </Card>
          </div>

          {(tutor.bio?.es || tutor.bio?.en) && (
            <>
              <div className="section-label">{L('tu_bio_es')}</div>
              <p style={{ fontSize: 13, lineHeight: 1.6 }}>{tutor.bio?.[lang] || tutor.bio?.es}</p>
            </>
          )}

          <div className="section-label">{L('tu_reviews')} ({reviews.length})</div>
          {reviews.length === 0 ? <EmptyState msg={L('tu_no_reviews')} ic="💬" /> : reviews.map((rv) => (
            <div key={rv.id} className="review">
              <div className="rhead">
                <div className="flex" style={{ gap: 8 }}>
                  <div className="avatar">{rv.userInitials || initialsOf(rv.userName)}</div>
                  <div>
                    <b style={{ fontSize: 12.5 }}>{rv.userName || rv.userId}</b>
                    <div className="note">{date(rv.createdAt)}{rv.lessonsTaken ? ` · ${rv.lessonsTaken} clases` : ''}</div>
                  </div>
                </div>
                <div className="flex" style={{ gap: 8 }}>
                  <Stars value={rv.overall ?? 0} />
                  <button className="btn dgr sm" onClick={() => onDeleteReview(rv)}>🗑</button>
                </div>
              </div>
              {rv.comment && <p style={{ fontSize: 12.5, marginTop: 8, lineHeight: 1.55 }}>{rv.comment}</p>}
              <div className="chips" style={{ marginTop: 8 }}>
                {CRITERIA.map((c) => (
                  <span key={c} className="tag">{L(`crit_${c}`)}: {rv.ratings?.[c] ?? '—'}</span>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </Modal>
  );
}

function VerifyDialog({ tutor, ctx, busy, onClose, onConfirm }) {
  const { L } = ctx;
  const [note, setNote] = useState(tutor.verificationNote || '');
  const turningOn = !tutor.verified;

  return (
    <Modal busy={busy} title={L('tu_verify_title')} onClose={onClose}
      footer={<>
        <button className="btn sec" onClick={onClose} disabled={busy}>{L('cancel')}</button>
        <button className={`btn ${turningOn ? '' : 'dgr'}`} onClick={() => onConfirm(note)} disabled={busy}>
          {busy ? '…' : L(turningOn ? 'tu_verify' : 'tu_unverify')}
        </button>
      </>}>
      <p style={{ fontSize: 13.5, lineHeight: 1.6 }}>
        {L(turningOn ? 'tu_verify_msg' : 'tu_unverify_msg', { name: tutor.name })}
      </p>
      <Field label={L('tu_verify_note')}>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={L('tu_verify_note_ph')} />
      </Field>
    </Modal>
  );
}
