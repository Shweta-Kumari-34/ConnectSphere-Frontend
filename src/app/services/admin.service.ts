import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { AuthService, UserRole } from './auth.service';

// Frontend API client for admin and moderator operations.
@Injectable({ providedIn: 'root' })
export class AdminService {

  private readonly AUTH_URL = '/auth';
  private readonly POST_URL = '/posts';
  private readonly NOTIF_URL = '/notifications';
  private readonly COMMENT_URL = '/comments';
  private readonly SEARCH_URL = '/search';
  private readonly FOLLOW_URL = '/follows';
  private readonly VERIFICATION_URL = '/auth/admin/verification-requests';
  private readonly REPORT_URL = '/reports';

  constructor(
    private http: HttpClient,
    private authService: AuthService
  ) {}

  getAllUsers(): Observable<any[]> {
    return this.withRoles(['ADMIN'], () => this.http.get<any[]>(`${this.AUTH_URL}/users`));
  }

  searchUsers(keyword: string): Observable<any[]> {
    return this.withRoles(['ADMIN'], () => this.http.get<any[]>(`${this.AUTH_URL}/search?q=${keyword}`));
  }

  suspendUser(userId: number): Observable<string> {
    return this.withRoles(['ADMIN'], () => this.http.put(`${this.AUTH_URL}/users/${userId}/suspend`, {}, { responseType: 'text' }));
  }

  reactivateUser(userId: number): Observable<string> {
    return this.withRoles(['ADMIN'], () => this.http.put(`${this.AUTH_URL}/users/${userId}/reactivate`, {}, { responseType: 'text' }));
  }

  deleteUser(userId: number): Observable<string> {
    return this.withRoles(['ADMIN'], () => this.http.delete(`${this.AUTH_URL}/users/${userId}`, { responseType: 'text' }));
  }

  getAllPosts(): Observable<any[]> {
    return this.withRoles(['ADMIN'], () => this.http.get<any[]>(`${this.POST_URL}/all`));
  }

  deletePost(id: number): Observable<string> {
    return this.withRoles(['ADMIN'], () => this.http.delete(`${this.POST_URL}/${id}`, { responseType: 'text' }));
  }

  getCommentsByPost(postId: number): Observable<any[]> {
    return this.withRoles(['ADMIN'], () => this.http.get<any[]>(`${this.COMMENT_URL}/post/${postId}`));
  }

  deleteComment(id: number): Observable<string> {
    return this.withRoles(['ADMIN'], () => this.http.delete(`${this.COMMENT_URL}/${id}`, { responseType: 'text' }));
  }

  getAllNotifications(): Observable<any[]> {
    return this.withRoles(['ADMIN'], () => this.http.get<any[]>(`${this.NOTIF_URL}/all`));
  }

  sendBulkNotification(recipientEmails: string[], type: string, message: string): Observable<string> {
    return this.withRoles(['ADMIN'], () => this.http.post(`${this.NOTIF_URL}/bulk`, { recipientEmails, type, message }, { responseType: 'text' }));
  }

  getTrendingHashtags(limit: number = 20): Observable<any[]> {
    return this.withRoles(['ADMIN'], () => this.http.get<any[]>(`${this.SEARCH_URL}/trending?limit=${limit}`));
  }

  getFollowStats(): Observable<any> {
    return this.withRoles(['ADMIN'], () => this.http.get<any>(`${this.FOLLOW_URL}/stats`));
  }

  getAllReports(): Observable<any[]> {
    return this.withRoles(['ADMIN'], () => this.http.get<any[]>(this.REPORT_URL));
  }

  getPendingReports(): Observable<any[]> {
    return this.withRoles(['ADMIN'], () => this.http.get<any[]>(`${this.REPORT_URL}/pending`));
  }

  getReportStats(): Observable<any> {
    return this.withRoles(['ADMIN'], () => this.http.get<any>(`${this.REPORT_URL}/stats`));
  }

  resolveReport(id: number, adminNote?: string): Observable<any> {
    return this.withRoles(['ADMIN'], () => this.http.put(`${this.REPORT_URL}/${id}/resolve`, adminNote ? { adminNote } : {}));
  }

  dismissReport(id: number, adminNote?: string): Observable<any> {
    return this.withRoles(['ADMIN'], () => this.http.put(`${this.REPORT_URL}/${id}/dismiss`, adminNote ? { adminNote } : {}));
  }

  deleteReport(id: number): Observable<string> {
    return this.withRoles(['ADMIN'], () => this.http.delete(`${this.REPORT_URL}/${id}`, { responseType: 'text' }));
  }

  submitReport(targetType: string, targetId: number, reason: string): Observable<any> {
    return this.http.post(this.REPORT_URL, { targetType, targetId, reason });
  }

  getVerificationRequests(status: string = 'PENDING'): Observable<any[]> {
    return this.withRoles(['ADMIN', 'MODERATOR'], () => this.http.get<any[]>(`${this.VERIFICATION_URL}?status=${status}`));
  }

  reviewVerificationRequest(requestId: number, decision: 'APPROVE' | 'REJECT', rejectionReason?: string, adminNote?: string): Observable<any> {
    return this.withRoles(['ADMIN', 'MODERATOR'], () => this.http.put<any>(`${this.VERIFICATION_URL}/${requestId}/review`, {
      decision,
      rejectionReason,
      adminNote
    }));
  }

  private withRoles<T>(roles: UserRole[], requestFactory: () => Observable<T>): Observable<T> {
    if (!this.authService.hasAnyRole(...roles)) {
      return throwError(() => new Error('Forbidden: insufficient role'));
    }
    return requestFactory();
  }
}
