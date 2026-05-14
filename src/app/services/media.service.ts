import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

// Media attachment model linked to posts.
export interface Media {
  id: number;
  userEmail: string;
  postId: number;
  mediaUrl: string;
  mediaType: string;
  createdAt: string;
}

// Story model used by story tray/viewer pages.
export interface Story {
  id: number;
  userEmail: string;
  mediaUrl: string;
  caption: string;
  active: boolean;
  createdAt: string;
  expiresAt: string;
}

// Frontend API client for media upload and story APIs.
@Injectable({ providedIn: 'root' })
export class MediaService {

  private readonly API_URL = '/media';

  constructor(private http: HttpClient) {}

  uploadMedia(postId: number, mediaUrl: string, mediaType: string = 'IMAGE'): Observable<Media> {
    return this.http.post<Media>(
      `${this.API_URL}/upload?postId=${postId}&mediaUrl=${encodeURIComponent(mediaUrl)}&mediaType=${mediaType}`, {}
    );
  }

  getMediaByPost(postId: number): Observable<Media[]> {
    return this.http.get<Media[]>(`${this.API_URL}/post/${postId}`);
  }

  createStory(mediaUrl: string, caption: string): Observable<Story> {
    return this.http.post<Story>(
      `${this.API_URL}/stories?mediaUrl=${encodeURIComponent(mediaUrl)}&caption=${encodeURIComponent(caption)}`, {}
    );
  }

  getActiveStories(): Observable<Story[]> {
    return this.http.get<Story[]>(`${this.API_URL}/stories/active`);
  }

  getMyStories(): Observable<Story[]> {
    return this.http.get<Story[]>(`${this.API_URL}/stories/my`);
  }

  deleteStory(id: number): Observable<string> {
    return this.http.delete(`${this.API_URL}/stories/${id}`, { responseType: 'text' });
  }
}
