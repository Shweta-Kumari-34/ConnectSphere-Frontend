import { Injectable } from '@angular/core';
import { HttpClient, HttpEvent, HttpHeaders, HttpRequest } from '@angular/common/http';
import { Observable, catchError, throwError } from 'rxjs';

export interface Reel {
  id: number;
  // Unique id for UI rendering when we intentionally duplicate reels in the feed.
  // Backend APIs must continue using `id`.
  clientId?: number;
  userEmail: string;
  mediaUrl: string;
  caption: string;
  mediaType: string;
  viewsCount: number;
  likesCount: number;
  commentsCount: number;
  visibility: string;
  createdAt: string;
  audioName?: string;
  audioUrl?: string;
}

export interface ReelCommentPayload {
  id: number;
  reelId?: number;
  userEmail: string;
  content: string;
  createdAt: string;
}

@Injectable({ providedIn: 'root' })
export class ReelService {

  private readonly API_URL = '/api/reels';

  constructor(private http: HttpClient) {}

  createReel(file: File, caption: string, visibility: string = 'PUBLIC', userEmail?: string): Observable<HttpEvent<Reel>> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('caption', caption);
    formData.append('visibility', visibility);
    const headers = userEmail
      ? new HttpHeaders({ 'X-User-Email': userEmail })
      : undefined;

    const req = new HttpRequest('POST', `${this.API_URL}/upload`, formData, {
      headers,
      reportProgress: true,
      responseType: 'json'
    });

    return this.http.request(req);
  }

  getFeed(userEmail: string): Observable<Reel[]> {
    return this.http.get<Reel[]>(`${this.API_URL}/feed/${userEmail}`);
  }

  getMyReels(userEmail: string): Observable<Reel[]> {
    return this.http.get<Reel[]>(`${this.API_URL}/my-reels/${userEmail}`);
  }

  getUserReels(userEmail: string): Observable<Reel[]> {
    return this.http.get<Reel[]>(`${this.API_URL}/user/${userEmail}`).pipe(
      catchError(() => this.http.get<Reel[]>(`${this.API_URL}/my-reels/${userEmail}`))
    );
  }

  getExploreReels(): Observable<Reel[]> {
    return this.http.get<Reel[]>(`${this.API_URL}/feed/all_public_discovery`);
  }

  deleteReel(reelId: number): Observable<string> {
    return this.http.delete(`${this.API_URL}/${reelId}`, { responseType: 'text' }).pipe(
      catchError((err) => {
        if (err?.status !== 404) {
          return throwError(() => err);
        }
        // Backward-compatible fallbacks for older backend mappings
        return this.http.delete(`${this.API_URL}/delete/${reelId}`, { responseType: 'text' }).pipe(
          catchError(() => this.http.delete(`${this.API_URL}/${reelId}/delete`, { responseType: 'text' }))
        );
      })
    );
  }

  getReelComments(reelId: number): Observable<ReelCommentPayload[]> {
    return this.http.get<ReelCommentPayload[]>(`${this.API_URL}/${reelId}/comments`).pipe(
      catchError((err) => {
        if (err?.status !== 404) {
          return throwError(() => err);
        }
        // Fallback to comment-service keyed by reel id
        return this.http.get<ReelCommentPayload[]>(`/comments/post/${reelId}`);
      })
    );
  }

  addReelComment(reelId: number, content: string): Observable<ReelCommentPayload> {
    return this.http.post<ReelCommentPayload>(`${this.API_URL}/${reelId}/comments`, { content }).pipe(
      catchError((err) => {
        if (err?.status !== 404) {
          return throwError(() => err);
        }
        // Fallback to comment-service payload format
        return this.http.post<ReelCommentPayload>(`/comments`, { postId: reelId, content });
      })
    );
  }

  viewReel(id: number): Observable<string> {
    return new Observable<string>(observer => {
      observer.next('Viewed');
      observer.complete();
    });
  }
}
