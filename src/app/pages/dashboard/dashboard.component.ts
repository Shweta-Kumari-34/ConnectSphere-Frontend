import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { PostService, Post } from '../../services/post.service';
import { PaymentService } from '../../services/payment.service';
import { FollowService } from '../../services/follow.service';
import { LikeService } from '../../services/like.service';
import { NotificationService, Notification } from '../../services/notification.service';
import { UserProfileStateService, UserProfileState } from '../../services/user-profile-state.service';
import { ReelService, Reel } from '../../services/reel.service';
import { StoryService, Story } from '../../services/story.service';
import { SearchService } from '../../services/search.service';

interface Activity {
  type: string;
  icon: string;
  iconClass?: string;
  text: string;
  time: string;
  actionUrl?: string;
  thumbnailUrl?: string;
  isRead?: boolean;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class DashboardComponent implements OnInit, OnDestroy {

  username = '';
  totalPosts = 0;
  totalPayments = 0;
  followerCount = 0;
  followingCount = 0;
  unreadNotifications = 0;
  recentPosts: Post[] = [];
  isVerified = false;
  greeting = '';
  role = 'USER';
  private unreadSub?: any;

  // Activity feed
  activities: Activity[] = [];
  
  latestReel: Reel | null = null;
  latestStory: Story | null = null;

  totalReels = 0;
  totalStories = 0;
  likesReceived = 0;

  profilePicUrl = '';
  isPremiumMember = false;
  profileCompletion = 0;

  trendingHashtag: string | null = null;
  suggestedUsers: any[] = [];
  latestFollower: any = null;
  latestComment: any = null;

  latestMedia: any[] = [];

  constructor(
    private authService: AuthService,
    private postService: PostService,
    private paymentService: PaymentService,
    private followService: FollowService,
    private notificationService: NotificationService,
    private userProfileStateService: UserProfileStateService,
    private reelService: ReelService,
    private storyService: StoryService,
    private searchService: SearchService,
    private likeService: LikeService
  ) {}

  ngOnInit(): void {
    this.username = this.authService.getUsername() || 'User';
    this.role = this.authService.getRole();
    this.greeting = this.getGreeting();
    
    // Initial fetch for counts and profile
    this.loadDashboardData();

    this.unreadSub = this.notificationService.unreadCount$.subscribe((count) => {
      this.unreadNotifications = Number(count) || 0;
    });
  }

  private loadDashboardData(): void {
    // Profile & Completion
    this.userProfileStateService.getCurrentUserProfile(true).subscribe({
      next: (profile) => {
        if (profile) {
          this.isVerified = !!profile.isVerified;
          this.profilePicUrl = profile.profilePicUrl || '';
          this.isPremiumMember = !!profile.isPremiumMember;
          this.username = profile.username || this.username;
          this.calculateProfileCompletion(profile);
        }
      }
    });

    // Posts & Likes from posts
    this.postService.getMyPosts().subscribe({
      next: (posts) => {
        this.totalPosts = posts.length;
        this.recentPosts = posts.slice(-6).reverse();
        
        // Fetch real-time likes for each post to ensure accuracy
        posts.forEach(p => {
          this.likeService.getLikeCount(p.id, 'POST').subscribe(count => {
            this.likesReceived += Number(count) || 0;
            p.likeCount = Number(count) || 0;
          });
        });
        this.updateLatestMedia(posts.map(p => ({ ...p, mediaType: 'IMAGE', thumbnailUrl: p.mediaUrls?.[0] })));
        this.recalculateCompletionIfProfileReady();
      }
    });

    // Reels & Likes from reels
    const email = this.authService.getEmail() || '';
    if (email) {
      this.reelService.getMyReels(email).subscribe({
        next: (reels) => {
          this.totalReels = reels.length;
          
          // Fetch real-time likes for each reel
          reels.forEach(r => {
            this.likeService.getLikeCount(r.id, 'REEL').subscribe(count => {
              this.likesReceived += Number(count) || 0;
              r.likesCount = Number(count) || 0;
            });
          });
          this.updateLatestMedia(reels.map(r => ({ ...r, mediaType: 'VIDEO', thumbnailUrl: r.mediaUrl })));
          this.recalculateCompletionIfProfileReady();
        }
      });

      // Stories
      this.storyService.getUserStories(email).subscribe({
        next: (stories) => {
          this.totalStories = stories.length;
          
          // Stories can also have likes/reactions
          stories.forEach(s => {
            this.likeService.getLikeCount(s.id, 'STORY').subscribe(count => {
              this.likesReceived += Number(count) || 0;
              (s as any).likesCount = Number(count) || 0;
            });
          });
          this.updateLatestMedia(stories.map(s => ({ ...s, thumbnailUrl: s.mediaUrl })));
          this.recalculateCompletionIfProfileReady();
        }
      });
    }

    // Followers
    this.followService.getFollowerCount().subscribe({
      next: (count) => {
        this.followerCount = count;
        this.recalculateCompletionIfProfileReady();
      }
    });

    // Following
    this.followService.getFollowingCount().subscribe({
      next: (count) => this.followingCount = count
    });

    // Payments
    this.paymentService.getMyPayments().subscribe({
      next: (payments) => this.totalPayments = payments.length
    });

    // Notifications -> Activities
    this.notificationService.getNotifications({ size: 10 }).subscribe({
      next: (page) => {
        this.activities = page.notifications.map(n => ({
          type: n.type,
          icon: this.getNotificationIcon(n.type),
          iconClass: this.getNotificationClass(n.type),
          text: this.decodeNotificationText(n.message),
          time: this.timeAgo(n.createdAt),
          actionUrl: this.buildActionUrl(n),
          thumbnailUrl: this.getThumbnailUrl(n),
          isRead: n.isRead
        }));
      }
    });

    // Trends
    this.searchService.getTrending(1).subscribe({
      next: (trends) => {
        if (trends && trends.length > 0) {
          this.trendingHashtag = trends[0].tag || trends[0][0] || trends[0];
        }
      }
    });

    // Suggested
    this.followService.getSuggestedUsers().subscribe({
      next: (users) => {
        this.suggestedUsers = (users || []).slice(0, 3).map(email => ({
          email,
          username: email.split('@')[0]
        }));
      }
    });
  }

  private updateLatestMedia(newItems: any[]): void {
    const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);
    
    const combined = [...this.latestMedia, ...newItems]
      .filter((v, i, a) => a.findIndex(t => (t.id === v.id && t.mediaType === v.mediaType)) === i)
      // Only show items uploaded within the last 24 hours
      .filter(item => new Date(item.createdAt).getTime() > twentyFourHoursAgo)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    
    this.latestMedia = combined.slice(0, 10);
  }

  private lastProfile: UserProfileState | null = null;
  private recalculateCompletionIfProfileReady(): void {
    if (this.lastProfile) {
      this.calculateProfileCompletion(this.lastProfile);
    }
  }

  calculateProfileCompletion(profile: UserProfileState): void {
    this.lastProfile = profile;
    let score = 0;
    const totalSteps = 5;
    
    // Step 1: Basic Info
    if (profile.email || profile.username) score += 1;
    // Step 2: Full Name
    if (profile.fullName && profile.fullName.trim().length > 0) score += 1;
    // Step 3: Bio
    if (profile.bio && profile.bio.trim().length > 0) score += 1;
    // Step 4: Profile Picture
    if (profile.profilePicUrl && profile.profilePicUrl.trim().length > 0) score += 1;
    // Step 5: Activity or Verification
    const hasActivity = (this.totalPosts || 0) > 0 || (this.totalReels || 0) > 0 || (this.totalStories || 0) > 0 || (this.followerCount || 0) > 0;
    if (hasActivity || profile.isVerified) score += 1;
    
    this.profileCompletion = Math.round((score / totalSteps) * 100);
  }

  ngOnDestroy(): void {
    this.unreadSub?.unsubscribe?.();
  }

  canAccessAdminPanel(): boolean {
    return this.authService.canAccessAdminPanel();
  }

  isModeratorOnly(): boolean {
    return this.authService.isModerator() && !this.authService.isAdmin();
  }

  getGreeting(): string {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 17) return 'Good Afternoon';
    return 'Good Evening';
  }

  timeAgo(dateStr: string): string {
    if (!dateStr) return '';
    const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
  }

  private getNotificationIcon(type: string): string {
    if (type.includes('like')) return '❤️';
    if (type.includes('comment')) return '💬';
    if (type.includes('follow')) return '👤';
    if (type.includes('mention')) return '@';
    if (type.includes('premium')) return '💎';
    return '🔔';
  }

  private getNotificationClass(type: string): string {
    if (type.includes('like')) return 'like-bg';
    if (type.includes('comment')) return 'comment-bg';
    if (type.includes('follow')) return 'follow-bg';
    return 'default-bg';
  }

  decodeNotificationText(value: string): string {
    const source = (value || '').trim();
    if (!source) return '';
    try { return decodeURIComponent(source); } 
    catch { return source.replace(/%20/g, ' '); }
  }

  buildActionUrl(notification: any): string {
    const metadata = notification.metadata || {};
    const postId = notification.targetPostId || metadata['postId'];
    const reelId = notification.targetReelId || metadata['reelId'];
    if (reelId) return '/reels?reelId=' + reelId;
    if (postId) return '/posts?postId=' + postId;
    if (notification.type.includes('follow')) return '/user/' + notification.senderEmail;
    return '/dashboard';
  }

  getThumbnailUrl(notification: any): string | undefined {
    const metadata = notification.metadata || {};
    return notification.thumbnailUrl || metadata['thumbnailUrl'] || metadata['mediaUrl'];
  }
}
