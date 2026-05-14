import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { MediaUploadService } from './media-upload.service';

describe('MediaUploadService', () => {
  let service: MediaUploadService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [MediaUploadService]
    });
    service = TestBed.inject(MediaUploadService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should validate valid file successfully', () => {
    const file = new File([''], 'test.jpg', { type: 'image/jpeg' });
    Object.defineProperty(file, 'size', { value: 1024 * 1024 }); // 1MB
    const error = service.validateFile(file);
    expect(error).toBeNull();
  });

  it('should reject file that is too large', () => {
    const file = new File([''], 'test.jpg', { type: 'image/jpeg' });
    Object.defineProperty(file, 'size', { value: 100 * 1024 * 1024 }); // 100MB
    const error = service.validateFile(file);
    expect(error).toBeTruthy();
    expect(error).toContain('too large');
  });

  it('should reject file with invalid format', () => {
    const file = new File([''], 'test.txt', { type: 'text/plain' });
    Object.defineProperty(file, 'size', { value: 1024 });
    const error = service.validateFile(file);
    expect(error).toBeTruthy();
    expect(error).toContain('Unsupported file type');
  });

  it('should upload post media file', () => {
    const file = new File([''], 'test.jpg', { type: 'image/jpeg' });
    service.uploadFileToPost(1, file).subscribe((res: any) => {
      expect(res).toBeTruthy();
    });
    const req = httpMock.expectOne('/media/upload/file');
    expect(req.request.method).toBe('POST');
    req.flush({ url: 'http://new.jpg' });
  });

  it('should upload story file', () => {
    const file = new File([''], 'test.jpg', { type: 'image/jpeg' });
    service.uploadStoryFile(file, 'caption').subscribe((res: any) => {
      expect(res).toBeTruthy();
    });
    const req = httpMock.expectOne('/media/stories/upload');
    expect(req.request.method).toBe('POST');
    req.flush({ id: 1 });
  });
});
