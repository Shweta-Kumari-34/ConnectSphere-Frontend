import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, of, throwError } from 'rxjs';

export interface PaymentRequest {
  planCode: 'VERIFIED_BADGE' | 'PREMIUM_MEMBERSHIP';
  paymentProvider: 'UPI_QR' | 'RAZORPAY';
  paymentMethod: 'UPI' | 'CARD' | 'WALLET';
  amount?: number;
  description?: string;
  autoRenew?: boolean;
  theme?: string;
}

export interface PaymentIntent {
  paymentId: number;
  message: string;
  amount: number;
  currency: string;
  planCode: string;
  status: string;
  transactionId: string;
  paymentProvider: string;
  paymentMethod: string;
  providerOrderId?: string;
  razorpayOrderId?: string;
  razorpayKeyId?: string;
  receiptNumber?: string;
  upiQrPayload?: string;
  upiQrImageUrl?: string;
  createdAt: string;
  confirmedAt?: string;
  expiresAt?: string;
}

export interface PaymentConfirmRequest {
  paymentId: number;
  providerPaymentId?: string;
  providerSignature?: string;
  upiReference?: string;
  webhookEventId?: string;
  success?: boolean;
}

export interface Payment {
  paymentId: number;
  userEmail: string;
  amount: number;
  currency: string;
  description: string;
  paymentMethod: string;
  paymentProvider: string;
  providerOrderId: string;
  providerPaymentId: string;
  planCode: string;
  transactionId: string;
  receiptNumber: string;
  status: string;
  createdAt: string;
  confirmedAt?: string;
  expiresAt?: string;
}

export interface SubscriptionRecord {
  id: number;
  userEmail: string;
  planCode: string;
  status: 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'PENDING';
  startedAt: string;
  expiresAt: string;
  autoRenew: boolean;
  lastRenewedAt?: string;
  cancelledAt?: string;
  featureSnapshot?: string;
}

export interface VerificationEligibility {
  eligible: boolean;
  blockers: string[];
  username: string;
  profilePicPresent: boolean;
  accountCreatedAt: string;
  existingRequest?: VerificationRequest | null;
}

export interface VerificationRequest {
  id: number;
  userEmail: string;
  username: string;
  fullName: string;
  profilePicUrl: string;
  reason: string;
  documentUrl?: string;
  selfieUrl?: string;
  status: string;
  rejectionReason?: string;
  adminNote?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  submittedAt?: string;
  message?: string;
}

@Injectable({ providedIn: 'root' })
export class PaymentService {
  private readonly PAYMENTS_API_URL = '/payments';
  private readonly AUTH_API_URL = '/auth';
  private readonly DEMO_UPI_VPA = 'demo.connectsphere@okaxis';
  private readonly DEMO_UPI_NAME = 'ConnectSphere Demo Merchant';

  constructor(private http: HttpClient) {}

  createPaymentIntent(request: PaymentRequest): Observable<PaymentIntent> {
    return this.http.post<PaymentIntent>(`${this.PAYMENTS_API_URL}/intent`, request).pipe(
      catchError((err) => {
        const status = Number(err?.status || 0);
        if (![404, 405, 501].includes(status)) {
          return throwError(() => err);
        }
        // Legacy fallback for running servers that still expose /payments/process only.
        return this.http.post<any>(`${this.PAYMENTS_API_URL}/process`, {
          amount: request.planCode === 'VERIFIED_BADGE' ? 699 : 999,
          description: request.planCode === 'VERIFIED_BADGE' ? 'ConnectSphere Verified Badge' : 'ConnectSphere Premium Membership',
          paymentMethod: request.paymentMethod
        }).pipe(
          map((legacy) => {
            const amount = legacy.amount || (request.planCode === 'VERIFIED_BADGE' ? 699 : 999);
            const transactionId = legacy.transactionId || `TXN-${Date.now()}`;
            const upiQrPayload = request.paymentProvider === 'UPI_QR'
              ? this.buildDemoUpiPayload(amount, transactionId, request.planCode)
              : '';

            return {
              paymentId: legacy.paymentId,
              message: legacy.message || 'Demo payment processed successfully',
              amount,
              currency: 'INR',
              planCode: request.planCode,
              status: legacy.status || 'SUCCESS',
              transactionId,
              paymentProvider: request.paymentProvider,
              paymentMethod: request.paymentMethod,
              providerOrderId: `legacy-order-${legacy.paymentId || Date.now()}`,
              receiptNumber: legacy.receiptNumber,
              upiQrPayload,
              upiQrImageUrl: request.paymentProvider === 'UPI_QR'
                ? this.buildDemoQrImage(request.planCode, amount, transactionId, upiQrPayload)
                : '',
              createdAt: legacy.createdAt || new Date().toISOString(),
              confirmedAt: legacy.createdAt || new Date().toISOString(),
              expiresAt: ''
            } as PaymentIntent;
          })
        );
      })
    );
  }

  confirmPayment(request: PaymentConfirmRequest): Observable<PaymentIntent> {
    return this.http.post<PaymentIntent>(`${this.PAYMENTS_API_URL}/confirm`, request).pipe(
      catchError((err) => {
        const status = Number(err?.status || 0);
        if (![404, 405, 501].includes(status)) {
          return throwError(() => err);
        }
        // Legacy servers process payment directly during /intent fallback.
        return of({
          paymentId: request.paymentId,
          message: request.success === false ? 'Payment marked failed' : 'Demo payment processed (legacy fallback)',
          amount: 0,
          currency: 'INR',
          planCode: '',
          status: request.success === false ? 'FAILED' : 'SUCCESS',
          transactionId: `LEGACY-${request.paymentId}`,
          paymentProvider: '',
          paymentMethod: '',
          createdAt: new Date().toISOString(),
          confirmedAt: new Date().toISOString(),
          expiresAt: ''
        } as PaymentIntent);
      })
    );
  }

  getMyPayments(): Observable<Payment[]> {
    return this.http.get<Payment[]>(`${this.PAYMENTS_API_URL}/my`);
  }

  getMySubscriptions(): Observable<SubscriptionRecord[]> {
    return this.http.get<SubscriptionRecord[]>(`${this.PAYMENTS_API_URL}/subscriptions/my`);
  }

  setAutoRenew(subscriptionId: number, autoRenew: boolean): Observable<SubscriptionRecord> {
    return this.http.put<SubscriptionRecord>(`${this.PAYMENTS_API_URL}/subscriptions/${subscriptionId}/auto-renew`, { autoRenew });
  }

  cancelSubscription(subscriptionId: number): Observable<SubscriptionRecord> {
    return this.http.put<SubscriptionRecord>(`${this.PAYMENTS_API_URL}/subscriptions/${subscriptionId}/cancel`, {});
  }

  renewSubscription(subscriptionId: number, theme?: string): Observable<SubscriptionRecord> {
    return this.http.post<SubscriptionRecord>(`${this.PAYMENTS_API_URL}/subscriptions/${subscriptionId}/renew`, { theme });
  }

  upgradeSubscription(subscriptionId: number, targetPlanCode: 'PREMIUM_MEMBERSHIP'): Observable<SubscriptionRecord> {
    return this.http.post<SubscriptionRecord>(`${this.PAYMENTS_API_URL}/subscriptions/${subscriptionId}/upgrade`, { targetPlanCode });
  }

  getReceipt(paymentId: number): Observable<any> {
    return this.http.get<any>(`${this.PAYMENTS_API_URL}/receipts/${paymentId}`).pipe(
      catchError((err) => {
        const status = Number(err?.status || 0);
        if (![404, 405, 501].includes(status)) {
          return throwError(() => err);
        }
        return this.http.get<any>(`${this.PAYMENTS_API_URL}/${paymentId}`).pipe(
          map((payment) => ({
            receiptNumber: payment?.receiptNumber || `RCP-LEGACY-${paymentId}`,
            transactionId: payment?.transactionId || `LEGACY-${paymentId}`,
            paymentId,
            planCode: payment?.planCode || 'LEGACY_PLAN',
            amount: payment?.amount || 0,
            currency: payment?.currency || 'INR',
            paidAt: payment?.createdAt || new Date().toISOString(),
            paymentMethod: payment?.paymentMethod || 'UPI',
            paymentProvider: payment?.paymentProvider || 'LEGACY'
          }))
        );
      })
    );
  }

  downloadReceiptPdf(paymentId: number): Observable<Blob> {
    return this.http.get(`${this.PAYMENTS_API_URL}/receipts/${paymentId}/download`, { responseType: 'blob' });
  }

  getVerificationEligibility(): Observable<VerificationEligibility> {
    return this.http.get<VerificationEligibility>(`${this.AUTH_API_URL}/verification/eligibility`);
  }

  getMyVerificationRequest(): Observable<VerificationRequest> {
    return this.http.get<VerificationRequest>(`${this.AUTH_API_URL}/verification/my-request`);
  }

  submitVerificationRequest(payload: {
    reason?: string;
    includeDocument: boolean;
    includeSelfie: boolean;
    document?: File | null;
    selfie?: File | null;
  }): Observable<VerificationRequest> {
    const formData = new FormData();
    if (payload.reason) {
      formData.append('reason', payload.reason);
    }
    formData.append('includeDocument', String(payload.includeDocument));
    formData.append('includeSelfie', String(payload.includeSelfie));
    if (payload.document) {
      formData.append('document', payload.document);
    }
    if (payload.selfie) {
      formData.append('selfie', payload.selfie);
    }
    return this.http.post<VerificationRequest>(`${this.AUTH_API_URL}/verification/apply`, formData);
  }

  private buildDemoUpiPayload(amount: number, transactionId: string, planCode: string): string {
    const planLabel = planCode === 'VERIFIED_BADGE' ? 'Verified Badge' : 'Premium Membership';
    return `upi://pay?pa=${encodeURIComponent(this.DEMO_UPI_VPA)}&pn=${encodeURIComponent(this.DEMO_UPI_NAME)}&am=${amount.toFixed(2)}&cu=INR&tr=${encodeURIComponent(transactionId)}&tn=${encodeURIComponent(`ConnectSphere demo payment for ${planLabel}`)}&mc=5814`;
  }

  private buildDemoQrImage(planCode: string, amount: number, transactionId: string, upiPayload: string): string {
    const planLabel = planCode === 'VERIFIED_BADGE' ? 'Verified Badge' : 'Premium Membership';
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="360" height="420" viewBox="0 0 360 420">
        <rect width="360" height="420" rx="24" fill="#0f172a"/>
        <rect x="24" y="24" width="312" height="372" rx="18" fill="#ffffff"/>
        <rect x="52" y="84" width="256" height="256" rx="12" fill="#e2e8f0"/>
        <text x="180" y="126" text-anchor="middle" font-family="Arial" font-size="18" font-weight="700" fill="#0f172a">DEMO QR</text>
        <text x="180" y="154" text-anchor="middle" font-family="Arial" font-size="11" fill="#475569">No real bank account required</text>
        <text x="180" y="196" text-anchor="middle" font-family="monospace" font-size="12" fill="#0f172a">PLAN: ${planLabel}</text>
        <text x="180" y="220" text-anchor="middle" font-family="monospace" font-size="12" fill="#0f172a">AMOUNT: INR ${amount.toFixed(2)}</text>
        <text x="180" y="244" text-anchor="middle" font-family="monospace" font-size="12" fill="#0f172a">TXN: ${transactionId}</text>
        <text x="180" y="310" text-anchor="middle" font-family="Arial" font-size="10" fill="#64748b">Use Confirm Payment to simulate success</text>
        <text x="180" y="352" text-anchor="middle" font-family="Arial" font-size="11" font-weight="700" fill="#2563eb">Demo UPI payload attached</text>
        <text x="180" y="374" text-anchor="middle" font-family="Arial" font-size="9" fill="#64748b">${this.escapeXml(upiPayload)}</text>
      </svg>`;
    return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
  }

  private escapeXml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
