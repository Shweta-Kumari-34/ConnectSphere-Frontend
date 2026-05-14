import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { StoryService } from './story.service';

describe('StoryService', () => {
  let service: StoryService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [StoryService]
    });
    service = TestBed.inject(StoryService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should get active stories', () => {
    const stories = [{ id: 1 }];
    service.getActiveStories().subscribe((res: any) => {
      expect(res).toEqual(stories);
    });
    const req = httpMock.expectOne('/media/stories/active');
    expect(req.request.method).toBe('GET');
    req.flush(stories);
  });

  it('should get user stories', () => {
    const stories = [{ id: 1 }];
    service.getUserStories('user@test.com').subscribe((res: any) => {
      expect(res).toEqual(stories);
    });
    const req = httpMock.expectOne('/media/stories/user/user@test.com');
    expect(req.request.method).toBe('GET');
    req.flush(stories);
  });

  it('should create story', () => {
    const story = { id: 1 };
    service.createStory('http://test.jpg', 'caption').subscribe((res: any) => {
      expect(res).toEqual(story);
    });
    const req = httpMock.expectOne('/media/stories?mediaUrl=http%3A%2F%2Ftest.jpg&caption=caption');
    expect(req.request.method).toBe('POST');
    req.flush(story);
  });

  it('should delete story', () => {
    service.deleteStory(1).subscribe((res: any) => {
      expect(res).toBeTruthy();
    });
    const req = httpMock.expectOne('/media/stories/1');
    expect(req.request.method).toBe('DELETE');
    req.flush({});
  });
});
