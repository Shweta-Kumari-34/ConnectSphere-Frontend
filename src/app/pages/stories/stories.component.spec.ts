import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { StoriesComponent } from './stories.component';
import { of, throwError } from 'rxjs';
import { StoryService } from '../../services/story.service';
import { FollowService } from '../../services/follow.service';
import { AuthService } from '../../services/auth.service';
import { MediaUploadService } from '../../services/media-upload.service';
import { Router } from '@angular/router';

describe('StoriesComponent', () => {
  let component: StoriesComponent;
  let fixture: ComponentFixture<StoriesComponent>;

  let mockStoryService: any;
  let mockFollowService: any;
  let mockAuthService: any;
  let mockMediaUploadService: any;
  let mockRouter: any;

  beforeEach(async () => {
    mockStoryService = {
      getActiveStories: vi.fn().mockReturnValue(of([
        { id: 1, userEmail: 'test@test.com', mediaUrl: 'test1.jpg', createdAt: new Date() },
        { id: 2, userEmail: 'friend@test.com', mediaUrl: 'test2.jpg', createdAt: new Date() },
        { id: 3, userEmail: 'stranger@test.com', mediaUrl: 'test3.jpg', createdAt: new Date() }
      ])),
      createStory: vi.fn().mockReturnValue(of({ id: 99, mediaUrl: 'http://new.jpg' }))
    };

    mockFollowService = {
      getFollowing: vi.fn().mockReturnValue(of([{ followingEmail: 'friend@test.com' }]))
    };

    mockAuthService = {
      getEmail: vi.fn().mockReturnValue('test@test.com')
    };

    mockMediaUploadService = {
      validateFile: vi.fn().mockReturnValue(null),
      uploadStoryFile: vi.fn().mockReturnValue(of({ id: 100, mediaUrl: 'blob' }))
    };

    mockRouter = {
      navigate: vi.fn()
    };

    await TestBed.configureTestingModule({
      imports: [StoriesComponent],
      providers: [
        { provide: StoryService, useValue: mockStoryService },
        { provide: FollowService, useValue: mockFollowService },
        { provide: AuthService, useValue: mockAuthService },
        { provide: MediaUploadService, useValue: mockMediaUploadService },
        { provide: Router, useValue: mockRouter }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(StoriesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should create and load stories properly filtered by following', () => {
    expect(component).toBeTruthy();
    expect(mockStoryService.getActiveStories).toHaveBeenCalled();
    expect(mockFollowService.getFollowing).toHaveBeenCalled();
    
    // My own story should be populated
    expect(component.hasMyOwnStory).toBe(true);
    expect(component.myOwnStory?.id).toBe(1);

    // Active stories should only contain people I follow (friend@test.com)
    expect(component.activeStories.length).toBe(1);
    expect(component.activeStories[0].id).toBe(2);
  });

  it('should open and close story viewer', () => {
    expect(component.showStoryViewer).toBe(false);

    component.openMyStory();
    expect(component.showStoryViewer).toBe(true);
    expect(component.viewerStories[0].id).toBe(1);

    component.closeStoryViewer();
    expect(component.showStoryViewer).toBe(false);

    component.openStoryViewer(0);
    expect(component.showStoryViewer).toBe(true);
    expect(component.viewerStories[0].id).toBe(2);
  });

  it('should handle file selection and validation', () => {
    const mockFile = new File([''], 'test.png', { type: 'image/png' });
    const mockEvent = { target: { files: [mockFile] } } as any;

    component.onFileSelected(mockEvent);
    expect(mockMediaUploadService.validateFile).toHaveBeenCalledWith(mockFile);
    expect(component.selectedFiles.length).toBe(1);
    expect(component.fileError).toBe('');
  });

  it('should handle file validation errors', () => {
    mockMediaUploadService.validateFile.mockReturnValue('File too large');
    const mockFile = new File([''], 'test.png', { type: 'image/png' });
    const mockEvent = { target: { files: [mockFile] } } as any;

    component.onFileSelected(mockEvent);
    expect(component.fileError).toBe('File too large');
    expect(component.selectedFiles.length).toBe(0);
  });

  it('should create story via URL', async () => {
    component.newMediaUrl = 'http://new.jpg';
    await component.createStory();

    expect(mockStoryService.createStory).toHaveBeenCalledWith('http://new.jpg', '');
    expect(mockRouter.navigate).toHaveBeenCalled();
    expect(component.successMessage).toBeTruthy();
    expect(component.showForm).toBe(false);
  });

  it('should create story via File upload', async () => {
    component.selectedFiles = [new File([''], 'test.png')];
    component.newCaption = 'My new story';
    
    await component.createStory();

    expect(mockMediaUploadService.uploadStoryFile).toHaveBeenCalled();
    expect(mockRouter.navigate).toHaveBeenCalled();
  });

  it('should clear composer state', () => {
    component.newMediaUrl = 'test';
    component.newCaption = 'test';
    component.selectedFiles = [new File([''], 'test')];
    
    component.clearComposer();
    
    expect(component.newMediaUrl).toBe('');
    expect(component.newCaption).toBe('');
    expect(component.selectedFiles.length).toBe(0);
  });
});
