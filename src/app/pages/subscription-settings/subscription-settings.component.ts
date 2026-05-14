import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PaymentService, SubscriptionRecord } from '../../services/payment.service';
import { UserProfileStateService } from '../../services/user-profile-state.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-subscription-settings',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './subscription-settings.component.html',
  styleUrl: './subscription-settings.component.scss'
})
export class SubscriptionSettingsComponent implements OnInit {
  subscriptions: SubscriptionRecord[] = [];
  loading = false;
  successMessage = '';
  errorMessage = '';

  isPremiumMember = false;
  isVerified = false;

  constructor(
    private paymentService: PaymentService,
    private userProfileStateService: UserProfileStateService,
    private authService: AuthService
  ) {}

  ngOnInit(): void {
    this.loadSubscriptions();
  }

  loadSubscriptions(): void {
    // 1. Check local state for badges
    this.userProfileStateService.getCurrentUserProfile().subscribe(profile => {
      if (profile) {
        this.isPremiumMember = !!profile.isPremiumMember;
        this.isVerified = !!profile.isVerified;
      }
    });

    // 2. Fetch from payment-service
    this.paymentService.getMySubscriptions().subscribe({
      next: (res) => (this.subscriptions = res),
      error: () => (this.subscriptions = [])
    });
  }

  renew(subscription: SubscriptionRecord): void {
    this.loading = true;
    this.paymentService.renewSubscription(subscription.id).subscribe({
      next: () => {
        this.loading = false;
        this.successMessage = 'Subscription renewed.';
        this.errorMessage = '';
        this.loadSubscriptions();
      },
      error: (err) => {
        this.loading = false;
        this.errorMessage = err?.error?.message || 'Could not renew subscription.';
      }
    });
  }

  cancel(subscription: SubscriptionRecord): void {
    this.loading = true;
    this.paymentService.cancelSubscription(subscription.id).subscribe({
      next: () => {
        this.loading = false;
        this.successMessage = 'Subscription cancelled.';
        this.errorMessage = '';
        this.loadSubscriptions();
      },
      error: (err) => {
        this.loading = false;
        this.errorMessage = err?.error?.message || 'Could not cancel subscription.';
      }
    });
  }

  toggleAutoRenew(subscription: SubscriptionRecord): void {
    this.loading = true;
    this.paymentService.setAutoRenew(subscription.id, !subscription.autoRenew).subscribe({
      next: () => {
        this.loading = false;
        this.successMessage = 'Auto-renew setting updated.';
        this.errorMessage = '';
        this.loadSubscriptions();
      },
      error: (err) => {
        this.loading = false;
        this.errorMessage = err?.error?.message || 'Could not update auto-renew.';
      }
    });
  }

  upgrade(subscription: SubscriptionRecord): void {
    this.loading = true;
    this.paymentService.upgradeSubscription(subscription.id, 'PREMIUM_MEMBERSHIP').subscribe({
      next: () => {
        this.loading = false;
        this.successMessage = 'Upgraded to Premium Membership.';
        this.errorMessage = '';
        this.loadSubscriptions();
      },
      error: (err) => {
        this.loading = false;
        this.errorMessage = err?.error?.message || 'Could not upgrade subscription.';
      }
    });
  }
}
