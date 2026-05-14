import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, of, tap } from 'rxjs';

// Normalized profile shape cached on frontend for quick reuse across pages.
export interface UserProfileState {
  userId?: number;
  username: string;
  email: string;
  fullName?: string;
  bio?: string;
  profilePicUrl?: string;
  isVerified: boolean;
  isPremiumMember: boolean;
  premiumExpiresAt?: string;
  subscriptionStatus?: string;
}

// Maintains a lightweight in-memory profile cache to reduce duplicate calls.
@Injectable({ providedIn: 'root' })
export class UserProfileStateService {
  private readonly AUTH_API_URL = '/auth';
  private cache = new Map<string, UserProfileState>();

  constructor(private http: HttpClient) {}

  getCurrentUserProfile(force = false): Observable<UserProfileState | null> {
    const key = '__current__';
    if (!force && this.cache.has(key)) {
      return of(this.cache.get(key) || null);
    }
    return this.http.get<any>(`${this.AUTH_API_URL}/profile`).pipe(
      map((profile) => this.normalizeProfile(profile)),
      tap((profile) => {
        if (profile) {
          this.cache.set(key, profile);
          this.cache.set((profile.email || '').toLowerCase(), profile);
        }
      })
    );
  }

  getProfileByEmail(email: string, force = false): Observable<UserProfileState | null> {
    const normalized = (email || '').trim().toLowerCase();
    if (!normalized) {
      return of(null);
    }
    if (!force && this.cache.has(normalized)) {
      return of(this.cache.get(normalized) || null);
    }
    return this.http.get<any>(`${this.AUTH_API_URL}/user/${encodeURIComponent(normalized)}`).pipe(
      map((profile) => this.normalizeProfile(profile)),
      tap((profile) => {
        if (profile) {
          this.cache.set(normalized, profile);
        }
      })
    );
  }

  clearCache(): void {
    this.cache.clear();
  }

  private normalizeProfile(profile: any): UserProfileState | null {
    if (!profile) {
      return null;
    }
    return {
      userId: profile.userId || profile.id,
      username: profile.username || (profile.email || '').split('@')[0],
      email: profile.email || '',
      fullName: profile.fullName || '',
      bio: profile.bio || '',
      profilePicUrl: profile.profilePicUrl || '',
      isVerified: !!profile.isVerified,
      isPremiumMember: !!profile.isPremiumMember,
      premiumExpiresAt: profile.premiumExpiresAt,
      subscriptionStatus: profile.subscriptionStatus
    };
  }
}
