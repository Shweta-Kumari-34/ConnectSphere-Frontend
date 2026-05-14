import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Story, StoryService } from '../../services/story.service';
import { NotificationService } from '../../services/notification.service';
import { LikeService } from '../../services/like.service';
import { formatStoryAgeShort, isStoryActiveNow } from '../../utils/story-time';

@Component({
  selector: 'app-story-viewer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './story-viewer.component.html',
  styleUrl: './story-viewer.component.scss'
})
export class StoryViewerComponent implements OnChanges, OnDestroy {
  @Input() stories: Story[] = [];
  @Input() currentIndex = 0;
  @Input() currentUserEmail = '';
  @Input() allowDelete = false;

  @Output() closed = new EventEmitter<void>();
  @Output() storyChanged = new EventEmitter<Story>();
  @Output() deleteRequested = new EventEmitter<Story>();

  visibleStories: Story[] = [];
  activeIndex = 0;
  activeProgress = 0;
  showMenu = false;
  storyCommentText = '';
  isPaused = false;

  private timerId: ReturnType<typeof setInterval> | null = null;
  private activeStartedAt = 0;
  private pausedAt = 0;
  private readonly storyDurationMs = 5000;

  constructor(
    private notificationService: NotificationService,
    private likeService: LikeService,
    private storyService: StoryService
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['stories'] || changes['currentIndex']) {
      this.visibleStories = (this.stories || []).filter((story) => isStoryActiveNow(story));
      if (!this.visibleStories.length) {
        this.stopTimer();
        this.closeViewer();
        return;
      }

      const boundedIndex = Math.min(Math.max(this.currentIndex || 0, 0), this.visibleStories.length - 1);
      this.setActiveIndex(boundedIndex);
    }
  }

  ngOnDestroy(): void {
    this.stopTimer();
  }

  get activeStory(): Story | null {
    return this.visibleStories[this.activeIndex] || null;
  }

  closeViewer(): void {
    this.stopTimer();
    this.showMenu = false;
    this.closed.emit();
  }

  previousStory(): void {
    if (!this.visibleStories.length) {
      return;
    }

    if (this.activeIndex === 0) {
      this.setActiveIndex(0);
      return;
    }

    this.setActiveIndex(this.activeIndex - 1);
  }

  nextStory(): void {
    if (!this.visibleStories.length) {
      return;
    }

    if (this.activeIndex >= this.visibleStories.length - 1) {
      this.closeViewer();
      return;
    }

    this.setActiveIndex(this.activeIndex + 1);
  }

  getProgressPercent(index: number): number {
    if (index < this.activeIndex) {
      return 100;
    }

    if (index > this.activeIndex) {
      return 0;
    }

    return this.activeProgress;
  }

  getStoryInitial(story: Story | null): string {
    if (!story?.userEmail) {
      return 'U';
    }
    return story.userEmail.split('@')[0].charAt(0).toUpperCase();
  }

  getStoryDisplayName(story: Story | null): string {
    if (!story?.userEmail) {
      return 'user';
    }
    return story.userEmail.split('@')[0];
  }

  getStoryAgeLabel(story: Story | null): string {
    if (!story) {
      return '';
    }
    return formatStoryAgeShort(story);
  }

  get canDeleteActiveStory(): boolean {
    return !!this.activeStory && this.allowDelete;
  }

  getActiveStoryMediaUrl(): string {
    const raw = (this.activeStory?.mediaUrl || '').trim();
    if (!raw) {
      return '';
    }

    if (raw.startsWith('data:') || raw.startsWith('blob:')) {
      return raw;
    }

    if (raw.startsWith('http://') || raw.startsWith('https://')) {
      try {
        const parsed = new URL(raw);
        if (parsed.pathname?.startsWith('/uploads/')) {
          return parsed.pathname;
        }
      } catch {
        return raw;
      }
      return raw;
    }

    const normalized = raw.replace(/\\/g, '/');
    const uploadsIndex = normalized.toLowerCase().indexOf('/uploads/');
    if (uploadsIndex >= 0) {
      const uploadsPath = normalized.substring(uploadsIndex);
      return uploadsPath;
    }

    if (normalized.startsWith('/media/')) {
      return normalized;
    }

    if (normalized.startsWith('/uploads/')) {
      return normalized;
    }

    if (normalized.startsWith('uploads/')) {
      return `/${normalized}`;
    }

    if (normalized.startsWith('media/')) {
      return `/${normalized}`;
    }

    if (normalized.startsWith('/')) {
      return normalized;
    }

    return `/media/${normalized}`;
  }

  toggleMenu(event: Event): void {
    event.stopPropagation();
    this.showMenu = !this.showMenu;
  }

  requestDelete(event: Event): void {
    event.stopPropagation();
    this.showMenu = false;
    if (!this.activeStory) {
      return;
    }
    this.deleteRequested.emit(this.activeStory);
  }

  pauseTimer(): void {
    this.isPaused = true;
    this.pausedAt = Date.now();
    this.stopTimer();
  }

  resumeTimer(): void {
    if (!this.isPaused) return;
    this.isPaused = false;
    const elapsedBeforePause = this.pausedAt - this.activeStartedAt;
    this.activeStartedAt = Date.now() - elapsedBeforePause;
    this.startTimer();
  }

  sendStoryReaction(emoji: string): void {
    if (!this.activeStory) return;
    
    // Use LikeService for story reactions
    this.likeService.likeTarget(this.activeStory.id, 'STORY', emoji).subscribe({
      next: () => {
        console.log(`Reacted ${emoji} to story ${this.activeStory?.id}`);
        // Visual feedback would go here
        this.nextStory();
      },
      error: () => this.nextStory()
    });
  }

  sendStoryComment(): void {
    if (!this.activeStory || !this.storyCommentText.trim()) return;
    const text = this.storyCommentText.trim();
    const storyId = this.activeStory.id;

    // Optimistically clear the input and resume the progress bar
    this.storyCommentText = '';
    this.resumeTimer();

    this.storyService.commentOnStory(storyId, text).subscribe({
      next: () => {
        // Comment sent — story continues playing normally
      },
      error: () => {
        // Don't skip to next story on error; just let the story keep playing
        // so the user can try again if they want
      }
    });
  }

  private setActiveIndex(index: number): void {
    this.activeIndex = index;
    this.activeProgress = 0;
    this.activeStartedAt = Date.now();
    this.isPaused = false;
    this.storyCommentText = '';
    this.showMenu = false;
    this.emitActiveStory();
    this.startTimer();
  }

  private emitActiveStory(): void {
    const story = this.activeStory;
    if (story) {
      this.storyChanged.emit(story);
    }
  }

  private startTimer(): void {
    this.stopTimer();

    this.timerId = setInterval(() => {
      const elapsed = Date.now() - this.activeStartedAt;
      const progress = Math.min(100, (elapsed / this.storyDurationMs) * 100);
      this.activeProgress = progress;

      if (progress >= 100) {
        this.nextStory();
      }
    }, 50);
  }

  private stopTimer(): void {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }
}
