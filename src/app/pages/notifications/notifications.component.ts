import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, ViewChild, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { catchError, forkJoin, of, Subscription } from 'rxjs';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  Notification,
  NotificationService,
  NotificationSettings
} from '../../services/notification.service';
import { FollowService } from '../../services/follow.service';
import { LikeService } from '../../services/like.service';

type NotificationTabKey =
  | 'all'
  | 'likes'
  | 'comments'
  | 'follows'
  | 'mentions'
  | 'stories'
  | 'verifiedPremium'
  | 'requests';

interface SenderProfile {
  username: string;
  fullName: string;
  profilePicUrl: string;
}

@Component({
  selector: 'app-notifications',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './notifications.component.html',
  styleUrl: './notifications.component.scss'
})
export class NotificationsComponent implements OnInit, AfterViewInit, OnDestroy {
  private readonly AUTH_API = '/auth';
  private readonly previewPlaceholder =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 88">
        <defs>
          <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stop-color="#e2e8f0"/>
            <stop offset="100%" stop-color="#cbd5e1"/>
          </linearGradient>
        </defs>
        <rect width="88" height="88" rx="12" fill="url(#g)"/>
        <circle cx="31" cy="32" r="9" fill="#94a3b8"/>
        <path d="M16 66l18-18 11 11 12-14 15 21H16z" fill="#64748b"/>
      </svg>`
    );
  private readonly generatedPosterCache = new Map<string, Promise<string>>();
  private readonly posterUrlByKey: Record<string, string> = {};
  private readonly videoExtensions = ['.mp4', '.webm', '.mov', '.m4v', '.ogg'];

  @ViewChild('loadMoreAnchor') loadMoreAnchor?: ElementRef<HTMLDivElement>;

  notifications: Notification[] = [];
  unreadCount = 0;
  activeFilter: NotificationTabKey = 'all';

  loading = false;
  loadingMore = false;
  hasMore = true;
  private page = 0;
  private readonly pageSize = 20;

  senderProfiles: Record<string, SenderProfile> = {};
  followStates: Record<string, boolean> = {};
  followBusy: Record<string, boolean> = {};
  requestBusy: Record<number, boolean> = {};
  likeReplyBusy: Record<number, boolean> = {};

  showSettingsPanel = false;
  settingsSaving = false;
  settings: NotificationSettings = { ...DEFAULT_NOTIFICATION_SETTINGS };
  mutedTypes = new Set<string>();

  tabs: Array<{ key: NotificationTabKey; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'likes', label: 'Likes' },
    { key: 'comments', label: 'Comments' },
    { key: 'follows', label: 'Follows' },
    { key: 'mentions', label: 'Mentions' },
    { key: 'stories', label: 'Stories' },
    { key: 'verifiedPremium', label: 'Verified/Premium' },
    { key: 'requests', label: 'Requests' }
  ];

  private observer?: IntersectionObserver;
  private readonly subscriptions = new Subscription();

  constructor(
    private notificationService: NotificationService,
    private http: HttpClient,
    private followService: FollowService,
    private likeService: LikeService,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.subscriptions.add(
      this.notificationService.unreadCount$.subscribe((count) => {
        this.unreadCount = Number(count) || 0;
      })
    );

    this.notificationService.refreshUnreadCount();
    this.loadSettings();
    this.resetAndLoadNotifications();
    this.startLiveStream();
  }

  ngAfterViewInit(): void {
    this.setupInfiniteScroll();
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
    this.observer?.disconnect();
  }

  get visibleNotifications(): Notification[] {
    return this.notifications.filter((notification) => {
      if (!this.matchesFilter(notification)) {
        return false;
      }
      return !this.isMuted(notification.type);
    });
  }

  get newNotifications(): any[] {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return this.groupNotifications(this.visibleNotifications.filter(n => new Date(n.createdAt) >= today));
  }

  get olderNotifications(): any[] {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return this.groupNotifications(this.visibleNotifications.filter(n => new Date(n.createdAt) < today));
  }

  private groupNotifications(list: Notification[]): any[] {
    const grouped: any[] = [];
    const likeMap = new Map<string, any>();

    for (const notif of list) {
      if (this.isLikeNotification(notif)) {
        const targetId = notif.targetPostId || notif.targetReelId || notif.targetStoryId || notif.metadata?.['postId'] || notif.metadata?.['reelId'];
        if (targetId) {
          const key = `like-${targetId}`;
          if (likeMap.has(key)) {
            const group = likeMap.get(key);
            group.groupedCount++;
            group.groupedUsers.push(notif.senderUsername || notif.senderEmail.split('@')[0]);
            continue;
          } else {
            const groupNotif = { ...notif, groupedCount: 1, groupedUsers: [notif.senderUsername || notif.senderEmail.split('@')[0]] };
            likeMap.set(key, groupNotif);
            grouped.push(groupNotif);
            continue;
          }
        }
      }
      grouped.push(notif);
    }
    return grouped;
  }


  filterNotifications(tab: NotificationTabKey): void {
    if (this.activeFilter === tab) {
      return;
    }

    this.activeFilter = tab;
    this.resetAndLoadNotifications();
  }

  toggleSettingsPanel(): void {
    this.showSettingsPanel = !this.showSettingsPanel;
  }

  saveSettings(): void {
    if (this.settingsSaving) {
      return;
    }

    this.settingsSaving = true;
    this.settings.mutedTypes = Array.from(this.mutedTypes);

    this.notificationService.updateSettings(this.settings).subscribe({
      next: (updated) => {
        this.settings = { ...updated };
        this.mutedTypes = new Set((updated.mutedTypes || []).map((t) => this.normalizeType(t)));
        this.settingsSaving = false;
        this.showSettingsPanel = false;
      },
      error: () => {
        this.settingsSaving = false;
      }
    });
  }

  markAllRead(): void {
    this.notificationService.markAllRead().subscribe({
      next: () => {
        this.notifications = this.notifications.map((notification) => ({
          ...notification,
          isRead: true
        }));
        this.unreadCount = 0;
        this.notificationService.pushUnreadCount(0);
      }
    });
  }

  markAsRead(notification: Notification, event?: Event): void {
    event?.stopPropagation();

    if (notification.isRead) {
      return;
    }

    notification.isRead = true;
    this.unreadCount = Math.max(0, this.unreadCount - 1);
    this.notificationService.pushUnreadCount(this.unreadCount);

    this.notificationService.markAsRead(notification.id).subscribe({
      error: () => {
        notification.isRead = false;
        this.unreadCount += 1;
        this.notificationService.pushUnreadCount(this.unreadCount);
      }
    });
  }

  openNotification(notification: Notification): void {
    this.markAsRead(notification);

    if (notification.actionUrl) {
      void this.router.navigateByUrl(notification.actionUrl);
      return;
    }

    const postId    = this.getPostId(notification);
    const commentId = this.getCommentId(notification);
    const reelId    = this.getReelId(notification);

    // MENTION HANDLING: If it's a mention, check metadata for destination
    if (this.isMentionNotification(notification)) {
      const mentionTarget = notification.metadata?.['targetType'];
      if (mentionTarget === 'REEL' && reelId) {
        void this.router.navigate(['/reels'], { queryParams: { reelId, notif: notification.id } });
        return;
      }
      if (mentionTarget === 'POST' && postId) {
        void this.router.navigate(['/posts'], { queryParams: { postId, notif: notification.id } });
        return;
      }
    }

    // Navigate to the reel that was liked/commented on
    if (reelId) {
      void this.router.navigate(['/reels'], {
        queryParams: { reelId, notif: notification.id }
      });
      return;
    }

    if (notification.targetStoryId) {
      void this.router.navigate(['/stories'], {
        queryParams: {
          storyId: notification.targetStoryId,
          notif: notification.id
        }
      });
      return;
    }

    if (postId) {
      void this.router.navigate(['/posts'], {
        queryParams: {
          postId,
          commentId: commentId || null,
          notif: notification.id
        }
      });
      return;
    }

    if (this.canFollowSender(notification)) {
      void this.router.navigate(['/user', notification.senderEmail]);
      return;
    }

    if (this.isPremiumOrVerification(notification)) {
      void this.router.navigate(['/payments']);
      return;
    }

    void this.router.navigate(['/dashboard']);
  }

  deleteNotification(notification: any, event: Event): void {
    event.stopPropagation();
    notification.isDeleting = true;

    setTimeout(() => {
      this.notificationService.deleteNotification(notification.id).subscribe({
        next: () => {
          const wasUnread = !notification.isRead;
          this.notifications = this.notifications.filter((item) => item.id !== notification.id);
          if (wasUnread) {
            this.unreadCount = Math.max(0, this.unreadCount - 1);
            this.notificationService.pushUnreadCount(this.unreadCount);
          }
        }
      });
    }, 300); // Wait for animation
  }

  muteType(notification: Notification, event: Event): void {
    event.stopPropagation();

    const type = this.normalizeType(notification.type);
    if (!type) {
      return;
    }

    this.notificationService.muteType(type).subscribe({
      next: () => {
        this.mutedTypes.add(type);
        this.settings.mutedTypes = Array.from(this.mutedTypes);
      }
    });
  }

  unmute(type: string): void {
    const normalized = this.normalizeType(type);
    if (!normalized) {
      return;
    }

    this.notificationService.unmuteType(normalized).subscribe({
      next: () => {
        this.mutedTypes.delete(normalized);
        this.settings.mutedTypes = Array.from(this.mutedTypes);
      }
    });
  }

  followBack(notification: Notification, event: Event): void {
    event.stopPropagation();

    if (!this.canFollowSender(notification)) {
      return;
    }

    const senderEmail = notification.senderEmail;
    if (this.followStates[senderEmail] || this.followBusy[senderEmail]) {
      return;
    }

    this.followBusy = { ...this.followBusy, [senderEmail]: true };

    this.followService.follow(senderEmail).subscribe({
      next: () => {
        this.followStates = { ...this.followStates, [senderEmail]: true };
        this.followBusy = { ...this.followBusy, [senderEmail]: false };
        window.dispatchEvent(new Event('connectsphere-follow-changed'));
      },
      error: () => {
        this.followBusy = { ...this.followBusy, [senderEmail]: false };
      }
    });
  }

  acceptFollowRequest(notification: Notification, event: Event): void {
    event.stopPropagation();

    if (this.requestBusy[notification.id]) {
      return;
    }

    this.requestBusy = { ...this.requestBusy, [notification.id]: true };
    this.notificationService.acceptFollowRequest(notification.id, notification.senderEmail).subscribe({
      next: () => {
        this.requestBusy = { ...this.requestBusy, [notification.id]: false };
        this.markAsRead(notification);
        this.followStates = { ...this.followStates, [notification.senderEmail]: true };
        notification.requestStatus = 'ACCEPTED';
      },
      error: () => {
        this.requestBusy = { ...this.requestBusy, [notification.id]: false };
      }
    });
  }

  declineFollowRequest(notification: Notification, event: Event): void {
    event.stopPropagation();

    if (this.requestBusy[notification.id]) {
      return;
    }

    this.requestBusy = { ...this.requestBusy, [notification.id]: true };
    this.notificationService.declineFollowRequest(notification.id, notification.senderEmail).subscribe({
      next: () => {
        this.requestBusy = { ...this.requestBusy, [notification.id]: false };
        this.markAsRead(notification);
        notification.requestStatus = 'DECLINED';
      },
      error: () => {
        this.requestBusy = { ...this.requestBusy, [notification.id]: false };
      }
    });
  }

  likeReply(notification: Notification, event: Event): void {
    event.stopPropagation();

    const commentId = this.getCommentId(notification);
    if (!commentId || this.likeReplyBusy[notification.id]) {
      return;
    }

    this.likeReplyBusy = { ...this.likeReplyBusy, [notification.id]: true };
    this.likeService.likeTarget(commentId, 'COMMENT', 'LIKE').subscribe({
      next: () => {
        this.likeReplyBusy = { ...this.likeReplyBusy, [notification.id]: false };
      },
      error: () => {
        this.likeReplyBusy = { ...this.likeReplyBusy, [notification.id]: false };
      }
    });
  }

  isLikeNotification(notification: Notification): boolean {
    const type = this.normalizeType(notification.type);
    return type.includes('like') || type.includes('reaction') || type.includes('love') || type.includes('heart');
  }

  isCommentNotification(notification: Notification): boolean {
    const type = this.normalizeType(notification.type);
    return type.includes('comment') || type.includes('reply');
  }

  isMentionNotification(notification: Notification): boolean {
    const type = this.normalizeType(notification.type);
    return type.includes('mention') || type.includes('tag');
  }

  replyBack(notification: Notification, event: Event): void {
    event.stopPropagation();

    const postId = this.getPostId(notification);
    const commentId = this.getCommentId(notification);

    void this.router.navigate(['/posts'], {
      queryParams: {
        postId: postId || null,
        replyTo: commentId || null,
        notif: notification.id
      }
    });
  }

  isFollowNotification(notification: Notification): boolean {
    const type = this.normalizeType(notification.type);
    return type.includes('follow') && !type.includes('request');
  }

  isFollowRequest(notification: Notification): boolean {
    const type = this.normalizeType(notification.type);
    return type.includes('request') || (type.includes('follow') && (notification.requestStatus || '').toUpperCase() === 'PENDING');
  }

  canFollowSender(notification: Notification): boolean {
    return this.isRealUserEmail(notification.senderEmail);
  }

  showCommentQuickActions(notification: Notification): boolean {
    const type = this.normalizeType(notification.type);
    return type.includes('comment') || type.includes('reply');
  }

  showThumbnail(notification: Notification): boolean {
    return this.shouldShowMediaPreview(notification) && !!this.getPreviewImageUrl(notification);
  }

  isVideoPreview(notification: Notification): boolean {
    return this.shouldShowMediaPreview(notification) && this.isVideoNotification(notification);
  }

  getPreviewImageUrl(notification: Notification): string {
    if (!this.shouldShowMediaPreview(notification)) {
      return '';
    }

    const key = this.getPosterCacheKey(notification);
    const directThumbnail = this.getThumbnailUrl(notification);

    if (directThumbnail && !this.isLikelyVideoAsset(directThumbnail)) {
      return directThumbnail;
    }

    const cachedPoster = this.posterUrlByKey[key];
    if (cachedPoster) {
      return cachedPoster;
    }

    if (this.isVideoNotification(notification)) {
      const videoSource = directThumbnail || this.getMediaSourceUrl(notification);
      if (videoSource) {
        this.ensurePosterGenerated(notification, videoSource);
      }
      return this.previewPlaceholder;
    }

    return directThumbnail || this.getMediaSourceUrl(notification) || this.previewPlaceholder;
  }

  getVideoSourceUrl(notification: Notification): string {
    const direct = this.getThumbnailUrl(notification);
    const media = direct && this.isLikelyVideoAsset(direct) ? direct : this.getMediaSourceUrl(notification);
    return media ? media + '#t=1.5' : '';
  }

  getThumbnailUrl(notification: Notification): string {
    const direct = notification.thumbnailUrl || '';
    if (direct) {
      return direct;
    }

    const metadata = notification.metadata || {};
    const fallback =
      metadata['thumbnailUrl'] ||
      metadata['previewUrl'] ||
      metadata['postThumbnailUrl'] ||
      metadata['mediaUrl'] ||
      '';

    return typeof fallback === 'string' ? fallback : '';
  }

  getSenderName(notification: Notification): string {
    const sender = this.senderProfiles[notification.senderEmail];
    if (sender) {
      return sender.fullName || sender.username || notification.senderEmail.split('@')[0];
    }

    return (
      notification.senderFullName ||
      notification.senderUsername ||
      (this.isRealUserEmail(notification.senderEmail) ? notification.senderEmail.split('@')[0] : 'ConnectSphere')
    );
  }

  getSenderHandle(notification: Notification): string {
    if (!this.isRealUserEmail(notification.senderEmail)) {
      return '@connectsphere';
    }

    const sender = this.senderProfiles[notification.senderEmail];
    const handle = sender?.username || notification.senderUsername || notification.senderEmail.split('@')[0];
    return `@${handle}`;
  }

  getSenderAvatarUrl(notification: Notification): string {
    return (
      this.senderProfiles[notification.senderEmail]?.profilePicUrl ||
      notification.senderProfilePicUrl ||
      ''
    );
  }

  getSenderInitial(notification: Notification): string {
    const source = this.getSenderName(notification);
    return source.charAt(0).toUpperCase();
  }

  getNotificationMessage(notification: any): string {
    if (notification.groupedCount > 1) {
      return `and ${notification.groupedCount - 1} others liked your post`;
    }

    const fallbackMessage = this.getFallbackMessage(notification.type);
    let message = this.decodeNotificationText(notification.message || fallbackMessage).trim();

    if (!message) {
      return fallbackMessage;
    }

    const senderName = this.getSenderName(notification).toLowerCase();
    const lower = message.toLowerCase();
    if (lower.startsWith(senderName)) {
      message = message.slice(senderName.length).trim();
    }

    return message || fallbackMessage;
  }

  getNotificationTime(notification: Notification): string {
    const timestamp = notification.createdAt;
    if (!timestamp) {
      return 'now';
    }

    const diffSeconds = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000);
    if (diffSeconds < 60) return `${Math.max(1, diffSeconds)}s`;
    if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m`;
    if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h`;
    if (diffSeconds < 604800) return `${Math.floor(diffSeconds / 86400)}d`;
    return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  getTypeLabel(type: string): string {
    const normalized = this.normalizeType(type);

    if (normalized.includes('follow') && normalized.includes('request')) return 'Request';
    if (normalized.includes('follow')) return 'Follow';
    if (normalized.includes('comment') || normalized.includes('reply')) return 'Comment';
    if (normalized.includes('mention') || normalized.includes('tag')) return 'Mention';
    if (normalized.includes('story')) return 'Story';
    if (normalized.includes('premium')) return 'Premium';
    if (normalized.includes('verify')) return 'Verified';
    if (normalized.includes('announce') || normalized.includes('system')) return 'System';
    if (normalized.includes('like') || normalized.includes('reaction')) return 'Like';
    return 'Update';
  }

  isMuted(type: string): boolean {
    return this.mutedTypes.has(this.normalizeType(type));
  }

  private resetAndLoadNotifications(): void {
    this.page = 0;
    this.hasMore = true;
    this.notifications = [];
    this.loadNotifications();
  }

  private loadNotifications(): void {
    if (!this.hasMore || this.loading || this.loadingMore) {
      return;
    }

    if (this.page === 0) {
      this.loading = true;
    } else {
      this.loadingMore = true;
    }

    const requestedPage = this.page;
    this.notificationService.getNotifications({
      page: requestedPage,
      size: this.pageSize,
      tab: this.activeFilter === 'all' ? undefined : this.activeFilter
    }).subscribe({
      next: (result) => {
        const rows = Array.isArray(result.notifications) ? result.notifications : [];

        this.notifications = requestedPage === 0
          ? rows
          : this.mergeById(this.notifications, rows);

        this.hasMore = !!result.hasMore;
        this.page = requestedPage + 1;
        this.loading = false;
        this.loadingMore = false;

        if (typeof result.unreadCount === 'number' && !Number.isNaN(result.unreadCount)) {
          this.unreadCount = result.unreadCount;
          this.notificationService.pushUnreadCount(result.unreadCount);
        }

        this.loadSenderProfiles(rows);
        this.loadFollowStates(rows);
        this.primePreviewThumbnails(rows);
      },
      error: () => {
        this.loading = false;
        this.loadingMore = false;
        this.hasMore = false;
      }
    });
  }

  private setupInfiniteScroll(): void {
    if (!this.loadMoreAnchor?.nativeElement || typeof IntersectionObserver === 'undefined') {
      return;
    }

    this.observer?.disconnect();
    this.observer = new IntersectionObserver((entries) => {
      const [entry] = entries;
      if (entry?.isIntersecting) {
        this.loadNotifications();
      }
    }, { rootMargin: '200px 0px 200px 0px' });

    this.observer.observe(this.loadMoreAnchor.nativeElement);
  }

  private startLiveStream(): void {
    this.subscriptions.add(
      this.notificationService.streamNotifications().subscribe({
        next: (notification) => {
          if (!notification?.id) {
            return;
          }
 
          const exists = this.notifications.some((item) => item.id === notification.id);
          if (!exists) {
            this.notifications = [notification, ...this.notifications];
          }

          if (!notification.isRead) {
            this.unreadCount += 1;
            this.notificationService.pushUnreadCount(this.unreadCount);
          }

          this.loadSenderProfiles([notification]);
          this.loadFollowStates([notification]);
          this.primePreviewThumbnails([notification]);
        }
      })
    );
  }

  private loadSettings(): void {
    this.notificationService.getSettings().subscribe({
      next: (settings) => {
        this.settings = { ...settings };
        this.mutedTypes = new Set((settings.mutedTypes || []).map((t) => this.normalizeType(t)));
      }
    });
  }

  private loadSenderProfiles(sourceNotifications: Notification[]): void {
    const senderEmails = [...new Set(
      sourceNotifications
        .map((notification) => notification.senderEmail)
        .filter((email) => this.isRealUserEmail(email) && !this.senderProfiles[email])
    )];

    if (senderEmails.length === 0) {
      return;
    }

    const requests = senderEmails.map((email) =>
      this.http.get<any>(`${this.AUTH_API}/user/${encodeURIComponent(email)}`).pipe(
        catchError(() => of(null))
      )
    );

    this.subscriptions.add(
      forkJoin(requests).subscribe((profiles) => {
        const nextProfiles = { ...this.senderProfiles };
        senderEmails.forEach((email, index) => {
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

        this.senderProfiles = nextProfiles;
      })
    );
  }

  private loadFollowStates(sourceNotifications: Notification[]): void {
    const senderEmails = [...new Set(
      sourceNotifications
        .filter((notification) => this.isFollowNotification(notification) && this.canFollowSender(notification))
        .map((notification) => notification.senderEmail)
        .filter((email) => this.followStates[email] === undefined)
    )];

    if (senderEmails.length === 0) {
      return;
    }

    const requests = senderEmails.map((email) =>
      this.followService.isFollowing(email).pipe(
        catchError(() => of(false))
      )
    );

    this.subscriptions.add(
      forkJoin(requests).subscribe((statuses) => {
        const nextStates = { ...this.followStates };
        senderEmails.forEach((email, index) => {
          nextStates[email] = statuses[index];
        });
        this.followStates = nextStates;
      })
    );
  }

  private mergeById(current: Notification[], incoming: Notification[]): Notification[] {
    const mapById = new Map<number, Notification>();
    current.forEach((item) => mapById.set(item.id, item));
    incoming.forEach((item) => mapById.set(item.id, item));
    return Array.from(mapById.values()).sort((a, b) => {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }

  private matchesFilter(notification: Notification): boolean {
    if (this.activeFilter === 'all') {
      return true;
    }

    const type = this.normalizeType(notification.type);

    if (this.activeFilter === 'likes') {
      return type.includes('like') || type.includes('reaction');
    }

    if (this.activeFilter === 'comments') {
      return type.includes('comment') || type.includes('reply');
    }

    if (this.activeFilter === 'follows') {
      return type.includes('follow') && !type.includes('request');
    }

    if (this.activeFilter === 'mentions') {
      return type.includes('mention') || type.includes('tag');
    }

    if (this.activeFilter === 'stories') {
      return type.includes('story');
    }

    if (this.activeFilter === 'verifiedPremium') {
      return type.includes('verify') || type.includes('premium') || type.includes('subscription');
    }

    if (this.activeFilter === 'requests') {
      return type.includes('request');
    }

    return true;
  }

  private getFallbackMessage(type: string): string {
    const normalized = this.normalizeType(type);

    if (normalized.includes('follow') && normalized.includes('request')) return 'requested to join your circle';
    if (normalized.includes('follow')) return 'started following your journey';
    if (normalized.includes('comment') && normalized.includes('reply')) return 'replied to your thoughts';
    if (normalized.includes('comment')) return 'shared a thought on your post';
    if (normalized.includes('mention') || normalized.includes('tag')) return 'mentioned you in a moment';
    if (normalized.includes('story')) return 'loved the story you shared';
    if (normalized.includes('verify')) return 'your account verification is now active';
    if (normalized.includes('premium') || normalized.includes('subscription')) return 'your premium experience is ready';
    if (normalized.includes('announce') || normalized.includes('system')) return 'posted a new community update';
    return 'liked the moment you shared';
  }

  private getPostId(notification: Notification): number | undefined {
    return notification.targetPostId || this.pickMetaNumber(notification, 'postId');
  }

  private getCommentId(notification: Notification): number | undefined {
    return notification.targetCommentId || this.pickMetaNumber(notification, 'commentId');
  }

  private getReelId(notification: Notification): number | undefined {
    return notification.targetReelId || this.pickMetaNumber(notification, 'reelId');
  }

  private pickMetaNumber(notification: Notification, key: string): number | undefined {
    const raw = notification.metadata?.[key];
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    if (typeof raw === 'string' && raw.trim() && !Number.isNaN(Number(raw))) return Number(raw);
    return undefined;
  }

  private isPremiumOrVerification(notification: Notification): boolean {
    const type = this.normalizeType(notification.type);
    return type.includes('premium') || type.includes('subscription') || type.includes('verify');
  }

  private isRealUserEmail(email: string): boolean {
    return !!email && email.includes('@') && email.toUpperCase() !== 'SYSTEM';
  }

  private normalizeType(type: string): string {
    return (type || '')
      .toLowerCase()
      .replace(/[\s-]+/g, '_')
      .trim();
  }

  private primePreviewThumbnails(sourceNotifications: Notification[]): void {
    sourceNotifications.forEach((notification) => {
      if (!this.isVideoNotification(notification)) {
        return;
      }
      const sourceUrl = this.getThumbnailUrl(notification) || this.getMediaSourceUrl(notification);
      if (!sourceUrl) {
        return;
      }
      this.ensurePosterGenerated(notification, sourceUrl);
    });
  }

  private getMediaSourceUrl(notification: Notification): string {
    const metadata = notification.metadata || {};
    const source =
      metadata['mediaUrl'] ||
      metadata['videoUrl'] ||
      metadata['reelMediaUrl'] ||
      metadata['postMediaUrl'] ||
      '';

    return typeof source === 'string' ? source : '';
  }

  private isVideoNotification(notification: Notification): boolean {
    const type = this.normalizeType(notification.type);
    if (type.includes('reel') || type.includes('video')) {
      return true;
    }

    const thumbnailUrl = this.getThumbnailUrl(notification);
    const mediaUrl = this.getMediaSourceUrl(notification);
    return this.isLikelyVideoAsset(thumbnailUrl) || this.isLikelyVideoAsset(mediaUrl);
  }

  private shouldShowMediaPreview(notification: Notification): boolean {
    if (!this.hasMediaTarget(notification)) {
      return false;
    }

    return !!(this.getThumbnailUrl(notification) || this.getMediaSourceUrl(notification) || this.isVideoNotification(notification));
  }

  private hasMediaTarget(notification: Notification): boolean {
    const actionUrl = (notification.actionUrl || '').toLowerCase();
    if (notification.targetStoryId || notification.targetReelId || notification.targetPostId) {
      return true;
    }

    return actionUrl.includes('/stories') || actionUrl.includes('/reels') || actionUrl.includes('/posts');
  }

  private isLikelyVideoAsset(url: string): boolean {
    const normalized = (url || '').trim().toLowerCase().split('?')[0];
    return this.videoExtensions.some((extension) => normalized.endsWith(extension));
  }

  private getPosterCacheKey(notification: Notification): string {
    return `${notification.id}:${this.getThumbnailUrl(notification)}:${this.getMediaSourceUrl(notification)}`;
  }

  private ensurePosterGenerated(notification: Notification, sourceUrl: string): void {
    const key = this.getPosterCacheKey(notification);
    if (this.posterUrlByKey[key] || this.generatedPosterCache.has(key)) {
      return;
    }

    const posterTask = this.generatePosterFromVideo(sourceUrl)
      .then((posterUrl) => {
        this.posterUrlByKey[key] = posterUrl;
        this.cdr.detectChanges();
        return posterUrl;
      })
      .catch(() => {
        this.cdr.detectChanges();
        return this.previewPlaceholder;
      });

    this.generatedPosterCache.set(key, posterTask);
    void posterTask.finally(() => {
      this.generatedPosterCache.delete(key);
    });
  }

  private generatePosterFromVideo(sourceUrl: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;
      video.crossOrigin = 'anonymous';

      const cleanup = () => {
        video.pause();
        video.removeAttribute('src');
        video.load();
      };

      const captureFrame = () => {
        try {
          const width = video.videoWidth || 160;
          const height = video.videoHeight || 160;
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext('2d');
          if (!context) {
            cleanup();
            reject(new Error('Canvas unavailable'));
            return;
          }

          context.drawImage(video, 0, 0, width, height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
          cleanup();
          resolve(dataUrl);
        } catch (error) {
          cleanup();
          reject(error);
        }
      };

      video.addEventListener('loadeddata', () => {
        if (video.readyState >= 2) {
          const validDuration = Number.isFinite(video.duration) && video.duration > 0;
          const seekTarget = validDuration ? Math.min(video.duration * 0.25, 1.5) : 0.5;
          
          if (seekTarget > 0) {
            video.currentTime = seekTarget;
            return;
          }
          captureFrame();
        }
      }, { once: true });

      video.addEventListener('seeked', captureFrame, { once: true });
      video.addEventListener('error', () => {
        cleanup();
        reject(new Error('Video load failed'));
      }, { once: true });

      video.src = sourceUrl;
      video.load();
    });
  }

  private decodeNotificationText(value: string): string {
    const source = (value || '').trim();
    if (!source) {
      return '';
    }

    try {
      return decodeURIComponent(source);
    } catch {
      return source.replace(/%20/g, ' ');
    }
  }
}
