'use client';

import type { CSSProperties, ReactNode } from 'react';

/** Small shared UI primitives so pages stay visually consistent. */

export function Card({
  title,
  children,
  accent,
}: {
  title?: string;
  children: ReactNode;
  accent?: string;
}): ReactNode {
  return (
    <section
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        padding: 20,
        background: 'white',
        borderTop: accent ? `3px solid ${accent}` : undefined,
      }}
    >
      {title ? (
        <h3 style={{ margin: '0 0 12px', fontSize: 14, color: '#374151' }}>
          {title}
        </h3>
      ) : null}
      {children}
    </section>
  );
}

export function Stat({
  value,
  label,
  color,
}: {
  value: ReactNode;
  label: string;
  color?: string;
}): ReactNode {
  return (
    <div style={{ textAlign: 'center', padding: '8px 20px' }}>
      <div style={{ fontSize: 28, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>{label}</div>
    </div>
  );
}

export function Button({
  children,
  onClick,
  disabled,
  variant = 'default',
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'default' | 'primary' | 'danger';
  type?: 'button' | 'submit';
}): ReactNode {
  const colors: Record<string, CSSProperties> = {
    default: { background: '#f3f4f6', color: '#111827', border: '1px solid #d1d5db' },
    primary: { background: '#5865F2', color: 'white', border: 'none' },
    danger: { background: 'white', color: '#dc2626', border: '1px solid #fca5a5' },
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        ...colors[variant],
        borderRadius: 6,
        padding: '8px 14px',
        fontSize: 13,
        fontWeight: 500,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {children}
    </button>
  );
}

const TH: CSSProperties = {
  textAlign: 'left',
  borderBottom: '2px solid #e5e7eb',
  padding: '8px 12px',
  fontSize: 12,
  color: '#6b7280',
  textTransform: 'uppercase',
};
const TD: CSSProperties = {
  padding: '10px 12px',
  borderBottom: '1px solid #f3f4f6',
  fontSize: 13,
};

export function Table({
  columns,
  children,
}: {
  columns: string[];
  children: ReactNode;
}): ReactNode {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c} style={TH}>
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

export function Td({ children, mono }: { children: ReactNode; mono?: boolean }): ReactNode {
  return <td style={{ ...TD, fontFamily: mono ? 'monospace' : undefined }}>{children}</td>;
}

export function Empty({ colSpan, text }: { colSpan: number; text: string }): ReactNode {
  return (
    <tr>
      <td colSpan={colSpan} style={{ ...TD, color: '#9ca3af', textAlign: 'center', padding: 24 }}>
        {text}
      </td>
    </tr>
  );
}

export function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : '—';
}

export function fmtBytes(bytes: number | null): string {
  if (bytes == null) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
