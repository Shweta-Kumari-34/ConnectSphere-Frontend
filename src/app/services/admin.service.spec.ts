import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { AdminService } from './admin.service';
import { AuthService } from './auth.service';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('AdminService', () => {
  let service: AdminService;
  let httpMock: HttpTestingController;
  let authServiceSpy: any;

  beforeEach(() => {
    authServiceSpy = {
      hasAnyRole: vi.fn(() => true)
    };

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        AdminService,
        { provide: AuthService, useValue: authServiceSpy }
      ]
    });
    service = TestBed.inject(AdminService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('User Management', () => {
    it('should fetch all users for admins', () => {
      const mockUsers = [{ id: 1, email: 'user@test.com' }];
      service.getAllUsers().subscribe(users => {
        expect(users.length).toBe(1);
      });

      const req = httpMock.expectOne('/auth/users');
      expect(req.request.method).toBe('GET');
      req.flush(mockUsers);
    });

    it('should throw error if user lacks admin role', () => {
      authServiceSpy.hasAnyRole.mockReturnValue(false);
      service.getAllUsers().subscribe({
        error: (err) => {
          expect(err.message).toContain('Forbidden');
        }
      });
      httpMock.expectNone('/auth/users');
    });

    it('should suspend user', () => {
      service.suspendUser(1).subscribe(res => {
        expect(res).toBe('Suspended');
      });
      const req = httpMock.expectOne('/auth/users/1/suspend');
      req.flush('Suspended');
    });

    it('should search users', () => {
      service.searchUsers('test').subscribe();
      httpMock.expectOne('/auth/search?q=test').flush([]);
    });

    it('should reactivate user', () => {
      service.reactivateUser(1).subscribe();
      httpMock.expectOne('/auth/users/1/reactivate').flush('OK');
    });

    it('should delete user', () => {
      service.deleteUser(1).subscribe();
      httpMock.expectOne('/auth/users/1').flush('OK');
    });
  });

  describe('Post Management', () => {
    it('should delete post', () => {
      service.deletePost(100).subscribe(res => {
        expect(res).toBe('Deleted');
      });
      const req = httpMock.expectOne('/posts/100');
      req.flush('Deleted');
    });

    it('should fetch all posts', () => {
      service.getAllPosts().subscribe();
      httpMock.expectOne('/posts/all').flush([]);
    });
  });

  describe('Notification Management', () => {
    it('should send bulk notification', () => {
      service.sendBulkNotification(['a@b.com'], 'test', 'msg').subscribe();
      const req = httpMock.expectOne('/notifications/bulk');
      expect(req.request.method).toBe('POST');
      req.flush('OK');
    });
  });

  describe('Report Management', () => {
    it('should fetch pending reports', () => {
      service.getPendingReports().subscribe(res => {
        expect(res).toEqual([]);
      });
      const req = httpMock.expectOne('/reports/pending');
      req.flush([]);
    });

    it('should resolve report', () => {
      service.resolveReport(1, 'Fixed').subscribe();
      const req = httpMock.expectOne('/reports/1/resolve');
      expect(req.request.body).toEqual({ adminNote: 'Fixed' });
      req.flush({});
    });
  });

  describe('Verification Management', () => {
    it('should fetch verification requests', () => {
      service.getVerificationRequests().subscribe();
      const req = httpMock.expectOne('/auth/admin/verification-requests?status=PENDING');
      req.flush([]);
    });

    it('should review verification request', () => {
      service.reviewVerificationRequest(1, 'APPROVE', undefined, 'Good').subscribe();
      const req = httpMock.expectOne('/auth/admin/verification-requests/1/review');
      expect(req.request.method).toBe('PUT');
      expect(req.request.body.decision).toBe('APPROVE');
      req.flush({});
    });
  });
});
