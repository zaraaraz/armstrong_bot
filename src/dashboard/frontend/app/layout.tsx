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
      <body>{children}</body>
    </html>
  );
}
