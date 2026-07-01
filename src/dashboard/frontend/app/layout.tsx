import type { ReactNode } from 'react';

export const metadata = {
  title: 'Ghost Bot Dashboard',
  description: 'Control plane for Ghost Bot',
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  return (
    <html lang="pt">
      <body
        style={{
          margin: 0,
          fontFamily:
            'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          background: '#f9fafb',
          color: '#111827',
        }}
      >
        {children}
      </body>
    </html>
  );
}
