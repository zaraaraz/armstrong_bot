'use client';

import type { CSSProperties, ReactNode } from 'react';

/**
 * Small shared UI primitives so pages stay visually consistent.
 * Dark theme palette (Discord-inspired) — single source of truth.
 */
export const palette = {
  pageBg: '#0f1117',
  surface: 'rgba(255, 255, 255, 0.035)',
  surfaceBorder: 'rgba(255, 255, 255, 0.07)',
  panel: '#151823',
  text: '#e5e7eb',
  muted: '#9ca3af',
  faint: 'rgba(255, 255, 255, 0.06)',
  accent: '#5865F2',
  accentSoft: '#7983f5',
  success: '#23a55a',
  warning: '#d97706',
  danger: '#f87171',
} as const;

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
        border: `1px solid ${palette.surfaceBorder}`,
        borderRadius: 14,
        padding: 20,
        background: palette.surface,
        borderTop: accent ? `3px solid ${accent}` : undefined,
      }}
    >
      {title ? (
        <h3
          style={{
            margin: '0 0 12px',
            fontSize: 12.5,
            color: palette.muted,
            textTransform: 'uppercase',
            letterSpacing: 1,
          }}
        >
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
      <div style={{ fontSize: 28, fontWeight: 700, color: color ?? palette.text }}>
        {value}
      </div>
      <div style={{ fontSize: 12, color: palette.muted, marginTop: 4 }}>
        {label}
      </div>
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
    default: {
      background: 'rgba(255, 255, 255, 0.06)',
      color: palette.text,
      border: `1px solid rgba(255, 255, 255, 0.14)`,
    },
    primary: {
      background: palette.accent,
      color: 'white',
      border: '1px solid transparent',
    },
    danger: {
      background: 'transparent',
      color: palette.danger,
      border: '1px solid rgba(248, 113, 113, 0.4)',
    },
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        ...colors[variant],
        borderRadius: 8,
        padding: '8px 14px',
        fontSize: 13,
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
      }}
    >
      {children}
    </button>
  );
}

const TH: CSSProperties = {
  textAlign: 'left',
  borderBottom: `1px solid rgba(255, 255, 255, 0.12)`,
  padding: '8px 12px',
  fontSize: 11.5,
  color: palette.muted,
  textTransform: 'uppercase',
  letterSpacing: 0.8,
};
const TD: CSSProperties = {
  padding: '10px 12px',
  borderBottom: `1px solid ${palette.faint}`,
  fontSize: 13,
  color: palette.text,
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

export function Td({
  children,
  mono,
}: {
  children: ReactNode;
  mono?: boolean;
}): ReactNode {
  return (
    <td style={{ ...TD, fontFamily: mono ? 'monospace' : undefined }}>
      {children}
    </td>
  );
}

export function Empty({
  colSpan,
  text,
}: {
  colSpan: number;
  text: string;
}): ReactNode {
  return (
    <tr>
      <td
        colSpan={colSpan}
        style={{
          ...TD,
          color: palette.muted,
          textAlign: 'center',
          padding: 24,
        }}
      >
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
