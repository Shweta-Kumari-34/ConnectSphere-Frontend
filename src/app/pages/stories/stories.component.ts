import { Component, ElementRef, OnInit, ViewChild, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { forkJoin, Subscription } from 'rxjs';
import { StoryService, Story } from '../../services/story.service';
import { FollowService } from '../../services/follow.service';
import { AuthService } from '../../services/auth.service';
import { MediaUploadService, UPLOAD_LIMITS } from '../../services/media-upload.service';
import { firstValueFrom, timeout } from 'rxjs';
import { getStoryCreatedAtMs, isStoryActiveNow } from '../../utils/story-time';
import { StoryViewerComponent } from '../../components/story-viewer/story-viewer.component';

@Component({
  selector: 'app-stories',
  standalone: true,
  imports: [CommonModule, FormsModule, StoryViewerComponent],
  templateUrl: './stories.component.html',
  styleUrl: './stories.component.scss'
})
export class StoriesComponent implements OnInit, OnDestroy {
  @ViewChild('storyFileInput') storyFileInput?: ElementRef<HTMLInputElement>;

  // Composer/form state.
  showForm = false;
  newMediaUrl = '';
  newCaption = '';
  loading = false;
  successMessage = '';
  errorMessage = '';

  selectedFiles: File[] = [];
  selectedImagePreview: string | null = null;
  fileError = '';
  uploadAccept = UPLOAD_LIMITS.acceptString;
  private loadingFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly subscriptions = new Subscription();

  // Story viewer state (modal + selected sequence).
  activeStories: Story[] = [];
  viewerStories: Story[] = [];
  selectedStoryIndex = 0;
  showStoryViewer = false;
  hasMyOwnStory = false;
  myOwnStory: Story | null = null;
  myStories: Story[] = [];
  private storiesByUser = new Map<string, Story[]>();
  myEmail = '';

  constructor(
    private storyService: StoryService,
    private followService: FollowService,
    public authService: AuthService,
    public mediaUploadService: MediaUploadService,
    private router: Router
  ) {
    this.myEmail = this.authService.getEmail() || '';
  }

  ngOnInit(): void {
    this.showForm = false;
    this.loadStories();
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  loadStories(): void {
    this.subscriptions.add(
      forkJoin({
        stories: this.storyService.getActiveStories(),
        following: this.followService.getFollowing()
      }).subscribe({
        next: ({ stories, following }) => {
          // Feed stories should include active stories from accounts I follow.
          const followingEmails = new Set((following || []).map(f => (f.followingEmail || '').toLowerCase()));
          const myEmailLower = this.myEmail.toLowerCase();
          const allStories = stories || [];

          // Keep my stories separate for "Your Story" ring and own viewer flow.
          const myActiveStories = allStories
            .filter(s => (s.userEmail || '').toLowerCase() === myEmailLower && isStoryActiveNow(s))
            .map(s => this.normalizeStory(s))
            .sort((a, b) => (getStoryCreatedAtMs(b) || 0) - (getStoryCreatedAtMs(a) || 0));
          
          this.myStories = myActiveStories;
          this.hasMyOwnStory = myActiveStories.length > 0;
          this.myOwnStory = this.hasMyOwnStory ? myActiveStories[0] : null;

          this.storiesByUser.clear();
          const newestByUser = new Map<string, Story>();
          allStories
            .filter((story) => {
              const email = (story.userEmail || '').toLowerCase();
              return isStoryActiveNow(story) && followingEmails.has(email) && email !== myEmailLower;
            })
            .map((story) => this.normalizeStory(story))
            .forEach((story) => {
              const key = (story.userEmail || '').toLowerCase();
              // Collect full per-user sequence for story viewer.
              const userStories = this.storiesByUser.get(key) || [];
              userStories.push(story);
              this.storiesByUser.set(key, userStories);

              // Keep latest story per user for compact ring row.
              const existing = newestByUser.get(key);
              if (!existing || (getStoryCreatedAtMs(story) || 0) > (getStoryCreatedAtMs(existing) || 0)) {
                newestByUser.set(key, story);
              }
            });

          this.storiesByUser.forEach((userStories, key) => {
            const sorted = userStories.sort((a, b) => (getStoryCreatedAtMs(b) || 0) - (getStoryCreatedAtMs(a) || 0));
            this.storiesByUser.set(key, sorted);
          });

          this.activeStories = Array.from(newestByUser.values())
            .sort((a, b) => (getStoryCreatedAtMs(b) || 0) - (getStoryCreatedAtMs(a) || 0));
        },
        error: () => {
          this.activeStories = [];
        }
      })
    );
  }

  private normalizeStory(story: Story): Story {
    let mediaUrl = story.mediaUrl || '';
    if (mediaUrl.startsWith('/uploads/')) {
      mediaUrl = mediaUrl; 
    }
    return { ...story, mediaUrl };
  }

  openMyStory(): void {
    if (!this.myOwnStory) return;
    this.viewerStories = this.myStories.length ? this.myStories : [this.myOwnStory];
    this.selectedStoryIndex = 0;
    this.showStoryViewer = true;
  }

  openStoryViewer(index: number): void {
    // Expand one user ring entry into that user's full active sequence.
    const selected = this.activeStories[index];
    const key = (selected?.userEmail || '').toLowerCase();
    const userStories = this.storiesByUser.get(key) || [];
    this.viewerStories = userStories.length ? userStories : (selected ? [selected] : []);
    this.selectedStoryIndex = 0;
    this.showStoryViewer = true;
  }

  closeStoryViewer(): void {
    this.showStoryViewer = false;
  }

  get canSubmitStory(): boolean {
    return !!(this.selectedFiles.length || this.newMediaUrl.trim());
  }

  onShareStoryClick(): void {
    if (this.loading) {
      return;
    }

    this.errorMessage = '';
    this.successMessage = '';

    if (!this.showForm) {
      this.showForm = true;
      return;
    }

    this.createStory();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = input.files ? Array.from(input.files) : [];
    if (!files.length) {
      return;
    }

    for (const file of files) {
      const error = this.mediaUploadService.validateFile(file);
      if (error) {
        this.fileError = error;
        this.selectedFiles = [];
        this.selectedImagePreview = null;
        this.resetFileInput();
        return;
      }
    }

    this.fileError = '';
    this.errorMessage = '';
    this.selectedFiles = files;
    this.newMediaUrl = '';

    const firstFile = files[0];
    if (firstFile.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        this.selectedImagePreview = e.target?.result as string;
      };
      reader.readAsDataURL(firstFile);
      return;
    }

    this.selectedImagePreview = null;
  }

  removeImage(): void {
    this.selectedFiles = [];
    this.selectedImagePreview = null;
    this.fileError = '';
    this.resetFileInput();
  }

  clearComposer(): void {
    this.newMediaUrl = '';
    this.newCaption = '';
    this.selectedFiles = [];
    this.selectedImagePreview = null;
    this.fileError = '';
    this.errorMessage = '';
    this.resetFileInput();
  }

  cancelComposer(): void {
    this.clearComposer();
    this.showForm = false;
  }

  async createStory(): Promise<void> {
    if (this.loading) {
      return;
    }

    const mediaUrl = this.newMediaUrl.trim();

    if (!this.selectedFiles.length && !mediaUrl) {
      this.errorMessage = 'Choose a photo or paste a media URL first.';
      return;
    }

    this.loading = true;
    this.errorMessage = '';
    this.successMessage = '';
    this.startLoadingFallbackTimer();

    try {
      // File upload path: upload each selected file and create story entry.
      if (this.selectedFiles.length) {
        const createdStories: Story[] = [];
        for (const file of this.selectedFiles) {
          const created = await firstValueFrom(
            this.mediaUploadService.uploadStoryFile(file, this.newCaption.trim()).pipe(timeout(60000))
          );
          createdStories.push(created);
        }
        this.finishStoryCreation(createdStories);
        return;
      }

      // URL path: create story directly from provided URL.
      const story = await firstValueFrom(
        this.storyService.createStory(mediaUrl, this.newCaption.trim()).pipe(timeout(15000))
      );
      this.finishStoryCreation([story]);
    } catch (err) {
      this.errorMessage = this.extractErrorMessage(err, 'Story upload could not start.');
      console.error('Story submission crashed before the request was sent:', err);
    } finally {
      this.loading = false;
      this.clearLoadingFallbackTimer();
    }
  }

  private finishStoryCreation(stories: Story[] = []): void {
    this.clearComposer();
    this.showForm = false;
    
    // Add new stories to local state instantly if we are on a page that shows them
    if (stories.length > 0) {
      this.myOwnStory = this.normalizeStory(stories[0]);
      this.hasMyOwnStory = true;
    }

    // Broadcast event so other pages (posts/profile) can refresh story strips immediately.
    window.dispatchEvent(new CustomEvent('connectsphere-story-created'));

    this.successMessage = 'Story created instantly!';
    
    // Navigate immediately to show the result
    this.router.navigate(['/profile'], {
      queryParams: { storyUploaded: Date.now() },
      replaceUrl: true
    });

    setTimeout(() => { this.successMessage = ''; }, 2000);
  }

  get selectedFileLabel(): string {
    if (!this.selectedFiles.length) {
      return '';
    }
    if (this.selectedFiles.length === 1) {
      return this.selectedFiles[0].name;
    }
    return `${this.selectedFiles[0].name} +${this.selectedFiles.length - 1} more`;
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

    if (err?.name === 'TimeoutError') {
      return 'Story upload is taking too long. Please try again.';
    }

    return fallback;
  }

  private resetFileInput(): void {
    if (this.storyFileInput?.nativeElement) {
      this.storyFileInput.nativeElement.value = '';
    }
  }

  private startLoadingFallbackTimer(): void {
    this.clearLoadingFallbackTimer();
    this.loadingFallbackTimer = setTimeout(() => {
      if (!this.loading) {
        return;
      }
      this.loading = false;
      this.errorMessage = 'Story upload took too long. Please try again.';
    }, 90000);
  }

  private clearLoadingFallbackTimer(): void {
    if (!this.loadingFallbackTimer) {
      return;
    }
    clearTimeout(this.loadingFallbackTimer);
    this.loadingFallbackTimer = null;
  }
}
