import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { forkJoin, Subscription } from 'rxjs';
import { PostService, Post } from '../../services/post.service';
import { LikeService } from '../../services/like.service';
import { CommentService, Comment as PostComment } from '../../services/comment.service';
import { StoryService, Story } from '../../services/story.service';
import { FollowService } from '../../services/follow.service';
import { AuthService } from '../../services/auth.service';
import { AdminService } from '../../services/admin.service';
import { MediaUploadService, MediaItem, UPLOAD_LIMITS } from '../../services/media-upload.service';
import { UserProfileStateService } from '../../services/user-profile-state.service';
import { getStoryCreatedAtMs, getStoryExpiresAtMs, isStoryActiveNow } from '../../utils/story-time';
import { PostCarouselComponent } from '../../components/post-carousel/post-carousel.component';
import { StoryViewerComponent } from '../../components/story-viewer/story-viewer.component';

interface SelectedMediaPreview {
  file: File;
  objectUrl: string;
  isVideo: boolean;
}

@Component({
  selector: 'app-posts',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, PostCarouselComponent, StoryViewerComponent],
  templateUrl: './posts.component.html',
  styleUrl: './posts.component.scss'
})
export class PostsComponent implements OnInit, OnDestroy {
  @ViewChild('fileInput') fileInput?: ElementRef<HTMLInputElement>;
  @ViewChild('composerCard') composerCard?: ElementRef<HTMLElement>;

  posts: Post[] = [];
  activeStories: Story[] = [];
  newTitle = '';
  newContent = '';
  newVisibility = 'PUBLIC';
  loading = false;
  showForm = false;
  successMessage = '';
  errorMessage = '';
  myEmail = '';
  showStoryViewer = false;
  selectedStoryIndex = 0;
  hasMyOwnStory = false;
  
  composerMode: 'all' | 'text' | 'upload' = 'all';
  private readonly MEDIA_BASE_URL = '';
  private readonly subscriptions = new Subscription();
  userBadgeMap: Record<string, { isVerified: boolean; isPremiumMember: boolean }> = {};

  reactionTypes = [
    { type: 'LIKE', emoji: '👍', label: 'Like' },
    { type: 'LOVE', emoji: '❤️', label: 'Love' },
    { type: 'HAHA', emoji: '😂', label: 'Haha' },
    { type: 'WOW', emoji: '😮', label: 'Wow' },
    { type: 'SAD', emoji: '😢', label: 'Sad' },
    { type: 'ANGRY', emoji: '😡', label: 'Angry' },
    { type: 'FIRE', emoji: '🔥', label: 'Fire' }
  ];

  likedPosts: Set<number> = new Set();
  postReactions: { [postId: number]: string } = {};
  showReactionPicker: number | null = null;

  expandedComments: Set<number> = new Set();
  postComments: { [postId: number]: PostComment[] } = {};
  newCommentText: { [postId: number]: string } = {};

  replyingTo: { [postId: number]: number | null } = {};
  replyText: { [commentId: number]: string } = {};
  expandedReplies: Set<number> = new Set();

  likedComments: Set<number> = new Set();
  editingComment: number | null = null;
  editCommentText = '';

  editingPost: number | null = null;
  editPostTitle = '';
  editPostContent = '';

  showReportModal = false;
  reportTargetId = 0;
  reportTargetType = '';
  reportReason = '';

  selectedFiles: File[] = [];
  selectedMediaPreviews: SelectedMediaPreview[] = [];
  fileError = '';
  uploadAccept = UPLOAD_LIMITS.acceptString;

  constructor(
    private postService: PostService,
    private likeService: LikeService,
    private commentService: CommentService,
    private storyService: StoryService,
    private followService: FollowService,
    public authService: AuthService,
    private adminService: AdminService,
    public mediaUploadService: MediaUploadService,
    private userProfileStateService: UserProfileStateService,
    private route: ActivatedRoute,
    private router: Router
  ) {
    this.myEmail = this.authService.getEmail() || '';
  }

  ngOnInit(): void {
    if (!this.authService.isLoggedIn()) return;
    this.loadPosts();
    this.loadStories();
    this.subscriptions.add(
      this.route.queryParamMap.subscribe((params) => {
        const requestedMode = params.get('composer');
        if (requestedMode === 'text' || requestedMode === 'upload') {
          this.openComposer(requestedMode);
        } else if (requestedMode === 'all') {
          this.openComposer('all');
        }
      })
    );
  }

  ngOnDestroy(): void {
    this.revokePreviewUrls();
    this.subscriptions.unsubscribe();
  }

  get canSubmitPost(): boolean {
    return !!(this.newTitle.trim() || this.newContent.trim() || this.selectedFiles.length);
  }

  get composerTitle(): string {
    if (this.composerMode === 'text') return 'Text Post';
    if (this.composerMode === 'upload') return 'Upload Post';
    return 'Create Post';
  }

  get composerDescription(): string {
    if (this.composerMode === 'text') return 'Share a text-only update with your followers.';
    if (this.composerMode === 'upload') return 'Add photos or videos, then publish them as one carousel post.';
    return 'Write text, attach media, and choose who can see your post.';
  }

  myOwnStory: Story | null = null;
  viewerStories: Story[] = [];
  // Full active story list for followed users (used by story viewer sequencing).
  private followingActiveStories: Story[] = [];
  // Full active story list for the logged-in user.
  private myAllActiveStories: Story[] = [];

  loadStories(): void {
    this.subscriptions.add(
      forkJoin({
        stories: this.storyService.getActiveStories(),
        following: this.followService.getFollowing()
      }).subscribe({
        next: ({ stories, following }) => {
          // Story rings should include followed users only.
          const followingEmails = new Set((following || []).map(f => (f.followingEmail || '').toLowerCase()));
          
          // Keep my stories separately to control "Your Story" behavior.
          const myEmailLower = this.myEmail.toLowerCase();
          const allStories = stories || [];
          const myActiveStories = allStories
            .filter(s => (s.userEmail || '').toLowerCase() === myEmailLower && isStoryActiveNow(s))
            .map(s => this.normalizeStory(s))
            .sort((a, b) => (getStoryCreatedAtMs(a) || 0) - (getStoryCreatedAtMs(b) || 0));
          
          this.hasMyOwnStory = myActiveStories.length > 0;
          this.myAllActiveStories = myActiveStories;
          // Ring preview shows latest; viewer opens full `myAllActiveStories`.
          this.myOwnStory = this.hasMyOwnStory ? myActiveStories[myActiveStories.length - 1] : null;

          const normalizedFollowingStories = allStories
            .filter((story) => {
              const email = (story.userEmail || '').toLowerCase();
              // Only show following users here (no duplicates of "me")
              return isStoryActiveNow(story) && followingEmails.has(email) && email !== myEmailLower;
            })
            .map((story) => this.normalizeStory(story));

          // Preserve full per-user story sequence for the story viewer.
          this.followingActiveStories = normalizedFollowingStories
            .slice()
            .sort((a, b) => (getStoryCreatedAtMs(a) || 0) - (getStoryCreatedAtMs(b) || 0));

          // Build one latest story per user for compact ring strip UI.
          const newestByUser = new Map<string, Story>();
          normalizedFollowingStories.forEach((story) => {
              const key = (story.userEmail || '').toLowerCase();
              const existing = newestByUser.get(key);
              if (!existing || (getStoryCreatedAtMs(story) || 0) > (getStoryCreatedAtMs(existing) || 0)) {
                newestByUser.set(key, story);
              }
            });
          this.activeStories = Array.from(newestByUser.values())
            .sort((a, b) => (getStoryCreatedAtMs(b) || 0) - (getStoryCreatedAtMs(a) || 0));
        },
        error: () => this.activeStories = []
      })
    );
  }

  openMyStory(): void {
    if (!this.myAllActiveStories.length) return;
    // Open all my active stories, oldest -> newest.
    this.viewerStories = this.myAllActiveStories.slice();
    this.selectedStoryIndex = 0;
    this.showStoryViewer = true;
  }

  openStoryViewer(index: number): void {
    // User clicked a ring entry (one per author).
    const selected = this.activeStories[index];
    if (!selected?.userEmail) {
      return;
    }
    const selectedEmail = selected.userEmail.toLowerCase();
    // Expand that ring into full active story sequence of same author.
    const userStories = this.followingActiveStories
      .filter((story) => (story.userEmail || '').toLowerCase() === selectedEmail)
      .sort((a, b) => (getStoryCreatedAtMs(a) || 0) - (getStoryCreatedAtMs(b) || 0));
    if (!userStories.length) {
      return;
    }
    this.viewerStories = userStories;
    this.selectedStoryIndex = 0;
    this.showStoryViewer = true;
  }

  closeStoryViewer(): void {
    this.showStoryViewer = false;
  }

  loadPosts(): void {
    this.subscriptions.add(
      this.postService.getFeed().subscribe({
        next: (posts) => {
          this.posts = posts.map((post) => this.normalizePost(post));
          this.loadBadgesForEmails(this.posts.map((post) => post.userEmail));
          this.posts.forEach((post) => {
            this.populatePostMedia(post);
            this.hydratePostEngagement(post);
          });
        },
        error: () => this.posts = []
      })
    );
  }

  toggleComposer(): void {
    if (this.showForm) {
      this.showForm = false;
      this.clearComposerQueryParam();
      return;
    }
    this.openComposer('all');
  }

  openComposer(mode: 'all' | 'text' | 'upload'): void {
    this.showForm = true;
    this.composerMode = mode;
    this.errorMessage = '';
    setTimeout(() => {
      this.composerCard?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  setComposerMode(mode: 'all' | 'text' | 'upload'): void {
    this.composerMode = mode;
    if (mode === 'text') {
      this.removeAllMedia();
    }
  }

  createPost(): void {
    const title = this.newTitle.trim();
    const content = this.newContent.trim();

    if (!title && !content && !this.selectedFiles.length) {
      this.errorMessage = 'Add some text or choose media before posting.';
      return;
    }

    this.loading = true;
    this.errorMessage = '';
    this.successMessage = '';

    const basePayload = {
      title: title || this.buildFallbackTitle(content),
      content,
      visibility: this.newVisibility,
      mediaUrls: [],
      postType: this.selectedFiles.length > 1 ? 'CAROUSEL' : this.getPostTypeFromFiles(this.selectedFiles)
    };

    this.subscriptions.add(
      this.postService.createPost(basePayload).subscribe({
        next: (post) => {
          if (!this.selectedFiles.length || !post.id) {
            this.finishPostCreation('Post created successfully!');
            return;
          }

          forkJoin(this.mediaUploadService.uploadFilesToPost(post.id, this.selectedFiles)).subscribe({
            next: (mediaItems) => this.persistUploadedMedia(post, mediaItems),
            error: (err) => {
              this.finishPostCreation('Post created, but the media upload failed.');
              this.errorMessage = this.extractErrorMessage(err, 'Post was created but media upload failed.');
            }
          });
        },
        error: (err) => {
          this.loading = false;
          this.errorMessage = this.extractErrorMessage(err, 'Could not create your post.');
        }
      })
    );
  }

  private persistUploadedMedia(post: Post, mediaItems: MediaItem[]): void {
    const normalizedMediaUrls = mediaItems.map((item) => this.normalizeMediaUrl(item.mediaUrl));
    const nextPostType = normalizedMediaUrls.length > 1
      ? 'CAROUSEL'
      : (mediaItems[0]?.mediaType || 'IMAGE');

    this.subscriptions.add(
      this.postService.updatePost(post.id, {
        title: post.title,
        content: post.content,
        visibility: post.visibility,
        mediaUrls: normalizedMediaUrls,
        postType: nextPostType
      }).subscribe({
        next: () => this.finishPostCreation('Post created successfully!'),
        error: () => {
          this.finishPostCreation('Post created successfully!');
          this.loadPosts();
        }
      })
    );
  }

  private finishPostCreation(message: string): void {
    this.loading = false;
    this.clearComposer();
    this.showForm = false;
    this.composerMode = 'all';
    this.clearComposerQueryParam();
    this.successMessage = 'Post live instantly!';
    this.loadPosts(); // Reload feed to show the new post at the top
    setTimeout(() => this.successMessage = '', 2000);
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files || []);

    if (!files.length) {
      return;
    }

    const validationError = files.map((file) => this.mediaUploadService.validateFile(file)).find(Boolean) || '';
    if (validationError) {
      this.fileError = validationError;
      this.removeAllMedia();
      return;
    }

    this.revokePreviewUrls();
    this.selectedFiles = files;
    this.selectedMediaPreviews = files.map((file) => ({
      file,
      objectUrl: URL.createObjectURL(file),
      isVideo: file.type.startsWith('video/')
    }));
    this.fileError = '';
    this.errorMessage = '';
  }

  removeSelectedFile(index: number): void {
    const preview = this.selectedMediaPreviews[index];
    if (preview) {
      URL.revokeObjectURL(preview.objectUrl);
    }

    this.selectedMediaPreviews.splice(index, 1);
    this.selectedFiles.splice(index, 1);

    if (!this.selectedFiles.length && this.fileInput?.nativeElement) {
      this.fileInput.nativeElement.value = '';
    }
  }

  removeAllMedia(): void {
    this.revokePreviewUrls();
    this.selectedFiles = [];
    this.selectedMediaPreviews = [];
    this.fileError = '';
    if (this.fileInput?.nativeElement) {
      this.fileInput.nativeElement.value = '';
    }
  }

  clearComposer(): void {
    this.newTitle = '';
    this.newContent = '';
    this.newVisibility = 'PUBLIC';
    this.removeAllMedia();
    this.errorMessage = '';
  }

  private revokePreviewUrls(): void {
    this.selectedMediaPreviews.forEach((preview) => URL.revokeObjectURL(preview.objectUrl));
  }

  private clearComposerQueryParam(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { composer: null },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }

  toggleReactionPicker(postId: number, event: Event): void {
    event.stopPropagation();
    this.showReactionPicker = this.showReactionPicker === postId ? null : postId;
  }

  closeReactionPicker(): void {
    this.showReactionPicker = null;
  }

  reactToPost(post: Post, reactionType: string): void {
    if (this.likedPosts.has(post.id)) {
      if (this.postReactions[post.id] === reactionType) {
        this.subscriptions.add(
          this.likeService.unlikeTarget(post.id, 'POST').subscribe({
            next: () => {
              this.likedPosts.delete(post.id);
              delete this.postReactions[post.id];
              post.likeCount = Math.max(0, (post.likeCount || 0) - 1);
            }
          })
        );
      } else {
        this.subscriptions.add(
          this.likeService.unlikeTarget(post.id, 'POST').subscribe({
            next: () => {
              this.likeService.likeTarget(post.id, 'POST', reactionType).subscribe({
                next: () => {
                  this.likedPosts.add(post.id);
                  this.postReactions[post.id] = reactionType;
                }
              });
            }
          })
        );
      }
    } else {
      this.subscriptions.add(
        this.likeService.likeTarget(post.id, 'POST', reactionType).subscribe({
          next: () => {
            this.likedPosts.add(post.id);
            this.postReactions[post.id] = reactionType;
            post.likeCount = (post.likeCount || 0) + 1;
          }
        })
      );
    }
    this.showReactionPicker = null;
  }

  quickToggleLike(post: Post): void {
    if (this.likedPosts.has(post.id)) {
      this.subscriptions.add(
        this.likeService.unlikeTarget(post.id, 'POST').subscribe({
          next: () => {
            this.likedPosts.delete(post.id);
            delete this.postReactions[post.id];
            post.likeCount = Math.max(0, (post.likeCount || 0) - 1);
          }
        })
      );
    } else {
      this.reactToPost(post, 'LIKE');
    }
  }

  getReactionEmoji(postId: number): string {
    const type = this.postReactions[postId];
    const found = this.reactionTypes.find((reaction) => reaction.type === type);
    return found ? found.emoji : 'Like';
  }

  startEditPost(post: Post): void {
    this.editingPost = post.id;
    this.editPostTitle = post.title;
    this.editPostContent = post.content;
  }

  cancelEditPost(): void {
    this.editingPost = null;
  }

  saveEditPost(post: Post): void {
    if (!this.editPostTitle.trim() && !this.editPostContent.trim()) {
      return;
    }
    this.subscriptions.add(
      this.postService.updatePost(post.id, {
        title: this.editPostTitle.trim() || post.title,
        content: this.editPostContent.trim(),
        mediaUrls: post.mediaUrls,
        postType: post.postType,
        visibility: post.visibility
      }).subscribe({
        next: (updated) => {
          post.title = updated.title;
          post.content = updated.content;
          post.mediaUrls = (updated.mediaUrls || post.mediaUrls || []).map((url) => this.normalizeMediaUrl(url));
          post.postType = updated.postType || post.postType;
          this.editingPost = null;
          this.successMessage = 'Post updated!';
          setTimeout(() => this.successMessage = '', 3000);
        }
      })
    );
  }

  isMyPost(post: Post): boolean {
    return post.userEmail === this.myEmail;
  }

  toggleComments(postId: number): void {
    if (this.expandedComments.has(postId)) {
      this.expandedComments.delete(postId);
      return;
    }
    this.expandedComments.add(postId);
    this.loadComments(postId);
  }

  loadComments(postId: number): void {
    this.subscriptions.add(
      this.commentService.getCommentsByPost(postId).subscribe({
        next: (comments) => {
          this.postComments[postId] = comments;
          this.loadBadgesForEmails(comments.map((comment) => comment.userEmail));
          comments.forEach((comment) => {
            this.likeService.hasLiked(comment.id, 'COMMENT').subscribe({
              next: (liked) => {
                if (liked) {
                  this.likedComments.add(comment.id);
                } else {
                  this.likedComments.delete(comment.id);
                }
              },
              error: () => {}
            });
          });
        },
        error: () => this.postComments[postId] = []
      })
    );
  }

  getRootComments(postId: number): PostComment[] {
    return (this.postComments[postId] || []).filter((comment) => !comment.parentId);
  }

  getReplies(postId: number, parentId: number): PostComment[] {
    return (this.postComments[postId] || []).filter((comment) => comment.parentId === parentId);
  }

  hasReplies(postId: number, commentId: number): boolean {
    return this.getReplies(postId, commentId).length > 0;
  }

  toggleReplies(commentId: number): void {
    if (this.expandedReplies.has(commentId)) {
      this.expandedReplies.delete(commentId);
    } else {
      this.expandedReplies.add(commentId);
    }
  }

  startReply(postId: number, commentId: number): void {
    this.replyingTo[postId] = commentId;
    this.replyText[commentId] = '';
  }

  cancelReply(postId: number): void {
    this.replyingTo[postId] = null;
  }

  addComment(postId: number): void {
    const text = this.newCommentText[postId]?.trim();
    if (!text) return;

    // Optimistic Update
    const tempComment: PostComment = {
      id: -Date.now(),
      postId: postId,
      userEmail: this.myEmail,
      content: text,
      createdAt: new Date().toISOString(),
      likeCount: 0,
      parentId: null
    };

    if (!this.postComments[postId]) this.postComments[postId] = [];
    this.postComments[postId].push(tempComment);
    this.incrementPostCommentCount(postId, 1);
    const savedText = this.newCommentText[postId];
    this.newCommentText[postId] = '';

    this.subscriptions.add(
      this.commentService.addComment({ postId, content: text }).subscribe({
        next: (comment) => {
          // Replace temp with real
          const idx = this.postComments[postId].findIndex(c => c.id === tempComment.id);
          if (idx !== -1) this.postComments[postId][idx] = comment;
        },
        error: (err) => {
          // Rollback
          this.postComments[postId] = this.postComments[postId].filter(c => c.id !== tempComment.id);
          this.incrementPostCommentCount(postId, -1);
          this.newCommentText[postId] = savedText;
          console.error('Post comment failed:', err);
        }
      })
    );
  }

  addReply(postId: number, parentId: number): void {
    const text = this.replyText[parentId]?.trim();
    if (!text) {
      return;
    }

    this.subscriptions.add(
      this.commentService.addComment({ postId, parentId, content: text }).subscribe({
        next: (reply) => {
          if (!this.postComments[postId]) {
            this.postComments[postId] = [];
          }
          this.postComments[postId].push(reply);
          this.replyText[parentId] = '';
          this.replyingTo[postId] = null;
          this.expandedReplies.add(parentId);
          this.incrementPostCommentCount(postId, 1);
        }
      })
    );
  }

  toggleCommentLike(comment: PostComment): void {
    if (this.likedComments.has(comment.id)) {
      this.subscriptions.add(
        this.likeService.unlikeTarget(comment.id, 'COMMENT').subscribe({
          next: () => {
            this.likedComments.delete(comment.id);
            comment.likeCount = Math.max(0, (comment.likeCount || 0) - 1);
          }
        })
      );
    } else {
      this.subscriptions.add(
        this.likeService.likeTarget(comment.id, 'COMMENT').subscribe({
          next: () => {
            this.likedComments.add(comment.id);
            comment.likeCount = (comment.likeCount || 0) + 1;
          }
        })
      );
    }
  }

  startEditComment(comment: PostComment): void {
    this.editingComment = comment.id;
    this.editCommentText = comment.content;
  }

  cancelEditComment(): void {
    this.editingComment = null;
  }

  saveEditComment(comment: PostComment): void {
    if (!this.editCommentText.trim()) {
      return;
    }
    this.subscriptions.add(
      this.commentService.updateComment(comment.id, this.editCommentText.trim()).subscribe({
        next: (updated) => {
          comment.content = updated.content || this.editCommentText.trim();
          this.editingComment = null;
          this.successMessage = 'Comment updated!';
          setTimeout(() => this.successMessage = '', 3000);
        },
        error: () => {
          comment.content = this.editCommentText.trim();
          this.editingComment = null;
        }
      })
    );
  }

  deleteComment(postId: number, commentId: number): void {
    if (!confirm('Delete this comment?')) {
      return;
    }

    const removedCount = this.countCommentThreadSize(postId, commentId);
    this.subscriptions.add(
      this.commentService.deleteComment(commentId).subscribe({
        next: () => {
          this.postComments[postId] = (this.postComments[postId] || []).filter((comment) => {
            return comment.id !== commentId && comment.parentId !== commentId;
          });
          this.incrementPostCommentCount(postId, -removedCount);
        }
      })
    );
  }

  isMyComment(comment: PostComment): boolean {
    return comment.userEmail === this.myEmail;
  }

  openReport(targetId: number, targetType: string): void {
    this.reportTargetId = targetId;
    this.reportTargetType = targetType;
    this.reportReason = '';
    this.showReportModal = true;
  }

  closeReport(): void {
    this.showReportModal = false;
  }

  submitReport(): void {
    if (!this.reportReason.trim()) {
      return;
    }
    this.subscriptions.add(
      this.adminService.submitReport(this.reportTargetType, this.reportTargetId, this.reportReason).subscribe({
        next: () => {
          this.showReportModal = false;
          this.successMessage = `${this.reportTargetType} reported. Our team will review it.`;
          setTimeout(() => this.successMessage = '', 4000);
        },
        error: () => {
          this.showReportModal = false;
          this.successMessage = `${this.reportTargetType} reported. Our team will review it.`;
          setTimeout(() => this.successMessage = '', 4000);
        }
      })
    );
  }

  deletePost(id: number): void {
    if (!confirm('Delete this post?')) {
      return;
    }
    this.subscriptions.add(
      this.postService.deletePost(id).subscribe({
        next: () => {
          this.posts = this.posts.filter((post) => post.id !== id);
          delete this.postComments[id];
          this.expandedComments.delete(id);
        }
      })
    );
  }

  private hydratePostEngagement(post: Post): void {
    this.likeService.hasLiked(post.id, 'POST').subscribe({
      next: (liked) => {
        if (liked) {
          this.likedPosts.add(post.id);
        } else {
          this.likedPosts.delete(post.id);
        }
      },
      error: () => {}
    });

    this.likeService.getLikeCount(post.id, 'POST').subscribe({
      next: (count) => post.likeCount = Number(count) || 0,
      error: () => {}
    });

    this.commentService.getCommentCount(post.id).subscribe({
      next: (count) => post.commentCount = Number(count) || 0,
      error: () => {}
    });
  }

  private populatePostMedia(post: Post): void {
    const existingUrls = (post.mediaUrls || []).map((url) => this.normalizeMediaUrl(url)).filter(Boolean);
    post.mediaUrls = existingUrls;
    if (post.mediaUrls.length > 1) {
      post.postType = 'CAROUSEL';
    }

    this.mediaUploadService.getMediaByPost(post.id).subscribe({
      next: (mediaItems) => {
        if (!mediaItems.length) {
          return;
        }
        post.mediaUrls = mediaItems.map((item) => this.normalizeMediaUrl(item.mediaUrl)).filter(Boolean);
        post.postType = post.mediaUrls.length > 1 ? 'CAROUSEL' : (mediaItems[0]?.mediaType || post.postType);
      },
      error: () => {}
    });
  }

  private normalizeMediaUrl(url: string): string {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('blob:') || url.startsWith('data:')) {
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
    const normalizedMediaUrls = (post.mediaUrls || []).map((url) => this.normalizeMediaUrl(url)).filter(Boolean);
    return {
      ...post,
      mediaUrls: normalizedMediaUrls,
      postType: normalizedMediaUrls.length > 1 ? 'CAROUSEL' : post.postType
    };
  }

  private buildFallbackTitle(content: string): string {
    if (content) {
      return content.slice(0, 40);
    }
    if (this.selectedFiles.length) {
      return this.selectedFiles.length === 1
        ? this.selectedFiles[0].name.replace(/\.[^.]+$/, '')
        : `${this.selectedFiles.length} media post`;
    }
    return 'Quick post';
  }

  private getPostTypeFromFiles(files: File[]): string {
    if (files.length > 1) {
      return 'CAROUSEL';
    }
    if (files[0]?.type.startsWith('video/')) {
      return 'VIDEO';
    }
    if (files[0]?.type.startsWith('image/')) {
      return 'IMAGE';
    }
    return 'TEXT';
  }

  private incrementPostCommentCount(postId: number, delta: number): void {
    const post = this.posts.find((item) => item.id === postId);
    if (post) {
      post.commentCount = Math.max(0, (post.commentCount || 0) + delta);
    }
  }

  private countCommentThreadSize(postId: number, commentId: number): number {
    return (this.postComments[postId] || []).filter((comment) => {
      return comment.id === commentId || comment.parentId === commentId;
    }).length || 1;
  }

  private extractErrorMessage(err: any, fallback: string): string {
    if (typeof err?.error === 'string' && err.error.trim()) {
      return err.error;
    }
    if (err?.error?.message) {
      return err.error.message;
    }
    if (err?.status === 0) {
      return 'Upload service is not reachable right now.';
    }
    return fallback;
  }

  getTimeAgo(dateStr: string): string {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + ' min ago';
    if (diff < 86400) return Math.floor(diff / 3600) + ' hours ago';
    return Math.floor(diff / 86400) + ' days ago';
  }

  isVerifiedUser(email: string): boolean {
    return !!this.userBadgeMap[(email || '').toLowerCase()]?.isVerified;
  }

  isPremiumUser(email: string): boolean {
    return !!this.userBadgeMap[(email || '').toLowerCase()]?.isPremiumMember;
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
