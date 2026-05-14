import { Component, OnInit, OnDestroy, ViewChildren, QueryList, ElementRef, AfterViewInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { HttpErrorResponse, HttpEventType } from '@angular/common/http';
import { ReelService, Reel, ReelCommentPayload } from '../../services/reel.service';
import { LikeService } from '../../services/like.service';
import { FollowService } from '../../services/follow.service';
import { AuthService } from '../../services/auth.service';
import { UserProfileStateService } from '../../services/user-profile-state.service';

/**
 * ReelsComponent handles the immersive, full-screen vertical video feed (Instagram-style Reels).
 * 
 * <p>Key Responsibilities:
 * <ul>
 *     <li>Infinite Scrolling: Automatically fetches and appends/prepends reels to the feed.</li>
 *     <li>Video Management: Uses IntersectionObserver to play/pause videos based on visibility.</li>
 *     <li>Engagement: Handles likes, follows, comments, and sharing for each reel.</li>
 *     <li>Adaptive Fallbacks: Automatically detects media playback failures and swaps in working fallbacks.</li>
 *     <li>Dynamic Feed Mutation: Trims the DOM periodically to maintain performance during long sessions.</li>
 * </ul>
 */
@Component({
  selector: 'app-reels',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './reels.component.html',
  styleUrl: './reels.component.scss'
})
export class ReelsComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChildren('videoElement') videoElements!: QueryList<ElementRef<HTMLVideoElement>>;
  @ViewChildren('reelContainer') reelContainers!: QueryList<ElementRef<HTMLElement>>;
  @ViewChild('feedContainer') feedContainer?: ElementRef<HTMLElement>;

  reels: Reel[] = [];
  currentIndex = 0;
  isMuted = true;
  liked: Set<number> = new Set();
  saved: Set<number> = new Set();
  showComments = false;
  showSharePanel = false;
  commentText = '';
  readonly quickCommentEmojis = ['😀', '😂', '😍', '🔥', '👏', '🎉', '❤️'];
  reelComments: { [reelId: number]: ReelComment[] } = {};

  followedUsers: Set<string> = new Set();
  myEmail = '';
  myRole = '';

  isLoading: { [index: number]: boolean } = {};
  private selectedReelId: number | null = null;
  private hasAppliedSelectedReel = false;
  private readonly reelUsernames: Record<string, string> = {};
  private sourceReelPool: Reel[] = [];
  private isMutatingFeed = false;
  private generatedIdSeed = Date.now();
  private rotationPool: Reel[] = [];
  private playbackWatchdogs: Record<number, ReturnType<typeof setTimeout>> = {};
  private failedMediaUrls: Set<string> = new Set();
  private failedReelIds: Set<number> = new Set();
  successMessage = '';

  getMediaUrl(url: string): string {
    const raw = (url || '').trim();
    if (!raw) return '';
    if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('blob:')) {
      return raw;
    }
    if (raw.startsWith('/uploads/reels/')) {
      // Reels media is served by post-service.
      return raw;
    }
    if (raw.startsWith('/uploads/')) {
      return raw;
    }
    if (raw.startsWith('/')) {
      return raw;
    }
    return `/${raw}`;
  }

  hasPlayableMedia(reel: Reel): boolean {
    if (this.failedReelIds.has(reel.id)) return false;
    const resolved = this.getReelMediaSrc(reel);
    return !!resolved;
  }

  isMediaFailed(reel: Reel): boolean {
    const src = this.getReelMediaSrc(reel);
    return !!src && this.failedMediaUrls.has(src);
  }

  getReelMediaSrc(reel: Reel): string {
    return this.getMediaUrl((reel as any)?.mediaUrl || (reel as any)?.videoUrl || '');
  }

  onLoadStart(index: number) {
    this.isLoading[index] = true;
  }

  onCanPlay(index: number) {
    this.isLoading[index] = false;
    const reel = this.reels[index];
    if (reel) {
      this.failedReelIds.delete(reel.id);
      this.failedMediaUrls.delete(this.getReelMediaSrc(reel));
    }
  }

  onVideoLoaded(index: number, videoElement: HTMLVideoElement) {
    if (this.playbackWatchdogs[index]) {
      clearTimeout(this.playbackWatchdogs[index]);
    }
    // Some mobile browsers need a little more time before first frame paints.
    // Avoid forcing source replacement too early.
    this.playbackWatchdogs[index] = setTimeout(() => {
      if (videoElement.error) {
        this.handleVideoError(index, videoElement);
      }
    }, 10000);
  }

  onVideoProgress(index: number) {
    if (this.playbackWatchdogs[index]) {
      clearTimeout(this.playbackWatchdogs[index]);
      delete this.playbackWatchdogs[index];
    }
  }

  handleVideoError(index: number, videoElement: HTMLVideoElement) {
    this.isLoading[index] = false;
    if (this.playbackWatchdogs[index]) {
      clearTimeout(this.playbackWatchdogs[index]);
      delete this.playbackWatchdogs[index];
    }

    const reel = this.reels[index];
    if (!reel) return;

    const originalSrc = this.getReelMediaSrc(reel);
    if (!originalSrc) return;

    // One soft retry with cache-busting for transient media fetch errors.
    if (!videoElement.getAttribute('data-retry-applied')) {
      videoElement.setAttribute('data-retry-applied', 'true');
      const retrySrc = originalSrc.includes('?') ? `${originalSrc}&retry=${Date.now()}` : `${originalSrc}?retry=${Date.now()}`;
      videoElement.src = retrySrc;
      videoElement.load();
      return;
    }

    // Keep original source, mark as failed for UI message.
    this.failedReelIds.add(reel.id);
    this.failedMediaUrls.add(originalSrc);
    this.rotationPool = this.rotationPool.filter((r) => r.id !== reel.id);
    this.sourceReelPool = this.sourceReelPool.filter((r) => r.id !== reel.id);
    this.moveToNextReel(index);
  }

  private observer!: IntersectionObserver;

  constructor(
    private reelService: ReelService,
    private likeService: LikeService,
    private followService: FollowService,
    private authService: AuthService,
    private route: ActivatedRoute,
    private userProfileStateService: UserProfileStateService
  ) {
    this.myEmail = this.authService.getEmail() || '';
    this.myRole = this.authService.getRole() || 'USER';
  }

  ngOnInit(): void {
    this.route.queryParamMap.subscribe((params) => {
      const reelIdParam = params.get('reelId');
      const parsed = reelIdParam ? Number(reelIdParam) : NaN;
      this.selectedReelId = Number.isFinite(parsed) ? parsed : null;
      this.hasAppliedSelectedReel = false;
      this.tryFocusSelectedReel();
    });

    this.reels = [];
    this.loadReelsData();
  }

  showUploadModal = false;
  selectedFile: File | null = null;
  videoPreviewUrl: string | null = null;
  uploadCaption = '';
  uploadVisibility = 'PUBLIC';
  isUploading = false;
  uploadProgress = 0;

  openUploadModal() {
    if (!this.myEmail) {
      alert('Please log in to upload a reel.');
      return;
    }
    this.showUploadModal = true;
    this.selectedFile = null;
    this.videoPreviewUrl = null;
    this.uploadCaption = '';
    this.uploadVisibility = 'PUBLIC';
    this.uploadProgress = 0;
  }

  closeUploadModal() {
    this.showUploadModal = false;
  }

  onFileSelected(event: any) {
    const file = event.target.files[0];
    if (file) {
      if (!file.type.startsWith('video/')) {
        alert('Please select a video file.');
        return;
      }
      this.selectedFile = file;
      this.videoPreviewUrl = URL.createObjectURL(file);
    }
  }

  submitUpload() {
    if (!this.myEmail) {
      alert('Your session has expired. Please log in again.');
      return;
    }

    if (!this.selectedFile) {
      alert('Please select a video file.');
      return;
    }

    this.isUploading = true;
    this.uploadProgress = 0;

    this.reelService.createReel(this.selectedFile, this.uploadCaption, this.uploadVisibility, this.myEmail).subscribe({
      next: (event: any) => {
        if (event.type === HttpEventType.UploadProgress) {
          const total = Number(event.total || 0);
          this.uploadProgress = total > 0 ? Math.round((100 * event.loaded) / total) : 0;
        } else if (event.type === HttpEventType.Response) {
          this.isUploading = false;
          this.closeUploadModal();
          if (event.body) {
            // Add to head of list instantly
            this.reels = [this.normalizeReels([event.body])[0], ...this.reels];
            this.hydrateReelEngagement(event.body);
            // Move view to the new reel instantly
            this.currentIndex = 0;
          }
          this.successMessage = 'Reel live instantly!';
          setTimeout(() => this.successMessage = '', 2000);
        }
      },
      error: (err) => {
        this.isUploading = false;
        console.error('Upload Error:', err);
        const errorMsg = this.extractUploadErrorMessage(err);
        alert(errorMsg);
      }
    });
  }

  private loadReelsData(): void {
    if (!this.myEmail) {
      this.reelService.getFeed('').subscribe({
        next: (feedReels) => {
          const normalizedFeed = this.normalizeReels(feedReels || []);
          this.reels = [...normalizedFeed];
        },
        error: () => {
          this.reels = [];
        }
      });
      return;
    }

    let myReels: Reel[] = [];
    let feedReels: Reel[] = [];
    let gotMyReels = false;
    let gotFeed = false;

    const finalizeList = () => {
      if (!gotMyReels || !gotFeed) return;
      const merged = [...this.normalizeReels(myReels), ...this.normalizeReels(feedReels)];
      const deduped = new Map<number, Reel>();
      merged.forEach((reel) => deduped.set(reel.id, reel));
      this.reels = Array.from(deduped.values());
      this.sourceReelPool = [...this.reels];
      this.reels.forEach((reel) => this.hydrateReelEngagement(reel));
      this.hydrateReelUsernames(this.reels);
      this.tryFocusSelectedReel();
    };

    this.reelService.getMyReels(this.myEmail).subscribe({
      next: (reels) => {
        myReels = reels || [];
        gotMyReels = true;
        finalizeList();
      },
      error: () => {
        gotMyReels = true;
        finalizeList();
      }
    });

    this.reelService.getFeed(this.myEmail).subscribe({
      next: (reels) => {
        feedReels = reels || [];
        gotFeed = true;
        finalizeList();
      },
      error: () => {
        gotFeed = true;
        finalizeList();
      }
    });
  }

  private normalizeReels(reels: Reel[]): Reel[] {
    return reels.map((r) => ({
      ...r,
      mediaUrl: (r as any).mediaUrl || (r as any).videoUrl || '',
      // Preserve backend id for API calls; use a separate clientId for UI duplication.
      clientId: Number((r as any).clientId ?? r.id),
      audioName: (r as any).audioName || 'Original Audio',
      visibility: r.visibility || 'PUBLIC'
    }));
  }

  private extractUploadErrorMessage(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      if (err.status === 401) {
        return 'Session expired or unauthorized. Please log in again and retry.';
      }
      if (err.status === 413) {
        return 'Video is too large. Please upload a smaller file.';
      }
      if (err.status === 0) {
        return 'Upload connection dropped (gateway timeout/proxy issue). Please retry; if it persists, restart API Gateway and frontend.';
      }

      const payload = err.error;
      if (typeof payload === 'string' && payload.trim()) {
        return payload.trim();
      }
      if (payload && typeof payload === 'object') {
        const obj = payload as { message?: string; error?: string };
        if (obj.message && obj.message.trim()) {
          return obj.message.trim();
        }
        if (obj.error && obj.error.trim()) {
          return obj.error.trim();
        }
      }
      return `Upload failed (${err.status}). Please try again.`;
    }

    if (err instanceof Error && err.message) {
      return err.message;
    }

    return 'Upload failed. Please try again.';
  }

  ngAfterViewInit(): void {
    const options = {
      root: null, // use viewport
      rootMargin: '0px',
      threshold: 0.35 // less strict for mobile/embedded layouts
    };

    this.observer = new IntersectionObserver((entries) => {
      const visibleEntries = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio);

      if (!visibleEntries.length) {
        return;
      }

      const activeEntry = visibleEntries[0];
      const activeVideo = activeEntry.target as HTMLVideoElement;
      const activeIndex = Number(activeVideo.getAttribute('data-index'));

      if (!Number.isFinite(activeIndex)) {
        return;
      }

      this.currentIndex = activeIndex;

      // Prevent play/pause race by deciding a single active video first.
      this.videoElements.forEach((el, idx) => {
        const node = el.nativeElement;
        if (idx === activeIndex) {
          this.tryPlayVideo(node);
        } else {
          node.pause();
        }
      });

      this.extendFeedIfNeeded(activeIndex);
    }, options);

    this.videoElements.changes.subscribe(() => {
      this.observeVideos();
      this.tryFocusSelectedReel();
    });
    this.observeVideos();
    this.reelContainers.changes.subscribe(() => {
      this.tryFocusSelectedReel();
    });
    this.tryFocusSelectedReel();
  }

  observeVideos() {
    if (this.observer) {
      this.observer.disconnect();
      this.videoElements.forEach(el => {
        this.observer.observe(el.nativeElement);
      });
    }
  }

  pauseAllVideos() {
    if (this.videoElements) {
      this.videoElements.forEach(el => {
        el.nativeElement.pause();
      });
    }
  }

  ngOnDestroy(): void {
    if (this.observer) this.observer.disconnect();
    Object.values(this.playbackWatchdogs).forEach((timer) => clearTimeout(timer));
    this.playbackWatchdogs = {};
  }

  private tryPlayVideo(video: HTMLVideoElement): void {
    const playAttempt = video.play();
    if (!playAttempt) {
      return;
    }
    playAttempt.catch((error: unknown) => {
      const name = (error as { name?: string })?.name || '';
      // AbortError / NotAllowedError can happen during quick scroll or autoplay policy.
      // Do not treat these as broken media.
      if (name === 'AbortError' || name === 'NotAllowedError') {
        return;
      }
    });
  }

  private extendFeedIfNeeded(index: number): void {
    if (this.isMutatingFeed || !this.reels.length) return;
    if (index >= this.reels.length - 2) {
      this.appendRandomReels(4);
      return;
    }
    if (index <= 1 && this.reels.length > 3) {
      this.prependRandomReels(2);
    }
  }

  private appendRandomReels(count: number): void {
    const batch = this.pickNextReels(count);
    if (!batch.length) return;
    this.isMutatingFeed = true;
    this.reels = [...this.reels, ...batch];
    this.trimFeedIfNeeded();
    setTimeout(() => (this.isMutatingFeed = false), 80);
  }

  private prependRandomReels(count: number): void {
    const batch = this.pickNextReels(count);
    if (!batch.length) return;
    const feedEl = this.feedContainer?.nativeElement;
    const prevScrollTop = feedEl?.scrollTop ?? 0;
    const delta = (feedEl?.clientHeight ?? window.innerHeight) * batch.length;
    this.isMutatingFeed = true;
    this.reels = [...batch, ...this.reels];
    this.currentIndex += batch.length;
    this.trimFeedIfNeeded();
    setTimeout(() => {
      if (feedEl) {
        feedEl.scrollTop = prevScrollTop + delta;
      }
      this.isMutatingFeed = false;
    }, 0);
  }

  private pickNextReels(count: number): Reel[] {
    const liveSourcePool = (this.sourceReelPool.length ? this.sourceReelPool : this.reels)
      .filter((r) => !this.failedReelIds.has(r.id));
    const pool = liveSourcePool.length ? liveSourcePool : this.reels.filter((r) => !this.failedReelIds.has(r.id));
    if (!pool.length) return [];

    if (this.rotationPool.length < count) {
      this.rotationPool = this.shuffleReels([...pool]);
    }

    const result: Reel[] = [];
    for (let i = 0; i < count; i++) {
      if (!this.rotationPool.length) {
        this.rotationPool = this.shuffleReels([...pool]);
      }
      const base = this.rotationPool.shift();
      if (!base) break;
      result.push({
        ...base,
        // Duplicate the reel for an "endless" feed, but keep the real backend id intact.
        // Only `clientId` changes so actions like comment/like keep working.
        clientId: ++this.generatedIdSeed
      });
    }
    return result;
  }

  private shuffleReels(items: Reel[]): Reel[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }

  private trimFeedIfNeeded(): void {
    const maxItems = 60;
    if (this.reels.length <= maxItems) return;
    const drop = this.reels.length - maxItems;
    const removeFromTop = Math.min(drop, Math.max(0, this.currentIndex - 15));
    if (removeFromTop > 0) {
      this.reels = this.reels.slice(removeFromTop);
      this.currentIndex = Math.max(0, this.currentIndex - removeFromTop);
    } else {
      this.reels = this.reels.slice(0, maxItems);
    }
  }

  isVideo(reel: Reel): boolean {
    const mediaUrl = this.getReelMediaSrc(reel).toLowerCase();
    const mediaType = String((reel as any)?.mediaType || '').toUpperCase();
    return mediaType === 'VIDEO' || mediaUrl.includes('.mp4') || mediaUrl.includes('.webm') || mediaUrl.includes('.mov');
  }

  togglePlayPause(video: HTMLVideoElement) {
    if (video.paused) {
      this.pauseAllVideos();
      this.tryPlayVideo(video);
    } else {
      video.pause();
    }
  }

  toggleMute(event: Event) {
    event.stopPropagation();
    this.isMuted = !this.isMuted;
    if (this.videoElements) {
      this.videoElements.forEach(el => {
        el.nativeElement.muted = this.isMuted;
      });
    }
  }

  followUser(email: string): void {
    if (this.isFollowingUser(email) || email === this.myEmail) return;
    this.followService.follow(email).subscribe({
      next: () => { this.followedUsers.add(email); },
      error: () => {}
    });
  }

  unfollowUser(email: string): void {
    this.followService.unfollow(email).subscribe({
      next: () => { this.followedUsers.delete(email); },
      error: () => {}
    });
  }

  isFollowingUser(email: string): boolean {
    return this.followedUsers.has(email);
  }

  isMe(email: string): boolean {
    return email === this.myEmail;
  }

  getReelDisplayName(email: string): string {
    const key = (email || '').toLowerCase();
    return this.reelUsernames[key] || (email || '').split('@')[0];
  }

  getReelInitial(email: string): string {
    return this.getReelDisplayName(email).charAt(0).toUpperCase() || 'U';
  }

  toggleLike(reel: Reel): void {
    if (this.liked.has(reel.id)) {
      this.liked.delete(reel.id);
      reel.likesCount = Math.max(0, (reel.likesCount || 0) - 1);
      this.likeService.unlikeTarget(reel.id, 'REEL').subscribe({
        error: () => {
          this.liked.add(reel.id);
          reel.likesCount = (reel.likesCount || 0) + 1;
        }
      });
    } else {
      this.liked.add(reel.id);
      reel.likesCount = (reel.likesCount || 0) + 1;
      this.likeService.likeTarget(reel.id, 'REEL').subscribe({
        error: () => {
          this.liked.delete(reel.id);
          reel.likesCount = Math.max(0, (reel.likesCount || 0) - 1);
        }
      });
    }
  }

  toggleSave(reel: Reel): void {
    if (this.saved.has(reel.id)) {
      this.saved.delete(reel.id);
    } else {
      this.saved.add(reel.id);
    }
  }

  toggleComments(): void {
    this.showComments = !this.showComments;
    this.showSharePanel = false;
    if (this.showComments) {
      this.loadCommentsForCurrentReel();
    }
  }

  toggleShare(): void {
    this.showSharePanel = !this.showSharePanel;
    this.showComments = false;
  }

  closePanels(): void {
    this.showComments = false;
    this.showSharePanel = false;
  }

  addComment(): void {
    const text = this.commentText.trim();
    if (!text) return;
    const currentReel = this.reels[this.currentIndex];
    if (!currentReel) return;

    // Optimistic Update
    const tempComment: ReelComment = {
      id: -Date.now(),
      user: (this.myEmail || 'me').split('@')[0],
      text: text,
      reactions: {},
      timestamp: new Date()
    };

    if (!this.reelComments[currentReel.id]) this.reelComments[currentReel.id] = [];
    this.reelComments[currentReel.id].push(tempComment);
    currentReel.commentsCount = (currentReel.commentsCount || 0) + 1;
    const savedText = this.commentText;
    this.commentText = '';

    this.reelService.addReelComment(currentReel.id, text).subscribe({
      next: (comment) => {
        // Replace temp comment with real one
        const idx = this.reelComments[currentReel.id].findIndex(c => c.id === tempComment.id);
        if (idx !== -1) {
          this.reelComments[currentReel.id][idx] = this.mapReelComment(comment);
        }
      },
      error: (err) => {
        // Rollback on error
        this.reelComments[currentReel.id] = this.reelComments[currentReel.id].filter(c => c.id !== tempComment.id);
        currentReel.commentsCount = Math.max(0, (currentReel.commentsCount || 0) - 1);
        this.commentText = savedText;
        console.error('Comment failed:', err);
      }
    });
  }

  addEmojiToComment(emoji: string): void {
    this.commentText = `${this.commentText}${emoji}`;
  }

  isOwner(reel: Reel): boolean {
    return (reel.userEmail || '').toLowerCase() === (this.myEmail || '').toLowerCase();
  }

  canDeleteReel(reel: Reel): boolean {
    if (this.isOwner(reel)) return true;
    return (this.myRole || '').toUpperCase() === 'ADMIN';
  }

  deleteReel(reel: Reel, event: Event): void {
    event.stopPropagation();
    if (!this.isOwner(reel)) return;
    if (!confirm('Delete this reel?')) return;

    this.reelService.deleteReel(reel.id).subscribe({
      next: () => {
        this.reels = this.reels.filter((r) => r.id !== reel.id);
        delete this.reelComments[reel.id];
      },
      error: (err) => {
        const reason =
          err?.error?.message ||
          (typeof err?.error === 'string' ? err.error : '') ||
          `Request failed (${err?.status ?? 'unknown'})`;
        alert(`Could not delete reel: ${reason}`);
      }
    });
  }

  private loadCommentsForCurrentReel(): void {
    const currentReel = this.reels[this.currentIndex];
    if (!currentReel) return;
    this.reelService.getReelComments(currentReel.id).subscribe({
      next: (comments) => {
        this.reelComments[currentReel.id] = comments.map((c) => this.mapReelComment(c));
      },
      error: () => {
        this.reelComments[currentReel.id] = [];
      }
    });
  }

  private mapReelComment(comment: ReelCommentPayload): ReelComment {
    const content = (comment as any).content || (comment as any).text || '';
    const userEmail = (comment as any).userEmail || '';
    const createdAt = (comment as any).createdAt || (comment as any).timestamp;
    return {
      id: Number(comment.id),
      user: (userEmail || 'user').split('@')[0],
      text: content,
      reactions: {},
      timestamp: createdAt ? new Date(createdAt) : new Date()
    };
  }

  private hydrateReelEngagement(reel: Reel): void {
    this.likeService.getLikeCount(reel.id, 'REEL').subscribe({
      next: (count) => {
        reel.likesCount = Number(count) || 0;
      },
      error: () => {}
    });

    this.likeService.hasLiked(reel.id, 'REEL').subscribe({
      next: (hasLiked) => {
        if (hasLiked) {
          this.liked.add(reel.id);
        } else {
          this.liked.delete(reel.id);
        }
      },
      error: () => {}
    });
  }

  private hydrateReelUsernames(reels: Reel[]): void {
    const uniqueEmails = [...new Set((reels || []).map((r) => (r.userEmail || '').trim().toLowerCase()).filter(Boolean))];
    uniqueEmails.forEach((email) => {
      if (this.isKnownSeedEmail(email)) return;
      if (this.reelUsernames[email]) return;
      this.userProfileStateService.getProfileByEmail(email).subscribe({
        next: (profile) => {
          if (!profile) return;
          this.reelUsernames[email] = profile.username || email.split('@')[0];
        },
        error: () => {}
      });
    });
  }

  private moveToNextReel(fromIndex: number): void {
    if (!this.reels.length || !this.reelContainers) return;
    const nextIndex = this.findNextPlayableIndex(fromIndex);
    if (nextIndex < 0 || nextIndex === fromIndex) return;
    const target = this.reelContainers.get(nextIndex)?.nativeElement;
    if (!target) return;
    this.currentIndex = nextIndex;
    target.scrollIntoView({ block: 'start', behavior: 'smooth' });
    setTimeout(() => {
      const video = this.videoElements?.get(nextIndex)?.nativeElement;
      if (video) {
        this.pauseAllVideos();
        this.tryPlayVideo(video);
      }
    }, 100);
  }

  private findNextPlayableIndex(fromIndex: number): number {
    for (let offset = 1; offset < this.reels.length; offset++) {
      const idx = (fromIndex + offset) % this.reels.length;
      if (!this.failedReelIds.has(this.reels[idx].id)) {
        return idx;
      }
    }
    return -1;
  }

  private isKnownSeedEmail(email: string): boolean {
    return (
      email.endsWith('@example.com') ||
      email.startsWith('test') ||
      email.startsWith('qa_') ||
      email.includes('@connectsphere.com')
    );
  }

  formatViews(count: number): string {
    if (!count) return '0';
    if (count >= 1000000) return (count / 1000000).toFixed(1) + 'M';
    if (count >= 1000) return (count / 1000).toFixed(1) + 'K';
    return count.toString();
  }

  get currentComments(): ReelComment[] {
    const currentReel = this.reels[this.currentIndex];
    return currentReel ? (this.reelComments[currentReel.id] || []) : [];
  }

  get commentCount(): number {
    const currentReel = this.reels[this.currentIndex];
    return currentReel ? (this.reelComments[currentReel.id]?.length || 0) : 0;
  }

  private tryFocusSelectedReel(): void {
    if (this.hasAppliedSelectedReel || !this.selectedReelId || !this.reels.length || !this.reelContainers) {
      return;
    }

    const selectedIndex = this.reels.findIndex((r) => Number(r.id) === this.selectedReelId);
    if (selectedIndex < 0) {
      return;
    }

    const target = this.reelContainers.get(selectedIndex)?.nativeElement;
    if (!target) {
      return;
    }

    this.currentIndex = selectedIndex;
    target.scrollIntoView({ block: 'start', behavior: 'auto' });
    this.hasAppliedSelectedReel = true;
    setTimeout(() => {
      const video = this.videoElements?.get(selectedIndex)?.nativeElement;
      if (video) {
        this.pauseAllVideos();
        this.tryPlayVideo(video);
      }
    }, 120);
  }
}

export interface ReelComment {
  id: number;
  user: string;
  text: string;
  reactions: { [emoji: string]: number };
  timestamp: Date;
}





