import { useEffect, useState } from 'react';

/** 数値入力。Enter / blur で確定。不正値は元に戻す */
export function NumberField({
  value,
  onCommit,
  unit,
  min,
  max,
  decimals = 3,
  disabled,
  label,
}: {
  value: number;
  onCommit: (v: number) => void;
  unit?: string;
  min?: number;
  max?: number;
  decimals?: number;
  disabled?: boolean;
  label?: string;
}) {
  const fmt = (v: number) => String(Number(v.toFixed(decimals)));
  const [text, setText] = useState(fmt(value));
  useEffect(() => setText(fmt(value)), [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = () => {
    const v = Number(text.replace(/[,，]/g, ''));
    if (text.trim() === '' || !Number.isFinite(v) || (min !== undefined && v < min) || (max !== undefined && v > max)) {
      setText(fmt(value));
      return;
    }
    if (Math.abs(v - value) > 1e-12) onCommit(v);
    else setText(fmt(value));
  };

  return (
    <span className="numfield">
      <input
        type="text"
        inputMode="decimal"
        aria-label={label}
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setText(fmt(value));
        }}
      />
      {unit && <span className="unit">{unit}</span>}
    </span>
  );
}

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="row">
      <span className="row-label">{label}</span>
      <span className="row-value">{children}</span>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

export const KIND_LABEL: Record<string, string> = {
  conveyor: 'コンベヤ',
  source: 'ワーク供給',
  sensor: '在荷センサ',
  stopper: 'ストッパ',
  inspection_station: '検査ステーション',
  generic: '汎用オブジェクト',
};

export const KIND_EMOJI: Record<string, string> = {
  conveyor: '🟫',
  source: '📦',
  sensor: '👁',
  stopper: '🚧',
  inspection_station: '🔍',
  inspection_cell: '🔍',
  generic: '🧊',
};

export const ROLE_LABEL: Record<string, string> = {
  motor_run: 'モータ運転',
  detect: 'ワーク検出',
  release: 'ストッパ開放',
  inspect_start: '検査開始',
  inspect_done: '検査完了',
  inspect_ok: '検査OK',
};

export const AXIS_LABEL: Record<string, string> = { belt: 'ベルト', linear: '直動', rotary: '回転' };
