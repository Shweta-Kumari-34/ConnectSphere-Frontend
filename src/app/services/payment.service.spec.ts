import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { PaymentService, PaymentRequest, PaymentConfirmRequest } from './payment.service';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('PaymentService', () => {
  let service: PaymentService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [PaymentService]
    });
    service = TestBed.inject(PaymentService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('Payment Intents', () => {
    it('should create a payment intent via standard API', () => {
      const mockRequest: PaymentRequest = {
        planCode: 'PREMIUM_MEMBERSHIP',
        paymentProvider: 'RAZORPAY',
        paymentMethod: 'CARD',
        amount: 999
      };

      const mockResponse = {
        paymentId: 1,
        razorpayOrderId: 'order_123',
        status: 'PENDING'
      };

      service.createPaymentIntent(mockRequest).subscribe(res => {
        expect(res.paymentId).toBe(1);
        expect(res.razorpayOrderId).toBe('order_123');
      });

      const req = httpMock.expectOne('/payments/intent');
      expect(req.request.method).toBe('POST');
      req.flush(mockResponse);
    });

    it('should fallback to legacy process endpoint if intent fails with 404', () => {
      const mockRequest: PaymentRequest = {
        planCode: 'VERIFIED_BADGE',
        paymentProvider: 'UPI_QR',
        paymentMethod: 'UPI'
      };

      const mockLegacyResponse = {
        paymentId: 99,
        status: 'SUCCESS',
        amount: 699
      };

      service.createPaymentIntent(mockRequest).subscribe(res => {
        expect(res.paymentId).toBe(99);
        expect(res.upiQrPayload).toContain('upi://pay');
      });

      // First call to /intent fails
      const req1 = httpMock.expectOne('/payments/intent');
      req1.flush('Not Found', { status: 404, statusText: 'Not Found' });

      // Second call to legacy /process
      const req2 = httpMock.expectOne('/payments/process');
      req2.flush(mockLegacyResponse);
    });
  });

  describe('Subscription Management', () => {
    it('should set auto-renew status', () => {
      service.setAutoRenew(10, true).subscribe(res => {
        expect(res.autoRenew).toBe(true);
      });

      const req = httpMock.expectOne('/payments/subscriptions/10/auto-renew');
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual({ autoRenew: true });
      req.flush({ id: 10, autoRenew: true });
    });

    it('should cancel a subscription', () => {
      service.cancelSubscription(10).subscribe(res => {
        expect(res.status).toBe('CANCELLED');
      });

      const req = httpMock.expectOne('/payments/subscriptions/10/cancel');
      req.flush({ id: 10, status: 'CANCELLED' });
    });
  });

  describe('Receipts', () => {
    it('should fetch receipt via standard API', () => {
      const mockReceipt = { receiptNumber: 'RCP-123', amount: 500 };

      service.getReceipt(1).subscribe(res => {
        expect(res.receiptNumber).toBe('RCP-123');
      });

      const req = httpMock.expectOne('/payments/receipts/1');
      req.flush(mockReceipt);
    });

    it('should handle receipt download as blob', () => {
      const mockBlob = new Blob(['pdf-content'], { type: 'application/pdf' });

      service.downloadReceiptPdf(1).subscribe(res => {
        expect(res.size).toBeGreaterThan(0);
      });

      const req = httpMock.expectOne('/payments/receipts/1/download');
      expect(req.request.responseType).toBe('blob');
      req.flush(mockBlob);
    });
  });

  describe('Verification Requests', () => {
    it('should submit verification request with FormData', () => {
      const payload = {
        reason: 'Test Reason',
        includeDocument: true,
        includeSelfie: false,
        document: new File([''], 'doc.jpg')
      };

      service.submitVerificationRequest(payload).subscribe(res => {
        expect(res.status).toBe('SUBMITTED');
      });

      const req = httpMock.expectOne('/auth/verification/apply');
      expect(req.request.method).toBe('POST');
      expect(req.request.body instanceof FormData).toBe(true);
      req.flush({ status: 'SUBMITTED' });
    });

    it('should check verification eligibility', () => {
      service.getVerificationEligibility().subscribe(res => {
        expect(res.eligible).toBe(true);
      });
      const req = httpMock.expectOne('/auth/verification/eligibility');
      req.flush({ eligible: true, blockers: [], username: 'test' });
    });

    it('should get my verification request', () => {
      service.getMyVerificationRequest().subscribe(res => {
        expect(res.id).toBe(123);
      });
      const req = httpMock.expectOne('/auth/verification/my-request');
      req.flush({ id: 123, status: 'PENDING' });
    });
  });
});
