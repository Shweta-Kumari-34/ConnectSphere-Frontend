import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { LikeService } from './like.service';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('LikeService', () => {
  let service: LikeService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [LikeService]
    });
    service = TestBed.inject(LikeService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should like a target', () => {
    service.likeTarget(1, 'POST').subscribe(res => {
      expect(res.targetId).toBe(1);
    });
    const req = httpMock.expectOne('/likes?targetId=1&targetType=POST&reactionType=LIKE');
    expect(req.request.method).toBe('POST');
    req.flush({ id: 10, targetId: 1, targetType: 'POST', reactionType: 'LIKE' });
  });

  it('should unlike a target', () => {
    service.unlikeTarget(1, 'POST').subscribe();
    const req = httpMock.expectOne('/likes?targetId=1&targetType=POST');
    expect(req.request.method).toBe('DELETE');
    req.flush('Unliked');
  });

  it('should check if target is liked', () => {
    service.hasLiked(1, 'POST').subscribe(res => {
      expect(res).toBe(true);
    });
    const req = httpMock.expectOne('/likes/has-liked?targetId=1&targetType=POST');
    req.flush(true);
  });

  it('should get like count', () => {
    service.getLikeCount(1, 'POST').subscribe(res => {
      expect(res).toBe(100);
    });
    const req = httpMock.expectOne('/likes/count/1?targetType=POST');
    req.flush(100);
  });
});
