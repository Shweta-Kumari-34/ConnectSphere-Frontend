import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReelsComponent } from './reels.component';
import { ActivatedRoute } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ReelService } from '../../services/reel.service';
import { LikeService } from '../../services/like.service';
import { FollowService } from '../../services/follow.service';
import { AuthService } from '../../services/auth.service';
import { UserProfileStateService } from '../../services/user-profile-state.service';
import { ElementRef, QueryList } from '@angular/core';

describe('ReelsComponent', () => {
  let component: ReelsComponent;
  let fixture: ComponentFixture<ReelsComponent>;

  let mockReelService: any;
  let mockLikeService: any;
  let mockFollowService: any;
  let mockAuthService: any;
  let mockUserProfileStateService: any;
  let mockActivatedRoute: any;

  beforeEach(async () => {
    // Mock IntersectionObserver
    class MockIntersectionObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    window.IntersectionObserver = MockIntersectionObserver as any;

    mockReelService = {
      getFeed: vi.fn().mockReturnValue(of([{ id: 1, videoUrl: 'test.mp4', userEmail: 'user1@test.com' }])),
      getMyReels: vi.fn().mockReturnValue(of([])),
      deleteReel: vi.fn().mockReturnValue(of({})),
      getReelComments: vi.fn().mockReturnValue(of([])),
      addReelComment: vi.fn().mockReturnValue(of({ id: 99, text: 'nice', userEmail: 'test@test.com', timestamp: new Date() }))
    };

    mockLikeService = {
      getLikeCount: vi.fn().mockReturnValue(of(10)),
      hasLiked: vi.fn().mockReturnValue(of(false)),
      likeTarget: vi.fn().mockReturnValue(of({})),
      unlikeTarget: vi.fn().mockReturnValue(of({}))
    };

    mockFollowService = {
      follow: vi.fn().mockReturnValue(of({})),
      unfollow: vi.fn().mockReturnValue(of({}))
    };

    mockAuthService = {
      getEmail: vi.fn().mockReturnValue('test@test.com'),
      getRole: vi.fn().mockReturnValue('USER')
    };

    mockUserProfileStateService = {
      getProfileByEmail: vi.fn().mockReturnValue(of({ username: 'User1' }))
    };

    mockActivatedRoute = {
      queryParamMap: of({ get: (key: string) => null })
    };

    await TestBed.configureTestingModule({
      imports: [ReelsComponent],
      providers: [
        { provide: ReelService, useValue: mockReelService },
        { provide: LikeService, useValue: mockLikeService },
        { provide: FollowService, useValue: mockFollowService },
        { provide: AuthService, useValue: mockAuthService },
        { provide: UserProfileStateService, useValue: mockUserProfileStateService },
        { provide: ActivatedRoute, useValue: mockActivatedRoute }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(ReelsComponent);
    component = fixture.componentInstance;
    
    // Mock ViewChildren
    component.videoElements = new QueryList<ElementRef<HTMLVideoElement>>();
    component.reelContainers = new QueryList<ElementRef<HTMLElement>>();
    
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should create and load feed', () => {
    expect(component).toBeTruthy();
    expect(mockReelService.getFeed).toHaveBeenCalled();
    expect(component.reels.length).toBeGreaterThan(0);
    expect(component.reels[0].id).toBe(1);
  });

  it('should format media URL correctly', () => {
    expect(component.getMediaUrl('http://test.com/v.mp4')).toBe('http://test.com/v.mp4');
    expect(component.getMediaUrl('/uploads/reels/v.mp4')).toBe('/uploads/reels/v.mp4');
    expect(component.getMediaUrl('v.mp4')).toBe('/v.mp4');
  });

  it('should toggle like successfully', () => {
    const reel = { id: 1, likesCount: 10 } as any;
    component.liked.clear();
    
    // Like
    component.toggleLike(reel);
    expect(component.liked.has(1)).toBe(true);
    expect(reel.likesCount).toBe(11);
    expect(mockLikeService.likeTarget).toHaveBeenCalledWith(1, 'REEL');

    // Unlike
    component.toggleLike(reel);
    expect(component.liked.has(1)).toBe(false);
    expect(reel.likesCount).toBe(10);
    expect(mockLikeService.unlikeTarget).toHaveBeenCalledWith(1, 'REEL');
  });

  it('should toggle save state', () => {
    const reel = { id: 1 } as any;
    component.saved.clear();
    
    component.toggleSave(reel);
    expect(component.saved.has(1)).toBe(true);
    
    component.toggleSave(reel);
    expect(component.saved.has(1)).toBe(false);
  });

  it('should open and close panels', () => {
    component.showComments = false;
    component.showSharePanel = true;
    
    component.toggleComments();
    expect(component.showComments).toBe(true);
    expect(component.showSharePanel).toBe(false);

    component.toggleShare();
    expect(component.showSharePanel).toBe(true);
    expect(component.showComments).toBe(false);

    component.closePanels();
    expect(component.showComments).toBe(false);
    expect(component.showSharePanel).toBe(false);
  });

  it('should correctly identify owner', () => {
    component.myEmail = 'test@test.com';
    expect(component.isOwner({ userEmail: 'test@test.com' } as any)).toBe(true);
    expect(component.isOwner({ userEmail: 'other@test.com' } as any)).toBe(false);
  });

  it('should check if user can delete reel', () => {
    component.myEmail = 'test@test.com';
    component.myRole = 'USER';
    
    expect(component.canDeleteReel({ userEmail: 'test@test.com' } as any)).toBe(true); // Owner
    expect(component.canDeleteReel({ userEmail: 'other@test.com' } as any)).toBe(false); // Not owner

    component.myRole = 'ADMIN';
    expect(component.canDeleteReel({ userEmail: 'other@test.com' } as any)).toBe(true); // Admin overrides
  });

  it('should manage follow state', () => {
    component.followUser('target@test.com');
    expect(mockFollowService.follow).toHaveBeenCalledWith('target@test.com');
    expect(component.isFollowingUser('target@test.com')).toBe(true);

    component.unfollowUser('target@test.com');
    expect(mockFollowService.unfollow).toHaveBeenCalledWith('target@test.com');
    expect(component.isFollowingUser('target@test.com')).toBe(false);
  });

  it('should add comment optimistically', () => {
    component.reels = [{ id: 1 }] as any;
    component.currentIndex = 0;
    component.commentText = 'test comment';
    
    component.addComment();
    
    expect(component.reelComments[1].length).toBe(1);
    expect(component.commentText).toBe('');
    expect(mockReelService.addReelComment).toHaveBeenCalledWith(1, 'test comment');
  });
});
