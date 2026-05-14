import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

// Hashtag row model used by hashtag search/trending features.
export interface Hashtag {
  id: number;
  tag: string;
  postId: number;
  createdAt: string;
}

// Frontend API client for post/user/hashtag discovery endpoints.
@Injectable({ providedIn: 'root' })
export class SearchService {

  private readonly API_URL = '/search';

  constructor(private http: HttpClient) {}

  searchPosts(query: string): Observable<number[]> {
    return this.http.get<number[]>(`${this.API_URL}/posts?q=${query}`);
  }

  searchUsers(query: string): Observable<string[]> {
    return this.http.get<string[]>(`${this.API_URL}/users?q=${query}`);
  }

  searchHashtags(query: string): Observable<Hashtag[]> {
    return this.http.get<Hashtag[]>(`${this.API_URL}/hashtags?q=${query}`);
  }

  getTrending(limit: number = 10): Observable<any[]> {
    return this.http.get<any[]>(`${this.API_URL}/trending?limit=${limit}`);
  }

  getPostsByHashtag(tag: string): Observable<number[]> {
    return this.http.get<number[]>(`${this.API_URL}/posts-by-hashtag?tag=${tag}`);
  }

  getHashtagsForPost(postId: number): Observable<Hashtag[]> {
    return this.http.get<Hashtag[]>(`${this.API_URL}/hashtags/post/${postId}`);
  }

  getHashtagCount(tag: string): Observable<any> {
    return this.http.get(`${this.API_URL}/count?tag=${tag}`);
  }
}
