import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { PostService } from './post.service';

describe('PostService', () => {
  let service: PostService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [PostService]
    });
    service = TestBed.inject(PostService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should get all posts', () => {
    const dummyPosts = [{ id: 1, content: 'Test' }];
    service.getAllPosts().subscribe((posts: any) => {
      expect(posts).toEqual(dummyPosts);
    });
    const req = httpMock.expectOne('/posts/all');
    expect(req.request.method).toBe('GET');
    req.flush(dummyPosts);
  });

  it('should get feed', () => {
    const dummyPosts = [{ id: 1, content: 'Test' }];
    service.getFeed().subscribe((posts: any) => {
      expect(posts).toEqual(dummyPosts);
    });
    const req = httpMock.expectOne('/posts/feed');
    expect(req.request.method).toBe('GET');
    req.flush(dummyPosts);
  });

  it('should get my posts', () => {
    const dummyPosts = [{ id: 1, content: 'Test' }];
    service.getMyPosts().subscribe((posts: any) => {
      expect(posts).toEqual(dummyPosts);
    });
    const req = httpMock.expectOne('/posts/my');
    expect(req.request.method).toBe('GET');
    req.flush(dummyPosts);
  });

  it('should get posts by user', () => {
    const dummyPosts = [{ id: 1, content: 'Test' }];
    service.getPostsByUser('user@test.com').subscribe((posts: any) => {
      expect(posts).toEqual(dummyPosts);
    });
    const req = httpMock.expectOne('/posts/user/user@test.com');
    expect(req.request.method).toBe('GET');
    req.flush(dummyPosts);
  });

  it('should create post', () => {
    const dummyPost = { id: 1, content: 'Test', title: 'T' };
    
    service.createPost(dummyPost as any).subscribe((post: any) => {
      expect(post).toEqual(dummyPost);
    });

    const req = httpMock.expectOne('/posts/create');
    expect(req.request.method).toBe('POST');
    req.flush(dummyPost);
  });

  it('should get post by id', () => {
    const dummyPost = { id: 1, content: 'Test' };
    service.getPostById(1).subscribe((post: any) => {
      expect(post).toEqual(dummyPost);
    });
    const req = httpMock.expectOne('/posts/1');
    expect(req.request.method).toBe('GET');
    req.flush(dummyPost);
  });

  it('should delete post', () => {
    service.deletePost(1).subscribe((res: any) => {
      expect(res).toBeTruthy();
    });
    const req = httpMock.expectOne('/posts/1');
    expect(req.request.method).toBe('DELETE');
    req.flush({});
  });
});
