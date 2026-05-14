import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { UserProfileStateService } from './user-profile-state.service';
import { AuthService } from './auth.service';

import { vi } from 'vitest';

describe('UserProfileStateService', () => {
  let service: UserProfileStateService;
  let httpMock: HttpTestingController;

  const mockAuthService = {
    getEmail: vi.fn().mockReturnValue('test@test.com')
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        UserProfileStateService,
        { provide: AuthService, useValue: mockAuthService }
      ]
    });
    service = TestBed.inject(UserProfileStateService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should get current user profile with caching', () => {
    const profile = { email: 'test@test.com', username: 'test' };
    
    // First call (fetches from API)
    service.getCurrentUserProfile().subscribe((res: any) => {
      expect(res.email).toEqual(profile.email);
    });
    const req = httpMock.expectOne('/auth/profile');
    expect(req.request.method).toBe('GET');
    req.flush(profile);

    // Second call (uses cache, shouldn't trigger HTTP)
    service.getCurrentUserProfile().subscribe((res: any) => {
      expect(res.email).toEqual(profile.email);
    });
    httpMock.expectNone('/auth/profile');
  });

  it('should force refresh profile', () => {
    const profile = { email: 'test@test.com', username: 'test' };
    
    service.getCurrentUserProfile(true).subscribe((res: any) => {
      expect(res.email).toEqual(profile.email);
    });
    const req = httpMock.expectOne('/auth/profile');
    expect(req.request.method).toBe('GET');
    req.flush(profile);
  });

  it('should get profile by email (not current user)', () => {
    const profile = { email: 'other@test.com' };
    
    service.getProfileByEmail('other@test.com').subscribe((res: any) => {
      expect(res.email).toEqual(profile.email);
    });
    const req = httpMock.expectOne('/auth/user/other%40test.com');
    expect(req.request.method).toBe('GET');
    req.flush(profile);
  });

  it('should clear cache', () => {
    service.clearCache();
    // Subsequent get should hit API
    service.getCurrentUserProfile().subscribe();
    const req = httpMock.expectOne('/auth/profile');
    expect(req.request.method).toBe('GET');
    req.flush({});
  });
});
