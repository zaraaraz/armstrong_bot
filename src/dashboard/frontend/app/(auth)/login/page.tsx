import type { ReactNode } from 'react';

/**
 * Login entry. The actual OAuth dance is owned by the backend — the button
 * navigates to the backend `/api/dashboard/auth/login` route which 302s to
 * Discord and, on success, redirects back to `/guild-select`.
 */
export default function LoginPage(): ReactNode {
  return (
    <main style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
      <div
        style={{
          background: 'white',
          border: '1px solid #e5e7eb',
          borderRadius: 12,
          padding: '40px 48px',
          textAlign: 'center',
          boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
          maxWidth: 400,
        }}
      >
        <div style={{ fontSize: 48 }}>👻</div>
        <h1 style={{ margin: '8px 0 4px' }}>Ghost Bot Dashboard</h1>
        <p style={{ color: '#6b7280', marginTop: 0 }}>
          Sign in with Discord to manage your servers.
        </p>
        <a href="/api/dashboard/auth/login" style={{ textDecoration: 'none' }}>
          <button
            type="button"
            style={{
              background: '#5865F2',
              color: 'white',
              border: 'none',
              borderRadius: 8,
              padding: '12px 24px',
              fontSize: 15,
              fontWeight: 600,
              cursor: 'pointer',
              marginTop: 12,
            }}
          >
            Login with Discord
          </button>
        </a>
      </div>
    </main>
  );
}
