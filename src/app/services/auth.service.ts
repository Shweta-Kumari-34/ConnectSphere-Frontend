import { Injectable } from '@angular/core';
import { HttpClient, HttpResponse, HttpErrorResponse } from '@angular/common/http';
import { Observable, BehaviorSubject, map, tap, catchError, throwError, timeout, TimeoutError } from 'rxjs';
import { environment } from '../../environments/environment';

// These types define what values are accepted for user roles across the entire frontend.
export type UserRole = 'USER' | 'ADMIN' | 'MODERATOR';

// Shape of the response we get back from the backend after login or register.
export interface AuthResponse {
  message?: string;         
  token?: string;           
  userId?: number;          
  username?: string;        
  role?: string;            
  email?: string;           
  sessionEstablished: boolean; 
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  username: string;
  email: string;
  password: string;
  fullName: string;
  role: UserRole;
}

export interface OAuthCallbackSession {
  token?: string;
  username?: string;
  userId?: string | number;
  email?: string;
  role?: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {

  // FIXED: Now uses the full Gateway URL from environment.ts
  private readonly API_URL = environment.oauthBaseUrl + '/auth';

  private loggedIn = new BehaviorSubject<boolean>(this.hasToken());  
  private roleState = new BehaviorSubject<UserRole>(this.resolveStoredRole()); 

  isLoggedIn$ = this.loggedIn.asObservable();
  role$ = this.roleState.asObservable();

  constructor(private http: HttpClient) {}

  register(request: RegisterRequest): Observable<AuthResponse> {
    return this.http.post(`${this.API_URL}/register`, request, {
      observe: 'response',
      responseType: 'text'
    }).pipe(
      timeout(15000),
      map(res => this.normalizeAuthResponse(res)),       
      tap(res => {
        if (res.sessionEstablished) {
          this.storeSession(res);  
        }
      }),
      catchError(err => throwError(() => this.normalizeError(err))) 
    );
  }

  verifyRegister(email: string, otp: string): Observable<AuthResponse> {
    return this.http.post(`${this.API_URL}/register/verify`, { email, otp }, {
      observe: 'response',
      responseType: 'text'
    }).pipe(
      timeout(15000),
      map(res => this.normalizeAuthResponse(res, true)), 
      tap(res => this.storeSession(res)),               
      catchError(err => throwError(() => this.normalizeError(err)))
    );
  }

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

  initiatePasswordReset(email: string): Observable<any> {
    return this.http.post(`${this.API_URL}/password-reset/initiate`, { email }, { responseType: 'text' }).pipe(
      timeout(15000),
      catchError(err => throwError(() => this.normalizeError(err)))
    );
  }

  verifyPasswordReset(email: string, otp: string, newPassword: string): Observable<any> {
    return this.http.post(`${this.API_URL}/password-reset/verify`, { email, otp, newPassword }, { responseType: 'text' }).pipe(
      timeout(15000),
      catchError(err => throwError(() => this.normalizeError(err)))
    );
  }

  setSessionFromOAuthCallback(payload: OAuthCallbackSession): boolean {
    if (!payload?.token) {
      return false; 
    }

    this.storeTokenSession({
      token: payload.token,
      username: payload.username,
      userId: this.toNumber(payload.userId),
      email: payload.email,
      role: payload.role
    });

    return true; 
  }

  logout(): void {
    this.clearStoredSession();
    this.loggedIn.next(false);    
    this.roleState.next('USER');  
  }

  private clearStoredSession(): void {
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    localStorage.removeItem('role');
    localStorage.removeItem('userId');
    localStorage.removeItem('email');
  }

  getToken(): string | null {
    return localStorage.getItem('token');
  }

  getUsername(): string | null {
    return localStorage.getItem('username');
  }

  getEmail(): string | null {
    return localStorage.getItem('email');
  }

  getRole(): UserRole {
    return this.normalizeRole(localStorage.getItem('role'));
  }

  isLoggedIn(): boolean {
    return this.hasToken();
  }

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

  isStaff(): boolean {
    return this.hasAnyRole('ADMIN', 'MODERATOR');
  }

  canAccessAdminPanel(): boolean {
    return this.isAdmin() || this.isModerator();
  }

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

  private resolveStoredRole(): UserRole {
    return this.normalizeRole(localStorage.getItem('role'));
  }

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

  private storeSession(res: AuthResponse): void {
    this.storeTokenSession({
      token: res.token,
      username: res.username,
      userId: res.userId,
      email: res.email,
      role: res.role
    });
  }

  private storeTokenSession(session: {
    token?: string;
    username?: string;
    userId?: number;
    email?: string;
    role?: string;
  }): void {
    if (!session.token) {
      return; 
    }

    const tokenPayload = this.decodeJwtPayload(session.token);
    const resolvedRole = this.resolveRole(session.role, tokenPayload);
    const resolvedEmail = this.resolveEmail(session.email, tokenPayload);

    localStorage.setItem('token', session.token);
    localStorage.setItem('username', session.username || this.pickFirstString(tokenPayload?.preferred_username, tokenPayload?.username) || '');
    localStorage.setItem('role', resolvedRole);
    localStorage.setItem('userId', String(session.userId ?? this.toNumber(tokenPayload?.userId) ?? 0));
    localStorage.setItem('email', resolvedEmail || '');

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

  private decodeJwtPayload(token: string): any | null {
    try {
      const parts = token.split('.');
      if (parts.length < 2) {
        return null; 
      }
      return JSON.parse(atob(parts[1])); 
    } catch {
      return null; 
    }
  }

  private tryParseJson(value: string): any | null {
    if (!value || (!value.startsWith('{') && !value.startsWith('['))) {
      return null; 
    }
    try {
      return JSON.parse(value);
    } catch {
      return null; 
    }
  }

  private pickFirstString(...values: unknown[]): string | undefined {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
    return undefined;
  }

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
