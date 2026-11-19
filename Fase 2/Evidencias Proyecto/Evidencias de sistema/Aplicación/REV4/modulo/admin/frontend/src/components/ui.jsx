import { useMemo, useEffect, useState, useRef } from 'react';

export function Kpi({ label, value, delta, up, ic }) {
  return (
    <div className="kpi">
      <div className="lbl">{ic} {label}</div>
      <div className="kpi-val">{value}</div>
      {delta ? <div className={`dl ${up ? 'up' : 'dn'}`}>{up ? '▲' : '▼'} {delta}</div> : null}
    </div>
  );
}

export function Card({ children, className = '', style }) {
  return <div className={`card ${className}`} style={style}>{children}</div>;
}

const STATE_MAP = {
  ok: ['dot ok', 'st_ok', 'g'], deg: ['dot deg', 'st_deg', 'w'], down: ['dot down', 'st_down', 'd'],
};
export function StatusPill({ state, L }) {
  const m = STATE_MAP[state] || STATE_MAP.ok;
  return <span className={`tag ${m[2]}`}><span className={m[0]} style={{ marginRight: 5 }} />{L(m[1])}</span>;
}

export function Loading({ L }) { return <div className="center">{L('loading')}</div>; }

// ─────────────────────────────────────────────────────────────────────────────
// Primitivas de interacción (modales, formularios, pestañas, avisos)
// ─────────────────────────────────────────────────────────────────────────────

// Etiqueta genérica de estado tolerante a valores desconocidos: nunca revienta
// si el backend devuelve un estado que el mapa no contempla.
export function Pill({ value, map = {}, L }) {
  const m = map[value];
  return <span className={`tag ${m?.[0] ?? ''}`}>{m ? L(m[1]) : (value ?? '—')}</span>;
}

export function ErrorBox({ msg, onRetry, L }) {
  if (!msg) return null;
  return (
    <div className="err flex between" style={{ marginTop: 0 }}>
      <span>⛔ {msg}</span>
      {onRetry && <button className="btn sec sm" onClick={onRetry}>{L ? L('retry') : 'Reintentar'}</button>}
    </div>
  );
}

export function EmptyState({ msg, ic = '📭' }) {
  return <div className="empty-hint" style={{ padding: '28px 12px' }}>{ic} {msg}</div>;
}

// Aviso flotante autodescartable. `kind`: ok | warn | err
export function Toast({ toast, onDone }) {
  useEffect(() => {
    if (!toast) return undefined;
    const id = setTimeout(onDone, toast.ms || 3000);
    return () => clearTimeout(id);
  }, [toast, onDone]);
  if (!toast) return null;
  return <div className={`toast ${toast.kind || 'ok'}`}>{toast.msg}</div>;
}

// Hook de conveniencia para el patrón toast de las páginas.
export function useToast() {
  const [toast, setToast] = useState(null);
  return {
    toast,
    clear: () => setToast(null),
    ok: (msg) => setToast({ msg: `✓ ${msg}`, kind: 'ok' }),
    warn: (msg) => setToast({ msg: `⚠ ${msg}`, kind: 'warn' }),
    err: (msg) => setToast({ msg: `⛔ ${msg}`, kind: 'err', ms: 5000 }),
  };
}

export function Modal({ title, subtitle, children, onClose, footer, wide, busy }) {
  const ref = useRef(null);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.querySelector('input,select,textarea,button')?.focus();
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose, busy]);

  return (
    <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className={`modal ${wide ? 'wide' : ''}`} ref={ref} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <div>
            <div className="modal-title">{title}</div>
            {subtitle && <div className="note">{subtitle}</div>}
          </div>
          <button className="modal-x" onClick={onClose} disabled={busy} aria-label="Cerrar">✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

// Confirmación con soporte para acciones destructivas.
export function Confirm({ title, message, confirmLabel, cancelLabel, danger, busy, onConfirm, onClose }) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      busy={busy}
      footer={<>
        <button className="btn sec" onClick={onClose} disabled={busy}>{cancelLabel}</button>
        <button className={`btn ${danger ? 'dgr' : ''}`} onClick={onConfirm} disabled={busy}>{busy ? '…' : confirmLabel}</button>
      </>}
    >
      <p style={{ fontSize: 13.5, lineHeight: 1.6 }}>{message}</p>
    </Modal>
  );
}

export function Field({ label, hint, children, wide }) {
  return (
    <div className={`field ${wide ? 'span-2' : ''}`}>
      <label>{label}</label>
      {children}
      {hint && <div className="note" style={{ marginTop: 3 }}>{hint}</div>}
    </div>
  );
}

export function FormGrid({ children }) { return <div className="form-grid">{children}</div>; }

export function Select({ value, onChange, options, placeholder, ...rest }) {
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...rest}>
      {placeholder != null && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export function Check({ label, checked, onChange }) {
  return (
    <label className="check">
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={active === t.id}
          className={`tab ${active === t.id ? 'act' : ''}`} onClick={() => onChange(t.id)}>
          {t.ic} {t.label}
          {t.count != null && <span className="cnt">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

// Selección múltiple sobre un catálogo cerrado (modos, criterios…).
export function Chips({ options, value = [], onChange }) {
  const toggle = (v) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <div className="chips">
      {options.map((o) => (
        <button type="button" key={o.value} className={`chip ${value.includes(o.value) ? 'on' : ''}`} onClick={() => toggle(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// Lista de etiquetas libre (materias, idiomas): Enter o coma para añadir.
export function TagInput({ value = [], onChange, placeholder, suggestions = [] }) {
  const [draft, setDraft] = useState('');
  const add = (raw) => {
    const t = String(raw).trim();
    if (!t) return;
    if (!value.includes(t)) onChange([...value, t]);
    setDraft('');
  };
  const free = suggestions.filter((s) => !value.includes(s));
  return (
    <div>
      <div className="chips" style={{ marginBottom: value.length ? 6 : 0 }}>
        {value.map((v) => (
          <span key={v} className="chip on">
            {v}<span className="x" onClick={() => onChange(value.filter((x) => x !== v))}>✕</span>
          </span>
        ))}
      </div>
      <input
        style={{ width: '100%' }}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(draft); }
          if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => add(draft)}
      />
      {free.length > 0 && (
        <div className="chips" style={{ marginTop: 6 }}>
          {free.slice(0, 12).map((s) => (
            <button type="button" key={s} className="chip sug" onClick={() => add(s)}>+ {s}</button>
          ))}
        </div>
      )}
    </div>
  );
}

// Valoración de solo lectura (0–5, medio punto por barra).
export function Stars({ value = 0, count }) {
  const full = Math.round(Number(value) || 0);
  return (
    <span className="stars" title={`${value}`}>
      {[1, 2, 3, 4, 5].map((i) => <span key={i} className={i <= full ? 'on' : ''}>★</span>)}
      <b>{Number(value || 0).toFixed(1)}</b>
      {count != null && <span className="note">({count})</span>}
    </span>
  );
}

// Paginación por cursor del backend (meta.pagination.nextCursor).
export function Pager({ page, shown, total, hasNext, onNext, onPrev, L }) {
  if (!hasNext && page === 0) return null;
  return (
    <div className="pager">
      <span className="note">{L('pg_showing', { shown, total })}</span>
      <div className="flex" style={{ gap: 6 }}>
        <button className="btn sec sm" onClick={onPrev} disabled={page === 0}>← {L('pg_prev')}</button>
        <button className="btn sec sm" onClick={onNext} disabled={!hasNext}>{L('pg_next')} →</button>
      </div>
    </div>
  );
}

export function KV({ k, v }) {
  return <div className="kv"><span className="k">{k}</span><span className="v">{v ?? '—'}</span></div>;
}

// ── Gráficos SVG inline (mismos del wireframe) ──
export function LineChart({ vals = [], labels = [] }) {
  const path = useMemo(() => {
    const w = 300, h = 96, pad = 8;
    // Con menos de dos puntos no hay línea que trazar: `step` se iría a
    // infinito y el cálculo del área reventaría al leer el último punto.
    if (vals.length < 2) return { empty: true, w, h };
    const max = Math.max(...vals), min = Math.min(...vals), rng = (max - min) || 1;
    const step = (w - pad * 2) / (vals.length - 1);
    const pts = vals.map((v, i) => [pad + i * step, h - 18 - ((v - min) / rng) * (h - 30)]);
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const area = d + ` L${pts[pts.length - 1][0].toFixed(1)} ${h - 18} L${pad} ${h - 18} Z`;
    return { d, area, pts, w, h, pad, step };
  }, [vals]);
  if (path.empty) return <svg viewBox={`0 0 ${path.w} ${path.h}`} width="100%" height={path.h} />;
  const { d, area, pts, w, h, pad, step } = path;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none">
      <path d={area} fill="var(--brand)" opacity=".12" />
      <path d={d} fill="none" stroke="var(--brand)" strokeWidth="2.5" strokeLinejoin="round" />
      {pts.map((p, i) => <circle key={i} cx={p[0].toFixed(1)} cy={p[1].toFixed(1)} r="2.5" fill="var(--brand)" />)}
      {labels.map((l, i) => <text key={i} x={(pad + i * step).toFixed(1)} y={h - 4} fontSize="8.5" fill="var(--muted)" textAnchor="middle" fontFamily="Inter">{l}</text>)}
    </svg>
  );
}

export function Bars({ data = [] }) {
  const w = 300, h = 140, bottom = 20;
  const max = Math.max(...data.map((d) => d.value), 0) || 1;
  const n = data.length || 1, slot = w / n, bw = Math.min(40, slot * 0.5);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h}>
      {data.map((d, i) => {
        const bh = (d.value / max) * (h - bottom - 14);
        const x = slot * i + slot / 2 - bw / 2; const y = h - bottom - bh;
        return (
          <g key={i}>
            <rect x={x.toFixed(1)} y={y.toFixed(1)} width={bw} height={bh.toFixed(1)} rx="5" fill={d.color || 'var(--brand)'} />
            <text x={(slot * i + slot / 2).toFixed(1)} y={(y - 4).toFixed(1)} fontSize="8.5" fill="var(--ink)" textAnchor="middle" fontFamily="Montserrat" fontWeight="700">{d.disp}</text>
            <text x={(slot * i + slot / 2).toFixed(1)} y={h - 5} fontSize="8.5" fill="var(--muted)" textAnchor="middle" fontFamily="Inter">{d.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function Donut({ pct }) {
  const r = 40, c = 2 * Math.PI * r, off = c * (1 - pct / 100);
  return (
    <svg viewBox="0 0 104 104" width="116" height="116">
      <circle cx="52" cy="52" r={r} fill="none" stroke="var(--line)" strokeWidth="12" />
      <circle cx="52" cy="52" r={r} fill="none" stroke="var(--accent)" strokeWidth="12" strokeLinecap="round" strokeDasharray={c.toFixed(1)} strokeDashoffset={off.toFixed(1)} transform="rotate(-90 52 52)" />
      <text x="52" y="50" fontSize="19" fontWeight="800" fill="var(--ink)" textAnchor="middle" fontFamily="Montserrat">{pct}%</text>
      <text x="52" y="67" fontSize="8" fill="var(--muted)" textAnchor="middle" fontFamily="Inter">conv.</text>
    </svg>
  );
}

export function HBars({ data = [] }) {
  const w = 300, rowH = 30, labW = 130;
  const max = Math.max(...data.map((d) => d.value), 0) || 1, h = data.length * rowH + 4;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h}>
      {data.map((d, i) => {
        const bw = (d.value / max) * (w - labW - 46); const y = i * rowH + 5;
        return (
          <g key={i}>
            <text x="0" y={y + 14} fontSize="10" fill="var(--ink)" fontFamily="Inter">{d.label}</text>
            <rect x={labW} y={y + 4} width={Math.max(3, bw).toFixed(1)} height="14" rx="4" fill={d.color || 'var(--brand)'} />
            <text x={(labW + Math.max(3, bw) + 5).toFixed(1)} y={y + 15} fontSize="9" fill="var(--muted)" fontFamily="Inter">{d.disp}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function Funnel({ data = [] }) {
  const w = 300, rowH = 34, max = data[0]?.value || 1, h = data.length * rowH + 4;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h}>
      {data.map((d, i) => {
        const bw = (d.value / max) * (w - 10); const x = (w - bw) / 2; const y = i * rowH + 4; const op = 1 - i * 0.16;
        return (
          <g key={i}>
            <rect x={x.toFixed(1)} y={y} width={bw.toFixed(1)} height={rowH - 9} rx="5" fill="var(--brand)" opacity={op.toFixed(2)} />
            <text x={(w / 2).toFixed(1)} y={y + 17} fontSize="10" fill="#fff" textAnchor="middle" fontFamily="Inter" fontWeight="600">{d.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

export const COIN = { bronze: '🥉', silver: '🥈', gold: '🥇', diamond: '💎', platinum: '⬡' };
