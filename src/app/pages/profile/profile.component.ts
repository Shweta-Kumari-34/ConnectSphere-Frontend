import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../../services/auth.service';
import { PostService, Post } from '../../services/post.service';
import { Follow, FollowService } from '../../services/follow.service';
import { Story, StoryService } from '../../services/story.service';
import { LikeService } from '../../services/like.service';
import { Comment, CommentService } from '../../services/comment.service';
import { MediaUploadService } from '../../services/media-upload.service';
import { UserProfileStateService } from '../../services/user-profile-state.service';
import { StoryViewerComponent } from '../../components/story-viewer/story-viewer.component';
import { PostDetailModalComponent } from '../../components/post-detail-modal/post-detail-modal.component';
import { isStrongPassword } from '../../utils/auth-validation';
import { getStoryCreatedAtMs, getStoryExpiresAtMs, isStoryActiveNow } from '../../utils/story-time';
import { catchError, finalize, filter, forkJoin, of, Subscription, timeout } from 'rxjs';
import { ReelService } from '../../services/reel.service';

interface FollowProfile {
  username: string;
  fullName: string;
  profilePicUrl: string;
}

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, StoryViewerComponent, PostDetailModalComponent],
  templateUrl: './profile.component.html',
  styleUrl: './profile.component.scss'
})
export class ProfileComponent implements OnInit, OnDestroy {
  @ViewChild('profilePicInput') profilePicInput?: ElementRef<HTMLInputElement>;

  username = '';
  email = '';
  role = '';
  fullName = '';
  bio = '';
  profilePicUrl = '';
  currentPassword = '';
  newPassword = '';
  successMessage = '';
  errorMessage = '';
  loading = false;
  isVerified = false;
  isPremiumMember = false;

  totalPosts: number | null = null;
  followerCount: number | null = null;
  followingCount: number | null = null;
  followersList: Follow[] = [];
  followingList: Follow[] = [];
  followProfiles: Record<string, FollowProfile> = {};
  showFollowModal = false;
  followModalTab: 'followers' | 'following' = 'followers';
  followSearchTerm = '';
  loadingFollowModal = false;
  activeStories: Story[] = [];
  viewerStories: Story[] = [];
  viewerCurrentIndex = 0;
  viewedStoryIds = new Set<number>();

  activeTab: 'posts' | 'reels' | 'saved' = 'posts';
  myPosts: Post[] = [];
  myReels: any[] = [];
  selectedPost: Post | null = null;
  likedPostIds = new Set<number>();
  showCommentsModal = false;
  commentsModalPost: Post | null = null;
  postComments: Comment[] = [];
  newCommentText = '';
  readonly quickCommentEmojis = ['😀', '😂', '😍', '🔥', '👏', '🎉', '❤️'];
  loadingComments = false;
  postingComment = false;
  showEditModal = false;
  showPasswordModal = false;

  selectedProfileImageFile: File | null = null;
  selectedProfilePreview = '';
  readonly profilePictureAccept = 'image/jpeg,image/png,image/webp';
  private readonly maxProfilePictureBytes = 5 * 1024 * 1024;
  private readonly API_URL = '/auth';
  private readonly MEDIA_BASE_URL = '';
  private readonly followChangedHandler = () => this.loadFollowCounts();
  private routerEventsSub?: Subscription;
  private commentPostSafetyTimer: ReturnType<typeof setTimeout> | null = null;
  userBadgeMap: Record<string, { isVerified: boolean; isPremiumMember: boolean }> = {};

  constructor(
    private authService: AuthService,
    private http: HttpClient,
    private postService: PostService,
    private followService: FollowService,
    private storyService: StoryService,
    private likeService: LikeService,
    private commentService: CommentService,
    private mediaUploadService: MediaUploadService,
    private userProfileStateService: UserProfileStateService,
    private router: Router,
    private reelService: ReelService
  ) {}

  ngOnInit(): void {
    if (!this.authService.isLoggedIn()) return;
    this.username = this.authService.getUsername() || '';
    this.email = this.authService.getEmail() || '';
    this.role = this.authService.getRole() || 'USER';
    this.refreshProfileData();
    window.addEventListener('connectsphere-follow-changed', this.followChangedHandler);
    this.routerEventsSub = this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd)
    ).subscribe((event) => {
      if (event.urlAfterRedirects.startsWith('/profile')) {
        this.refreshProfileData();
      }
    });
  }

  ngOnDestroy(): void {
    window.removeEventListener('connectsphere-follow-changed', this.followChangedHandler);
    this.routerEventsSub?.unsubscribe();
    this.clearCommentPostSafetyTimer();
  }

  getInitial(): string {
    const source = this.fullName || this.username || 'U';
    return source.charAt(0).toUpperCase();
  }

  get profileImagePreview(): string {
    return this.selectedProfilePreview || this.profilePicUrl;
  }

  get storyUsers(): Story[] {
    const byUser = new Map<string, Story>();
    this.activeStories.forEach((story) => {
      const existing = byUser.get(story.userEmail);
      if (!existing || (getStoryCreatedAtMs(story) || 0) > (getStoryCreatedAtMs(existing) || 0)) {
        byUser.set(story.userEmail, story);
      }
    });
    return Array.from(byUser.values()).sort((a, b) => {
      return (getStoryCreatedAtMs(b) || 0) - (getStoryCreatedAtMs(a) || 0);
    });
  }

  get isStoryViewerOpen(): boolean {
    return this.viewerStories.length > 0;
  }

  get hasMyStories(): boolean {
    if (!this.email) {
      return false;
    }
    return this.getStoriesForUser(this.email).length > 0;
  }

  loadProfile(): void {
    this.http.get<any>(`${this.API_URL}/profile`).subscribe({
      next: (profile) => {
        this.username = profile.username || this.username;
        this.email = profile.email || this.email;
        this.fullName = profile.fullName || '';
        this.bio = profile.bio || '';
        this.profilePicUrl = profile.profilePicUrl || '';
        this.role = profile.role || this.role;
        this.isVerified = !!profile.isVerified;
        this.isPremiumMember = !!profile.isPremiumMember;
      },
      error: () => {}
    });
  }

  loadPosts(): void {
    this.postService.getMyPosts().subscribe({
      next: (posts) => {
        const myEmail = (this.email || '').toLowerCase();
        this.myPosts = posts
          .filter((post) => !myEmail || (post.userEmail || '').toLowerCase() === myEmail)
          .map((post) => this.normalizePost(post))
          .reverse();
        this.myPosts.forEach((post) => {
          this.populatePostMedia(post);
          this.hydratePostEngagement(post);
        });
        this.totalPosts = this.myPosts.length;
      },
      error: () => {
        this.myPosts = [];
        this.loadPostCountFallback();
      }
    });
  }

  openPost(post: Post): void {
    this.selectedPost = post;
  }

  closePost(): void {
    this.selectedPost = null;
  }

  isPostLiked(post: Post): boolean {
    return this.likedPostIds.has(post.id);
  }

  get filteredFollowers(): Follow[] {
    return this.followersList.filter((item) => {
      const email = this.getFollowerEmail(item);
      return !!email && this.matchesFollowSearch(email);
    });
  }

  get filteredFollowing(): Follow[] {
    return this.followingList.filter((item) => {
      const email = this.getFollowingEmail(item);
      return !!email && this.matchesFollowSearch(email);
    });
  }

  togglePostLike(post: Post, event: Event): void {
    event.stopPropagation();

    const wasLiked = this.likedPostIds.has(post.id);
    if (wasLiked) {
      this.likedPostIds.delete(post.id);
      post.likeCount = Math.max(0, (post.likeCount || 0) - 1);
      this.likeService.unlikeTarget(post.id, 'POST').subscribe({
        error: () => {
          this.likedPostIds.add(post.id);
          post.likeCount = (post.likeCount || 0) + 1;
        }
      });
      return;
    }

    this.likedPostIds.add(post.id);
    post.likeCount = (post.likeCount || 0) + 1;
    this.likeService.likeTarget(post.id, 'POST').subscribe({
      error: () => {
        this.likedPostIds.delete(post.id);
        post.likeCount = Math.max(0, (post.likeCount || 0) - 1);
      }
    });
  }

  openCommentsModal(post: Post, event: Event): void {
    event.stopPropagation();
    this.commentsModalPost = post;
    this.showCommentsModal = true;
    this.newCommentText = '';
    this.loadCommentsForPost(post);
  }

  closeCommentsModal(): void {
    this.showCommentsModal = false;
    this.commentsModalPost = null;
    this.postComments = [];
    this.newCommentText = '';
    this.loadingComments = false;
    this.postingComment = false;
    this.clearCommentPostSafetyTimer();
  }

  addCommentToSelectedPost(): void {
    if (!this.commentsModalPost || this.postingComment) {
      return;
    }

    const content = this.newCommentText.trim();
    if (!content) {
      return;
    }

    const targetPost = this.commentsModalPost;
    this.postingComment = true;
    this.newCommentText = '';
    targetPost.commentCount = (targetPost.commentCount || 0) + 1;
    this.startCommentPostSafetyTimer(targetPost, content);

    this.commentService.addComment({ postId: targetPost.id, content }).pipe(
      timeout(12000),
      finalize(() => {
        this.postingComment = false;
        this.clearCommentPostSafetyTimer();
      })
    ).subscribe({
      next: (comment) => {
        this.postComments = [...this.postComments, comment];
      },
      error: () => {
        targetPost.commentCount = Math.max(0, (targetPost.commentCount || 0) - 1);
        this.newCommentText = content;
        this.errorMessage = 'Could not post comment right now. Please try again.';
      }
    });
  }

  addEmojiToComment(emoji: string): void {
    const nextValue = `${this.newCommentText}${emoji}`;
    this.newCommentText = nextValue;
  }

  getCommentAuthor(comment: Comment): string {
    return (comment.userEmail || 'user').split('@')[0];
  }

  openFollowModal(tab: 'followers' | 'following'): void {
    this.followModalTab = tab;
    this.showFollowModal = true;
    this.followSearchTerm = '';
    this.loadFollowLists();
  }

  closeFollowModal(): void {
    this.showFollowModal = false;
    this.followSearchTerm = '';
  }

  setFollowModalTab(tab: 'followers' | 'following'): void {
    this.followModalTab = tab;
  }

  getFollowDisplayName(email: string): string {
    const profile = this.followProfiles[email];
    return profile?.fullName || profile?.username || email.split('@')[0];
  }

  getFollowHandle(email: string): string {
    const profile = this.followProfiles[email];
    return `@${profile?.username || email.split('@')[0]}`;
  }

  getFollowProfilePhoto(email: string): string {
    return this.followProfiles[email]?.profilePicUrl || '';
  }

  getFollowInitial(email: string): string {
    return this.getFollowDisplayName(email).charAt(0).toUpperCase();
  }

  getFollowerEmail(item: Follow): string {
    return this.normalizeEmail(item?.followerEmail || item?.followingEmail);
  }

  getFollowingEmail(item: Follow): string {
    return this.normalizeEmail(item?.followingEmail || item?.followerEmail);
  }

  handlePostDeleted(postId: number): void {
    this.myPosts = this.myPosts.filter((post) => post.id !== postId);
    this.totalPosts = this.myPosts.length;
    this.selectedPost = null;
  }

  loadFollowCounts(): void {
    this.followService.getFollowerCount().subscribe({
      next: (count) => {
        const parsed = this.parseCountValue(count);
        this.followerCount = parsed;
        if (parsed === null) {
          this.loadFollowerCountFallback();
        }
      },
      error: () => this.loadFollowerCountFallback()
    });

    this.followService.getFollowingCount().subscribe({
      next: (count) => {
        const parsed = this.parseCountValue(count);
        this.followingCount = parsed;
        if (parsed === null) {
          this.loadFollowingCountFallback();
        }
      },
      error: () => this.loadFollowingCountFallback()
    });
  }

  loadStories(): void {
    this.storyService.getActiveStories().subscribe({
      next: (stories) => {
        // Filter to only show my own stories on my profile
        this.activeStories = stories
          .filter((story) => isStoryActiveNow(story) && story.userEmail === this.email)
          .map((story) => this.normalizeStory(story));
      },
      error: () => {
        this.activeStories = [];
      }
    });
  }

  openStoryViewerForUser(userEmail: string): void {
    const userStories = this.getStoriesForUser(userEmail);
    if (!userStories.length) {
      return;
    }
    this.viewerStories = userStories;
    this.viewerCurrentIndex = 0;
  }

  openMyStories(): void {
    if (!this.email) {
      return;
    }
    this.openStoryViewerForUser(this.email);
  }

  closeStoryViewer(): void {
    this.viewerStories = [];
    this.viewerCurrentIndex = 0;
  }

  deleteStoryFromViewer(story: Story): void {
    if (!story?.id) {
      return;
    }

    this.storyService.deleteStory(story.id).subscribe({
      next: () => {
        this.activeStories = this.activeStories.filter((s) => s.id !== story.id);
        this.viewerStories = this.viewerStories.filter((s) => s.id !== story.id);
        if (!this.viewerStories.length) {
          this.closeStoryViewer();
        }
      },
      error: () => {
        this.errorMessage = 'Could not delete story.';
      }
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

  getStoryInitial(story: Story): string {
    return this.getStoryDisplayName(story).charAt(0).toUpperCase();
  }

  getStoryDisplayName(story: Story): string {
    return story.userEmail?.split('@')[0] || 'user';
  }

  private refreshProfileData(): void {
    this.loadProfile();
    this.loadPosts();
    this.loadReels();
    this.loadFollowCounts();
    this.loadStories();
  }

  private loadReels(): void {
    if (!this.email) return;
    this.reelService.getMyReels(this.email).subscribe({
      next: (reels) => {
        this.myReels = reels;
      },
      error: () => {
        this.myReels = [];
      }
    });
  }

  private loadFollowLists(): void {
    this.loadingFollowModal = true;
    const followersRequest = this.followService.getFollowers().pipe(catchError(() => of([] as Follow[])));
    const followingRequest = this.followService.getFollowing().pipe(catchError(() => of([] as Follow[])));
    const encodedEmail = encodeURIComponent(this.email || '');
    const followersByEmailRequest = encodedEmail
      ? this.http.get<Follow[]>(`/follows/followers/${encodedEmail}`).pipe(catchError(() => of([] as Follow[])))
      : of([] as Follow[]);
    const followingByEmailRequest = encodedEmail
      ? this.http.get<Follow[]>(`/follows/following/${encodedEmail}`).pipe(catchError(() => of([] as Follow[])))
      : of([] as Follow[]);

    forkJoin({
      followers: followersRequest,
      following: followingRequest,
      followersByEmail: followersByEmailRequest,
      followingByEmail: followingByEmailRequest
    }).subscribe({
      next: ({ followers, following, followersByEmail, followingByEmail }) => {
        const resolvedFollowers = (followers && followers.length > 0) ? followers : followersByEmail;
        const resolvedFollowing = (following && following.length > 0) ? following : followingByEmail;

        this.followersList = this.normalizeFollowList(resolvedFollowers, 'followerEmail');
        this.followingList = this.normalizeFollowList(resolvedFollowing, 'followingEmail');

        const emails = [
          ...this.followersList.map((item) => item.followerEmail),
          ...this.followingList.map((item) => item.followingEmail)
        ];
        this.loadProfilesForFollowEmails(emails);
        this.loadingFollowModal = false;
      },
      error: () => {
        this.followersList = [];
        this.followingList = [];
        this.loadingFollowModal = false;
      }
    });
  }

  private normalizeFollowList(data: Follow[], field: 'followerEmail' | 'followingEmail'): Follow[] {
    const seen = new Set<string>();

    return (data || []).filter((item) => {
      const email = this.resolveCounterpartyEmail(item, field);
      if (!email || seen.has(email)) {
        return false;
      }
      seen.add(email);
      return true;
    }).map((item) => ({
      ...item,
      followerEmail: field === 'followerEmail'
        ? this.resolveCounterpartyEmail(item, field)
        : this.normalizeEmail(item.followerEmail),
      followingEmail: field === 'followingEmail'
        ? this.resolveCounterpartyEmail(item, field)
        : this.normalizeEmail(item.followingEmail)
    }));
  }

  private resolveCounterpartyEmail(item: Follow, field: 'followerEmail' | 'followingEmail'): string {
    const primaryEmail = this.normalizeEmail(item?.[field]);
    const fallbackField = field === 'followerEmail' ? 'followingEmail' : 'followerEmail';
    const fallbackEmail = this.normalizeEmail(item?.[fallbackField]);

    if (primaryEmail) {
      return primaryEmail;
    }

    if (fallbackEmail) {
      return fallbackEmail;
    }

    return primaryEmail || fallbackEmail;
  }

  private normalizeEmail(value: string | null | undefined): string {
    return (value || '').trim().toLowerCase();
  }

  private loadPostCountFallback(): void {
    if (!this.email) {
      this.totalPosts = null;
      return;
    }

    this.postService.getPostCount(this.email).subscribe({
      next: (response) => {
        this.totalPosts = this.parseCountValue(response);
      },
      error: () => {
        this.totalPosts = null;
      }
    });
  }

  private loadFollowerCountFallback(): void {
    if (!this.email) {
      this.followerCount = null;
      return;
    }

    this.http.get<any>(`/follows/follower-count/${encodeURIComponent(this.email)}`).subscribe({
      next: (response) => {
        this.followerCount = this.parseCountValue(response);
      },
      error: () => {
        this.followerCount = null;
      }
    });
  }

  private loadFollowingCountFallback(): void {
    if (!this.email) {
      this.followingCount = null;
      return;
    }

    this.http.get<any>(`/follows/following-count/${encodeURIComponent(this.email)}`).subscribe({
      next: (response) => {
        this.followingCount = this.parseCountValue(response);
      },
      error: () => {
        this.followingCount = null;
      }
    });
  }

  private parseCountValue(value: any): number | null {
    if (value === null || value === undefined) {
      return null;
    }

    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }

    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }

    if (typeof value === 'object') {
      const candidateKeys = ['count', 'total', 'value', 'followerCount', 'followingCount', 'postCount'];
      for (const key of candidateKeys) {
        if (key in value) {
          const parsed = Number(value[key]);
          if (Number.isFinite(parsed)) {
            return parsed;
          }
        }
      }
    }

    return null;
  }

  onProfileImageSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) {
      return;
    }

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      this.errorMessage = 'Only JPEG, PNG, and WebP images are allowed.';
      this.resetProfileImageInput();
      return;
    }

    if (file.size > this.maxProfilePictureBytes) {
      this.errorMessage = 'Profile picture must be 5MB or smaller.';
      this.resetProfileImageInput();
      return;
    }

    this.selectedProfileImageFile = file;
    this.errorMessage = '';

    const reader = new FileReader();
    reader.onload = (e) => {
      this.selectedProfilePreview = (e.target?.result as string) || '';
    };
    reader.readAsDataURL(file);
  }

  removeProfilePicture(): void {
    this.profilePicUrl = '';
    this.selectedProfileImageFile = null;
    this.selectedProfilePreview = '';
    this.resetProfileImageInput();
  }

  updateProfile(): void {
    this.loading = true;
    this.errorMessage = '';
    this.successMessage = '';

    const saveProfile = (profilePicUrl: string | null): void => {
      this.http.put(
        `${this.API_URL}/update-profile`,
        {
          fullName: this.fullName || null,
          bio: this.bio || null,
          profilePicUrl
        },
        { responseType: 'text' }
      ).subscribe({
        next: (msg) => {
          this.successMessage = msg;
          this.showEditModal = false;
          this.clearProfilePictureSelection();
          // Immediately reload profile to pick up auto-verification changes
          this.http.get<any>(`${this.API_URL}/profile`).subscribe({
            next: (profile) => {
              this.username = profile.username || this.username;
              this.fullName = profile.fullName || '';
              this.bio = profile.bio || '';
              this.profilePicUrl = profile.profilePicUrl || '';
              this.isVerified = !!profile.isVerified;
              this.isPremiumMember = !!profile.isPremiumMember;
              this.loading = false;
            },
            error: () => {
              this.loadProfile();
              this.loading = false;
            }
          });
          setTimeout(() => (this.successMessage = ''), 3000);
        },
        error: (err) => {
          this.loading = false;
          this.errorMessage = err.error?.message || err.error || 'Update failed';
        }
      });
    };

    if (this.selectedProfileImageFile) {
      const formData = new FormData();
      formData.append('file', this.selectedProfileImageFile);

      this.http.post<any>(`${this.API_URL}/profile-picture`, formData).subscribe({
        next: (response) => {
          const uploadedUrl = response?.profilePicUrl || '';
          this.profilePicUrl = uploadedUrl;
          saveProfile(uploadedUrl || null);
        },
        error: (err) => {
          this.loading = false;
          this.errorMessage = err.error?.message || err.error || 'Failed to upload profile picture';
        }
      });
      return;
    }

    saveProfile(this.profilePicUrl || null);
  }

  changePassword(): void {
    if (!this.currentPassword || !this.newPassword) {
      return;
    }

    if (!isStrongPassword(this.newPassword)) {
      this.errorMessage = 'New password must be 8+ characters and include one uppercase letter, one number, and one special character.';
      return;
    }

    this.loading = true;
    this.errorMessage = '';

    this.http.put(
      `${this.API_URL}/change-password`,
      {
        currentPassword: this.currentPassword,
        newPassword: this.newPassword
      },
      { responseType: 'text' }
    ).subscribe({
      next: (msg) => {
        this.loading = false;
        this.successMessage = msg;
        this.currentPassword = '';
        this.newPassword = '';
        this.showPasswordModal = false;
        setTimeout(() => (this.successMessage = ''), 3000);
      },
      error: (err) => {
        this.loading = false;
        this.errorMessage = err.error?.message || err.error || 'Password change failed';
      }
    });
  }

  private clearProfilePictureSelection(): void {
    this.selectedProfileImageFile = null;
    this.selectedProfilePreview = '';
    this.resetProfileImageInput();
  }

  private resetProfileImageInput(): void {
    if (this.profilePicInput?.nativeElement) {
      this.profilePicInput.nativeElement.value = '';
    }
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

  private normalizeMediaUrl(url: string): string {
    if (!url) {
      return '';
    }
    if (url.startsWith('data:') || url.startsWith('blob:')) {
      return url;
    }

    if (url.startsWith('http://') || url.startsWith('https://')) {
      try {
        const parsed = new URL(url);
        if (parsed.pathname?.startsWith('/uploads/')) {
          return parsed.pathname;
        }
      } catch {
        return url;
      }
      return url;
    }

    const normalized = url.replace(/\\/g, '/');
    const uploadsIndex = normalized.toLowerCase().indexOf('/uploads/');
    if (uploadsIndex >= 0) {
      const uploadsPath = normalized.substring(uploadsIndex);
      return `${this.MEDIA_BASE_URL}${uploadsPath}`;
    }

    if (normalized.startsWith('uploads/')) {
      return `${this.MEDIA_BASE_URL}/${normalized}`;
    }

    if (normalized.startsWith('/media/')) {
      return `${this.MEDIA_BASE_URL}${normalized}`;
    }

    if (normalized.startsWith('/uploads/')) {
      return `${this.MEDIA_BASE_URL}${normalized}`;
    }

    if (normalized.startsWith('/')) {
      return `${this.MEDIA_BASE_URL}${normalized}`;
    }

    return `${this.MEDIA_BASE_URL}/${normalized}`;
  }

  private normalizePost(post: Post): Post {
    const baseMedia = this.extractMediaUrlsFromPost(post);
    return {
      ...post,
      mediaUrls: baseMedia,
      postType: baseMedia.length > 1 ? 'CAROUSEL' : post.postType
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

    this.likeService.hasLiked(post.id, 'POST').subscribe({
      next: (liked) => {
        if (liked) {
          this.likedPostIds.add(post.id);
        } else {
          this.likedPostIds.delete(post.id);
        }
      },
      error: () => this.likedPostIds.delete(post.id)
    });

    this.commentService.getCommentCount(post.id).subscribe({
      next: (count) => post.commentCount = Number(count) || 0,
      error: () => {}
    });
  }

  private loadCommentsForPost(post: Post): void {
    this.loadingComments = true;
    this.commentService.getCommentsByPost(post.id).subscribe({
      next: (comments) => {
        this.postComments = comments;
        this.loadBadgesForEmails(comments.map((comment) => comment.userEmail));
        post.commentCount = comments.length;
        this.loadingComments = false;
      },
      error: () => {
        this.postComments = [];
        this.loadingComments = false;
      }
    });
  }

  private loadProfilesForFollowEmails(emails: string[]): void {
    const uniqueEmails = [...new Set(emails.filter((email) => !!email && !this.followProfiles[email]))];

    if (!uniqueEmails.length) {
      return;
    }

    const requests = uniqueEmails.map((email) =>
      this.http.get<any>(`${this.API_URL}/user/${encodeURIComponent(email)}`).pipe(
        catchError(() => of(null))
      )
    );

    forkJoin(requests).subscribe((profiles) => {
      const nextProfiles = { ...this.followProfiles };
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
      this.followProfiles = nextProfiles;
    });
  }

  private matchesFollowSearch(email: string): boolean {
    const query = this.followSearchTerm.trim().toLowerCase();
    if (!query) {
      return true;
    }

    const displayName = this.getFollowDisplayName(email).toLowerCase();
    const handle = this.getFollowHandle(email).toLowerCase();
    return displayName.includes(query) || handle.includes(query) || email.toLowerCase().includes(query);
  }

  private startCommentPostSafetyTimer(post: Post, content: string): void {
    this.clearCommentPostSafetyTimer();
    this.commentPostSafetyTimer = setTimeout(() => {
      if (!this.postingComment) {
        return;
      }
      this.postingComment = false;
      post.commentCount = Math.max(0, (post.commentCount || 0) - 1);
      this.newCommentText = content;
      this.errorMessage = 'Comment request timed out. Please try again.';
    }, 8000);
  }

  private clearCommentPostSafetyTimer(): void {
    if (this.commentPostSafetyTimer) {
      clearTimeout(this.commentPostSafetyTimer);
      this.commentPostSafetyTimer = null;
    }
  }

  private getStoriesForUser(userEmail: string): Story[] {
    const target = (userEmail || '').toLowerCase();
    return this.activeStories
      .filter((story) => (story.userEmail || '').toLowerCase() === target && isStoryActiveNow(story))
      .sort((a, b) => (getStoryCreatedAtMs(a) || 0) - (getStoryCreatedAtMs(b) || 0));
  }

  isVerifiedUser(email: string): boolean {
    return !!this.userBadgeMap[(email || '').toLowerCase()]?.isVerified;
  }

  isPremiumUser(email: string): boolean {
    return !!this.userBadgeMap[(email || '').toLowerCase()]?.isPremiumMember;
  }

  openReelInFeed(reel: any): void {
    if (!reel?.id) {
      this.router.navigate(['/reels']);
      return;
    }
    this.router.navigate(['/reels'], { queryParams: { reelId: reel.id } });
  }

  private loadBadgesForEmails(emails: string[]): void {
    const uniqueEmails = [...new Set((emails || []).filter(Boolean).map((email) => email.toLowerCase()))];
    uniqueEmails.forEach((email) => {
      if (this.userBadgeMap[email]) {
        return;
      }
      this.userProfileStateService.getProfileByEmail(email).subscribe({
        next: (profile) => {
          if (!profile) return;
          this.userBadgeMap[email] = {
            isVerified: !!profile.isVerified,
            isPremiumMember: !!profile.isPremiumMember
          };
        },
        error: () => {}
      });
    });
  }
}
