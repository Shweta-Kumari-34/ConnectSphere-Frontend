import { CommonModule } from '@angular/common';
import { Component, ElementRef, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { CommentService, Comment as PostComment } from '../../services/comment.service';
import { LikeService } from '../../services/like.service';
import { Post } from '../../services/post.service';
import { PostService } from '../../services/post.service';
import { PostCarouselComponent } from '../post-carousel/post-carousel.component';
import { UserProfileStateService } from '../../services/user-profile-state.service';

@Component({
  selector: 'app-post-detail-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, PostCarouselComponent],
  templateUrl: './post-detail-modal.component.html',
  styleUrl: './post-detail-modal.component.scss'
})
export class PostDetailModalComponent implements OnChanges, OnDestroy {
  @ViewChild('commentInput') commentInput?: ElementRef<HTMLInputElement>;

  @Input() post: Post | null = null;
  @Input() username = '';
  @Input() displayName = '';
  @Input() profilePicUrl = '';
  @Input() currentUserEmail = '';
  @Input() isLoggedIn = false;
  @Input() canDeletePost = false;
  @Input() isAuthorVerified = false;
  @Input() isAuthorPremium = false;

  @Output() closed = new EventEmitter<void>();
  @Output() postDeleted = new EventEmitter<number>();
  @Output() loginRequested = new EventEmitter<void>();

  comments: PostComment[] = [];
  newCommentText = '';
  likedComments = new Set<number>();
  likedPost = false;
  loadingComments = false;
  busy = false;
  userBadgeMap: Record<string, { isVerified: boolean; isPremiumMember: boolean }> = {};

  private readonly subscriptions = new Subscription();

  constructor(
    private likeService: LikeService,
    private commentService: CommentService,
    private postService: PostService,
    private userProfileStateService: UserProfileStateService
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['post'] && this.post?.id) {
      this.newCommentText = '';
      this.comments = [];
      this.likedComments.clear();
      this.syncPostState();
      this.loadComments();
    }
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  get hasPost(): boolean {
    return !!this.post;
  }

  get isOwnPost(): boolean {
    return !!this.post && this.post.userEmail === this.currentUserEmail;
  }

  get rootComments(): PostComment[] {
    return this.comments.filter((comment) => !comment.parentId);
  }

  get shouldShowMoreCaption(): boolean {
    const caption = this.post?.content || '';
    return caption.length > 90;
  }

  get visibleCaption(): string {
    const caption = this.post?.content || '';
    if (caption.length <= 90) {
      return caption;
    }
    return `${caption.slice(0, 90)}...`;
  }

  close(): void {
    this.closed.emit();
  }

  toggleLike(): void {
    if (!this.post) {
      return;
    }

    if (!this.isLoggedIn) {
      this.loginRequested.emit();
      return;
    }

    if (this.likedPost) {
      this.subscriptions.add(
        this.likeService.unlikeTarget(this.post.id, 'POST').subscribe({
          next: () => {
            this.likedPost = false;
            this.post!.likeCount = Math.max(0, (this.post!.likeCount || 0) - 1);
          }
        })
      );
      return;
    }

    this.subscriptions.add(
      this.likeService.likeTarget(this.post.id, 'POST').subscribe({
        next: () => {
          this.likedPost = true;
          this.post!.likeCount = (this.post!.likeCount || 0) + 1;
        }
      })
    );
  }

  focusComments(): void {
    setTimeout(() => {
      this.commentInput?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      this.commentInput?.nativeElement.focus();
    }, 0);
  }

  loadComments(): void {
    if (!this.post) {
      return;
    }

    this.loadingComments = true;
    this.subscriptions.add(
      this.commentService.getCommentsByPost(this.post.id).subscribe({
        next: (comments) => {
          this.comments = comments;
          this.loadingComments = false;
          this.loadBadgesForEmails(comments.map((comment) => comment.userEmail));
          comments.forEach((comment) => this.hydrateCommentLike(comment.id));
        },
        error: () => {
          this.comments = [];
          this.loadingComments = false;
        }
      })
    );
  }

  addComment(): void {
    if (!this.post) {
      return;
    }

    if (!this.isLoggedIn) {
      this.loginRequested.emit();
      return;
    }

    const content = this.newCommentText.trim();
    if (!content) {
      return;
    }

    this.subscriptions.add(
      this.commentService.addComment({ postId: this.post.id, content }).subscribe({
        next: (comment) => {
          this.comments = [...this.comments, comment];
          this.newCommentText = '';
          this.post!.commentCount = (this.post!.commentCount || 0) + 1;
        }
      })
    );
  }

  deleteComment(commentId: number): void {
    if (!this.post || !confirm('Delete this comment?')) {
      return;
    }

    const removedCount = this.comments.filter((comment) => {
      return comment.id === commentId || comment.parentId === commentId;
    }).length || 1;

    this.subscriptions.add(
      this.commentService.deleteComment(commentId).subscribe({
        next: () => {
          this.comments = this.comments.filter((comment) => comment.id !== commentId && comment.parentId !== commentId);
          this.post!.commentCount = Math.max(0, (this.post!.commentCount || 0) - removedCount);
        }
      })
    );
  }

  deletePost(): void {
    if (!this.post || this.busy || !confirm('Delete this post?')) {
      return;
    }

    this.busy = true;
    this.subscriptions.add(
      this.postService.deletePost(this.post.id).subscribe({
        next: () => {
          const deletedId = this.post!.id;
          this.busy = false;
          this.postDeleted.emit(deletedId);
        },
        error: () => {
          this.busy = false;
        }
      })
    );
  }

  getReplies(parentId: number): PostComment[] {
    return this.comments.filter((comment) => comment.parentId === parentId);
  }

  hasReplies(commentId: number): boolean {
    return this.getReplies(commentId).length > 0;
  }

  isOwnComment(comment: PostComment): boolean {
    return comment.userEmail === this.currentUserEmail;
  }

  toggleCommentLike(comment: PostComment): void {
    if (!this.isLoggedIn) {
      this.loginRequested.emit();
      return;
    }

    if (this.likedComments.has(comment.id)) {
      this.subscriptions.add(
        this.likeService.unlikeTarget(comment.id, 'COMMENT').subscribe({
          next: () => {
            this.likedComments.delete(comment.id);
            comment.likeCount = Math.max(0, (comment.likeCount || 0) - 1);
          }
        })
      );
      return;
    }

    this.subscriptions.add(
      this.likeService.likeTarget(comment.id, 'COMMENT').subscribe({
        next: () => {
          this.likedComments.add(comment.id);
          comment.likeCount = (comment.likeCount || 0) + 1;
        }
      })
    );
  }

  getTimeAgo(dateStr: string): string {
    if (!dateStr) return '';
    const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
    return `${Math.floor(diff / 86400)} days ago`;
  }

  isVerifiedUser(email: string): boolean {
    return !!this.userBadgeMap[(email || '').toLowerCase()]?.isVerified;
  }

  isPremiumUser(email: string): boolean {
    return !!this.userBadgeMap[(email || '').toLowerCase()]?.isPremiumMember;
  }

  private syncPostState(): void {
    if (!this.post || !this.isLoggedIn) {
      this.likedPost = false;
      return;
    }

    this.subscriptions.add(
      this.likeService.hasLiked(this.post.id, 'POST').subscribe({
        next: (liked) => this.likedPost = liked,
        error: () => this.likedPost = false
      })
    );

    this.subscriptions.add(
      this.likeService.getLikeCount(this.post.id, 'POST').subscribe({
        next: (count) => {
          if (this.post) {
            this.post.likeCount = Number(count) || 0;
          }
        },
        error: () => {}
      })
    );

    this.subscriptions.add(
      this.commentService.getCommentCount(this.post.id).subscribe({
        next: (count) => {
          if (this.post) {
            this.post.commentCount = Number(count) || 0;
          }
        },
        error: () => {}
      })
    );
  }

  private hydrateCommentLike(commentId: number): void {
    if (!this.isLoggedIn) {
      return;
    }

    this.likeService.hasLiked(commentId, 'COMMENT').subscribe({
      next: (liked) => {
        if (liked) {
          this.likedComments.add(commentId);
        } else {
          this.likedComments.delete(commentId);
        }
      },
      error: () => {}
    });
  }

  private loadBadgesForEmails(emails: string[]): void {
    const uniqueEmails = [...new Set((emails || []).filter(Boolean).map((email) => email.toLowerCase()))];
    uniqueEmails.forEach((email) => {
      if (this.userBadgeMap[email]) {
        return;
      }
      this.userProfileStateService.getProfileByEmail(email).subscribe({
        next: (profile) => {
          if (!profile) {
            return;
          }
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
