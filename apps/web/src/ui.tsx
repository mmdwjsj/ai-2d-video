import React from 'react';

export const SectionTitle: React.FC<{
  title: string; hint?: string; right?: React.ReactNode;
}> = ({ title, hint, right }) => (
  <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
    <div>
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      {hint && <p className="mt-0.5 text-xs text-stone-500">{hint}</p>}
    </div>
    {right && <div className="flex flex-wrap gap-2">{right}</div>}
  </div>
);

/** 嵌进「一页四段」时用的轻量标题行：不占大标题，只留提示与操作按钮。 */
export const InlineBar: React.FC<{ hint?: string; right?: React.ReactNode }> = ({ hint, right }) => (
  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
    {hint ? <p className="max-w-xl text-[11px] leading-5 text-stone-500">{hint}</p> : <span />}
    {right && <div className="flex flex-wrap gap-2">{right}</div>}
  </div>
);

export const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={`card p-4 ${className}`}>{children}</div>
);

export const Field: React.FC<{
  label: string; value: string | number; onChange: (value: string) => void;
  placeholder?: string; type?: string; min?: number; max?: number; step?: number;
}> = ({ label, value, onChange, placeholder, type = 'text', min, max, step }) => (
  <label className="block">
    <span className="label">{label}</span>
    <input
      className="input" type={type} value={value} placeholder={placeholder}
      min={min} max={max} step={step}
      onChange={(e) => onChange(e.target.value)}
    />
  </label>
);

export const TextArea: React.FC<{
  label: string; value: string; onChange: (value: string) => void;
  rows?: number; placeholder?: string; hint?: string;
}> = ({ label, value, onChange, rows = 4, placeholder, hint }) => (
  <label className="block">
    <span className="label">{label}</span>
    <textarea
      className="textarea" rows={rows} value={value} placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
    {hint && <span className="mt-1 block text-[11px] text-stone-400">{hint}</span>}
  </label>
);

export const Select: React.FC<{
  label: string; value: string; onChange: (value: string) => void;
  options: { value: string; label: string }[];
}> = ({ label, value, onChange, options }) => (
  <label className="block">
    <span className="label">{label}</span>
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  </label>
);

export const Badge: React.FC<{ tone?: 'gray' | 'green' | 'orange' | 'red' | 'blue'; children: React.ReactNode }> = ({
  tone = 'gray', children,
}) => {
  const cls = {
    gray: 'bg-stone-100 text-stone-600',
    green: 'bg-emerald-50 text-emerald-700',
    orange: 'bg-orange-50 text-orange-700',
    red: 'bg-red-50 text-red-700',
    blue: 'bg-sky-50 text-sky-700',
  }[tone];
  return <span className={`chip ${cls}`}>{children}</span>;
};

export const Banner: React.FC<{
  tone?: 'info' | 'warn' | 'error'; children: React.ReactNode; action?: React.ReactNode;
}> = ({ tone = 'info', children, action }) => {
  const cls = {
    info: 'border-sky-200 bg-sky-50 text-sky-800',
    warn: 'border-amber-200 bg-amber-50 text-amber-800',
    error: 'border-red-200 bg-red-50 text-red-700',
  }[tone];
  return (
    <div className={`mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs ${cls}`}>
      <span>{children}</span>
      {action && <span className="flex gap-2">{action}</span>}
    </div>
  );
};

export const Empty: React.FC<{ title: string; hint?: string; action?: React.ReactNode }> = ({ title, hint, action }) => (
  <div className="card flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
    <p className="text-sm font-medium text-ink">{title}</p>
    {hint && <p className="max-w-md text-xs text-stone-500">{hint}</p>}
    {action}
  </div>
);

export const Modal: React.FC<{
  title: string; children: React.ReactNode; onClose: () => void;
  footer?: React.ReactNode;
}> = ({ title, children, onClose, footer }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
    <div className="card w-full max-w-lg p-5" onClick={(e) => e.stopPropagation()}>
      <h3 className="mb-3 text-base font-semibold">{title}</h3>
      <div className="max-h-[60vh] overflow-auto text-sm">{children}</div>
      <div className="mt-4 flex justify-end gap-2">{footer ?? (
        <button className="btn btn-ghost" onClick={onClose}>关闭</button>
      )}</div>
    </div>
  </div>
);
