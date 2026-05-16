import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { MediaService } from './media.service';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('MediaService', () => {
  let service: MediaService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [MediaService]
    });
    service = TestBed.inject(MediaService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock?.verify();
    TestBed.resetTestingModule();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should upload media', () => {
    service.uploadMedia(1, 'http://test.com/img.jpg').subscribe(res => {
      expect(res.mediaUrl).toBe('http://test.com/img.jpg');
    });
    const req = httpMock.expectOne(r => r.url.includes('/media/upload') && r.url.includes('postId=1'));
    req.flush({ id: 1, postId: 1, mediaUrl: 'http://test.com/img.jpg', mediaType: 'IMAGE' });
  });

  it('should get media by post', () => {
    service.getMediaByPost(1).subscribe(res => {
      expect(res.length).toBe(0);
    });
    const req = httpMock.expectOne('/media/post/1');
    req.flush([]);
  });

  it('should create a story', () => {
    service.createStory('http://test.com/story.jpg', 'Nice story').subscribe();
    const req = httpMock.expectOne(r => r.url.includes('/media/stories') && r.url.includes('caption=Nice%20story'));
    req.flush({ id: 10, mediaUrl: 'http://test.com/story.jpg', caption: 'Nice story' });
  });

  it('should get active stories', () => {
    service.getActiveStories().subscribe();
    const req = httpMock.expectOne('/media/stories/active');
    req.flush([]);
  });

  it('should get my stories', () => {
    service.getMyStories().subscribe();
    const req = httpMock.expectOne('/media/stories/my');
    req.flush([]);
  });

  it('should delete a story', () => {
    service.deleteStory(10).subscribe();
    const req = httpMock.expectOne('/media/stories/10');
    expect(req.request.method).toBe('DELETE');
    req.flush('Deleted');
  });
});
