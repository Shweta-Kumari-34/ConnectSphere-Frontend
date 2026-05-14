import { CommonModule } from '@angular/common';
import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';

@Component({
  selector: 'app-post-carousel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './post-carousel.component.html',
  styleUrl: './post-carousel.component.scss'
})
export class PostCarouselComponent implements OnChanges {
  @Input() mediaUrls: string[] = [];
  @Input() ariaLabel = 'Post media';

  activeIndex = 0;
  private touchStartX: number | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['mediaUrls']) {
      const maxIndex = Math.max(0, this.mediaUrls.length - 1);
      this.activeIndex = Math.min(this.activeIndex, maxIndex);
    }
  }

  get hasMultipleItems(): boolean {
    return this.mediaUrls.length > 1;
  }

  get activeMediaUrl(): string {
    return this.mediaUrls[this.activeIndex] || '';
  }

  isVideoUrl(url: string): boolean {
    return /\.(mp4|mov|webm|ogg)($|\?)/i.test(url);
  }

  previousSlide(): void {
    if (!this.hasMultipleItems) {
      return;
    }
    this.activeIndex = this.activeIndex === 0 ? this.mediaUrls.length - 1 : this.activeIndex - 1;
  }

  nextSlide(): void {
    if (!this.hasMultipleItems) {
      return;
    }
    this.activeIndex = this.activeIndex === this.mediaUrls.length - 1 ? 0 : this.activeIndex + 1;
  }

  goToSlide(index: number): void {
    if (index < 0 || index >= this.mediaUrls.length) {
      return;
    }
    this.activeIndex = index;
  }

  onTouchStart(event: TouchEvent): void {
    this.touchStartX = event.changedTouches[0]?.clientX ?? null;
  }

  onTouchEnd(event: TouchEvent): void {
    if (this.touchStartX === null || !this.hasMultipleItems) {
      this.touchStartX = null;
      return;
    }

    const touchEndX = event.changedTouches[0]?.clientX ?? this.touchStartX;
    const deltaX = touchEndX - this.touchStartX;
    this.touchStartX = null;

    if (Math.abs(deltaX) < 40) {
      return;
    }

    if (deltaX > 0) {
      this.previousSlide();
    } else {
      this.nextSlide();
    }
  }
}
