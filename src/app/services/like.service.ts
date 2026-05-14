import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

// Like record returned for post/comment reaction actions.
export interface LikeEntity {
  id: number;
  targetId: number;
  targetType: string;
  userEmail: string;
  reactionType: string;
  createdAt: string;
}

// Frontend API client for like/unlike and like-count lookups.
@Injectable({ providedIn: 'root' })
export class LikeService {

  private readonly API_URL = '/likes';

  constructor(private http: HttpClient) {}

  likeTarget(targetId: number, targetType: string, reactionType: string = 'LIKE'): Observable<LikeEntity> {
    return this.http.post<LikeEntity>(
      `${this.API_URL}?targetId=${targetId}&targetType=${targetType}&reactionType=${reactionType}`, {}
    );
  }

  unlikeTarget(targetId: number, targetType: string): Observable<string> {
    return this.http.delete(`${this.API_URL}?targetId=${targetId}&targetType=${targetType}`, { responseType: 'text' });
  }

  hasLiked(targetId: number, targetType: string): Observable<boolean> {
    return this.http.get<boolean>(`${this.API_URL}/has-liked?targetId=${targetId}&targetType=${targetType}`);
  }

  getLikeCount(targetId: number, targetType: string): Observable<number> {
    return this.http.get<number>(`${this.API_URL}/count/${targetId}?targetType=${targetType}`);
  }
}
