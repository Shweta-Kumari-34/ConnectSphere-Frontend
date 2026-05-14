import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { PostService, Post } from '../../services/post.service';
import { FollowService } from '../../services/follow.service';
import { AuthService } from '../../services/auth.service';
import { Story, StoryService } from '../../services/story.service';
import { LikeService } from '../../services/like.service';
import { CommentService } from '../../services/comment.service';
import { MediaUploadService } from '../../services/media-upload.service';
import { StoryViewerComponent } from '../../components/story-viewer/story-viewer.component';
import { PostDetailModalComponent } from '../../components/post-detail-modal/post-detail-modal.component';
import { getStoryCreatedAtMs, getStoryExpiresAtMs, isStoryActiveNow } from '../../utils/story-time';
import { ReelService } from '../../services/reel.service';

@Component({
  selector: 'app-user-profile',
  standalone: true,
  imports: [CommonModule, RouterModule, StoryViewerComponent, PostDetailModalComponent],
  templateUrl: './user-profile.component.html',
  styleUrl: './user-profile.component.scss'
})
export class UserProfileComponent implements OnInit {
  private readonly API = '';
  private readonly MEDIA_BASE_URL = '';

  userEmail = '';
  username = '';
  fullName = '';
  bio = '';
  profilePicUrl = '';
  role = '';
  isVerified = false;
  isPremiumMember = false;
  memberSince = '';

  posts: Post[] = [];
  userReels: any[] = [];
  followerCount = 0;
  followingCount = 0;
  postCount = 0;
  isFollowing = false;
  isOwnProfile = false;
  isLoggedIn = false;
  currentUserEmail = '';
  loading = true;
  followBusy = false;

  activeTab: 'posts' | 'reels' | 'tagged' = 'posts';
  selectedPost: Post | null = null;
  userStories: Story[] = [];
  viewerStories: Story[] = [];
  viewerCurrentIndex = 0;
  viewedStoryIds = new Set<number>();

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private http: HttpClient,
    private postService: PostService,
    private followService: FollowService,
    private authService: AuthService,
    private storyService: StoryService,
    private likeService: LikeService,
    private commentService: CommentService,
    private mediaUploadService: MediaUploadService,
    private reelService: ReelService
  ) {}

  ngOnInit(): void {
    this.isLoggedIn = this.authService.isLoggedIn();
    this.currentUserEmail = this.authService.getEmail() || '';
    this.route.params.subscribe((params) => {
      this.userEmail = params['email'];
      this.username = this.userEmail.split('@')[0];
      this.isOwnProfile = this.isLoggedIn && this.userEmail === this.authService.getEmail();
      this.followBusy = false;
      this.loadProfile();
      this.loadPosts();
      this.loadReels();
      this.loadFollowCounts();
      this.loadUserStories();
      if (this.isLoggedIn && !this.isOwnProfile) {
        this.checkFollowStatus();
      } else {
        this.isFollowing = false;
      }
    });
  }

  loadProfile(): void {
    this.http.get<any>(`${this.API}/auth/user/${encodeURIComponent(this.userEmail)}`).subscribe({
      next: (profile) => {
        this.username = profile.username || this.username;
        this.fullName = profile.fullName || '';
        this.bio = profile.bio || '';
        this.profilePicUrl = profile.profilePicUrl || '';
        this.role = profile.role || 'USER';
        this.isVerified = !!profile.isVerified;
        this.isPremiumMember = !!profile.isPremiumMember;
        if (profile.createdAt) {
          const joinedDate = new Date(profile.createdAt);
          this.memberSince = joinedDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        }
      },
      error: () => {}
    });
  }

  loadPosts(): void {
    this.loading = true;
    this.postService.getPostsByUser(this.userEmail).subscribe({
      next: (posts) => {
        const profileEmail = (this.userEmail || '').toLowerCase();
        const normalizedPosts = posts
          .filter((post) => !profileEmail || (post.userEmail || '').toLowerCase() === profileEmail)
          .map((post) => this.normalizePost(post));
        this.posts = this.isOwnProfile
          ? normalizedPosts.reverse()
          : normalizedPosts.filter((post) => post.visibility === 'PUBLIC').reverse();
        this.posts.forEach((post) => {
          this.populatePostMedia(post);
          this.hydratePostEngagement(post);
        });
        this.postCount = this.posts.length;
        this.loading = false;
      },
      error: () => {
        this.posts = [];
        this.postCount = 0;
        this.loading = false;
      }
    });
  }

  loadReels(): void {
    this.reelService.getUserReels(this.userEmail).subscribe({
      next: (reels) => {
        // Apply visibility logic
        this.userReels = reels.filter((r) => {
          if (this.isOwnProfile) return true; // owner sees all
          if (r.visibility === 'PUBLIC') return true;
          if (r.visibility === 'FOLLOWERS' && this.isFollowing) return true;
          return false;
        }).reverse();
      },
      error: () => {
        this.userReels = [];
      }
    });
  }

  loadFollowCounts(): void {
    this.http.get<number>(`${this.API}/follows/follower-count/${encodeURIComponent(this.userEmail)}`).subscribe({
      next: (count) => (this.followerCount = Number(count) || 0),
      error: () => (this.followerCount = 0)
    });

    this.http.get<number>(`${this.API}/follows/following-count/${encodeURIComponent(this.userEmail)}`).subscribe({
      next: (count) => (this.followingCount = Number(count) || 0),
      error: () => (this.followingCount = 0)
    });
  }

  loadUserStories(): void {
    const targetEmail = (this.userEmail || '').toLowerCase();
    this.storyService.getActiveStories().subscribe({
      next: (stories) => {
        this.userStories = stories
          .filter((story) => (story.userEmail || '').toLowerCase() === targetEmail && isStoryActiveNow(story))
          .map((story) => this.normalizeStory(story))
          .sort((a, b) => (getStoryCreatedAtMs(a) || 0) - (getStoryCreatedAtMs(b) || 0));
      },
      error: () => {
        this.userStories = [];
      }
    });
  }

  openProfileStories(): void {
    if (!this.userStories.length) {
      return;
    }
    this.viewerStories = [...this.userStories];
    this.viewerCurrentIndex = 0;
  }

  closeStoryViewer(): void {
    this.viewerStories = [];
    this.viewerCurrentIndex = 0;
  }

  deleteStoryFromViewer(story: Story): void {
    if (!story?.id || !this.isOwnProfile) {
      return;
    }

    this.storyService.deleteStory(story.id).subscribe({
      next: () => {
        this.userStories = this.userStories.filter((s) => s.id !== story.id);
        this.viewerStories = this.viewerStories.filter((s) => s.id !== story.id);
        if (!this.viewerStories.length) {
          this.closeStoryViewer();
        }
      },
      error: () => {}
    });
  }

  markStoryViewed(story: Story): void {
    if (!story?.id || this.viewedStoryIds.has(story.id)) {
      return;
    }
    this.viewedStoryIds.add(story.id);
    this.storyService.viewStory(story.id).subscribe({
      next: () => {},
      error: () => {}
    });
  }

  get hasStories(): boolean {
    return this.userStories.length > 0;
  }

  checkFollowStatus(): void {
    this.followService.isFollowing(this.userEmail).subscribe({
      next: (value) => (this.isFollowing = value),
      error: () => (this.isFollowing = false)
    });
  }

  toggleFollow(): void {
    if (!this.isLoggedIn) {
      this.router.navigate(['/login']);
      return;
    }

    if (this.isOwnProfile || this.followBusy) {
      return;
    }

    this.followBusy = true;

    if (this.isFollowing) {
      this.followService.unfollow(this.userEmail).subscribe({
        next: () => this.finishFollowUpdate(false),
        error: () => (this.followBusy = false)
      });
      return;
    }

    this.followService.follow(this.userEmail).subscribe({
      next: () => this.finishFollowUpdate(true),
      error: () => (this.followBusy = false)
    });
  }

  openPost(post: Post): void {
    this.selectedPost = post;
  }

  closePost(): void {
    this.selectedPost = null;
  }

  handlePostDeleted(postId: number): void {
    this.posts = this.posts.filter((post) => post.id !== postId);
    this.postCount = this.posts.length;
    this.selectedPost = null;
  }

  goToLogin(): void {
    this.router.navigate(['/login']);
  }

  getInitial(): string {
    return (this.fullName || this.username || 'U').charAt(0).toUpperCase();
  }

  getDisplayName(): string {
    return this.fullName || this.username;
  }

  getPostPreview(post: Post | null): string {
    return post?.mediaUrls?.[0] || '';
  }

  getPostLetter(post: Post | null): string {
    const source = post?.title || post?.content || 'P';
    return source.charAt(0).toUpperCase();
  }

  getTimeAgo(dateStr: string): string {
    if (!dateStr) return '';
    const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
    return `${Math.floor(diff / 86400)} days ago`;
  }

  formatCount(count: number): string {
    if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
    if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
    return count.toString();
  }

  private finishFollowUpdate(nextState: boolean): void {
    this.isFollowing = nextState;
    this.followBusy = false;
    this.loadFollowCounts();
    this.checkFollowStatus();
    window.dispatchEvent(new Event('connectsphere-follow-changed'));
  }

  private normalizeMediaUrl(url: string): string {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    if (url.startsWith('/uploads/')) {
      return `${this.MEDIA_BASE_URL}${url}`;
    }
    return url;
  }

  private normalizeStory(story: Story): Story {
    const createdAtMs = getStoryCreatedAtMs(story);
    const expiresAtMs = getStoryExpiresAtMs(story);
    return {
      ...story,
      mediaUrl: this.normalizeMediaUrl(story.mediaUrl),
      createdAt: createdAtMs ? new Date(createdAtMs).toISOString() : story.createdAt,
      expiresAt: expiresAtMs ? new Date(expiresAtMs).toISOString() : story.expiresAt
    };
  }

  private normalizePost(post: Post): Post {
    const normalizedMediaUrls = this.extractMediaUrlsFromPost(post);
    return {
      ...post,
      mediaUrls: normalizedMediaUrls,
      postType: normalizedMediaUrls.length > 1 ? 'CAROUSEL' : post.postType
    };
  }

  private populatePostMedia(post: Post): void {
    const postId = this.resolvePostId(post);
    if (!postId) {
      return;
    }

    this.mediaUploadService.getMediaByPost(postId).subscribe({
      next: (mediaItems) => {
        if (!mediaItems.length) {
          return;
        }
        post.mediaUrls = mediaItems
          .map((item: any) => this.normalizeMediaUrl(item?.mediaUrl || item?.media_url || item?.url || ''))
          .filter(Boolean);
        post.postType = post.mediaUrls.length > 1 ? 'CAROUSEL' : (mediaItems[0]?.mediaType || post.postType);
      },
      error: () => {}
    });
  }

  private resolvePostId(post: any): number {
    const raw = post?.id ?? post?.postId ?? post?.post_id;
    const id = Number(raw);
    return Number.isFinite(id) && id > 0 ? id : 0;
  }

  private extractMediaUrlsFromPost(post: any): string[] {
    const urls: string[] = [];
    const add = (value: any) => {
      if (typeof value === 'string' && value.trim()) {
        urls.push(this.normalizeMediaUrl(value.trim()));
      }
    };

    const list = Array.isArray(post?.mediaUrls)
      ? post.mediaUrls
      : Array.isArray(post?.media_urls)
        ? post.media_urls
        : [];
    list.forEach(add);

    add(post?.mediaUrl);
    add(post?.media_url);
    add(post?.imageUrl);
    add(post?.image_url);
    add(post?.thumbnailUrl);
    add(post?.thumbnail_url);

    return Array.from(new Set(urls.filter(Boolean)));
  }

  private hydratePostEngagement(post: Post): void {
    this.likeService.getLikeCount(post.id, 'POST').subscribe({
      next: (count) => post.likeCount = Number(count) || 0,
      error: () => {}
    });

    this.commentService.getCommentCount(post.id).subscribe({
      next: (count) => post.commentCount = Number(count) || 0,
      error: () => {}
    });
  }
}
