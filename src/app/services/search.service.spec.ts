import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { SearchService } from './search.service';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('SearchService', () => {
  let service: SearchService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [SearchService]
    });
    service = TestBed.inject(SearchService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should search posts', () => {
    service.searchPosts('test').subscribe(res => {
      expect(res).toEqual([1, 2]);
    });
    const req = httpMock.expectOne('/search/posts?q=test');
    req.flush([1, 2]);
  });

  it('should search users', () => {
    service.searchUsers('alice').subscribe(res => {
      expect(res).toEqual(['alice123']);
    });
    const req = httpMock.expectOne('/search/users?q=alice');
    req.flush(['alice123']);
  });

  it('should get trending hashtags', () => {
    service.getTrending(5).subscribe(res => {
      expect(res.length).toBe(0);
    });
    const req = httpMock.expectOne('/search/trending?limit=5');
    req.flush([]);
  });

  it('should get posts by hashtag', () => {
    service.getPostsByHashtag('java').subscribe();
    const req = httpMock.expectOne('/search/posts-by-hashtag?tag=java');
    req.flush([]);
  });

  it('should get hashtag count', () => {
    service.getHashtagCount('java').subscribe(res => {
      expect(res.count).toBe(10);
    });
    const req = httpMock.expectOne('/search/count?tag=java');
    req.flush({ count: 10 });
  });

  it('should get hashtags for post', () => {
    service.getHashtagsForPost(1).subscribe();
    const req = httpMock.expectOne('/search/hashtags/post/1');
    req.flush([]);
  });

  it('should search hashtags', () => {
    service.searchHashtags('tag').subscribe();
    const req = httpMock.expectOne('/search/hashtags?q=tag');
    req.flush([]);
  });
});
