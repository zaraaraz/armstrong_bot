import type { ReactNode } from 'react';

/**
 * Login entry. The actual OAuth dance is owned by the backend — the button
 * simply navigates to the backend `/auth/login` route which 302s to Discord.
 */
export default function LoginPage(): ReactNode {
  return (
    <main style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
      <div>
        <h1>Ghost Bot Dashboard</h1>
        <p>Sign in with Discord to manage your servers.</p>
        <a href="/api/dashboard/auth/login">
          <button type="button">Login with Discord</button>
        </a>
      </div>
    </main>
  );
}
