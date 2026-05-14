import { HttpInterceptorFn } from '@angular/common/http';
import { throwError } from 'rxjs';

/*
 * JWT Auth Interceptor
 * --------------------
 * Automatically attaches the JWT token (from localStorage)
 * to every outgoing HTTP request as a Bearer token.
 *
 * Flow:
 *   Angular HttpClient → this interceptor → adds "Authorization: Bearer <token>" → API Gateway
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const storedToken = localStorage.getItem('token');
  const role = localStorage.getItem('role');
  const headers: Record<string, string> = {};
  const token = isExpiredJwt(storedToken) ? null : storedToken;
  const tokenEmail = extractEmailFromJwt(token);

  if (!token && storedToken) {
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    localStorage.removeItem('role');
    localStorage.removeItem('userId');
    localStorage.removeItem('email');
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (tokenEmail) {
    headers['X-User-Email'] = tokenEmail;
  }

  if (role) {
    headers['X-User-Role'] = role;
  }

  if (Object.keys(headers).length > 0) {
    return next(req.clone({ setHeaders: headers }));
  }

  // Prevent unnecessary 401 calls:
  // If no token exists and the request is to a protected endpoint (e.g. /posts, /follows, /profile, /payments, /notifications)
  // block the request locally by returning an empty observable or throwing an error.
  const url = req.url.toLowerCase();
  const isProtectedApi = url.includes('/posts') && !url.includes('/posts/all') && !url.includes('/posts/search')
    || url.includes('/follows')
    || url.includes('/profile') && !url.includes('/profile-picture')
    || url.includes('/payments')
    || url.includes('/notifications')
    || url.includes('/admin')
    || url.includes('/reels')
    || url.includes('/story') && !url.includes('/active');

  if (isProtectedApi && !token) {
    // Return an error observable immediately without hitting the backend
    return throwError(() => new Error('Unauthenticated: Prevented 401 call'));
  }

  return next(req);
};

function isExpiredJwt(token: string | null): boolean {
  if (!token) return true;
  try {
    const payloadBase64 = token.split('.')[1];
    if (!payloadBase64) return true;
    const payload = JSON.parse(atob(payloadBase64));
    const exp = Number(payload?.exp);
    if (!Number.isFinite(exp)) return false;
    return Math.floor(Date.now() / 1000) >= exp;
  } catch {
    return true;
  }
}

function extractEmailFromJwt(token: string | null): string | null {
  if (!token) return null;
  try {
    const payloadBase64 = token.split('.')[1];
    if (!payloadBase64) return null;
    const payload = JSON.parse(atob(payloadBase64));
    const email = payload?.sub || payload?.email || payload?.username;
    return typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null;
  } catch {
    return null;
  }
}
