import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { AuthService, RegisterRequest, LoginRequest } from './auth.service';
import { environment } from '../../environments/environment';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('AuthService', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [AuthService]
    });
    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
    localStorage.clear();
  });

  afterEach(() => {
    httpMock?.verify();
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('Registration', () => {
    it('should send a register request and handle success', () => {
      const mockRequest: RegisterRequest = {
        username: 'testuser',
        email: 'test@example.com',
        password: 'password123',
        fullName: 'Test User',
        role: 'USER'
      };

      service.register(mockRequest).subscribe(res => {
        expect(res.message).toBe('Registration successful');
      });

      const req = httpMock.expectOne(`${environment.oauthBaseUrl}/auth/register`);
      expect(req.request.method).toBe('POST');
      req.flush('Registration successful', { status: 200, statusText: 'OK' });
    });

    it('should handle registration with immediate token return', () => {
      const mockRequest: RegisterRequest = {
        username: 'testuser',
        email: 'test@example.com',
        password: 'password123',
        fullName: 'Test User',
        role: 'USER'
      };

      const mockResponse = JSON.stringify({
        token: 'mock-jwt-token',
        userId: 123,
        username: 'testuser',
        role: 'USER'
      });

      service.register(mockRequest).subscribe(res => {
        expect(res.token).toBe('mock-jwt-token');
        expect(localStorage.getItem('token')).toBe('mock-jwt-token');
      });

      const req = httpMock.expectOne(`${environment.oauthBaseUrl}/auth/register`);
      req.flush(mockResponse);
    });
  });

  describe('Login', () => {
    it('should store session on successful login', () => {
      const mockLogin: LoginRequest = { email: 'test@example.com', password: 'password123' };
      const mockResponse = JSON.stringify({
        token: 'jwt-token',
        userId: 456,
        email: 'test@example.com',
        role: 'ADMIN'
      });

      service.login(mockLogin).subscribe(res => {
        expect(res.token).toBe('jwt-token');
        expect(service.isLoggedIn()).toBe(true);
        expect(service.getRole()).toBe('ADMIN');
      });

      const req = httpMock.expectOne(`${environment.oauthBaseUrl}/auth/login`);
      req.flush(mockResponse);
    });

    it('should handle login errors', () => {
      service.login({ email: 'bad@email.com', password: 'wrong' }).subscribe({
        error: (err) => {
          expect(err.message).toBe('Invalid credentials');
        }
      });

      const req = httpMock.expectOne(`${environment.oauthBaseUrl}/auth/login`);
      req.flush('Invalid credentials', { status: 401, statusText: 'Unauthorized' });
    });
  });

  describe('Session Management', () => {
    it('should clear localStorage on logout', () => {
      localStorage.setItem('token', 'some-token');
      localStorage.setItem('role', 'USER');

      service.logout();

      expect(localStorage.getItem('token')).toBeNull();
      expect(service.isLoggedIn()).toBe(false);
    });

    it('should correctly identify staff roles', () => {
      localStorage.setItem('role', 'ADMIN');
      expect(service.isAdmin()).toBe(true);
      expect(service.isStaff()).toBe(true);

      localStorage.setItem('role', 'MODERATOR');
      expect(service.isModerator()).toBe(true);
      expect(service.isAdmin()).toBe(false);
      expect(service.isStaff()).toBe(true);

      localStorage.setItem('role', 'USER');
      expect(service.isStaff()).toBe(false);
    });
  });

  describe('Token Decoding', () => {
    it('should handle session from OAuth callback', () => {
      const payload = {
        token: 'header.eyJzdWIiOiJvYXV0aEBleGFtcGxlLmNvbSIsImV4cCI6OTk5OTk5OTk5OX0.sig',
        username: 'oauthuser',
        userId: 789,
        role: 'USER'
      };

      const result = service.setSessionFromOAuthCallback(payload);

      expect(result).toBe(true);
      expect(localStorage.getItem('token')).toBe(payload.token);
      expect(localStorage.getItem('email')).toBe('oauth@example.com');
    });
  });

  describe('Helper Methods', () => {
    it('should normalize auth response with missing fields', () => {
      // @ts-ignore - access private method for testing
      const result = service.normalizeAuthResponse({ body: 'OK', headers: { get: () => null } } as any);
      expect(result.message).toBe('OK');
      expect(result.sessionEstablished).toBe(false);
    });

    it('should pick first string correctly', () => {
      // @ts-ignore
      expect(service.pickFirstString(null, undefined, '', 'found')).toBe('found');
    });

    it('should convert values to number', () => {
      // @ts-ignore
      expect(service.toNumber('123')).toBe(123);
      // @ts-ignore
      expect(service.toNumber(null)).toBeUndefined();
    });

    it('should handle registration step 2 (verifyRegister)', () => {
      service.verifyRegister('test@email.com', '123456').subscribe(res => {
        expect(res.token).toBe('verify-token');
      });
      const req = httpMock.expectOne(`${environment.oauthBaseUrl}/auth/register/verify`);
      req.flush(JSON.stringify({ token: 'verify-token' }));
    });
  });
});
