import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { isValidEmail } from '../../utils/auth-validation';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss'
})
export class LoginComponent implements OnInit {

  email = '';
  password = '';
  errorMessage = '';
  loading = false;
  showPassword = false;
  successMessage = '';
  
  // OTP and Forgot Password states
  loginMode: 'PASSWORD' | 'OTP' = 'PASSWORD';
  isForgotPassword = false;
  otpSent = false;
  otp = '';
  loginOtpSent = false;
  loginOtp = '';
  newPassword = '';
  resendCooldown = 0;
  private cooldownTimer: ReturnType<typeof setInterval> | null = null;

  private submitSafetyTimer: ReturnType<typeof setTimeout> | null = null;

  // OAuth2 — URL sourced from environment configuration
  private readonly OAUTH_BASE = environment.oauthBaseUrl;

  constructor(
    private authService: AuthService,
    private router: Router,
    private route: ActivatedRoute,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    // Handle OAuth2 callback — backend redirects here with token in query params
    this.route.queryParams.subscribe(params => {
      const token = params['token'];
      const username = params['username'];
      const userId = params['userId'];
      const email = params['email'];

      if (token) {
        const established = this.authService.setSessionFromOAuthCallback({
          token,
          username,
          userId,
          email
        });
        if (established) {
          const userRole = this.authService.getRole();
          if (userRole === 'ADMIN') {
            this.router.navigate(['/admin']);
          } else if (userRole === 'MODERATOR') {
            this.router.navigate(['/moderator']);
          } else {
            this.router.navigate(['/dashboard']);
          }
        }
        return;
      }

      if (params['registered'] === '1') {
        this.successMessage = 'Account created successfully. Please sign in.';
      }
    });
  }

  onLogin(): void {
    if (this.loading) {
      return;
    }

    const email = this.email.trim();

    if (!isValidEmail(email)) {
      this.errorMessage = 'Enter a valid email address.';
      return;
    }

    if (!this.password.trim()) {
      this.errorMessage = 'Password is required.';
      return;
    }

    this.loading = true;
    this.errorMessage = '';
    this.successMessage = '';
    this.startSubmitSafetyTimer();

    this.authService.login({ email, password: this.password }).subscribe({
      next: () => {
        this.clearSubmitSafetyTimer();
        this.loading = false;
        this.navigateAfterLogin();
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.clearSubmitSafetyTimer();
        this.loading = false;
        this.successMessage = '';
        this.errorMessage = this.resolveAuthError(err, 'Login failed. Please check your credentials.');
        this.scrollToTop();
        this.cdr.detectChanges();
      }
    });
  }

  toggleLoginMode(): void {
    this.loginMode = this.loginMode === 'PASSWORD' ? 'OTP' : 'PASSWORD';
    this.errorMessage = '';
    this.successMessage = '';
    this.loginOtpSent = false;
    this.loginOtp = '';
  }

  showForgotPassword(): void {
    this.isForgotPassword = true;
    this.errorMessage = '';
    this.successMessage = '';
    this.otpSent = false;
    this.otp = '';
    this.newPassword = '';
  }

  backToLogin(): void {
    this.isForgotPassword = false;
    this.errorMessage = '';
    this.successMessage = '';
    this.otpSent = false;
    this.otp = '';
    this.loginOtpSent = false;
    this.loginOtp = '';
    this.newPassword = '';
  }

  initiateOtpLogin(): void {
    if (this.loading) {
      return;
    }

    const email = this.email.trim();
    if (!isValidEmail(email)) {
      this.errorMessage = 'Enter a valid email address.';
      return;
    }
    
    this.loading = true;
    this.errorMessage = '';
    this.authService.initiateLogin(email).subscribe({
      next: () => {
        this.loading = false;
        this.loginOtpSent = true;
        this.loginOtp = '';
        this.successMessage = 'Login code sent successfully. Enter the 6-digit OTP to continue.';
        this.startResendCooldown();
      },
      error: (err) => {
        this.loading = false;
        this.successMessage = '';
        this.errorMessage = this.resolveAuthError(err, 'Failed to send OTP.');
        this.scrollToTop();
      }
    });
  }

  verifyOtpLogin(): void {
    if (this.loading) {
      return;
    }

    const email = this.email.trim();
    const loginOtp = this.loginOtp.trim();
    if (!/^\d{6}$/.test(loginOtp)) {
      this.errorMessage = 'Enter a valid 6-digit OTP.';
      return;
    }

    this.loading = true;
    this.errorMessage = '';
    this.authService.verifyLogin(email, loginOtp).subscribe({
      next: () => {
        this.loading = false;
        this.navigateAfterLogin();
      },
      error: (err) => {
        this.loading = false;
        this.successMessage = '';
        this.errorMessage = this.resolveAuthError(err, 'Invalid OTP.');
        this.scrollToTop();
      }
    });
  }

  initiateForgotPassword(): void {
    if (this.loading) {
      return;
    }

    const email = this.email.trim();
    if (!isValidEmail(email)) {
      this.errorMessage = 'Enter a valid email address.';
      return;
    }

    this.loading = true;
    this.errorMessage = '';
    this.authService.initiatePasswordReset(email).subscribe({
      next: () => {
        this.loading = false;
        this.otpSent = true;
        this.successMessage = 'OTP sent to your email to reset password.';
        this.startResendCooldown();
      },
      error: (err) => {
        this.loading = false;
        this.successMessage = '';
        this.errorMessage = this.resolveAuthError(err, 'Failed to send reset email.');
        this.scrollToTop();
      }
    });
  }

  verifyForgotPassword(): void {
    if (this.loading) {
      return;
    }

    const email = this.email.trim();
    if (!this.otp.trim() || !this.newPassword.trim()) {
      this.errorMessage = 'OTP and new password are required.';
      return;
    }

    this.loading = true;
    this.errorMessage = '';
    this.authService.verifyPasswordReset(email, this.otp, this.newPassword).subscribe({
      next: () => {
        this.loading = false;
        this.successMessage = 'Password reset successfully. You can now login.';
        this.backToLogin();
      },
      error: (err) => {
        this.loading = false;
        this.successMessage = '';
        this.errorMessage = this.resolveAuthError(err, 'Failed to reset password.');
        this.scrollToTop();
      }
    });
  }

  resendOtp(purpose: 'LOGIN' | 'RESET'): void {
    if (this.resendCooldown > 0) return;
    
    if (purpose === 'LOGIN') {
      this.initiateOtpLogin();
    } else {
      this.initiateForgotPassword();
    }
  }

  private startResendCooldown(): void {
    this.resendCooldown = 60;
    if (this.cooldownTimer) clearInterval(this.cooldownTimer);
    
    this.cooldownTimer = setInterval(() => {
      this.resendCooldown--;
      if (this.resendCooldown <= 0 && this.cooldownTimer) {
        clearInterval(this.cooldownTimer);
      }
    }, 1000);
  }

  private navigateAfterLogin(): void {
    const userRole = this.authService.getRole();
    if (userRole === 'ADMIN') {
      this.router.navigate(['/admin']);
    } else if (userRole === 'MODERATOR') {
      this.router.navigate(['/moderator']);
    } else {
      this.router.navigate(['/dashboard']);
    }
  }

  loginWithGoogle(): void {
    window.location.href = `${this.OAUTH_BASE}/auth/oauth/google/start`;
  }

  private resolveAuthError(err: any, fallback: string): string {
    const status = Number(err?.status ?? err?.error?.status ?? 0);
    const rawMessage =
      (typeof err?.message === 'string' && err.message.trim()) ||
      (typeof err?.error?.message === 'string' && err.error.message.trim()) ||
      fallback;

    const msg = rawMessage.toLowerCase();

    if (msg.includes('inactive') || msg.includes('not active') || msg.includes('verify')) {
      return 'Your account is not verified yet. Please verify your email with OTP first.';
    }
    if (msg.includes('invalid credentials') || msg.includes('bad credentials')) {
      return 'Email or password is incorrect. Please try again.';
    }
    if (msg.includes('password') && msg.includes('incorrect')) {
      return 'Password is incorrect. Please try again.';
    }
    if (msg.includes('otp expired') || msg.includes('expired')) {
      return 'This OTP has expired. Please request a new code.';
    }
    if (msg.includes('invalid otp') || msg.includes('wrong otp')) {
      return 'Incorrect OTP. Please enter the latest code from email.';
    }
    if (msg.includes('please wait 60 seconds')) {
      return 'Please wait 60 seconds before requesting another code.';
    }
    if (msg.includes('too many otp requests') || msg.includes('rate limit')) {
      return 'Too many OTP requests. Please wait a few minutes and try again.';
    }
    if (status === 400) {
      return rawMessage || 'Invalid input. Please check your details.';
    }
    if (status === 401) {
      if (this.isForgotPassword || this.otpSent || this.loginMode === 'OTP') {
        return 'Request is not authorized right now. Please retry in a moment.';
      }
      return 'Email or password is incorrect. Please try again.';
    }
    if (status === 404 || status === 503) {
      return 'Auth service is temporarily unavailable. Please try again shortly.';
    }

    return rawMessage;
  }

  private scrollToTop(): void {
    const card = document.querySelector('.auth-card');
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  private startSubmitSafetyTimer(): void {
    this.clearSubmitSafetyTimer();
    this.submitSafetyTimer = setTimeout(() => {
      if (!this.loading) {
        return;
      }
      this.loading = false;
      this.errorMessage = 'Login request is taking too long. Please check backend/proxy and try again.';
      this.cdr.detectChanges();
    }, 20000);
  }

  private clearSubmitSafetyTimer(): void {
    if (this.submitSafetyTimer) {
      clearTimeout(this.submitSafetyTimer);
      this.submitSafetyTimer = null;
    }
  }
}
