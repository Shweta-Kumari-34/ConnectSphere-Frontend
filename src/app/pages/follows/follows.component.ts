import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { catchError, forkJoin, of } from 'rxjs';
import { FollowService, Follow } from '../../services/follow.service';
import { AuthService } from '../../services/auth.service';

interface FollowProfile {
  username: string;
  fullName: string;
  profilePicUrl: string;
}

interface SearchUser {
  email: string;
  username: string;
  fullName: string;
  profilePicUrl: string;
}

@Component({
  selector: 'app-follows',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './follows.component.html',
  styleUrl: './follows.component.scss'
})
export class FollowsComponent implements OnInit, OnDestroy {
  private readonly AUTH_API = '/auth';
  private readonly SEARCH_DEBOUNCE_MS = 280;
  private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly followChangedHandler = () => {
    this.loadFollowers();
    this.loadFollowing();
    this.loadSuggested();
  };

  currentUserEmail = '';
  followers: Follow[] = [];
  following: Follow[] = [];
  suggestedUsers: string[] = [];
  userProfiles: Record<string, FollowProfile> = {};
  userSearchTerm = '';
  searchResults: SearchUser[] = [];
  searchingUsers = false;
  hasSearched = false;
  activeTab: 'followers' | 'following' | 'suggested' = 'following';
  successMessage = '';
  errorMessage = '';

  constructor(
    private followService: FollowService,
    private http: HttpClient,
    private authService: AuthService
  ) {}

  ngOnInit(): void {
    this.currentUserEmail = (this.authService.getEmail() || '').trim().toLowerCase();
    this.loadFollowers();
    this.loadFollowing();
    this.loadSuggested();
    window.addEventListener('connectsphere-follow-changed', this.followChangedHandler);
  }

  ngOnDestroy(): void {
    this.clearSearchDebounce();
    window.removeEventListener('connectsphere-follow-changed', this.followChangedHandler);
  }

  loadFollowers(): void {
    this.followService.getFollowers().subscribe({
      next: (data) => {
        const normalized = this.normalizeFollowList(data, 'followerEmail');
        this.followers = normalized;
        this.loadProfilesForEmails(normalized.map((item) => item.followerEmail));
      },
      error: () => (this.followers = [])
    });
  }

  loadFollowing(): void {
    this.followService.getFollowing().subscribe({
      next: (data) => {
        const normalized = this.normalizeFollowList(data, 'followingEmail');
        this.following = normalized;
        this.loadProfilesForEmails(normalized.map((item) => item.followingEmail));
      },
      error: () => (this.following = [])
    });
  }

  loadSuggested(): void {
    this.followService.getSuggestedUsers().subscribe({
      next: (data) => {
        this.suggestedUsers = data;
        this.loadProfilesForEmails(data);
      },
      error: () => (this.suggestedUsers = [])
    });
  }

  follow(email?: string): void {
    const target = (email || '').trim().toLowerCase();
    if (!target) return;

    this.followService.follow(target).subscribe({
      next: () => {
        this.successMessage = `Now following ${target}`;
        this.loadFollowing();
        this.loadSuggested();
        this.searchResults = this.searchResults.map((item) =>
          item.email.toLowerCase() === target
            ? { ...item }
            : item
        );
        window.dispatchEvent(new Event('connectsphere-follow-changed'));
        setTimeout(() => (this.successMessage = ''), 3000);
      },
      error: (err) => {
        this.errorMessage = err.error || 'Failed to follow user';
        setTimeout(() => (this.errorMessage = ''), 3000);
      }
    });
  }

  onUserSearchInput(): void {
    this.clearSearchDebounce();
    const query = this.userSearchTerm.trim();

    if (!query) {
      this.searchResults = [];
      this.searchingUsers = false;
      this.hasSearched = false;
      return;
    }

    this.searchDebounceTimer = setTimeout(() => {
      this.searchUsers();
    }, this.SEARCH_DEBOUNCE_MS);
  }

  searchUsers(): void {
    const query = this.userSearchTerm.trim();
    if (!query) {
      this.searchResults = [];
      this.searchingUsers = false;
      this.hasSearched = false;
      return;
    }

    this.searchingUsers = true;
    this.hasSearched = true;

    const searchRequest = this.http.get<any[]>(`${this.AUTH_API}/search?q=${encodeURIComponent(query)}`).pipe(
      catchError(() => of([] as any[]))
    );
    const emailLookupRequest = query.includes('@')
      ? this.http.get<any>(`${this.AUTH_API}/user/${encodeURIComponent(query.toLowerCase())}`).pipe(
          catchError(() => of(null))
        )
      : of(null);

    forkJoin({
      search: searchRequest,
      exactEmailMatch: emailLookupRequest
    }).subscribe({
      next: ({ search, exactEmailMatch }) => {
        const combined = [...(Array.isArray(search) ? search : [])];
        if (exactEmailMatch) {
          combined.push(exactEmailMatch);
        }
        this.searchResults = this.normalizeSearchResults(combined, query);
        this.searchingUsers = false;
      },
      error: () => {
        this.searchResults = [];
        this.searchingUsers = false;
      }
    });
  }

  get noUserFound(): boolean {
    return this.hasSearched && !this.searchingUsers && this.searchResults.length === 0 && !!this.userSearchTerm.trim();
  }

  isAlreadyFollowing(email: string): boolean {
    const target = (email || '').toLowerCase();
    return this.following.some((item) => (item.followingEmail || '').toLowerCase() === target);
  }

  followFromSearch(user: SearchUser): void {
    if (!user?.email || this.isAlreadyFollowing(user.email)) {
      return;
    }
    this.follow(user.email);
  }

  unfollow(email: string): void {
    this.followService.unfollow(email).subscribe({
      next: () => {
        this.successMessage = `Unfollowed ${email}`;
        this.loadFollowing();
        this.loadSuggested();
        window.dispatchEvent(new Event('connectsphere-follow-changed'));
        setTimeout(() => (this.successMessage = ''), 3000);
      },
      error: (err) => {
        this.errorMessage = err.error || 'Failed to unfollow';
        setTimeout(() => (this.errorMessage = ''), 3000);
      }
    });
  }

  getDisplayName(email: string): string {
    const profile = this.userProfiles[email];
    return profile?.fullName || profile?.username || email.split('@')[0];
  }

  getHandle(email: string): string {
    const profile = this.userProfiles[email];
    return `@${profile?.username || email.split('@')[0]}`;
  }

  getProfilePhoto(email: string): string {
    return this.userProfiles[email]?.profilePicUrl || '';
  }

  getInitial(email: string): string {
    return this.getDisplayName(email).charAt(0).toUpperCase();
  }

  getSearchDisplayName(user: SearchUser): string {
    return user.fullName || user.username || user.email.split('@')[0];
  }

  getSearchHandle(user: SearchUser): string {
    return `@${user.username || user.email.split('@')[0]}`;
  }

  private loadProfilesForEmails(emails: string[]): void {
    const uniqueEmails = [...new Set(emails.filter((email) => !!email && !this.userProfiles[email]))];

    if (uniqueEmails.length === 0) {
      return;
    }

    const requests = uniqueEmails.map((email) =>
      this.http.get<any>(`${this.AUTH_API}/user/${encodeURIComponent(email)}`).pipe(
        catchError(() => of(null))
      )
    );

    forkJoin(requests).subscribe((profiles) => {
      const nextProfiles = { ...this.userProfiles };
      uniqueEmails.forEach((email, index) => {
        const profile = profiles[index];
        if (!profile) {
          return;
        }

        nextProfiles[email] = {
          username: profile.username || email.split('@')[0],
          fullName: profile.fullName || '',
          profilePicUrl: profile.profilePicUrl || ''
        };
      });
      this.userProfiles = nextProfiles;
    });
  }

  private normalizeFollowList(data: Follow[], field: 'followerEmail' | 'followingEmail'): Follow[] {
    const seen = new Set<string>();
    return (data || []).filter((item) => {
      const email = ((item[field] as string) || '').trim().toLowerCase();
      if (!email || email === this.currentUserEmail || seen.has(email)) {
        return false;
      }
      seen.add(email);
      return true;
    }).map((item) => ({
      ...item,
      [field]: ((item[field] as string) || '').trim().toLowerCase()
    }));
  }

  private normalizeSearchResults(users: any[], query: string): SearchUser[] {
    const q = query.trim().toLowerCase();
    const seen = new Set<string>();
    const normalized: SearchUser[] = [];

    (users || []).forEach((user) => {
      const email = (user?.email || '').toString().trim().toLowerCase();
      if (!email || email === this.currentUserEmail || seen.has(email)) {
        return;
      }

      const username = (user?.username || '').toString().trim();
      const fullName = (user?.fullName || '').toString().trim();
      const profilePicUrl = (user?.profilePicUrl || '').toString().trim();
      const combinedText = `${email} ${username.toLowerCase()} ${fullName.toLowerCase()}`;
      if (!combinedText.includes(q)) {
        return;
      }

      seen.add(email);
      normalized.push({
        email,
        username,
        fullName,
        profilePicUrl
      });
    });

    return normalized;
  }

  private clearSearchDebounce(): void {
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = null;
    }
  }
}
