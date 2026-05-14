import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { NotificationService, NotificationPage, NotificationSettings } from './notification.service';
import { AuthService } from './auth.service';
import { of } from 'rxjs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('NotificationService', () => {
  let service: NotificationService;
  let httpMock: HttpTestingController;
  let authServiceSpy: any;

  beforeEach(() => {
    authServiceSpy = {
      isLoggedIn$: of(true),
      isLoggedIn: () => true
    };

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        NotificationService,
        { provide: AuthService, useValue: authServiceSpy }
      ]
    });
    service = TestBed.inject(NotificationService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('Fetching Notifications', () => {
    it('should fetch notifications with query params', () => {
      const mockPage: any = {
        content: [{ id: 1, message: 'Test Notif' }],
        page: 0,
        size: 10,
        totalPages: 1
      };

      service.getNotifications({ page: 0, size: 10 }).subscribe(res => {
        expect(res.notifications.length).toBe(1);
        expect(res.notifications[0].message).toBe('Test Notif');
      });

      const req = httpMock.expectOne(r => r.url === '/notifications' && r.params.has('page'));
      req.flush(mockPage);
    });

    it('should fetch unread count', () => {
      service.getUnreadCount().subscribe(count => {
        expect(count).toBe(5);
      });

      const req = httpMock.expectOne('/notifications/unread-count');
      req.flush(5);
    });
  });

  describe('Actions', () => {
    it('should mark a notification as read', () => {
      service.markAsRead(1).subscribe(res => {
        expect(res).toBe('Read');
      });

      const req = httpMock.expectOne('/notifications/1/read');
      expect(req.request.method).toBe('PUT');
      req.flush('Read');

      // Also expects unread count refresh
      const refreshReq = httpMock.expectOne('/notifications/unread-count');
      refreshReq.flush(4);
    });

    it('should mark all as read', () => {
      service.markAllRead().subscribe(res => {
        expect(res).toBe('OK');
      });

      const req = httpMock.expectOne('/notifications/read-all');
      req.flush('OK');
    });

    it('should delete a notification', () => {
      service.deleteNotification(1).subscribe(res => {
        expect(res).toBe('Deleted');
      });

      const req = httpMock.expectOne('/notifications/1');
      expect(req.request.method).toBe('DELETE');
      req.flush('Deleted');

      const refreshReq = httpMock.expectOne('/notifications/unread-count');
      refreshReq.flush(4);
    });
  });

  describe('Settings', () => {
    it('should fetch settings', () => {
      const mockSettings: Partial<NotificationSettings> = { likes: false };
      service.getSettings().subscribe(res => {
        expect(res.likes).toBe(false);
        expect(res.comments).toBe(true); // Default
      });

      const req = httpMock.expectOne('/notifications/settings');
      req.flush(mockSettings);
    });

    it('should update settings', () => {
      const newSettings: Partial<NotificationSettings> = { likes: true };
      service.updateSettings(newSettings).subscribe(res => {
        expect(res.likes).toBe(true);
      });

      const req = httpMock.expectOne('/notifications/settings');
      expect(req.request.method).toBe('PUT');
      req.flush(newSettings);
    });
  });

  describe('Normalization Helpers', () => {
    it('should normalize notification with various field names', () => {
      // @ts-ignore
      const result = service.normalizeNotification({
        actorUsername: 'actor',
        text: 'hello',
        timestamp: 1625097600000
      });
      expect(result.senderUsername).toBe('actor');
      expect(result.message).toBe('hello');
      expect(result.createdAt).toBe(new Date(1625097600000).toISOString());
    });

    it('should pick first string', () => {
      // @ts-ignore
      expect(service.pickString(null, '', '  ', 'val')).toBe('val');
    });

    it('should normalize createdAt from various formats', () => {
      // @ts-ignore
      expect(service.normalizeCreatedAt(1625097600000)).toBe(new Date(1625097600000).toISOString());
      // @ts-ignore
      expect(service.normalizeCreatedAt('2023-01-01')).toBe(new Date('2023-01-01').toISOString());
      // @ts-ignore
      expect(service.normalizeCreatedAt('1625097600000')).toBe(new Date(1625097600000).toISOString());
    });

    it('should normalize page payload with content array', () => {
      const payload = { content: [{ id: 1 }], totalPages: 2, number: 0 };
      // @ts-ignore
      const res = service.normalizePagePayload(payload, 0, 10);
      expect(res.notifications.length).toBe(1);
      expect(res.hasMore).toBe(true);
    });

    it('should handle unread count push', () => {
      service.pushUnreadCount(10);
      service.unreadCount$.subscribe(count => expect(count).toBe(10));
    });
  });
});
