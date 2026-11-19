import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import {
  Card,
  Loading,
  ErrorBox,
  Modal,
  Field,
  FormGrid,
  Toast,
  useToast,
} from '../components/ui.jsx';

function normalize(plan) {
  return {
    ...plan,
    color: plan.color || '#6366F1',
    features: plan.features || [],
    popular: !!plan.popular,
    adminRevision: plan.adminRevision ?? 0,
    limits: {
      qDay: plan.limits?.qDay ?? 0,
      groups: plan.limits?.groups ?? 0,
      tests: plan.limits?.tests ?? 1,
    },
    badges: {
      login: plan.badges?.login ?? 0,
      purchase: plan.badges?.purchase ?? 0,
      correct: plan.badges?.correct ?? 0,
    },
  };
}

const payload = plan => ({
  name: plan.name,
  color: plan.color,
  features: plan.features,
  limits: plan.limits,
  badges: plan.badges,
  popular: plan.popular,
  adminRevision: plan.adminRevision,
});

const monthly = plan =>
  typeof plan.price === 'number'
    ? plan.price
    : plan.price?.monthly;

const yearly = plan =>
  typeof plan.price === 'number'
    ? plan.price * 10
    : plan.price?.yearly;

export default function Plans({ ctx }) {
  const { L, lang } = ctx;
  const text = (es, en) => lang === 'en' ? en : es;
  const toast = useToast();
  const drag = useRef(null);
  const lock = useRef(false);

  const [features, setFeatures] = useState([]);
  const [plans, setPlans] = useState(null);
  const [saved, setSaved] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialogId, setDialogId] = useState(null);
  const [overId, setOverId] = useState(null);

  const dirty = plan =>
    JSON.stringify(payload(plan)) !==
    JSON.stringify(payload(saved[plan.id] || plan));

  const hasChanges = !!plans?.some(dirty);

  const pending = text(
    'Pendiente de habilitar: creación, eliminación, publicación y cambios de precio.',
    'Not yet available: plan creation, deletion, publication and price changes.'
  );

  const featureName = feature =>
    (lang === 'en' ? feature.name_en : feature.name_es) ||
    feature.name_es ||
    feature.name ||
    feature.id;

  const money = value =>
    Number.isFinite(value)
      ? `USD ${value.toLocaleString(
          lang === 'en' ? 'en-US' : 'es-CL',
          {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }
        )}`
      : '—';

  async function load() {
    if (lock.current) return;

    lock.current = true;
    setBusy(true);
    setError('');

    try {
      const [catalog, rows] = await Promise.all([
        api.get('/features'),
        api.get('/plans'),
      ]);

      const order = { free: 0, uni: 1, all: 2 };

      const next = rows.data
        .map(normalize)
        .sort(
          (a, b) => (order[a.id] ?? 9) - (order[b.id] ?? 9)
        );

      setFeatures(catalog.data);
      setPlans(next);
      setSaved(
        Object.fromEntries(next.map(plan => [plan.id, plan]))
      );
    } catch (err) {
      setError(err.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function reload() {
    if (
      hasChanges &&
      !window.confirm(
        text(
          '¿Descartar los cambios sin guardar y recargar?',
          'Discard unsaved changes and reload?'
        )
      )
    ) {
      return;
    }

    load();
  }

  function update(id, change) {
    if (lock.current) return;

    setPlans(rows =>
      rows.map(plan =>
        plan.id === id ? change(plan) : plan
      )
    );
  }

  function addFeature(planId, featureId) {
    if (!features.some(feature => feature.id === featureId)) {
      return;
    }

    update(planId, plan => ({
      ...plan,
      features: [...new Set([...plan.features, featureId])],
    }));
  }

  function setNumber(id, group, key, value) {
    update(id, plan => ({
      ...plan,
      [group]: {
        ...plan[group],
        [key]: value === '' ? '' : Number(value),
      },
    }));
  }

  async function persist(rows) {
    if (lock.current) return false;

    lock.current = true;
    setBusy(true);

    let count = 0;

    try {
      for (const plan of rows) {
        const { data } = await api.put(
          `/plans/${plan.id}`,
          payload(plan)
        );

        const next = normalize(data);

        setPlans(previous =>
          previous.map(item =>
            item.id === next.id ? next : item
          )
        );

        setSaved(previous => ({
          ...previous,
          [next.id]: next,
        }));

        count++;
      }

      toast.ok(text('Cambios guardados.', 'Changes saved.'));
      return true;
    } catch (err) {
      const prefix = count
        ? text(
            `${count} plan(es) guardados. `,
            `${count} plan(s) saved. `
          )
        : '';

      toast.err(`${prefix}${err.message}`);
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  if (!plans) {
    return error
      ? (
        <Card>
          <ErrorBox msg={error} onRetry={load} L={L} />
        </Card>
      )
      : <Loading L={L} />;
  }

  const dialog = plans.find(plan => plan.id === dialogId);

  return (
    <>
      <div
        className="flex between wrap"
        style={{ marginBottom: 10, gap: 8 }}
      >
        <h2>{text('Planes y productos', 'Plans and products')}</h2>

        <button
          className="btn sec sm"
          disabled={busy}
          onClick={reload}
        >
          {text('Recargar', 'Reload')}
        </button>
      </div>

      <p className="sub">{L('p_intro')}</p>
      <p className="note">{pending}</p>

      {error && <ErrorBox msg={error} L={L} />}

      <div className="builder">
        <Card>
          <b>{L('p_catalog')}</b>
          <div className="note">{L('p_drag_hint')}</div>

          {features.map(feature => (
            <div
              key={feature.id}
              className="feat"
              draggable={!busy}
              onDragStart={event => {
                drag.current = feature.id;
                event.dataTransfer.setData(
                  'text/plain',
                  feature.id
                );
              }}
              onDragEnd={() => {
                drag.current = null;
                setOverId(null);
              }}
            >
              <span className="fi">{feature.ic}</span>
              {featureName(feature)}
            </div>
          ))}
        </Card>

        <div style={{ minWidth: 0 }}>
          <div
            className="flex between wrap"
            style={{ marginBottom: 10, gap: 8 }}
          >
            <span className="note">
              {hasChanges
                ? text(
                    'Tienes cambios sin guardar.',
                    'You have unsaved changes.'
                  )
                : ''}
            </span>

            <div className="flex" style={{ gap: 8 }}>
              <button
                className="btn sec sm"
                disabled
                title={pending}
              >
                {L('p_add_plan')}
              </button>

              <button
                className="btn sm"
                disabled={busy || !hasChanges}
                onClick={() => persist(plans.filter(dirty))}
              >
                {busy ? '…' : text('Guardar todos', 'Save all')}
              </button>
            </div>
          </div>

          <div className="plan-cols">
            {plans.map(plan => (
              <div key={plan.id} className="plan-col">
                <div
                  className="plan-head"
                  style={{
                    borderTop: `4px solid ${plan.color}`,
                  }}
                >
                  <div
                    className="flex between"
                    style={{ gap: 6 }}
                  >
                    <div className="pname">{plan.name}</div>

                    <div className="flex" style={{ gap: 4 }}>
                      <button
                        className="btn sec icon"
                        disabled={busy}
                        title={L('p_edit_meta')}
                        aria-label={`${text('Editar', 'Edit')} ${plan.name}`}
                        onClick={() => setDialogId(plan.id)}
                      >
                        ✏️
                      </button>

                      <button
                        className="btn dgr icon"
                        disabled
                        title={pending}
                        aria-label={L('p_delete')}
                      >
                        🗑
                      </button>
                    </div>
                  </div>

                  <div
                    className="pprice"
                    style={{ color: plan.color }}
                  >
                    {money(monthly(plan))}
                  </div>

                  <div className="note">
                    {text('Mensual', 'Monthly')}
                    {' · '}
                    {money(yearly(plan))}
                    {' '}
                    {text('anual', 'yearly')}
                  </div>

                  <label
                    className="check"
                    style={{ marginTop: 10 }}
                  >
                    <input
                      type="checkbox"
                      checked={plan.popular}
                      disabled={busy}
                      onChange={event =>
                        update(plan.id, item => ({
                          ...item,
                          popular: event.target.checked,
                        }))
                      }
                    />
                    {text('Plan destacado', 'Featured plan')}
                  </label>
                </div>

                <div
                  className={`dropzone ${overId === plan.id ? 'over' : ''}`}
                  onDragOver={event => {
                    if (!busy) {
                      event.preventDefault();
                      setOverId(plan.id);
                    }
                  }}
                  onDragLeave={() => setOverId(null)}
                  onDrop={event => {
                    event.preventDefault();
                    setOverId(null);

                    if (!busy) {
                      addFeature(
                        plan.id,
                        drag.current ||
                          event.dataTransfer.getData('text/plain')
                      );
                    }

                    drag.current = null;
                  }}
                >
                  {!plan.features.length && (
                    <div className="empty-hint">
                      {L('p_empty')}
                    </div>
                  )}

                  {plan.features.map(id => {
                    const feature = features.find(
                      item => item.id === id
                    );

                    return (
                      <div key={id} className="pfeat">
                        <span>{feature?.ic}</span>
                        {feature ? featureName(feature) : id}

                        <button
                          className="btn sec icon"
                          style={{ marginLeft: 'auto' }}
                          disabled={busy}
                          aria-label={`${text('Quitar', 'Remove')} ${feature ? featureName(feature) : id}`}
                          onClick={() =>
                            update(plan.id, item => ({
                              ...item,
                              features: item.features.filter(
                                value => value !== id
                              ),
                            }))
                          }
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}

                  <select
                    value=""
                    disabled={busy}
                    aria-label={`${text('Añadir funcionalidad a', 'Add feature to')} ${plan.name}`}
                    onChange={event =>
                      addFeature(plan.id, event.target.value)
                    }
                  >
                    <option value="">
                      {text(
                        'Añadir funcionalidad…',
                        'Add feature…'
                      )}
                    </option>

                    {features
                      .filter(
                        feature =>
                          !plan.features.includes(feature.id)
                      )
                      .map(feature => (
                        <option
                          key={feature.id}
                          value={feature.id}
                        >
                          {featureName(feature)}
                        </option>
                      ))}
                  </select>
                </div>

                {[
                  [
                    'limits',
                    L('p_limits'),
                    [
                      ['qDay', L('lim_qday')],
                      ['groups', L('lim_groups')],
                      ['tests', L('lim_tests')],
                    ],
                  ],
                  [
                    'badges',
                    L('p_badges'),
                    [
                      ['login', L('bdg_login')],
                      ['purchase', L('bdg_purchase')],
                      ['correct', L('bdg_correct')],
                    ],
                  ],
                ].map(([group, title, fields]) => (
                  <div className="limits" key={group}>
                    <div className="section-label">
                      {title}
                    </div>

                    {fields.map(([key, label]) => (
                      <div className="limit-row" key={key}>
                        <label
                          htmlFor={`${plan.id}-${group}-${key}`}
                        >
                          {label}
                        </label>

                        <input
                          id={`${plan.id}-${group}-${key}`}
                          type="number"
                          min="0"
                          step="1"
                          disabled={busy}
                          value={plan[group][key]}
                          onChange={event =>
                            setNumber(
                              plan.id,
                              group,
                              key,
                              event.target.value
                            )
                          }
                        />
                      </div>
                    ))}

                    <div className="note">
                      {group === 'limits'
                        ? `0 = ${L('unlimited')}`
                        : text(
                            'Badges por acción',
                            'Badges per action'
                          )}
                    </div>
                  </div>
                ))}

                <div
                  className="flex"
                  style={{
                    padding: 12,
                    gap: 8,
                    borderTop: '1px solid var(--line)',
                  }}
                >
                  <button
                    className="btn sm"
                    disabled={busy || !dirty(plan)}
                    onClick={() => persist([plan])}
                  >
                    {L('save')}
                  </button>

                  <button
                    className="btn sec sm"
                    disabled={busy || !dirty(plan)}
                    onClick={() =>
                      update(plan.id, () => saved[plan.id])
                    }
                  >
                    {text('Deshacer', 'Undo')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {dialog && (
        <PlanMetadata
          key={dialog.id}
          plan={dialog}
          ctx={ctx}
          busy={busy}
          pending={pending}
          onClose={() => setDialogId(null)}
          onSave={async changes => {
            const success = await persist([
              { ...dialog, ...changes },
            ]);

            if (success) setDialogId(null);
          }}
        />
      )}

      <Toast toast={toast.toast} onDone={toast.clear} />
    </>
  );
}

function PlanMetadata({
  plan,
  ctx,
  busy,
  pending,
  onClose,
  onSave,
}) {
  const { L, lang } = ctx;
  const text = (es, en) => lang === 'en' ? en : es;

  const [name, setName] = useState(plan.name);
  const [color, setColor] = useState(plan.color);

  return (
    <Modal
      busy={busy}
      title={L('p_edit_meta')}
      onClose={onClose}
      footer={
        <>
          <button
            className="btn sec"
            disabled={busy}
            onClick={onClose}
          >
            {L('cancel')}
          </button>

          <button
            className="btn"
            disabled={
              busy ||
              !name.trim() ||
              !/^#[0-9a-f]{6}$/i.test(color)
            }
            onClick={() =>
              onSave({
                name: name.trim(),
                color,
              })
            }
          >
            {busy ? '…' : L('save')}
          </button>
        </>
      }
    >
      <FormGrid>
        <Field wide label={L('p_name')}>
          <input
            value={name}
            maxLength={120}
            disabled={busy}
            onChange={event => setName(event.target.value)}
          />
        </Field>

        <Field label={L('p_color')}>
          <input
            type="color"
            disabled={busy}
            value={
              /^#[0-9a-f]{6}$/i.test(color)
                ? color
                : '#6366F1'
            }
            onChange={event => setColor(event.target.value)}
          />

          <input
            value={color}
            disabled={busy}
            onChange={event => setColor(event.target.value)}
          />
        </Field>

        <Field
          label={text(
            'Precio mensual (USD)',
            'Monthly price (USD)'
          )}
        >
          <input readOnly value={monthly(plan) ?? ''} />
        </Field>

        <Field
          label={text(
            'Precio anual (USD)',
            'Yearly price (USD)'
          )}
        >
          <input readOnly value={yearly(plan) ?? ''} />
        </Field>

        <Field label={text('Publicado', 'Published')}>
          <input
            type="checkbox"
            checked={plan.published !== false}
            disabled
          />
        </Field>
      </FormGrid>

      <p className="note">{pending}</p>
    </Modal>
  );
}