import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { ReelService } from './reel.service';

describe('ReelService', () => {
  let service: ReelService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [ReelService]
    });
    service = TestBed.inject(ReelService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should get feed', () => {
    const dummyReels = [{ id: 1, videoUrl: 'test.mp4' }];
    service.getFeed('user@test.com').subscribe((reels: any) => {
      expect(reels).toEqual(dummyReels);
    });
    const req = httpMock.expectOne('/api/reels/feed/user@test.com');
    expect(req.request.method).toBe('GET');
    req.flush(dummyReels);
  });

  it('should get my reels', () => {
    const dummyReels = [{ id: 1 }];
    service.getMyReels('user@test.com').subscribe((reels: any) => {
      expect(reels).toEqual(dummyReels);
    });
    const req = httpMock.expectOne('/api/reels/my-reels/user@test.com');
    expect(req.request.method).toBe('GET');
    req.flush(dummyReels);
  });

  it('should create reel', () => {
    const file = new File([''], 'test.mp4', { type: 'video/mp4' });
    service.createReel(file, 'Test', 'PUBLIC', 'user@test.com').subscribe((res: any) => {
      expect(res).toBeTruthy();
    });
    const req = httpMock.expectOne('/api/reels/upload');
    expect(req.request.method).toBe('POST');
    expect(req.request.body instanceof FormData).toBe(true);
    req.flush({});
  });

  it('should get reel comments', () => {
    const comments = [{ id: 1, text: 'nice' }];
    service.getReelComments(1).subscribe((res: any) => {
      expect(res).toEqual(comments);
    });
    const req = httpMock.expectOne('/api/reels/1/comments');
    expect(req.request.method).toBe('GET');
    req.flush(comments);
  });

  it('should add reel comment', () => {
    const comment = { id: 1, text: 'nice' };
    service.addReelComment(1, 'nice').subscribe((res: any) => {
      expect(res).toEqual(comment);
    });
    const req = httpMock.expectOne('/api/reels/1/comments');
    expect(req.request.method).toBe('POST');
    req.flush(comment);
  });

  it('should delete reel', () => {
    service.deleteReel(1).subscribe((res: any) => {
      expect(res).toBeTruthy();
    });
    const req = httpMock.expectOne('/api/reels/1');
    expect(req.request.method).toBe('DELETE');
    req.flush({});
  });
});
