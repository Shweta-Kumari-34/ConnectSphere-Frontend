import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DashboardComponent } from './dashboard.component';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { PostService } from '../../services/post.service';
import { PaymentService } from '../../services/payment.service';
import { FollowService } from '../../services/follow.service';
import { LikeService } from '../../services/like.service';
import { NotificationService } from '../../services/notification.service';
import { UserProfileStateService } from '../../services/user-profile-state.service';
import { ReelService } from '../../services/reel.service';
import { StoryService } from '../../services/story.service';
import { SearchService } from '../../services/search.service';

describe('DashboardComponent', () => {
  let component: DashboardComponent;
  let fixture: ComponentFixture<DashboardComponent>;

  // Mock Services
  let mockAuthService: any;
  let mockPostService: any;
  let mockPaymentService: any;
  let mockFollowService: any;
  let mockLikeService: any;
  let mockNotificationService: any;
  let mockUserProfileStateService: any;
  let mockReelService: any;
  let mockStoryService: any;
  let mockSearchService: any;

  beforeEach(async () => {
    mockAuthService = {
      getUsername: vi.fn().mockReturnValue('TestUser'),
      getRole: vi.fn().mockReturnValue('USER'),
      getEmail: vi.fn().mockReturnValue('test@test.com'),
      canAccessAdminPanel: vi.fn().mockReturnValue(false),
      isModerator: vi.fn().mockReturnValue(false),
      isAdmin: vi.fn().mockReturnValue(false)
    };

    mockPostService = {
      getMyPosts: vi.fn().mockReturnValue(of([]))
    };

    mockPaymentService = {
      getMyPayments: vi.fn().mockReturnValue(of([]))
    };

    mockFollowService = {
      getFollowerCount: vi.fn().mockReturnValue(of(100)),
      getFollowingCount: vi.fn().mockReturnValue(of(50)),
      getSuggestedUsers: vi.fn().mockReturnValue(of(['user1@test.com', 'user2@test.com']))
    };

    mockLikeService = {
      getLikeCount: vi.fn().mockReturnValue(of(5))
    };

    mockNotificationService = {
      unreadCount$: of(2),
      getNotifications: vi.fn().mockReturnValue(of({ notifications: [], totalPages: 1 }))
    };

    mockUserProfileStateService = {
      getCurrentUserProfile: vi.fn().mockReturnValue(of({
        isVerified: true,
        profilePicUrl: 'http://pic.com/1.jpg',
        isPremiumMember: true,
        username: 'TestUser',
        email: 'test@test.com',
        fullName: 'Test User',
        bio: 'Hello world'
      }))
    };

    mockReelService = {
      getMyReels: vi.fn().mockReturnValue(of([]))
    };

    mockStoryService = {
      getUserStories: vi.fn().mockReturnValue(of([]))
    };

    mockSearchService = {
      getTrending: vi.fn().mockReturnValue(of([{ tag: '#trending1' }]))
    };

    await TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: mockAuthService },
        { provide: PostService, useValue: mockPostService },
        { provide: PaymentService, useValue: mockPaymentService },
        { provide: FollowService, useValue: mockFollowService },
        { provide: LikeService, useValue: mockLikeService },
        { provide: NotificationService, useValue: mockNotificationService },
        { provide: UserProfileStateService, useValue: mockUserProfileStateService },
        { provide: ReelService, useValue: mockReelService },
        { provide: StoryService, useValue: mockStoryService },
        { provide: SearchService, useValue: mockSearchService }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(DashboardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should initialize basic user info from auth service', () => {
    expect(component.username).toBe('TestUser');
    expect(component.role).toBe('USER');
    expect(mockAuthService.getUsername).toHaveBeenCalled();
  });

  it('should calculate profile completion correctly', () => {
    // With all fields provided in mock, it should be 100%
    // Note: total steps is 5.
    // 1: email/username
    // 2: fullName
    // 3: bio
    // 4: profilePicUrl
    // 5: activity or verification
    expect(component.profileCompletion).toBe(100);
  });

  it('should fetch trending hashtags correctly', () => {
    expect(mockSearchService.getTrending).toHaveBeenCalledWith(1);
    expect(component.trendingHashtag).toBe('#trending1');
  });

  it('should get correct greeting based on time', () => {
    const originalGetHours = Date.prototype.getHours;
    
    Date.prototype.getHours = vi.fn().mockReturnValue(9);
    expect(component.getGreeting()).toBe('Good Morning');

    Date.prototype.getHours = vi.fn().mockReturnValue(14);
    expect(component.getGreeting()).toBe('Good Afternoon');

    Date.prototype.getHours = vi.fn().mockReturnValue(20);
    expect(component.getGreeting()).toBe('Good Evening');

    Date.prototype.getHours = originalGetHours;
  });

  it('should return correct time ago', () => {
    const now = Date.now();
    expect(component.timeAgo(new Date(now - 30 * 1000).toISOString())).toBe('just now');
    expect(component.timeAgo(new Date(now - 120 * 1000).toISOString())).toBe('2m ago');
    expect(component.timeAgo(new Date(now - 7200 * 1000).toISOString())).toBe('2h ago');
    expect(component.timeAgo(new Date(now - 172800 * 1000).toISOString())).toBe('2d ago');
    expect(component.timeAgo('')).toBe('');
  });

  it('should format notification text correctly', () => {
    expect(component.decodeNotificationText('Hello%20World')).toBe('Hello World');
    expect(component.decodeNotificationText('Hello%20World%21')).toBe('Hello World!');
    expect(component.decodeNotificationText('')).toBe('');
  });

  it('should return correct action url for notifications', () => {
    const mockPostNotif = { type: 'like_post', targetPostId: 123 };
    expect(component.buildActionUrl(mockPostNotif)).toBe('/posts?postId=123');

    const mockReelNotif = { type: 'like_reel', targetReelId: 456 };
    expect(component.buildActionUrl(mockReelNotif)).toBe('/reels?reelId=456');

    const mockFollowNotif = { type: 'follow', senderEmail: 'friend@test.com' };
    expect(component.buildActionUrl(mockFollowNotif)).toBe('/user/friend@test.com');
  });

  it('should check admin access correctly', () => {
    expect(component.canAccessAdminPanel()).toBe(false);
    
    mockAuthService.canAccessAdminPanel.mockReturnValue(true);
    expect(component.canAccessAdminPanel()).toBe(true);
  });
});
