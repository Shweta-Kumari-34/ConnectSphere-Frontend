import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../../services/auth.service';
import { LikeService } from '../../services/like.service';
import { CommentService } from '../../services/comment.service';
import { FollowService } from '../../services/follow.service';
import { PostService } from '../../services/post.service';
import { PostDetailModalComponent } from '../../components/post-detail-modal/post-detail-modal.component';
import { of } from 'rxjs';
import { catchError } from 'rxjs/operators';

interface ExploreUser {
  email: string;
  username: string;
  fullName: string;
  profilePicUrl: string;
  isVerified: boolean;
  isPremiumMember: boolean;
  isFollowing: boolean;
  followerCount: number;
}

interface ExploreCategory {
  label: string;
  icon: string;
  tag: string;
  color: string;
}

@Component({
  selector: 'app-explore',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, PostDetailModalComponent],
  templateUrl: './explore.component.html',
  styleUrl: './explore.component.scss'
})
export class ExploreComponent implements OnInit {

  private readonly API = '';

  // Public discoverability data used on Explore landing sections.
  publicPosts: any[] = [];
  trendingHashtags: any[] = [];
  searchQuery = '';
  searchResults: any[] = [];
  userResults: any[] = [];
  hashtagResults: any[] = [];
  searched = false;
  activeTab: 'posts' | 'users' | 'hashtags' = 'posts';
  loading = false;

  // Selected post for in-place comment/interaction modal (no route jump).
  viewingUser: any = null;
  viewingUserPosts: any[] = [];
  selectedPost: any | null = null;

  // Suggested users
  suggestedUsers: ExploreUser[] = [];

  // Categories
  categories: ExploreCategory[] = [
    { label: 'Technology', icon: '💻', tag: 'tech', color: '#7c3aed' },
    { label: 'Travel', icon: '✈️', tag: 'travel', color: '#0891b2' },
    { label: 'Food', icon: '🍕', tag: 'food', color: '#ea580c' },
    { label: 'Fitness', icon: '💪', tag: 'fitness', color: '#16a34a' },
    { label: 'Education', icon: '📚', tag: 'education', color: '#2563eb' },
    { label: 'Art', icon: '🎨', tag: 'art', color: '#db2777' },
    { label: 'Music', icon: '🎵', tag: 'music', color: '#9333ea' },
    { label: 'Photography', icon: '📷', tag: 'photography', color: '#ca8a04' }
  ];

  constructor(
    private http: HttpClient,
    private router: Router,
    public authService: AuthService,
    private likeService: LikeService,
    private commentService: CommentService,
    private followService: FollowService,
    private postService: PostService
  ) {}

  ngOnInit(): void {
    // Initial data load for explore home.
    this.loadPublicFeed();
    this.loadTrending();
    if (this.authService.isLoggedIn()) {
      this.loadSuggestedUsers();
    }
  }

  loadPublicFeed(): void {
    this.loading = true;
    // Prefer personalized feed endpoint; fallback keeps Explore resilient.
    this.http.get<any[]>(this.API + '/posts/feed').pipe(
      catchError(() => this.http.get<any[]>(this.API + '/posts/all')),
      catchError((err) => {
        console.error('Explore feed error:', err);
        return of([]);
      })
    ).subscribe({
      next: (posts) => {
        // Keep only public-like visibility values for Explore surface.
        this.publicPosts = (posts || [])
          .filter((p) => {
            const vis = String(p?.visibility || '').trim().toUpperCase();
            return vis === 'PUBLIC' || vis === 'ALL' || vis === '';
          }).map((p) => ({
            ...p,
            // Normalize for modal/carousel consumers expecting an array.
            mediaUrls: Array.isArray(p?.mediaUrls) ? p.mediaUrls : []
          }))
          .slice(0, 20);
        this.loading = false;
      },
      error: () => {
        this.publicPosts = [];
        this.loading = false;
      }
    });
  }

  loadTrending(): void {
    // Trending API payload can vary by service version; normalize here.
    this.http.get<any[]>(this.API + '/search/trending?limit=10').subscribe({
      next: (data) => this.trendingHashtags = data.map(t => ({
        tag: t.tag || t[0] || t,
        count: t.count || t[1] || 0
      })),
      error: () => this.trendingHashtags = []
    });
  }

  loadSuggestedUsers(): void {
    // Suggested users are hydrated from multiple endpoints for richer cards.
    this.followService.getSuggestedUsers().subscribe({
      next: (emails) => {
        this.suggestedUsers = emails.slice(0, 6).map(e => ({
          email: e,
          username: e.split('@')[0],
          fullName: '',
          profilePicUrl: '',
          isVerified: false,
          isPremiumMember: false,
          isFollowing: false,
          followerCount: 0
        }));
        this.suggestedUsers.forEach(u => {
          this.http.get<any>(this.API + '/auth/user/' + u.email).subscribe({
            next: (profile) => {
              u.fullName = profile.fullName || '';
              u.profilePicUrl = profile.profilePicUrl || '';
              u.isVerified = !!profile.isVerified;
              u.isPremiumMember = !!profile.isPremiumMember;
            },
            error: () => {}
          });
          this.followService.isFollowing(u.email).subscribe({
            next: (val) => u.isFollowing = val,
            error: () => {}
          });
        });
      },
      error: () => this.suggestedUsers = []
    });
  }

  search(): void {
    if (!this.searchQuery.trim()) return;
    this.searched = true;

    this.http.get<any[]>(this.API + '/posts/search?q=' + this.searchQuery).subscribe({
      next: (posts) => this.searchResults = posts.filter(p => this.isPublicVisibility(p?.visibility)),
      error: () => this.searchResults = []
    });

    this.http.get<string[]>(this.API + '/search/users?q=' + this.searchQuery).subscribe({
      next: (emails) => {
        this.userResults = emails.map(e => ({
          email: e,
          username: e.split('@')[0]
        }));
      },
      error: () => this.userResults = []
    });

    this.http.get<any[]>(this.API + '/auth/search?q=' + this.searchQuery).subscribe({
      next: (results) => {
        results.forEach(r => {
          if (!this.userResults.find((u: any) => u.email === r.email)) {
            this.userResults.push({
              email: r.email,
              username: r.username || r.email.split('@')[0],
              fullName: r.fullName || ''
            });
          }
        });
      },
      error: () => {}
    });

    this.http.get<any[]>(this.API + '/search/hashtags?q=' + this.searchQuery).subscribe({
      next: (data) => this.hashtagResults = data,
      error: () => this.hashtagResults = []
    });
  }

  searchByTag(tag: string): void {
    this.searchQuery = '#' + tag.replace('#', '');
    this.router.navigate(['/search'], { queryParams: { q: this.searchQuery } });
  }

  searchByCategory(tag: string): void {
    this.searchQuery = tag.replace('#', '').trim();
    this.router.navigate(['/search'], { queryParams: { q: this.searchQuery } });
  }

  clearSearch(): void {
    this.searchQuery = '';
    this.searched = false;
    this.searchResults = [];
    this.userResults = [];
    this.hashtagResults = [];
  }

  viewProfile(user: any): void {
    this.router.navigate(['/user', user.email]);
  }

  goToLogin(): void {
    this.router.navigate(['/login']);
  }

  goToRegister(): void {
    this.router.navigate(['/register']);
  }

  goToSearch(): void {
    this.router.navigate(['/search']);
  }

  toggleFollow(user: ExploreUser): void {
    if (!this.authService.isLoggedIn()) {
      this.router.navigate(['/login']);
      return;
    }
    if (user.isFollowing) {
      this.followService.unfollow(user.email).subscribe({
        next: () => { user.isFollowing = false; },
        error: () => {}
      });
    } else {
      this.followService.follow(user.email).subscribe({
        next: () => { user.isFollowing = true; },
        error: () => {}
      });
    }
  }

  isMe(email: string): boolean {
    return email === (this.authService.getEmail() || '');
  }

  getTimeAgo(dateStr: string): string {
    if (!dateStr) return '';
    const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
  }

  likePost(post: any): void {
    // Optimistic UI increment after successful like.
    this.likeService.likeTarget(post.id, 'POST').subscribe({
      next: () => post.likeCount++
    });
  }

  commentPost(post: any): void {
    // Open modal in Explore itself to avoid redirecting to feed/posts routes.
    this.selectedPost = post;
  }

  closePostModal(): void {
    // Clears modal state.
    this.selectedPost = null;
  }

  onScroll(): void {
    if (this.loading || !this.searchQuery) return;
    // Implementation for loading more search results if needed
  }

  getInitial(name: string): string {
    return (name || 'U').charAt(0).toUpperCase();
  }

  private isPublicVisibility(rawVisibility: string | null | undefined): boolean {
    const vis = String(rawVisibility || '').trim().toUpperCase();
    return vis === 'PUBLIC' || vis === 'ALL' || vis === '';
  }
}
