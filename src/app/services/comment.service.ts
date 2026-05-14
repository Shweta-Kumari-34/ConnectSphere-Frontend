import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

// Comment entity returned by backend APIs.
export interface Comment {
  id: number;
  postId: number;
  parentId: number | null;
  userEmail: string;
  content: string;
  likeCount: number;
  createdAt: string;
}

export interface CommentRequest {
  postId: number;
  parentId?: number;
  content: string;
}

// Frontend API client for comment and reply operations.
@Injectable({ providedIn: 'root' })
export class CommentService {

  private readonly API_URL = '/comments';

  constructor(private http: HttpClient) {}

  addComment(request: CommentRequest): Observable<Comment> {
    return this.http.post<Comment>(this.API_URL, request);
  }

  getCommentsByPost(postId: number): Observable<Comment[]> {
    return this.http.get<Comment[]>(`${this.API_URL}/post/${postId}`);
  }

  getCommentCount(postId: number): Observable<number> {
    return this.http.get<number>(`${this.API_URL}/count/${postId}`);
  }

  deleteComment(id: number): Observable<string> {
    return this.http.delete(`${this.API_URL}/${id}`, { responseType: 'text' });
  }

  updateComment(id: number, content: string): Observable<Comment> {
    return this.http.put<Comment>(`${this.API_URL}/${id}`, content);
  }

  getReplies(parentId: number): Observable<Comment[]> {
    return this.http.get<Comment[]>(`${this.API_URL}/replies/${parentId}`);
  }

  likeComment(id: number): Observable<string> {
    return this.http.post(`${this.API_URL}/${id}/like`, {}, { responseType: 'text' });
  }

  unlikeComment(id: number): Observable<string> {
    return this.http.post(`${this.API_URL}/${id}/unlike`, {}, { responseType: 'text' });
  }
}
