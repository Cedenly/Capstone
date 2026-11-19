import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, qs } from '../api/client.js';
import {
  Kpi, Card, Loading, ErrorBox, EmptyState, Modal, Field, FormGrid, Select,
  Toast, useToast, Pill,
} from '../components/ui.jsx';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
const DIFFICULTIES = ['d1', 'd2', 'd3', 'd4', 'd5'];
const STATUSES = ['draft', 'published', 'archived'];
const STATUS_TAG = { draft: ['w', 'qs_draft'], published: ['g', 'qs_published'], archived: ['', 'qs_archived'] };

const emptyQuestion = () => ({
  testId: '', axis: '', difficulty: 'd1',
  statement: '', options: ['', '', '', '', ''],
  correctAnswer: 'A', explanation: '', requiredSkill: '', status: 'draft',
});

const formFrom = (q) => ({
  testId: q.testId || '', axis: q.axis || '', difficulty: q.difficulty || 'd1',
  statement: q.statement || '',
  options: (q.options?.length ? [...q.options] : ['', '', '', '', '']),
  correctAnswer: q.correctAnswer || 'A',
  explanation: q.explanation || '', requiredSkill: q.requiredSkill || '',
  status: q.status || 'draft',
});

export default function Content({ ctx }) {
  const { L, fmt } = ctx;
  const t = useToast();

  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [filters, setFilters] = useState({ testId: '', axis: '', difficulty: '', status: '' });
  const [dialog, setDialog] = useState(null); // {kind:'form'|'import', question?}
  const [busy, setBusy] = useState(false);
  const seen = useRef({ tests: new Set(), axes: new Set() });

  const load = useCallback(async (f) => {
    setErr(null);
    try {
      const r = await api.get(`/questions${qs(f)}`);
      setRows(r.data);
      r.data.forEach((q) => {
        if (q.testId) seen.current.tests.add(q.testId);
        if (q.axis) seen.current.axes.add(q.axis);
      });
    } catch (e) { setErr(e.message); }
  }, []);

  useEffect(() => { load(filters); }, [filters, load]);

  const setF = (k, v) => setFilters((f) => ({ ...f, [k]: v }));
  const opts = (set) => [...set].sort().map((v) => ({ value: v, label: v }));

  const kpis = useMemo(() => {
    const list = rows || [];
    return {
      total: list.length,
      published: list.filter((q) => q.status === 'published').length,
      draft: list.filter((q) => (q.status || 'draft') === 'draft').length,
      tests: new Set(list.map((q) => q.testId).filter(Boolean)).size,
    };
  }, [rows]);

  const run = async (fn, okMsg) => {
    setBusy(true);
    try {
      const out = await fn();
      setDialog(null);
      if (okMsg) t.ok(okMsg);
      await load(filters);
      return out;
    } catch (e) { t.err(e.message); return null; } finally { setBusy(false); }
  };

  const save = (f, question) => {
    if (!f.statement.trim()) { t.err(L('q_err_statement')); return; }
    const options = f.options.map((o) => o.trim()).filter(Boolean);
    if (options.length < 2) { t.err(L('q_err_options')); return; }
    // Si la correcta apuntaba a una alternativa que quedó vacía, se reajusta.
    const correctAnswer = LETTERS.indexOf(f.correctAnswer) < options.length ? f.correctAnswer : 'A';
    const base = {
      testId: f.testId.trim() || null, axis: f.axis.trim() || null, difficulty: f.difficulty,
      statement: f.statement.trim(), options, correctAnswer,
      explanation: f.explanation, requiredSkill: f.requiredSkill,
    };
    // POST fuerza status 'draft' en el backend; solo PUT puede publicar.
    if (question) run(() => api.put(`/questions/${question.id}`, { ...base, status: f.status }), L('q_updated'));
    else run(() => api.post('/questions', base), L('q_created'));
  };

  if (err && !rows) return <Card><ErrorBox msg={err} onRetry={() => load(filters)} L={L} /></Card>;
  if (!rows) return <Loading L={L} />;

  return (
    <>
      <p className="sub" style={{ marginBottom: 14 }}>{L('q_intro')}</p>

      <div className="grid g4">
        <Kpi ic="📚" label={L('q_kpi_total')} value={fmt(kpis.total)} />
        <Kpi ic="✅" label={L('q_kpi_published')} value={fmt(kpis.published)} />
        <Kpi ic="✏️" label={L('q_kpi_draft')} value={fmt(kpis.draft)} />
        <Kpi ic="🧪" label={L('q_kpi_tests')} value={fmt(kpis.tests)} />
      </div>

      <Card style={{ marginTop: 16 }}>
        <div className="flex between wrap" style={{ gap: 10, marginBottom: 12 }}>
          <b>{L('q_table')}</b>
          <div className="flex" style={{ gap: 8 }}>
            <button className="btn sec sm" onClick={() => setDialog({ kind: 'import' })}>⬆️ {L('q_import')}</button>
            <button className="btn sm" onClick={() => setDialog({ kind: 'form' })}>+ {L('q_add')}</button>
          </div>
        </div>

        <div className="filters" style={{ marginBottom: 12 }}>
          <Select value={filters.testId} onChange={(v) => setF('testId', v)} options={opts(seen.current.tests)}
            placeholder={`${L('q_test')}: ${L('filter_all')}`} />
          <Select value={filters.axis} onChange={(v) => setF('axis', v)} options={opts(seen.current.axes)}
            placeholder={`${L('q_axis')}: ${L('filter_all')}`} />
          <Select value={filters.difficulty} onChange={(v) => setF('difficulty', v)} options={DIFFICULTIES.map((d) => ({ value: d, label: d.toUpperCase() }))}
            placeholder={`${L('q_difficulty')}: ${L('filter_all')}`} />
          <Select value={filters.status} onChange={(v) => setF('status', v)} options={STATUSES.map((s) => ({ value: s, label: L(STATUS_TAG[s][1]) }))}
            placeholder={`${L('q_status')}: ${L('filter_all')}`} />
          <button className="btn sec sm" onClick={() => setFilters({ testId: '', axis: '', difficulty: '', status: '' })}>{L('clear_filters')}</button>
        </div>

        {rows.length === 0 ? <EmptyState msg={L('q_no_questions')} ic="📚" /> : (
          <div className="tbl-wrap"><table>
            <thead><tr>
              <th>{L('q_statement')}</th><th>{L('q_test')}</th><th>{L('q_axis')}</th>
              <th>{L('q_difficulty')}</th><th>{L('q_correct')}</th><th>{L('q_status')}</th><th />
            </tr></thead>
            <tbody>{rows.map((q) => (
              <tr key={q.id}>
                <td>
                  <b className="clamp" style={{ fontSize: 13 }}>{q.statement}</b>
                  <div className="note">{q.id}</div>
                </td>
                <td><span className="tag">{q.testId || L('none')}</span></td>
                <td><span className="note">{q.axis || L('none')}</span></td>
                <td><span className="tag">{String(q.difficulty || '').toUpperCase() || L('none')}</span></td>
                <td><b>{q.correctAnswer}</b></td>
                <td><Pill value={q.status || 'draft'} map={STATUS_TAG} L={L} /></td>
                <td><div className="row-acts">
                  <button className="btn sec sm" onClick={() => setDialog({ kind: 'form', question: q })}>{L('edit')}</button>
                </div></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        {err && <ErrorBox msg={err} onRetry={() => load(filters)} L={L} />}
      </Card>

      {dialog?.kind === 'form' && (
        <QuestionForm question={dialog.question} ctx={ctx} busy={busy}
          tests={[...seen.current.tests]} axes={[...seen.current.axes]}
          onClose={() => setDialog(null)} onSave={save} />
      )}

      {dialog?.kind === 'import' && (
        <ImportDialog ctx={ctx} busy={busy} tests={[...seen.current.tests]}
          onClose={() => setDialog(null)}
          onRun={(testId, items) => run(() => api.post('/questions/import', { testId, items }))
            .then((res) => {
              if (!res) return;
              const d = res.data || {};
              t.ok(L('q_import_result', { imported: d.imported || 0, skipped: d.skipped || 0, errors: (d.errors || []).length }));
            })} />
      )}

      <Toast toast={t.toast} onDone={t.clear} />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function QuestionForm({ question, ctx, busy, tests, axes, onClose, onSave }) {
  const { L } = ctx;
  const [f, setF] = useState(() => (question ? formFrom(question) : emptyQuestion()));
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));
  const onText = (k) => (e) => set(k)(e.target.value);
  const setOption = (i, v) => setF((s) => ({ ...s, options: s.options.map((o, j) => (j === i ? v : o)) }));

  return (
    <Modal wide busy={busy} title={question ? L('q_edit') : L('q_new')} subtitle={question?.id}
      onClose={onClose}
      footer={<>
        {!question && <span className="note left">{L('q_draft_hint')}</span>}
        <button className="btn sec" onClick={onClose} disabled={busy}>{L('cancel')}</button>
        <button className="btn" onClick={() => onSave(f, question)} disabled={busy}>{busy ? '…' : (question ? L('save') : L('create'))}</button>
      </>}>
      <FormGrid>
        <Field label={L('q_test')} hint={tests.length ? tests.join(' · ') : undefined}>
          <input value={f.testId} onChange={onText('testId')} list="q-tests" placeholder="m1" />
          <datalist id="q-tests">{tests.map((x) => <option key={x} value={x} />)}</datalist>
        </Field>
        <Field label={L('q_axis')}>
          <input value={f.axis} onChange={onText('axis')} list="q-axes" placeholder="Álgebra" />
          <datalist id="q-axes">{axes.map((x) => <option key={x} value={x} />)}</datalist>
        </Field>
        <Field label={L('q_difficulty')}>
          <Select value={f.difficulty} onChange={set('difficulty')} options={DIFFICULTIES.map((d) => ({ value: d, label: d.toUpperCase() }))} />
        </Field>
        <Field label={L('q_status')} hint={question ? undefined : L('q_draft_hint')}>
          <Select value={f.status} onChange={set('status')} disabled={!question}
            options={STATUSES.map((s) => ({ value: s, label: L(STATUS_TAG[s][1]) }))} />
        </Field>
        <Field wide label={`${L('q_statement')} *`}>
          <textarea value={f.statement} onChange={onText('statement')} />
        </Field>
      </FormGrid>

      <div className="section-label">{L('q_options')}</div>
      <p className="note" style={{ marginBottom: 4 }}>{L('q_options_hint')}</p>
      {f.options.map((o, i) => (
        <div key={i} className={`opt-row ${f.correctAnswer === LETTERS[i] ? 'correct' : ''}`}>
          <button type="button" className="k" title={L('q_correct')} onClick={() => set('correctAnswer')(LETTERS[i])}>{LETTERS[i]}</button>
          <input value={o} onChange={(e) => setOption(i, e.target.value)} />
        </div>
      ))}

      <FormGrid>
        <Field wide label={L('q_explanation')}><textarea value={f.explanation} onChange={onText('explanation')} /></Field>
        <Field wide label={L('q_skill')}><input value={f.requiredSkill} onChange={onText('requiredSkill')} /></Field>
      </FormGrid>
    </Modal>
  );
}

function ImportDialog({ ctx, busy, tests, onClose, onRun }) {
  const { L } = ctx;
  const [testId, setTestId] = useState('');
  const [text, setText] = useState('');
  const [parseErr, setParseErr] = useState(null);

  const submit = () => {
    setParseErr(null);
    let items;
    try { items = JSON.parse(text); } catch { setParseErr(L('q_import_invalid')); return; }
    if (!Array.isArray(items)) { setParseErr(L('q_import_invalid')); return; }
    onRun(testId.trim() || null, items);
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setText(await file.text());
    setParseErr(null);
  };

  let count = null;
  try { const p = JSON.parse(text); if (Array.isArray(p)) count = p.length; } catch { /* borrador aún inválido */ }

  return (
    <Modal wide busy={busy} title={L('q_import_title')} onClose={onClose}
      footer={<>
        {count != null && <span className="note left">{count} ítems</span>}
        <button className="btn sec" onClick={onClose} disabled={busy}>{L('cancel')}</button>
        <button className="btn" onClick={submit} disabled={busy || !text.trim()}>{busy ? '…' : L('q_import_run')}</button>
      </>}>
      <FormGrid>
        <Field label={L('q_import_test')} hint={tests.length ? tests.join(' · ') : undefined}>
          <input value={testId} onChange={(e) => setTestId(e.target.value)} list="imp-tests" placeholder="m1" />
          <datalist id="imp-tests">{tests.map((x) => <option key={x} value={x} />)}</datalist>
        </Field>
        <Field label={L('q_import_file')}>
          <input type="file" accept=".json,application/json" onChange={onFile} />
        </Field>
      </FormGrid>
      <Field wide label="JSON" hint={L('q_import_hint')}>
        <textarea className="mono" style={{ minHeight: 220 }} value={text} onChange={(e) => setText(e.target.value)}
          placeholder='[{"pregunta":"…","alternativas":["…"],"respuesta_correcta":"B","eje":"Álgebra","dificultad":"d2"}]' />
      </Field>
      {parseErr && <div className="err">{parseErr}</div>}
    </Modal>
  );
}
