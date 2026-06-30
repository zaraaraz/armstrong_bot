import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIE = process.env.DASHBOARD_SESSION_COOKIE ?? 'ghost_dash_sid';
const PUBLIC_PATHS = ['/login', '/api/dashboard/auth'];

/**
 * Route guard at the edge: any path under `/g/*` or `/guild-select` requires the
 * session cookie. Unauthenticated users are redirected to `/login`. This is a
 * coarse cookie-presence check; the backend re-validates on every data fetch.
 */
export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const guarded =
    pathname.startsWith('/g/') || pathname.startsWith('/guild-select');
  if (!guarded) return NextResponse.next();

  const hasSession = req.cookies.has(SESSION_COOKIE);
  if (!hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/guild-select/:path*', '/g/:path*'],
};
