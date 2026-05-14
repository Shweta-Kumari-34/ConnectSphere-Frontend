import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { BehaviorSubject, Observable, catchError, map, of, throwError, Subject, Subscription } from 'rxjs';
import { AuthService } from './auth.service';

export interface Notification {
  id: number;
  recipientEmail: string;
  senderEmail: string;
  type: string;
  message: string;
  referenceId: number;
  referenceType?: string;
  isRead: boolean;
  createdAt: string;
  senderUsername?: string;
  senderFullName?: string;
  senderProfilePicUrl?: string;
  targetPostId?: number;
  targetCommentId?: number;
  targetStoryId?: number;
  targetReelId?: number;
  thumbnailUrl?: string;
  actionUrl?: string;
  requestStatus?: string;
  metadata?: Record<string, any>;
}

export interface NotificationPage {
  notifications: Notification[];
  page: number;
  size: number;
  hasMore: boolean;
  unreadCount?: number;
}

export interface NotificationQuery {
  page?: number;
  size?: number;
  tab?: string;
  cursor?: string;
}

export interface NotificationSettings {
  likes: boolean;
  comments: boolean;
  follows: boolean;
  mentions: boolean;
  stories: boolean;
  verifiedPremium: boolean;
  requests: boolean;
  system: boolean;
  pushEnabled: boolean;
  emailEnabled: boolean;
  mutedTypes: string[];
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  likes: true,
  comments: true,
  follows: true,
  mentions: true,
  stories: true,
  verifiedPremium: true,
  requests: true,
  system: true,
  pushEnabled: true,
  emailEnabled: false,
  mutedTypes: []
};

@Injectable({ providedIn: 'root' })
export class NotificationService {

  private readonly API_URL = '/notifications';
  private readonly unreadCountSubject = new BehaviorSubject<number>(0);
  readonly unreadCount$ = this.unreadCountSubject.asObservable();

  // SSE runtime state
  private eventSource?: EventSource | null = null;
  private streamSubject = new Subject<Notification>();
  private reconnectTimer?: any;
  private reconnectAttempts = 0;
  private authSubscription?: Subscription;

  constructor(private http: HttpClient, private authService: AuthService) {
    // Keep SSE closed by default; open only when streamNotifications() is used.
    this.authSubscription = this.authService.isLoggedIn$.subscribe((loggedIn) => {
      if (!loggedIn) {
        this.closeEventSource();
      }
    });
  }

  getNotifications(query: NotificationQuery = {}): Observable<NotificationPage> {
    let params = new HttpParams();
    if (query.page !== undefined) params = params.set('page', String(query.page));
    if (query.size !== undefined) params = params.set('size', String(query.size));
    if (query.tab) params = params.set('tab', query.tab);
    if (query.cursor) params = params.set('cursor', query.cursor);

    return this.http.get<any>(`${this.API_URL}`, { params }).pipe(
      map((payload) => this.normalizePagePayload(payload, query.page ?? 0, query.size ?? 20))
    );
  }

  getUnreadCount(): Observable<number> {
    return this.http.get<number>(`${this.API_URL}/unread-count`).pipe(
      map((count) => Number(count) || 0),
      map((count) => {
        this.unreadCountSubject.next(count);
        return count;
      })
    );
  }

  refreshUnreadCount(): void {
    this.getUnreadCount().subscribe({
      next: () => {},
      error: () => this.unreadCountSubject.next(0)
    });
  }

  markAsRead(id: number): Observable<string> {
    return this.http.put(`${this.API_URL}/${id}/read`, {}, { responseType: 'text' }).pipe(
      map((response) => {
        this.refreshUnreadCount();
        return response;
      })
    );
  }

  markAllRead(): Observable<string> {
    return this.http.put(`${this.API_URL}/read-all`, {}, { responseType: 'text' }).pipe(
      map((response) => {
        this.unreadCountSubject.next(0);
        return response;
      })
    );
  }

  deleteNotification(id: number): Observable<string> {
    return this.http.delete(`${this.API_URL}/${id}`, { responseType: 'text' }).pipe(
      map((response) => {
        this.refreshUnreadCount();
        return response;
      })
    );
  }

  getSettings(): Observable<NotificationSettings> {
    return this.http.get<Partial<NotificationSettings>>(`${this.API_URL}/settings`).pipe(
      map((settings) => this.normalizeSettings(settings)),
      catchError(() => of({ ...DEFAULT_NOTIFICATION_SETTINGS }))
    );
  }

  updateSettings(settings: Partial<NotificationSettings>): Observable<NotificationSettings> {
    return this.http.put<Partial<NotificationSettings>>(`${this.API_URL}/settings`, settings).pipe(
      map((data) => this.normalizeSettings(data)),
      catchError(() => of(this.normalizeSettings(settings)))
    );
  }

  muteType(type: string): Observable<string> {
    return this.http.put(`${this.API_URL}/mute`, { type }, { responseType: 'text' }).pipe(
      catchError(() => of('Muted'))
    );
  }

  unmuteType(type: string): Observable<string> {
    return this.http.put(`${this.API_URL}/unmute`, { type }, { responseType: 'text' }).pipe(
      catchError(() => of('Unmuted'))
    );
  }

  acceptFollowRequest(notificationId: number, senderEmail?: string): Observable<string> {
    return this.http.put(`${this.API_URL}/${notificationId}/accept`, {}, { responseType: 'text' }).pipe(
      catchError((err) => {
        if (!senderEmail) {
          return throwError(() => err);
        }
        return this.http.put(
          `/follows/requests/${encodeURIComponent(senderEmail)}/accept`,
          {},
          { responseType: 'text' }
        );
      }),
      map((response) => {
        this.refreshUnreadCount();
        return response;
      })
    );
  }

  declineFollowRequest(notificationId: number, senderEmail?: string): Observable<string> {
    return this.http.put(`${this.API_URL}/${notificationId}/decline`, {}, { responseType: 'text' }).pipe(
      catchError((err) => {
        if (!senderEmail) {
          return throwError(() => err);
        }
        return this.http.put(
          `/follows/requests/${encodeURIComponent(senderEmail)}/decline`,
          {},
          { responseType: 'text' }
        );
      }),
      map((response) => {
        this.refreshUnreadCount();
        return response;
      })
    );
  }

  streamNotifications(): Observable<Notification> {
    // Ensure an EventSource is open and return a shared observable of incoming notifications.
    this.ensureEventSourceOpen();
    return this.streamSubject.asObservable();
  }

  private ensureEventSourceOpen(): void {
    if (this.eventSource) return; // already open
    if (typeof EventSource === 'undefined') return;
    if (!this.authService.isLoggedIn()) return;

    const email = localStorage.getItem('email') || undefined;
    const userId = localStorage.getItem('userId') || undefined;

    const params: string[] = [];
    if (email) params.push(`email=${encodeURIComponent(email)}`);
    if (userId) params.push(`userId=${encodeURIComponent(userId)}`);
    const url = `${this.API_URL}/stream${params.length ? '?' + params.join('&') : ''}`;

    try {
      this.eventSource = new EventSource(url);
    } catch (e) {
      // If construction throws (rare), schedule a reconnect
      this.scheduleReconnect();
      return;
    }

    this.eventSource.onopen = () => {
      this.reconnectAttempts = 0;
      // successful open
    };

    this.eventSource.onmessage = (event) => {
      if (!event?.data) return;
      try {
        const payload = JSON.parse(event.data);
        const notif = this.normalizeNotification(payload);
        this.streamSubject.next(notif);
        // keep unread count refreshed for UI
        this.refreshUnreadCount();
      } catch (_) {
        // ignore malformed
      }
    };

    this.eventSource.onerror = () => {
      this.closeEventSource();
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    this.reconnectAttempts += 1;
    const delay = Math.min(30000, 1000 * Math.pow(2, Math.min(6, this.reconnectAttempts - 1)));
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.eventSource = null;
      this.ensureEventSourceOpen();
    }, delay);
  }

  private closeEventSource(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    if (this.eventSource) {
      try { this.eventSource.close(); } catch { }
      this.eventSource = null;
    }
  }

  pushUnreadCount(count: number): void {
    this.unreadCountSubject.next(Math.max(0, Number(count) || 0));
  }

  private normalizePagePayload(payload: any, fallbackPage: number, fallbackSize: number): NotificationPage {
    const rows = this.extractRows(payload).map((row) => this.normalizeNotification(row));
    const page = Number(payload?.page ?? payload?.number ?? fallbackPage) || 0;
    const size = Number(payload?.size ?? payload?.pageSize ?? fallbackSize) || fallbackSize;
    const totalPages = Number(payload?.totalPages ?? 0);
    const totalElements = Number(payload?.totalElements ?? 0);
    const hasMore =
      typeof payload?.hasMore === 'boolean'
        ? payload.hasMore
        : typeof payload?.last === 'boolean'
          ? !payload.last
          : totalPages > 0
            ? page + 1 < totalPages
            : totalElements > 0
              ? (page + 1) * size < totalElements
              : rows.length >= size;

    return {
      notifications: rows,
      page,
      size,
      hasMore,
      unreadCount: Number(payload?.unreadCount ?? payload?.unread ?? NaN)
    };
  }

  private extractRows(payload: any): any[] {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.content)) return payload.content;
    if (Array.isArray(payload?.notifications)) return payload.notifications;
    if (Array.isArray(payload?.items)) return payload.items;
    return [];
  }

  private normalizeNotification(raw: any): Notification {
    const createdAt = this.normalizeCreatedAt(raw?.createdAt ?? raw?.timestamp);
    return {
      id: Number(raw?.id ?? 0),
      recipientEmail: String(raw?.recipientEmail ?? raw?.recipient ?? ''),
      senderEmail: String(raw?.senderEmail ?? raw?.actorEmail ?? raw?.sender ?? ''),
      senderUsername: this.pickString(raw?.senderUsername, raw?.actorUsername, raw?.username),
      senderFullName: this.pickString(raw?.senderFullName, raw?.actorName, raw?.fullName),
      senderProfilePicUrl: this.pickString(raw?.senderProfilePicUrl, raw?.actorProfilePicUrl, raw?.profilePicUrl),
      type: String(raw?.type ?? 'system').toLowerCase(),
      message: String(raw?.message ?? raw?.text ?? ''),
      referenceId: Number(raw?.referenceId ?? raw?.targetId ?? 0),
      referenceType: this.pickString(raw?.referenceType, raw?.targetType),
      targetPostId: this.pickNumber(raw?.targetPostId, raw?.postId),
      targetCommentId: this.pickNumber(raw?.targetCommentId, raw?.commentId),
      targetStoryId: this.pickNumber(raw?.targetStoryId, raw?.storyId),
      targetReelId: this.pickNumber(raw?.targetReelId, raw?.reelId),
      thumbnailUrl: this.pickString(raw?.thumbnailUrl, raw?.previewUrl, raw?.postThumbnailUrl),
      actionUrl: this.pickString(raw?.actionUrl, raw?.deepLink),
      requestStatus: this.pickString(raw?.requestStatus),
      isRead: !!(raw?.isRead ?? raw?.read),
      // Normalize to ISO so date math/sorting never produces Invalid Date.
      createdAt,
      metadata: this.normalizeMetadata(raw?.metadata)
    };
  }

  private normalizeMetadata(raw: unknown): Record<string, any> {
    if (raw && typeof raw === 'object') {
      return raw as Record<string, any>;
    }
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (!trimmed) return {};
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object') {
          return parsed as Record<string, any>;
        }
      } catch {
        return {};
      }
    }
    return {};
  }

  private normalizeCreatedAt(value: unknown): string {
    // Accept:
    // - ISO string
    // - epoch millis number
    // - epoch millis as numeric string
    if (typeof value === 'number' && Number.isFinite(value)) {
      return new Date(value).toISOString();
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return new Date().toISOString();

      // Numeric string epoch millis
      if (/^\d{10,}$/.test(trimmed)) {
        const asNum = Number(trimmed);
        if (Number.isFinite(asNum)) {
          return new Date(asNum).toISOString();
        }
      }

      const parsed = new Date(trimmed);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString();
      }
    }

    return new Date().toISOString();
  }

  private normalizeSettings(data: Partial<NotificationSettings> | undefined): NotificationSettings {
    return {
      ...DEFAULT_NOTIFICATION_SETTINGS,
      ...(data || {}),
      mutedTypes: Array.isArray(data?.mutedTypes)
        ? data!.mutedTypes.map((entry) => String(entry).toLowerCase())
        : []
    };
  }

  private pickString(...values: unknown[]): string | undefined {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
    return undefined;
  }

  private pickNumber(...values: unknown[]): number | undefined {
    for (const value of values) {
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value === 'string' && value.trim() && !Number.isNaN(Number(value))) {
        return Number(value);
      }
    }
    return undefined;
  }
}
