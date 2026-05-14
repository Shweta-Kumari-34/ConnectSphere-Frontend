import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Story } from './story.service';

export interface MediaItem {
  id: number;
  userEmail: string;
  postId: number;
  mediaUrl: string;
  mediaType: string;
  mimeType: string;
  sizeKb: number;
  createdAt: string;
}

// Configurable limits (mirrors backend)
export const UPLOAD_LIMITS = {
  maxImageSizeKb: 10240,   // 10 MB
  maxVideoSizeKb: 51200,   // 50 MB
  allowedImageTypes: ['image/jpeg', 'image/png', 'image/webp'],
  allowedVideoTypes: ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'],
  get allAllowedTypes() {
    return [...this.allowedImageTypes, ...this.allowedVideoTypes];
  },
  get acceptString() {
    return '.jpg,.jpeg,.png,.webp,.mp4,.webm,.ogg,.mov';
  }
};

@Injectable({ providedIn: 'root' })
export class MediaUploadService {

  private readonly API_URL = '/media';

  constructor(private http: HttpClient) {}

  private buildAuthHeaders(): HttpHeaders {
    let headers = new HttpHeaders();
    const token = localStorage.getItem('token');
    const email = localStorage.getItem('email');

    if (token) {
      headers = headers.set('Authorization', `Bearer ${token}`);
    }

    if (email) {
      headers = headers.set('X-User-Email', email);
    }

    return headers;
  }

  validateFile(file: File): string | null {
    if (!file) {
      return 'No file selected';
    }

    if (!UPLOAD_LIMITS.allAllowedTypes.includes(file.type)) {
      return `Unsupported file type: ${file.type}. Allowed: JPEG, PNG, WebP, MP4, WebM, OGG, MOV`;
    }

    const sizeKb = file.size / 1024;
    const isImage = file.type.startsWith('image/');
    const maxKb = isImage ? UPLOAD_LIMITS.maxImageSizeKb : UPLOAD_LIMITS.maxVideoSizeKb;

    if (sizeKb > maxKb) {
      const maxMb = (maxKb / 1024).toFixed(0);
      const fileMb = (sizeKb / 1024).toFixed(1);
      return `File too large (${fileMb}MB). Maximum: ${maxMb}MB`;
    }

    return null;
  }

  uploadFileToPost(postId: number, file: File): Observable<MediaItem> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('postId', postId.toString());

    return this.http.post<MediaItem>(`${this.API_URL}/upload/file`, formData, {
      headers: this.buildAuthHeaders()
    });
  }

  uploadFilesToPost(postId: number, files: File[]): Observable<MediaItem>[] {
    return files.map((file) => this.uploadFileToPost(postId, file));
  }

  uploadStoryFile(file: File, caption: string): Observable<Story> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('caption', caption || '');
    return this.http.post<Story>(`${this.API_URL}/stories/upload`, formData, {
      headers: this.buildAuthHeaders()
    });
  }

  getMediaByPost(postId: number): Observable<MediaItem[]> {
    return this.http.get<MediaItem[]>(`${this.API_URL}/post/${postId}`);
  }

  deleteMediaByPost(postId: number): Observable<string> {
    return this.http.delete(`${this.API_URL}/post/${postId}`, { responseType: 'text' });
  }

  getFileTypeLabel(file: File): string {
    if (file.type.startsWith('image/')) return 'Image';
    if (file.type.startsWith('video/')) return 'Video';
    return 'File';
  }

  getFileSizeLabel(file: File): string {
    const kb = file.size / 1024;
    if (kb > 1024) return (kb / 1024).toFixed(1) + ' MB';
    return kb.toFixed(0) + ' KB';
  }
}
