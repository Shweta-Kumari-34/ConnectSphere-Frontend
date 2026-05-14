import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

// Follow relationship model used by profile/follow views.
export interface Follow {
  id: number;
  followerEmail: string;
  followingEmail: string;
  status: string;
  createdAt: string;
}

// Frontend API client for follow graph actions and counters.
@Injectable({ providedIn: 'root' })
export class FollowService {

  private readonly API_URL = '/follows';

  constructor(private http: HttpClient) {}

  follow(followingEmail: string): Observable<Follow> {
    return this.http.post<Follow>(`${this.API_URL}`, { followingEmail });
  }

  unfollow(followingEmail: string): Observable<string> {
    return this.http.delete(`${this.API_URL}/${followingEmail}`, { responseType: 'text' });
  }

  getFollowers(): Observable<Follow[]> {
    return this.http.get<Follow[]>(`${this.API_URL}/followers`);
  }

  getFollowing(): Observable<Follow[]> {
    return this.http.get<Follow[]>(`${this.API_URL}/following`);
  }

  getFollowerCount(): Observable<number> {
    return this.http.get<number>(`${this.API_URL}/followers/count`);
  }

  getFollowingCount(): Observable<number> {
    return this.http.get<number>(`${this.API_URL}/following/count`);
  }

  isFollowing(followingEmail: string): Observable<boolean> {
    return this.http.get<boolean>(`${this.API_URL}/is-following?followingEmail=${followingEmail}`);
  }

  getMutualFollows(otherEmail: string): Observable<string[]> {
    return this.http.get<string[]>(`${this.API_URL}/mutual?otherEmail=${otherEmail}`);
  }

  getSuggestedUsers(): Observable<string[]> {
    return this.http.get<string[]>(`${this.API_URL}/suggested`);
  }
}
