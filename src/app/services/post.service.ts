import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface Post {
  id: number;
  title: string;
  content: string;
  userEmail: string;
  mediaUrls: string[];
  postType: string;
  visibility: string;
  likeCount: number;
  commentCount: number;
  sharesCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PostPayload {
  title: string;
  content: string;
  visibility?: string;
  mediaUrls?: string[];
  postType?: string;
}

@Injectable({ providedIn: 'root' })
export class PostService {

  // Base route exposed by post-service through API gateway.
  private readonly API_URL = '/posts';

  constructor(private http: HttpClient) {}

  // Creates a new post for the authenticated user.
  createPost(post: PostPayload): Observable<Post> {
    return this.http.post<Post>(`${this.API_URL}/create`, post);
  }

  // Returns all posts (legacy + admin/discovery use cases).
  getAllPosts(): Observable<Post[]> {
    return this.http.get<Post[]>(`${this.API_URL}/all`);
  }

  // Returns feed posts for the current user context.
  getFeed(): Observable<Post[]> {
    return this.http.get<Post[]>(`${this.API_URL}/feed`);
  }

  // Returns current user's own posts.
  getMyPosts(): Observable<Post[]> {
    return this.http.get<Post[]>(`${this.API_URL}/my`);
  }

  // Fetch a single post by ID.
  getPostById(id: number): Observable<Post> {
    return this.http.get<Post>(`${this.API_URL}/${id}`);
  }

  // Fetch all posts authored by a specific user.
  getPostsByUser(userEmail: string): Observable<Post[]> {
    return this.http.get<Post[]>(`${this.API_URL}/user/${userEmail}`);
  }

  // Update title/content/visibility/media metadata.
  updatePost(id: number, post: PostPayload): Observable<Post> {
    return this.http.put<Post>(`${this.API_URL}/${id}`, post);
  }

  // Delete a post (author or authorized role).
  deletePost(id: number): Observable<string> {
    return this.http.delete(`${this.API_URL}/${id}`, { responseType: 'text' });
  }

  // Keyword search against post title/content.
  searchPosts(keyword: string): Observable<Post[]> {
    return this.http.get<Post[]>(`${this.API_URL}/search?q=${keyword}`);
  }

  // Small stats endpoint used by profile/dashboard widgets.
  getPostCount(userEmail: string): Observable<any> {
    return this.http.get(`${this.API_URL}/count/${userEmail}`);
  }
}
