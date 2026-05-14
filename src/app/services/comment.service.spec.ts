import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { CommentService, CommentRequest } from './comment.service';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('CommentService', () => {
  let service: CommentService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [CommentService]
    });
    service = TestBed.inject(CommentService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should add a comment', () => {
    const mockRequest: CommentRequest = { postId: 1, content: 'Nice post!' };
    const mockResponse = { id: 10, ...mockRequest, userEmail: 'test@user.com', likeCount: 0, createdAt: '' };

    service.addComment(mockRequest).subscribe(res => {
      expect(res.id).toBe(10);
    });

    const req = httpMock.expectOne('/comments');
    expect(req.request.method).toBe('POST');
    req.flush(mockResponse);
  });

  it('should get comments for a post', () => {
    service.getCommentsByPost(1).subscribe(res => {
      expect(res.length).toBe(0);
    });
    const req = httpMock.expectOne('/comments/post/1');
    req.flush([]);
  });

  it('should get replies for a comment', () => {
    service.getReplies(10).subscribe();
    const req = httpMock.expectOne('/comments/replies/10');
    req.flush([]);
  });

  it('should delete a comment', () => {
    service.deleteComment(10).subscribe();
    const req = httpMock.expectOne('/comments/10');
    expect(req.request.method).toBe('DELETE');
    req.flush('Deleted');
  });

  it('should like a comment', () => {
    service.likeComment(10).subscribe();
    const req = httpMock.expectOne('/comments/10/like');
    req.flush('Liked');
  });

  it('should get comment count', () => {
    service.getCommentCount(1).subscribe(res => expect(res).toBe(5));
    httpMock.expectOne('/comments/count/1').flush(5);
  });

  it('should update a comment', () => {
    service.updateComment(10, 'Updated content').subscribe();
    const req = httpMock.expectOne('/comments/10');
    expect(req.request.method).toBe('PUT');
    req.flush({ id: 10, content: 'Updated content' });
  });
});
