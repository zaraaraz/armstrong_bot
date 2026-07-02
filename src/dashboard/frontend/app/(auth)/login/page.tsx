import type { ReactNode } from 'react';

/**
 * Login entry. The actual OAuth dance is owned by the backend — the button
 * navigates to the backend `/api/dashboard/auth/login` route which 302s to
 * Discord and, on success, redirects back to `/guild-select`.
 */
export default function LoginPage(): ReactNode {
  return (
    <main
      style={{
        display: 'grid',
        placeItems: 'center',
        minHeight: '100vh',
        background:
          'radial-gradient(1200px 500px at 80% -10%, rgba(88, 101, 242, 0.18), transparent 60%),' +
          'radial-gradient(900px 400px at 10% 110%, rgba(88, 101, 242, 0.10), transparent 60%),' +
          '#0f1117',
      }}
    >
      <div
        style={{
          background: 'rgba(255, 255, 255, 0.035)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: 16,
          padding: '44px 52px',
          textAlign: 'center',
          maxWidth: 400,
        }}
      >
        <div style={{ fontSize: 52 }}>👻</div>
        <h1 style={{ margin: '10px 0 4px', color: '#e5e7eb', letterSpacing: -0.3 }}>
          Ghost Bot
        </h1>
        <p style={{ color: '#9ca3af', marginTop: 0, fontSize: 14.5 }}>
          Sign in with Discord to manage your servers.
        </p>
        <a href="/api/dashboard/auth/login" style={{ textDecoration: 'none' }}>
          <button
            type="button"
            style={{
              background: '#5865F2',
              color: 'white',
              border: 'none',
              borderRadius: 10,
              padding: '12px 26px',
              fontSize: 15,
              fontWeight: 600,
              cursor: 'pointer',
              marginTop: 14,
            }}
          >
            Login with Discord
          </button>
        </a>
      </div>
    </main>
  );
}
