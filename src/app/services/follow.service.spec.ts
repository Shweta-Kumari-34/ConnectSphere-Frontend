import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { FollowService } from './follow.service';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('FollowService', () => {
  let service: FollowService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [FollowService]
    });
    service = TestBed.inject(FollowService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should follow a user', () => {
    service.follow('other@test.com').subscribe(res => {
      expect(res.followingEmail).toBe('other@test.com');
    });
    const req = httpMock.expectOne('/follows');
    expect(req.request.method).toBe('POST');
    req.flush({ id: 1, followingEmail: 'other@test.com', status: 'FOLLOWING' });
  });

  it('should unfollow a user', () => {
    service.unfollow('other@test.com').subscribe();
    const req = httpMock.expectOne('/follows/other@test.com');
    expect(req.request.method).toBe('DELETE');
    req.flush('Unfollowed');
  });

  it('should check if following', () => {
    service.isFollowing('other@test.com').subscribe(res => {
      expect(res).toBe(true);
    });
    const req = httpMock.expectOne('/follows/is-following?followingEmail=other@test.com');
    req.flush(true);
  });

  it('should get suggested users', () => {
    service.getSuggestedUsers().subscribe(res => {
      expect(res).toEqual(['user1', 'user2']);
    });
    const req = httpMock.expectOne('/follows/suggested');
    req.flush(['user1', 'user2']);
  });

  it('should get followers and following counts', () => {
    service.getFollowerCount().subscribe(res => expect(res).toBe(5));
    httpMock.expectOne('/follows/followers/count').flush(5);

    service.getFollowingCount().subscribe(res => expect(res).toBe(10));
    httpMock.expectOne('/follows/following/count').flush(10);
  });

  it('should get followers and following lists', () => {
    service.getFollowers().subscribe(res => expect(res.length).toBe(1));
    httpMock.expectOne('/follows/followers').flush([{ id: 1 }]);

    service.getFollowing().subscribe(res => expect(res.length).toBe(1));
    httpMock.expectOne('/follows/following').flush([{ id: 2 }]);
  });

  it('should get mutual follows', () => {
    service.getMutualFollows('other@test.com').subscribe();
    httpMock.expectOne('/follows/mutual?otherEmail=other@test.com').flush(['mutual@test.com']);
  });
});
