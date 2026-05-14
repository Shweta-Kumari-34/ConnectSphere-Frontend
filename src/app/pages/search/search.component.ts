import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { SearchService, Hashtag } from '../../services/search.service';
import { PostService, Post } from '../../services/post.service';
import { FollowService } from '../../services/follow.service';
import { AuthService } from '../../services/auth.service';
import { LikeService } from '../../services/like.service';
import { CommentService } from '../../services/comment.service';
import { ReelService, Reel } from '../../services/reel.service';
import { Subject, debounceTime, distinctUntilChanged, switchMap, of, forkJoin } from 'rxjs';

@Component({
  selector: 'app-search',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './search.component.html',
  styleUrl: './search.component.scss'
})
export class SearchComponent implements OnInit, OnDestroy {

  private readonly API = '';

  searchQuery = '';
  searchFocused = false;
  recentSearches: string[] = [];
  hashtagResults: Hashtag[] = [];
  postResults: Post[] = [];
  userResults: UserResult[] = [];
  trending: TrendingTag[] = [];
  searched = false;
  searching = false;
  activeTab: 'all' | 'users' | 'posts' | 'hashtags' | 'reels' = 'all';

  // Live suggestions (autocomplete as you type)
  suggestions: UserResult[] = [];
  showSuggestions = false;
  suggestionsLoading = false;
  private searchSubject = new Subject<string>();

  // Suggested users
  suggestedUsers: UserResult[] = [];

  // Public feed for guest discovery
  discoveryPosts: Post[] = [];

  // Reel results
  reelResults: Reel[] = [];

  // View hashtag posts
  hashtagPosts: Post[] = [];
  hashtagReels: Reel[] = [];
  previewReel: Reel | null = null;
  viewingHashtag = '';

  myEmail = '';
  isLoggedIn = false;

  constructor(
    private searchService: SearchService,
    private postService: PostService,
    private followService: FollowService,
    public authService: AuthService,
    private likeService: LikeService,
    private commentService: CommentService,
    private reelService: ReelService,
    private http: HttpClient,
    private router: Router,
    private route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    this.isLoggedIn = this.authService.isLoggedIn();
    this.myEmail = this.authService.getEmail() || '';
    this.loadRecentSearches();
    this.loadTrending();
    this.loadDiscoveryPosts();
    if (this.isLoggedIn) {
      this.loadSuggestedUsers();
    }

    this.route.queryParamMap.subscribe(params => {
      const q = (params.get('q') || '').trim();

      if (!q) {
        return;
      }

      this.searchQuery = q;
      if (q.startsWith('#') || q.includes('#')) {
        this.searchByTag(q.replace('#', ''), false);
        return;
      }

      this.search(false);
    });

    // Setup live search autocomplete with debounce
    this.searchSubject.pipe(
      debounceTime(300),
      distinctUntilChanged()
    ).subscribe(query => {
      if (query.trim().length < 1) {
        this.suggestions = [];
        this.showSuggestions = false;
        return;
      }
      this.suggestionsLoading = true;
      this.loadSuggestions(query.trim());
    });
  }

  ngOnDestroy(): void {
    this.searchSubject.complete();
  }

  // ── Live Suggestion (autocomplete) ──
  onSearchInput(value: string): void {
    this.searchQuery = value;
    this.searchSubject.next(value);
  }

  private loadSuggestions(query: string): void {
    const suggestionMap = new Map<string, UserResult>();

    // Search from auth service (has username/fullName)
    this.http.get<any[]>(`${this.API}/auth/search?q=${query}`).subscribe({
      next: (results) => {
        results.forEach(r => {
          if (!suggestionMap.has(r.email)) {
            suggestionMap.set(r.email, {
              email: r.email,
              username: r.username || r.email.split('@')[0],
              fullName: r.fullName || '',
              profilePicUrl: r.profilePicUrl || '',
              bio: r.bio || '',
              isVerified: !!r.isVerified,
              isPremiumMember: !!r.isPremiumMember,
              isFollowing: false,
              followerCount: 0,
              followingCount: 0
            });
          }
        });
        this.suggestions = Array.from(suggestionMap.values()).slice(0, 8);
        this.showSuggestions = this.suggestions.length > 0;
        this.suggestionsLoading = false;
      },
      error: () => {
        this.suggestionsLoading = false;
      }
    });

    // Also search from search-service for broader results
    this.searchService.searchUsers(query).subscribe({
      next: (emails) => {
        emails.forEach(e => {
          if (!suggestionMap.has(e)) {
            const u: UserResult = {
              email: e,
              username: e.split('@')[0],
              fullName: '',
              profilePicUrl: '',
              bio: '',
              isVerified: false,
              isPremiumMember: false,
              isFollowing: false,
              followerCount: 0,
              followingCount: 0
            };
            suggestionMap.set(e, u);
            // Enrich with profile data
            this.http.get<any>(`${this.API}/auth/user/${e}`).subscribe({
              next: (profile) => {
                u.username = profile.username || u.username;
                u.fullName = profile.fullName || '';
                u.profilePicUrl = profile.profilePicUrl || '';
                u.isVerified = !!profile.isVerified;
                u.isPremiumMember = !!profile.isPremiumMember;
              },
              error: () => {}
            });
          }
        });
        this.suggestions = Array.from(suggestionMap.values()).slice(0, 8);
        this.showSuggestions = this.suggestions.length > 0;
        this.suggestionsLoading = false;
      },
      error: () => {}
    });
  }

  selectSuggestion(user: UserResult): void {
    this.showSuggestions = false;
    this.saveRecentSearch(user.username);
    this.navigateToProfile(user.email);
  }

  hideSuggestions(): void {
    // Delay to allow click on suggestion to register
    setTimeout(() => {
      this.showSuggestions = false;
    }, 200);
  }

  // ── Recent Searches (localStorage) ──
  loadRecentSearches(): void {
    try {
      const stored = localStorage.getItem('cs_recent_searches');
      this.recentSearches = stored ? JSON.parse(stored) : [];
    } catch { this.recentSearches = []; }
  }

  saveRecentSearch(query: string): void {
    this.recentSearches = [query, ...this.recentSearches.filter(s => s !== query)].slice(0, 8);
    localStorage.setItem('cs_recent_searches', JSON.stringify(this.recentSearches));
  }

  removeRecentSearch(query: string): void {
    this.recentSearches = this.recentSearches.filter(s => s !== query);
    localStorage.setItem('cs_recent_searches', JSON.stringify(this.recentSearches));
  }

  clearAllRecent(): void {
    this.recentSearches = [];
    localStorage.removeItem('cs_recent_searches');
  }

  // ── Trending Hashtags ──
  loadTrending(): void {
    this.searchService.getTrending(15).subscribe({
      next: (data) => {
        this.trending = data.map(t => ({
          tag: t.tag || t[0] || t,
          count: t.count || t[1] || 0
        }));
      },
      error: () => this.trending = []
    });
  }

  // ── Discovery Posts (public feed grid) ──
  loadDiscoveryPosts(): void {
    this.http.get<Post[]>(`${this.API}/posts/all`).subscribe({
      next: (posts) => {
        this.discoveryPosts = posts
          .filter(p => this.isPublicVisibility(p.visibility) && p.mediaUrls && p.mediaUrls.length > 0)
          .sort(() => Math.random() - 0.5) // shuffle for discovery
          .slice(0, 24);
        
        // Refresh counts for discovery posts
        this.discoveryPosts.forEach(p => {
          this.postService.getPostById(p.id).subscribe({
            next: (latest) => {
              p.likeCount = latest.likeCount;
              p.commentCount = latest.commentCount;
            },
            error: () => {}
          });
        });
      },
      error: () => this.discoveryPosts = []
    });
  }

  // ── Suggested Users ──
  loadSuggestedUsers(): void {
    this.followService.getSuggestedUsers().subscribe({
      next: (emails) => {
        this.suggestedUsers = emails.slice(0, 5).map(e => ({
          email: e,
          username: e.split('@')[0],
          fullName: '',
          profilePicUrl: '',
          bio: '',
          isVerified: false,
          isPremiumMember: false,
          isFollowing: false,
          followerCount: 0,
          followingCount: 0
        }));
        // Enrich with profile data
        this.suggestedUsers.forEach(u => {
          this.http.get<any>(`${this.API}/auth/user/${u.email}`).subscribe({
            next: (profile) => {
              u.fullName = profile.fullName || '';
              u.profilePicUrl = profile.profilePicUrl || '';
              u.bio = profile.bio || '';
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

  // ── Main Search ──
  search(syncUrl: boolean = true): void {
    if (!this.searchQuery.trim()) return;
    if (this.searchQuery.trim().startsWith('#') || this.searchQuery.trim().includes('#')) {
      this.searchByTag(this.searchQuery.trim().replace('#', ''), syncUrl);
      return;
    }
    if (syncUrl) {
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { q: this.searchQuery.trim() }
      });
    }
    this.searched = true;
    this.searching = true;
    this.showSuggestions = false;
    this.viewingHashtag = '';
    this.saveRecentSearch(this.searchQuery.trim());
    if (this.activeTab !== 'all' && this.activeTab !== 'users' && this.activeTab !== 'posts' && this.activeTab !== 'hashtags' && this.activeTab !== 'reels') {
      this.activeTab = 'all';
    }

    // Search users via search-service
    this.searchService.searchUsers(this.searchQuery).subscribe({
      next: (emails) => {
        this.userResults = emails.map(e => ({
          email: e,
          username: e.split('@')[0],
          fullName: '',
          profilePicUrl: '',
          bio: '',
          isVerified: false,
          isPremiumMember: false,
          isFollowing: false,
          followerCount: 0,
          followingCount: 0
        }));
        // Enrich with profile data from auth service
        this.userResults.forEach(u => {
          this.http.get<any>(`${this.API}/auth/user/${u.email}`).subscribe({
            next: (profile) => {
              u.username = profile.username || u.username;
              u.fullName = profile.fullName || '';
              u.profilePicUrl = profile.profilePicUrl || '';
              u.bio = profile.bio || '';
              u.isVerified = !!profile.isVerified;
              u.isPremiumMember = !!profile.isPremiumMember;
            },
            error: () => {}
          });
          // Follower count (public endpoint)
          this.http.get<number>(`${this.API}/follows/follower-count/${u.email}`).subscribe({
            next: (count) => u.followerCount = count,
            error: () => {}
          });
          if (this.isLoggedIn) {
            this.followService.isFollowing(u.email).subscribe({
              next: (val) => u.isFollowing = val,
              error: () => {}
            });
          }
        });
        this.searching = false;
      },
      error: () => { this.userResults = []; this.searching = false; }
    });

    // Also search from auth service for fuller username/fullName matching
    this.http.get<any[]>(`${this.API}/auth/search?q=${this.searchQuery}`).subscribe({
      next: (results) => {
        results.forEach(r => {
          if (!this.userResults.find(u => u.email === r.email)) {
            this.userResults.push({
              email: r.email,
              username: r.username || r.email.split('@')[0],
              fullName: r.fullName || '',
              profilePicUrl: r.profilePicUrl || '',
              bio: '',
              isVerified: !!r.isVerified,
              isPremiumMember: !!r.isPremiumMember,
              isFollowing: false,
              followerCount: 0,
              followingCount: 0
            });
          }
        });
      },
      error: () => {}
    });

    // Search posts
    this.postService.searchPosts(this.searchQuery).subscribe({
      next: data => {
        this.postResults = data.filter(p => this.isPublicVisibility(p.visibility));
        // Refresh counts for search results
        this.postResults.forEach(p => {
          this.postService.getPostById(p.id).subscribe({
            next: (latest) => {
              p.likeCount = latest.likeCount;
              p.commentCount = latest.commentCount;
            },
            error: () => {}
          });
        });
      },
      error: () => this.postResults = []
    });

    // Search hashtags
    this.searchService.searchHashtags(this.searchQuery).subscribe({
      next: data => this.hashtagResults = data,
      error: () => this.hashtagResults = []
    });

    // Search reels locally
    this.reelService.getExploreReels().subscribe({
      next: data => {
        const queryLower = this.searchQuery.toLowerCase();
        this.reelResults = data.filter(r => r.caption && r.caption.toLowerCase().includes(queryLower));
      },
      error: () => this.reelResults = []
    });
  }

  searchByTag(tag: string, syncUrl: boolean = true): void {
    const cleanTag = tag.replace(/^#/, '');
    this.searchQuery = '#' + cleanTag;
    if (syncUrl) {
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { q: this.searchQuery }
      });
    }
    this.viewingHashtag = cleanTag;
    this.searched = true;
    this.searching = true; // Show loading state
    this.activeTab = 'hashtags';
    this.saveRecentSearch(this.searchQuery.trim());

    // Reset results immediately
    this.hashtagPosts = [];
    this.postResults = [];
    this.hashtagReels = [];
    this.reelResults = [];
    this.hashtagResults = [];
    this.previewReel = null;

    // Load posts for this hashtag
    this.searchService.getPostsByHashtag(this.viewingHashtag).subscribe({
      next: (postIds) => {
        if (!postIds || postIds.length === 0) {
          this.loadHashtagPostsFallback(this.viewingHashtag);
          return;
        }
        let loadedCount = 0;
        postIds.forEach(id => {
          this.postService.getPostById(id).subscribe({
            next: (post) => {
              if (this.isPublicVisibility(post.visibility)) {
                this.hashtagPosts.push(post);
                this.postResults.push(post);
              }
              loadedCount++;
              if (loadedCount === postIds.length) this.searching = false;
            },
            error: () => {
              loadedCount++;
              if (loadedCount === postIds.length) this.searching = false;
            }
          });
        });
      },
      error: () => {
        this.loadHashtagPostsFallback(this.viewingHashtag);
      }
    });

    // Also run normal hashtag entity search
    this.searchService.searchHashtags(this.viewingHashtag).subscribe({
      next: data => this.hashtagResults = data,
      error: () => this.hashtagResults = []
    });

    // Search reels locally - fuzzy match on caption
    this.reelService.getExploreReels().subscribe({
      next: data => {
        const tagLower = this.viewingHashtag.toLowerCase();
        // Match if caption contains the tag (with or without #)
        this.hashtagReels = data.filter(r => {
          if (!r.caption) return false;
          const captionLower = r.caption.toLowerCase();
          return captionLower.includes('#' + tagLower) || 
                 captionLower.includes(tagLower);
        });
        this.reelResults = this.hashtagReels;
      },
      error: () => { 
        this.hashtagReels = []; 
        this.reelResults = []; 
      }
    });
  }

  private loadHashtagPostsFallback(tag: string): void {
    this.postService.getAllPosts().subscribe({
      next: (posts) => {
        const hashtagMatcher = new RegExp(`(^|\\s)#${this.escapeRegExp(tag)}(?=\\b|\\s|$)`, 'i');
        this.hashtagPosts = posts.filter(post =>
          this.isPublicVisibility(post.visibility) &&
          !!post.content &&
          hashtagMatcher.test(post.content)
        );
        this.postResults = [...this.hashtagPosts];
        this.searching = false;
      },
      error: () => {
        this.hashtagPosts = [];
        this.postResults = [];
        this.searching = false;
      }
    });
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private isPublicVisibility(rawVisibility: string | null | undefined): boolean {
    const vis = String(rawVisibility || '').trim().toUpperCase();
    return vis === 'PUBLIC' || vis === 'ALL' || vis === '';
  }

  openReelPreview(reel: Reel): void {
    this.previewReel = reel;
  }
  closeReelPreview(): void {
    this.previewReel = null;
  }
  navigateToReels(reelId: number): void {
    this.router.navigate(['/reels'], { queryParams: { reelId } });
  }
  
  clearSearch(): void {
    this.searchQuery = '';
    this.searched = false;
    this.searching = false;
    this.viewingHashtag = '';
    this.userResults = [];
    this.postResults = [];
    this.hashtagResults = [];
    this.hashtagPosts = [];
        this.postResults = [];
    this.reelResults = [];
    this.suggestions = [];
    this.showSuggestions = false;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { q: null },
      queryParamsHandling: 'merge'
    });
  }

  // ── Follow / Unfollow ──
  toggleFollow(user: UserResult): void {
    if (!this.isLoggedIn) {
      this.router.navigate(['/login']);
      return;
    }
    if (user.isFollowing) {
      this.followService.unfollow(user.email).subscribe({
        next: () => {
          user.isFollowing = false;
          user.followerCount = Math.max(0, user.followerCount - 1);
        },
        error: () => {}
      });
    } else {
      this.followService.follow(user.email).subscribe({
        next: () => {
          user.isFollowing = true;
          user.followerCount++;
        },
        error: () => {}
      });
    }
  }

  // ── Navigation ──
  navigateToProfile(email: string): void {
    this.router.navigate(['/user', email]);
  }

  goToLogin(): void {
    this.router.navigate(['/login']);
  }

  goToRegister(): void {
    this.router.navigate(['/register']);
  }

  isMe(email: string): boolean {
    return email === this.myEmail;
  }

  getTimeAgo(dateStr: string): string {
    if (!dateStr) return '';
    const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h';
    if (diff < 604800) return Math.floor(diff / 86400) + 'd';
    return Math.floor(diff / 604800) + 'w';
  }

  getPostHeading(post: Post): string {
    const title = (post.title || '').trim();
    if (title) {
      return title;
    }

    const contentPreview = this.getPostExcerpt(post.content, 42);
    return contentPreview || 'Untitled post';
  }

  getPostExcerpt(content: string | null | undefined, maxLength: number): string {
    const normalized = (content || '').replace(/\s+/g, ' ').trim();
    if (!normalized) {
      return 'No description available.';
    }

    if (normalized.length <= maxLength) {
      return normalized;
    }

    return `${normalized.slice(0, maxLength).trimEnd()}...`;
  }

  isFollowingUser(email: string): boolean {
    const u = this.userResults.find(ur => ur.email === email) || 
              this.suggestedUsers.find(su => su.email === email);
    return u ? u.isFollowing : false;
  }

  toggleFollowFromPost(post: any): void {
    let u = this.userResults.find(ur => ur.email === post.userEmail) || 
            this.suggestedUsers.find(su => su.email === post.userEmail);
    
    if (!u) {
      u = {
        email: post.userEmail,
        username: post.userEmail.split('@')[0],
        fullName: '',
        profilePicUrl: '',
        bio: '',
        isVerified: false,
        isPremiumMember: false,
        isFollowing: false,
        followerCount: 0,
        followingCount: 0
      };
    }
    this.toggleFollow(u);
  }

  getInitial(name: string): string {
    return (name || 'U').charAt(0).toUpperCase();
  }

  likePost(post: any): void {
    this.likeService.likeTarget(post.id, 'POST').subscribe({
      next: () => post.likeCount++
    });
  }

  commentPost(post: any): void {
    this.router.navigate(['/posts'], { queryParams: { postId: post.id } });
  }
}

interface UserResult {
  email: string;
  username: string;
  fullName: string;
  profilePicUrl: string;
  bio: string;
  isVerified: boolean;
  isPremiumMember: boolean;
  isFollowing: boolean;
  followerCount: number;
  followingCount: number;
}

interface TrendingTag {
  tag: string;
  count: number;
}
