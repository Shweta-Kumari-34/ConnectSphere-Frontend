import { Injectable } from '@angular/core';
import { HttpClient, HttpResponse, HttpErrorResponse } from '@angular/common/http';
import { Observable, BehaviorSubject, map, tap, catchError, throwError, timeout, TimeoutError } from 'rxjs';

// These types define what values are accepted for user roles across the entire frontend.
export type UserRole = 'USER' | 'ADMIN' | 'MODERATOR';

// Shape of the response we get back from the backend after login or register.
export interface AuthResponse {
  message?: string;         // e.g., "Login successful" or "OTP sent"
  token?: string;           // the JWT token — stored in localStorage after login
  userId?: number;          // the user's database ID
  username?: string;        // the user's handle (e.g., "alice123")
  role?: string;            // USER, ADMIN, or MODERATOR
  email?: string;           // the user's email address
  sessionEstablished: boolean; // true if a token was received and the user is now logged in
}

// What we send to the backend when the user submits the login form.
export interface LoginRequest {
  email: string;
  password: string;
}

// What we send to the backend when the user fills in the registration form.
export interface RegisterRequest {
  username: string;
  email: string;
  password: string;
  fullName: string;
  role: UserRole;
}

// What the backend gives us in the URL after a successful Google/GitHub OAuth2 login.
export interface OAuthCallbackSession {
  token?: string;
  username?: string;
  userId?: string | number;
  email?: string;
  role?: string;
}

/**
 * AuthService — The central authentication service for the ConnectSphere frontend.
 *
 * Responsibilities:
 *   1. Sending login, register, and OTP requests to the backend via HTTP.
 *   2. Storing the JWT token and user info in localStorage after a successful login.
 *   3. Exposing reactive observables (isLoggedIn$, role$) so other components can
 *      react to auth state changes in real time (e.g., hide/show nav items).
 *   4. Reading back stored session data (getToken, getEmail, getRole, etc.).
 *   5. Clearing the session on logout.
 *
 * Flow overview:
 *   User submits form → AuthService calls backend API → backend returns JWT
 *   → AuthService stores token in localStorage → isLoggedIn$ emits true
 *   → Angular guards and interceptors use the token for every future request
 */
@Injectable({ providedIn: 'root' })
export class AuthService {

  // All requests go through the API Gateway at /auth → routed to auth-service.
  private readonly API_URL = '/auth';

  // BehaviorSubject holds the current state and replays the last value to new subscribers.
  // When the user logs in, we call loggedIn.next(true) and all subscribers are notified.
  private loggedIn = new BehaviorSubject<boolean>(this.hasToken());  // true if token exists in localStorage
  private roleState = new BehaviorSubject<UserRole>(this.resolveStoredRole()); // current role from localStorage

  // Public observables — components subscribe to these to react when auth state changes.
  isLoggedIn$ = this.loggedIn.asObservable();
  role$ = this.roleState.asObservable();

  constructor(private http: HttpClient) {}

  // ─── REGISTRATION ────────────────────────────────────────────────────────

  // Step 1 of registration: send user details to backend.
  // The backend creates an inactive account and sends an OTP to the email.
  // We use responseType: 'text' because the backend sometimes returns plain strings, not JSON.
  // timeout(15000) means: if no response in 15 seconds, throw a timeout error.
  register(request: RegisterRequest): Observable<AuthResponse> {
    return this.http.post(`${this.API_URL}/register`, request, {
      observe: 'response',
      responseType: 'text'
    }).pipe(
      timeout(15000),
      map(res => this.normalizeAuthResponse(res)),       // parse the mixed response format
      tap(res => {
        if (res.sessionEstablished) {
          this.storeSession(res);  // if a token was returned, store it immediately
        }
      }),
      catchError(err => throwError(() => this.normalizeError(err))) // convert any error to a clean message
    );
  }

  // Step 2 of registration: user submits the OTP from their email.
  // If correct, the backend activates the account and returns a JWT token.
  // requireToken: true means we throw an error if no token comes back.
  verifyRegister(email: string, otp: string): Observable<AuthResponse> {
    return this.http.post(`${this.API_URL}/register/verify`, { email, otp }, {
      observe: 'response',
      responseType: 'text'
    }).pipe(
      timeout(15000),
      map(res => this.normalizeAuthResponse(res, true)), // expect a token in this response
      tap(res => this.storeSession(res)),               // store token → user is now logged in
      catchError(err => throwError(() => this.normalizeError(err)))
    );
  }

  // ─── LOGIN ───────────────────────────────────────────────────────────────

  // Standard password login: sends email + password, gets back a JWT token.
  // After this, the user is logged in and the token is stored in localStorage.
  login(request: LoginRequest): Observable<AuthResponse> {
    return this.http.post(`${this.API_URL}/login`, request, {
      observe: 'response',
      responseType: 'text'
    }).pipe(
      timeout(15000),
      map(res => this.normalizeAuthResponse(res, true)),
      tap(res => this.storeSession(res)),
      catchError(err => throwError(() => this.normalizeError(err)))
    );
  }

  // OTP login Step 1: user provides only their email → backend sends OTP to that email.
  // No token is returned here — just a confirmation message.
  initiateLogin(email: string): Observable<{ message?: string }> {
    return this.http.post(`${this.API_URL}/login/initiate`, { email }, {
      observe: 'response',
      responseType: 'text'
    }).pipe(
      timeout(15000),
      map(res => {
        const parsed = this.tryParseJson(res.body?.trim() || '');
        return { message: this.pickFirstString(parsed?.message, res.body) };
      }),
      catchError(err => throwError(() => this.normalizeError(err)))
    );
  }

  // OTP login Step 2: user submits the OTP they received → backend returns a JWT.
  // After this, the user is fully logged in.
  verifyLogin(email: string, otp: string): Observable<AuthResponse> {
    return this.http.post(`${this.API_URL}/login/verify`, { email, otp }, {
      observe: 'response',
      responseType: 'text'
    }).pipe(
      timeout(15000),
      map(res => this.normalizeAuthResponse(res, true)),
      tap(res => this.storeSession(res)),
      catchError(err => throwError(() => this.normalizeError(err)))
    );
  }

  // ─── PASSWORD RESET ──────────────────────────────────────────────────────

  // Step 1: User enters their email → backend sends an OTP to that inbox.
  initiatePasswordReset(email: string): Observable<any> {
    return this.http.post(`${this.API_URL}/password-reset/initiate`, { email }, { responseType: 'text' }).pipe(
      timeout(15000),
      catchError(err => throwError(() => this.normalizeError(err)))
    );
  }

  // Step 2: User submits email + OTP + new password → backend updates the password.
  verifyPasswordReset(email: string, otp: string, newPassword: string): Observable<any> {
    return this.http.post(`${this.API_URL}/password-reset/verify`, { email, otp, newPassword }, { responseType: 'text' }).pipe(
      timeout(15000),
      catchError(err => throwError(() => this.normalizeError(err)))
    );
  }

  // ─── OAUTH2 SESSION ──────────────────────────────────────────────────────

  // Called after a successful Google/GitHub login redirect.
  // The backend redirects the browser with token info in the URL — this method
  // reads that payload and stores it in localStorage, logging the user in.
  // Returns false if no token was present (e.g., OAuth was cancelled).
  setSessionFromOAuthCallback(payload: OAuthCallbackSession): boolean {
    if (!payload?.token) {
      return false; // no token means login was not completed — don't store anything
    }

    this.storeTokenSession({
      token: payload.token,
      username: payload.username,
      userId: this.toNumber(payload.userId),
      email: payload.email,
      role: payload.role
    });

    return true; // session established — user is now logged in
  }

  // ─── SESSION MANAGEMENT ──────────────────────────────────────────────────

  // Removes all stored auth data from localStorage and resets the reactive state.
  // The backend doesn't maintain sessions, so client-side removal is all that's needed.
  logout(): void {
    this.clearStoredSession();
    this.loggedIn.next(false);    // notify all subscribers that the user is now logged out
    this.roleState.next('USER');  // reset role to default
  }

  private clearStoredSession(): void {
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    localStorage.removeItem('role');
    localStorage.removeItem('userId');
    localStorage.removeItem('email');
  }

  // ─── SESSION READERS ─────────────────────────────────────────────────────
  // These are called by components and guards throughout the app to read the current session.

  // Returns the raw JWT string — attached to every API request by auth.interceptor.ts
  getToken(): string | null {
    return localStorage.getItem('token');
  }

  // Returns the logged-in user's display name (e.g., "alice123")
  getUsername(): string | null {
    return localStorage.getItem('username');
  }

  // Returns the logged-in user's email — used by backend services to identify the user
  getEmail(): string | null {
    return localStorage.getItem('email');
  }

  // Returns the current role (USER / ADMIN / MODERATOR) — used by guards and UI conditionals
  getRole(): UserRole {
    return this.normalizeRole(localStorage.getItem('role'));
  }

  // Simple check: is anyone logged in right now?
  isLoggedIn(): boolean {
    return this.hasToken();
  }

  // ─── ROLE CHECKS ─────────────────────────────────────────────────────────
  // These are used by Angular route guards and template conditionals like *ngIf="isAdmin()".

  // Returns true if the current user has any of the specified roles.
  hasAnyRole(...roles: UserRole[]): boolean {
    if (!roles.length) {
      return false;
    }
    const currentRole = this.getRole();
    return roles.includes(currentRole);
  }

  isAdmin(): boolean {
    return this.hasAnyRole('ADMIN');
  }

  isModerator(): boolean {
    return this.hasAnyRole('MODERATOR');
  }

  // Returns true for both ADMIN and MODERATOR — used for staff-only sections.
  isStaff(): boolean {
    return this.hasAnyRole('ADMIN', 'MODERATOR');
  }

  // Shorthand for checking access to the admin dashboard.
  canAccessAdminPanel(): boolean {
    return this.isAdmin() || this.isModerator();
  }

  // Returns true only if a valid token exists in localStorage.
  private hasToken(): boolean {
    const token = localStorage.getItem('token');
    if (!token) {
      return false;
    }

    const tokenPayload = this.decodeJwtPayload(token);
    const exp = this.toNumber(tokenPayload?.exp);
    if (exp && Math.floor(Date.now() / 1000) >= exp) {
      return false;
    }

    return true;
  }

  // Reads the stored role on startup so reactive state is initialized correctly.
  private resolveStoredRole(): UserRole {
    return this.normalizeRole(localStorage.getItem('role'));
  }

  /**
   * Normalizes error responses from various formats into a consistent structure.
   */
  private normalizeError(err: any): { message: string; status?: number } {
    if (err instanceof TimeoutError) {
      return {
        message: 'Request timed out. Server took too long to respond.',
        status: 408
      };
    }

    if (!(err instanceof HttpErrorResponse)) {
      return { message: err?.message || 'An unexpected error occurred.' };
    }

    const status = err.status;

    if (status === 0) {
      return {
        message: 'Unable to connect to the server. Please make sure the backend is running.',
        status: 0
      };
    }

    let parsed: any = null;
    if (typeof err.error === 'string' && err.error.trim()) {
      parsed = this.tryParseJson(err.error);
    } else if (typeof err.error === 'object' && err.error !== null) {
      parsed = err.error;
    }

    const message = this.pickFirstString(
      parsed?.message,
      parsed?.error?.message,
      parsed?.errors?.[0]?.defaultMessage,
      typeof err.error === 'string' ? err.error.trim() : undefined
    );

    const fallbackMessages: Record<number, string> = {
      400: 'Invalid request. Please check your input.',
      401: 'Invalid credentials. Please try again.',
      403: 'Access denied.',
      404: 'Service not available. Please try again later.',
      409: message || 'This account already exists.',
      500: 'Server error. Please try again later.',
      502: 'Server is temporarily unavailable.',
      503: 'Service unavailable. Please try again later.',
      504: 'Server timeout. Please try again.'
    };

    return {
      message: message || fallbackMessages[status] || `Request failed (${status}). Please try again.`,
      status
    };
  }

  // ─── PRIVATE HELPERS ─────────────────────────────────────────────────────

  // Parses the HTTP response into a clean AuthResponse object.
  // The backend may return JSON or plain text — this handles both cases.
  // It also checks multiple possible field names for the token (token, accessToken, jwt)
  // because different endpoints and OAuth providers use different naming conventions.
  private normalizeAuthResponse(response: HttpResponse<string>, requireToken: boolean = false): AuthResponse {
    const rawBody = response.body?.trim() || '';
    const parsed = this.tryParseJson(rawBody);
    const bearerHeader = response.headers.get('Authorization') || response.headers.get('authorization') || '';
    const headerToken = bearerHeader.startsWith('Bearer ') ? bearerHeader.slice(7).trim() : '';

    const token = this.pickFirstString(
      parsed?.token,
      parsed?.accessToken,
      parsed?.jwt,
      parsed?.data?.token,
      headerToken
    );

    const username = this.pickFirstString(
      parsed?.username,
      parsed?.user?.username,
      parsed?.data?.username
    );

    const role = this.pickFirstString(
      parsed?.role,
      parsed?.user?.role,
      parsed?.data?.role
    );

    const email = this.pickFirstString(
      parsed?.email,
      parsed?.user?.email,
      parsed?.data?.email
    );

    const userId = this.pickFirstNumber(
      parsed?.userId,
      parsed?.id,
      parsed?.user?.id,
      parsed?.data?.userId
    );

    if (requireToken && !token) {
      throw new Error('Login response did not include an authentication token.');
    }

    return {
      message: this.pickFirstString(parsed?.message, parsed?.data?.message, rawBody),
      token,
      userId,
      username,
      role,
      email,
      sessionEstablished: !!token
    };
  }

  // Adapts a full AuthResponse object into the storeTokenSession format.
  private storeSession(res: AuthResponse): void {
    this.storeTokenSession({
      token: res.token,
      username: res.username,
      userId: res.userId,
      email: res.email,
      role: res.role
    });
  }

  // Writes all session data to localStorage and updates the reactive state.
  // Also decodes the JWT payload to extract any fields the backend didn't include in the response body.
  private storeTokenSession(session: {
    token?: string;
    username?: string;
    userId?: number;
    email?: string;
    role?: string;
  }): void {
    if (!session.token) {
      return; // nothing to store without a token
    }

    // Decode the JWT payload to extract embedded claims (role, email, username)
    // in case the response body didn't include them directly.
    const tokenPayload = this.decodeJwtPayload(session.token);
    const resolvedRole = this.resolveRole(session.role, tokenPayload);
    const resolvedEmail = this.resolveEmail(session.email, tokenPayload);

    // Store everything so it survives page refreshes.
    localStorage.setItem('token', session.token);
    localStorage.setItem('username', session.username || this.pickFirstString(tokenPayload?.preferred_username, tokenPayload?.username) || '');
    localStorage.setItem('role', resolvedRole);
    localStorage.setItem('userId', String(session.userId ?? this.toNumber(tokenPayload?.userId) ?? 0));
    localStorage.setItem('email', resolvedEmail || '');

    // Notify all reactive subscribers that the user is now logged in.
    this.loggedIn.next(true);
    this.roleState.next(resolvedRole);
  }

  private resolveRole(responseRole: string | undefined, tokenPayload: any): UserRole {
    const fromToken = this.pickFirstString(
      tokenPayload?.role,
      tokenPayload?.roles?.[0],
      tokenPayload?.authorities?.[0],
      tokenPayload?.scope
    );

    return this.normalizeRole(responseRole || fromToken);
  }

  private resolveEmail(responseEmail: string | undefined, tokenPayload: any): string {
    return this.pickFirstString(
      responseEmail,
      tokenPayload?.sub,
      tokenPayload?.email,
      tokenPayload?.user_email
    ) || '';
  }

  private normalizeRole(rawRole: string | null | undefined): UserRole {
    const value = String(rawRole || '').toUpperCase().replace(/^ROLE_/, '').trim();
    if (value === 'ADMIN') return 'ADMIN';
    if (value === 'MODERATOR' || value === 'MOD') return 'MODERATOR';
    return 'USER';
  }

  // JWTs are three Base64-encoded sections separated by dots: header.payload.signature
  // We decode only the PAYLOAD (middle section) to read claims like email, role, userId.
  // We do NOT verify the signature here — the backend validates that on every request.
  private decodeJwtPayload(token: string): any | null {
    try {
      const parts = token.split('.');
      if (parts.length < 2) {
        return null; // not a valid JWT structure
      }
      return JSON.parse(atob(parts[1])); // Base64 decode and parse the payload
    } catch {
      return null; // token was malformed
    }
  }

  // Safely attempts to parse a string as JSON.
  // Returns null if the string is not JSON (e.g., plain text like "OK" or "User registered").
  private tryParseJson(value: string): any | null {
    if (!value || (!value.startsWith('{') && !value.startsWith('['))) {
      return null; // clearly not JSON — skip parsing
    }
    try {
      return JSON.parse(value);
    } catch {
      return null; // invalid JSON — return null safely
    }
  }

  // Returns the first non-empty string from a list of candidates.
  // Used to find fields like 'token' or 'email' that may appear under different names
  // depending on which backend endpoint or OAuth provider we're talking to.
  private pickFirstString(...values: unknown[]): string | undefined {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
    return undefined;
  }

  // Returns the first valid finite number from a list of candidates.
  // Also handles string representations of numbers (e.g., userId returned as "42").
  private pickFirstNumber(...values: unknown[]): number | undefined {
    for (const value of values) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === 'string' && value.trim() && !Number.isNaN(Number(value))) {
        return Number(value);
      }
    }
    return undefined;
  }

  // Converts a single value to a number — used when userId could be a string or number.
  private toNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim() && !Number.isNaN(Number(value))) {
      return Number(value);
    }
    return undefined;
  }
}
