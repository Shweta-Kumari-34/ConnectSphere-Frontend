import { Component, ElementRef, OnInit, ViewChild, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { finalize, timeout } from 'rxjs';
import {
  Payment,
  PaymentIntent,
  PaymentService,
  SubscriptionRecord,
  VerificationEligibility,
  VerificationRequest
} from '../../services/payment.service';
import { UserProfileState, UserProfileStateService } from '../../services/user-profile-state.service';

declare global {
  interface Window {
    Razorpay?: any;
  }
}

@Component({
  selector: 'app-payments',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './payments.component.html',
  styleUrl: './payments.component.scss'
})
export class PaymentsComponent implements OnInit {
  @ViewChild('subscriptionSection') subscriptionSection?: ElementRef<HTMLElement>;

  loading = false;
  successMessage = '';
  errorMessage = '';
  pendingConfirmationAction: 'success' | 'failed' | '' = '';
  checkoutOverlayState: 'idle' | 'processing' | 'success' = 'idle';
  private processingOverlayTimer: number | null = null;
  paymentSuccessState: {
    title: string;
    message: string;
    planCode: string;
    planName: string;
    amount: number;
    currency: string;
    paidAmountLabel: string;
    paymentId: number;
    confirmedAt?: string | null;
    receiptNumber?: string | null;
    transactionId?: string | null;
    checklist: string[];
  } | null = null;

  currentProfile: UserProfileState | null = null;
  eligibility: VerificationEligibility | null = null;
  verificationRequest: VerificationRequest | null = null;
  payments: Payment[] = [];
  subscriptions: SubscriptionRecord[] = [];

  selectedProvider: 'UPI_QR' | 'RAZORPAY' = 'UPI_QR';
  pendingIntent: PaymentIntent | null = null;
  processingPlan: 'VERIFIED_BADGE' | 'PREMIUM_MEMBERSHIP' | '' = '';
  private razorpayScriptLoaded = false;
  premiumTheme = 'CLASSIC';
  autoRenew = true;

  verificationReason = '';
  verificationReasonPreset = 'PUBLIC_FIGURE';
  readonly verificationReasonOptions = [
    { value: 'PUBLIC_FIGURE', label: 'Public Figure / Creator' },
    { value: 'BRAND_BUSINESS', label: 'Brand / Business Authenticity' },
    { value: 'IMITATION_RISK', label: 'High Imitation / Identity Risk' },
    { value: 'JOURNALIST_MEDIA', label: 'Journalist / Media Presence' },
    { value: 'OTHER', label: 'Other (custom reason)' }
  ];
  includeDocument = false;
  includeSelfie = false;
  documentFile: File | null = null;
  selfieFile: File | null = null;

  constructor(
    private paymentService: PaymentService,
    private profileStateService: UserProfileStateService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loadAll();
  }

  loadAll(): void {
    this.profileStateService.getCurrentUserProfile(true).subscribe({
      next: (profile) => (this.currentProfile = profile),
      error: () => (this.currentProfile = null)
    });

    this.paymentService.getVerificationEligibility().subscribe({
      next: (res) => (this.eligibility = res),
      error: () => (this.eligibility = null)
    });

    this.paymentService.getMyVerificationRequest().subscribe({
      next: (res) => (this.verificationRequest = res),
      error: () => (this.verificationRequest = null)
    });

    this.paymentService.getMyPayments().subscribe({
      next: (res) => (this.payments = [...res]),
      error: () => (this.payments = [])
    });

    this.paymentService.getMySubscriptions().subscribe({
      next: (res) => (this.subscriptions = [...res]),
      error: () => (this.subscriptions = [])
    });
  }

  get verifiedActive(): boolean {
    return !!this.currentProfile?.isVerified;
  }

  get premiumActive(): boolean {
    return !!this.currentProfile?.isPremiumMember;
  }

  get canApplyForVerification(): boolean {
    return !!this.eligibility?.eligible && !this.verifiedActive;
  }

  submitVerificationApplication(): void {
    this.loading = true;
    this.clearMessages();
    const finalReason = this.verificationReasonPreset === 'OTHER'
      ? this.verificationReason
      : this.verificationReasonOptions.find((option) => option.value === this.verificationReasonPreset)?.label || this.verificationReason;

    this.paymentService.submitVerificationRequest({
      reason: finalReason,
      includeDocument: this.includeDocument,
      includeSelfie: this.includeSelfie,
      document: this.documentFile,
      selfie: this.selfieFile
    }).pipe(
      timeout(15000),
      finalize(() => { this.loading = false; })
    ).subscribe({
      next: (res) => {
        this.verificationRequest = res;
        this.successMessage = 'Verification application submitted. Wait for admin review, then complete payment.';
        this.loadAll();
      },
      error: (err) => {
        this.errorMessage = err?.error?.message || 'Could not submit verification request.';
      }
    });
  }

  startPlanPayment(planCode: 'VERIFIED_BADGE' | 'PREMIUM_MEMBERSHIP'): void {
    try {
      if (planCode === 'VERIFIED_BADGE') {
        const status = (this.verificationRequest?.status || '').toUpperCase();
        const verificationAllowed = status === 'PAYMENT_PENDING' || status === 'APPROVED';
        if (!this.eligibility?.eligible || !verificationAllowed) {
          this.clearMessages();
          this.errorMessage = 'Complete verification eligibility and wait for admin approval before paying for Verified Badge.';
          return;
        }
      }

      this.loading = true;
      this.processingPlan = planCode;
      this.clearMessages();
      this.pendingIntent = null;

      this.paymentService.createPaymentIntent({
        planCode,
        paymentProvider: this.selectedProvider,
        paymentMethod: this.selectedProvider === 'UPI_QR' ? 'UPI' : 'CARD',
        autoRenew: planCode === 'PREMIUM_MEMBERSHIP' ? this.autoRenew : false,
        theme: this.premiumTheme
      }).pipe(
        timeout(20000),
        finalize(() => {
          this.loading = false;
          if (!this.pendingIntent) {
            this.processingPlan = '';
          }
        })
      ).subscribe({
        next: (intent) => {
          const status = (intent?.status || '').toUpperCase();
          if (status === 'SUCCESS' || status === 'CONFIRMED') {
            this.processingPlan = '';
            this.pendingIntent = null;
            this.successMessage = intent.message || 'Payment processed successfully.';
            this.paymentSuccessState = this.buildPaymentSuccessState(intent);
            this.checkoutOverlayState = 'success';
            this.profileStateService.clearCache();
            this.loadAll();
            this.cdr.detectChanges();
            return;
          }

          this.pendingIntent = intent;
          if ((intent.paymentProvider || '').toUpperCase() === 'RAZORPAY') {
            this.openRazorpayCheckout(intent);
          }
        },
        error: (err) => {
          this.errorMessage = err?.error?.message || 'Unable to create payment intent.';
        }
      });
    } catch (error: any) {
      this.loading = false;
      this.processingPlan = '';
      this.errorMessage = error?.message || 'Unexpected payment initialization error.';
    }
  }

  confirmPendingPayment(success = true, providerMeta?: { providerPaymentId?: string; providerSignature?: string }): void {
    if (!this.pendingIntent) {
      return;
    }
    const intentSnapshot = this.pendingIntent;
    const processingStartedAt = Date.now();
    this.loading = true;
    this.pendingConfirmationAction = success ? 'success' : 'failed';
    this.clearMessages();
    this.checkoutOverlayState = success ? 'processing' : 'idle';
    this.startProcessingOverlayWatchdog();
    this.cdr.detectChanges();
    this.paymentService.confirmPayment({
      paymentId: intentSnapshot.paymentId,
      success,
      ...this.buildSandboxProviderMeta(intentSnapshot, providerMeta)
    }).pipe(
      timeout(15000),
      finalize(() => {
        this.loading = false;
        this.pendingConfirmationAction = '';
      })
    ).subscribe({
      next: (res) => {
        const finish = () => {
          this.clearProcessingOverlayWatchdog();
          this.processingPlan = '';
          this.pendingIntent = null;
          if (success) {
            this.successMessage = res.message || 'Payment confirmed successfully.';
            this.paymentSuccessState = this.buildPaymentSuccessState(res, intentSnapshot);
            this.checkoutOverlayState = 'success';
          } else {
            this.successMessage = res.message || 'Payment marked as failed.';
            this.paymentSuccessState = null;
            this.checkoutOverlayState = 'idle';
          }
          this.profileStateService.clearCache();
          this.loadAll();
          this.cdr.detectChanges();
        };

        const minimumProcessingMs = success ? 2300 : 0;
        const remainingDelay = Math.max(0, minimumProcessingMs - (Date.now() - processingStartedAt));
        window.setTimeout(finish, remainingDelay);
      },
      error: (err) => {
        this.clearProcessingOverlayWatchdog();
        this.errorMessage = err?.error?.message || 'Payment confirmation failed.';
        this.checkoutOverlayState = 'idle';
        this.cdr.detectChanges();
      }
    });
  }

  cancelSubscription(subscription: SubscriptionRecord): void {
    this.loading = true;
    this.clearMessages();
    this.paymentService.cancelSubscription(subscription.id).subscribe({
      next: () => {
        this.loading = false;
        this.successMessage = 'Subscription cancelled.';
        this.profileStateService.clearCache();
        this.loadAll();
      },
      error: (err) => {
        this.loading = false;
        this.errorMessage = err?.error?.message || 'Could not cancel subscription.';
      }
    });
  }

  toggleAutoRenew(subscription: SubscriptionRecord): void {
    this.loading = true;
    this.clearMessages();
    this.paymentService.setAutoRenew(subscription.id, !subscription.autoRenew).subscribe({
      next: () => {
        this.loading = false;
        this.successMessage = !subscription.autoRenew ? 'Auto-renew enabled.' : 'Auto-renew disabled.';
        this.profileStateService.clearCache();
        this.loadAll();
      },
      error: (err) => {
        this.loading = false;
        this.errorMessage = err?.error?.message || 'Could not update auto-renew.';
      }
    });
  }

  renewSubscription(subscription: SubscriptionRecord): void {
    this.loading = true;
    this.clearMessages();
    this.paymentService.renewSubscription(subscription.id, this.premiumTheme).subscribe({
      next: () => {
        this.loading = false;
        this.successMessage = 'Subscription renewed successfully.';
        this.profileStateService.clearCache();
        this.loadAll();
      },
      error: (err) => {
        this.loading = false;
        this.errorMessage = err?.error?.message || 'Could not renew subscription.';
      }
    });
  }

  upgradeToPremium(subscription: SubscriptionRecord): void {
    this.loading = true;
    this.clearMessages();
    this.paymentService.upgradeSubscription(subscription.id, 'PREMIUM_MEMBERSHIP').subscribe({
      next: () => {
        this.loading = false;
        this.successMessage = 'Plan upgraded to Premium Membership.';
        this.profileStateService.clearCache();
        this.loadAll();
      },
      error: (err) => {
        this.loading = false;
        this.errorMessage = err?.error?.message || 'Could not upgrade subscription.';
      }
    });
  }

  onDocumentSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.documentFile = input.files?.[0] || null;
  }

  onSelfieSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selfieFile = input.files?.[0] || null;
  }

  getReceipt(paymentId: number, transactionId: string): void {
    this.paymentService.downloadReceiptPdf(paymentId).subscribe({
      next: (blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ConnectSphere_Receipt_${transactionId}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        this.successMessage = `Receipt downloaded successfully.`;
      },
      error: (err) => {
        let errorMsg = 'Receipt unavailable for this payment.';
        if (err?.error instanceof Blob) {
            err.error.text().then((text: string) => {
                try {
                    const json = JSON.parse(text);
                    this.errorMessage = json.message || errorMsg;
                } catch(e) {
                    this.errorMessage = errorMsg;
                }
            });
        } else {
            this.errorMessage = err?.error?.message || errorMsg;
        }
      }
    });
  }

  get canPayVerifiedBadge(): boolean {
    return !this.verifiedActive && !this.loading;
  }

  retryRazorpayCheckout(): void {
    if (!this.pendingIntent || (this.pendingIntent.paymentProvider || '').toUpperCase() !== 'RAZORPAY') {
      return;
    }
    this.openRazorpayCheckout(this.pendingIntent);
  }

  closeCheckoutSuccess(): void {
    this.checkoutOverlayState = 'idle';
    this.paymentSuccessState = null;
  }

  viewSubscriptionFromSuccess(): void {
    this.checkoutOverlayState = 'idle';
    window.setTimeout(() => {
      this.subscriptionSection?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  }

  downloadSuccessReceipt(): void {
    if (!this.paymentSuccessState?.paymentId || !this.paymentSuccessState.transactionId) {
      return;
    }
    this.getReceipt(this.paymentSuccessState.paymentId, this.paymentSuccessState.transactionId);
  }

  private clearMessages(): void {
    this.successMessage = '';
    this.errorMessage = '';
    this.paymentSuccessState = null;
  }

  private async openRazorpayCheckout(intent: PaymentIntent): Promise<void> {
    const key = intent.razorpayKeyId || '';
    const orderId = intent.razorpayOrderId || intent.providerOrderId || '';
    if (!key || !orderId || key === 'rzp_test_connectsphere_demo' || orderId.startsWith('rzp_demo_order_')) {
      this.errorMessage = 'Razorpay test keys are not configured on payment-service. Configure CONNECTSPHERE_RAZORPAY_ENABLED=true, CONNECTSPHERE_RAZORPAY_KEY_ID, and CONNECTSPHERE_RAZORPAY_KEY_SECRET to open Razorpay Checkout UI.';
      this.cdr.detectChanges();
      return;
    }

    const loaded = await this.ensureRazorpayScript();
    if (!loaded || !window.Razorpay) {
      this.errorMessage = 'Unable to load Razorpay checkout script. Please retry.';
      this.cdr.detectChanges();
      return;
    }

    const rz = new window.Razorpay({
      key,
      amount: Math.round(Number(intent.amount || 0) * 100),
      currency: intent.currency || 'INR',
      name: 'ConnectSphere',
      description: intent.planCode === 'VERIFIED_BADGE' ? 'Verified Badge Payment' : 'Premium Membership Payment',
      order_id: orderId,
      prefill: {
        email: this.currentProfile?.email || ''
      },
      notes: {
        planCode: intent.planCode || ''
      },
      handler: (response: any) => {
        this.confirmPendingPayment(true, {
          providerPaymentId: response?.razorpay_payment_id,
          providerSignature: response?.razorpay_signature
        });
      },
      modal: {
        ondismiss: () => {
          this.errorMessage = 'Payment checkout was closed before completion.';
          this.cdr.detectChanges();
        }
      },
      theme: {
        color: '#6366f1'
      }
    });

    if (typeof rz.on === 'function') {
      rz.on('payment.failed', (response: any) => {
        const providerPaymentId = response?.error?.metadata?.payment_id || `rzp_failed_${Date.now()}`;
        this.confirmPendingPayment(false, { providerPaymentId });
      });
    }

    rz.open();
  }

  private ensureRazorpayScript(): Promise<boolean> {
    if (this.razorpayScriptLoaded || window.Razorpay) {
      this.razorpayScriptLoaded = true;
      return Promise.resolve(true);
    }

    const existing = document.querySelector('script[data-razorpay-checkout="true"]') as HTMLScriptElement | null;
    if (existing) {
      return new Promise((resolve) => {
        existing.addEventListener('load', () => {
          this.razorpayScriptLoaded = true;
          resolve(true);
        });
        existing.addEventListener('error', () => resolve(false));
      });
    }

    return new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.async = true;
      script.setAttribute('data-razorpay-checkout', 'true');
      script.onload = () => {
        this.razorpayScriptLoaded = true;
        resolve(true);
      };
      script.onerror = () => resolve(false);
      document.body.appendChild(script);
    });
  }

  private startProcessingOverlayWatchdog(): void {
    this.clearProcessingOverlayWatchdog();
    this.processingOverlayTimer = window.setTimeout(() => {
      if (this.checkoutOverlayState === 'processing') {
        this.loading = false;
        this.pendingConfirmationAction = '';
        this.checkoutOverlayState = 'idle';
        this.errorMessage = 'Payment confirmation took too long. Please try Confirm Payment again.';
      }
    }, 20000);
  }

  private clearProcessingOverlayWatchdog(): void {
    if (this.processingOverlayTimer !== null) {
      window.clearTimeout(this.processingOverlayTimer);
      this.processingOverlayTimer = null;
    }
  }

  private buildPaymentSuccessState(payment: PaymentIntent, fallbackIntent?: PaymentIntent): {
    title: string;
    message: string;
    planCode: string;
    planName: string;
    amount: number;
    currency: string;
    paidAmountLabel: string;
    paymentId: number;
    confirmedAt?: string | null;
    receiptNumber?: string | null;
    transactionId?: string | null;
    checklist: string[];
  } {
    const resolvedPlanCode = payment.planCode || fallbackIntent?.planCode || '';
    const isVerified = resolvedPlanCode === 'VERIFIED_BADGE';
    const resolvedAmount = Number(payment.amount || fallbackIntent?.amount || 0);
    const resolvedCurrency = payment.currency || fallbackIntent?.currency || 'INR';
    const resolvedPaymentId = Number(payment.paymentId || fallbackIntent?.paymentId || 0);
    const resolvedConfirmedAt = payment.confirmedAt || new Date().toISOString();
    const planName = resolvedPlanCode === 'VERIFIED_BADGE' ? 'Verified Badge' : 'Premium Membership';
    return {
      title: 'Payment Successful',
      message: isVerified
        ? 'Your verified badge payment has been confirmed and the badge is now active on your profile.'
        : 'Your premium membership payment has been confirmed and premium benefits are now active.',
      planCode: resolvedPlanCode,
      planName,
      amount: resolvedAmount,
      currency: resolvedCurrency,
      paidAmountLabel: this.formatPaidAmount(resolvedAmount, resolvedCurrency),
      paymentId: resolvedPaymentId,
      confirmedAt: resolvedConfirmedAt,
      receiptNumber: payment.receiptNumber,
      transactionId: payment.transactionId,
      checklist: [
        isVerified ? 'Verified Badge Enabled' : 'Premium Membership Activated',
        isVerified ? 'Account Verification Completed' : 'Verified Badge Enabled',
        'Priority Support Enabled',
        'Premium Features Unlocked'
      ]
    };
  }

  private buildSandboxProviderMeta(
    intent: PaymentIntent,
    providerMeta?: { providerPaymentId?: string; providerSignature?: string }
  ): { providerPaymentId: string; providerSignature?: string } {
    if (providerMeta?.providerPaymentId || providerMeta?.providerSignature) {
      return {
        providerPaymentId: providerMeta.providerPaymentId || `${intent.paymentProvider}-${Date.now()}`,
        providerSignature: providerMeta.providerSignature
      };
    }

    const provider = (intent.paymentProvider || '').toUpperCase();
    if (provider === 'RAZORPAY') {
      const paymentId = `pay_demo_${Date.now()}`;
      return {
        providerPaymentId: paymentId,
        providerSignature: `demo_signature_${intent.paymentId}_${Date.now()}`
      };
    }
    return { providerPaymentId: `${provider || 'UPI_QR'}-${Date.now()}` };
  }

  private formatPaidAmount(amount: number, currency: string): string {
    try {
      return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: currency || 'INR',
        maximumFractionDigits: Number.isInteger(amount) ? 0 : 2
      }).format(amount);
    } catch {
      return `${currency || 'INR'} ${amount}`;
    }
  }
}
