import { Outlet } from 'react-router-dom';

/**
 * PublicRoute - Route wrapper for unauthenticated public demo pages.
 *
 * Unlike ProtectedRoute, this does NOT check authentication and does NOT
 * redirect to login. It simply renders the child routes.
 *
 * IMPORTANT: Does not clear localStorage auth tokens - a visitor with an
 * existing private session can browse /demo without losing their auth state.
 */
export function PublicRoute() {
  return <Outlet />;
}