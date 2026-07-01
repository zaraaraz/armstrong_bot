import { redirect } from 'next/navigation';

/**
 * Root entry — send visitors into the app. The edge middleware bounces
 * unauthenticated users from /guild-select to /login, so this single redirect
 * covers both the signed-in and signed-out cases.
 */
export default function RootPage(): never {
  redirect('/guild-select');
}
