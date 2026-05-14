import { Component, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService, UserRole } from '../../services/auth.service';
import { getPasswordChecks, isStrongPassword, isValidEmail, isValidUsername } from '../../utils/auth-validation';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './register.component.html',
  styleUrl: './register.component.scss'
})
export class RegisterComponent {


  username = '';
  email = '';
  password = '';
  fullName = '';
  accountType: '' | UserRole = '';
  errorMessage = '';
  successMessage = '';
  loading = false;
  showPassword = false;
  otpSent = false;
  otp = '';
  resendCooldown = 0;
  private cooldownTimer: ReturnType<typeof setInterval> | null = null;
  private submitSafetyTimer: ReturnType<typeof setTimeout> | null = null;

  // OAuth2 — URL sourced from environment configuration
  private readonly OAUTH_BASE = environment.oauthBaseUrl;

  constructor(
    private authService: AuthService,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

  get passwordChecks() {
    return getPasswordChecks(this.password);
  }

  onRegister(): void {
    if (this.loading) {
      return;
    }

    const username = this.username.trim();
    const email = this.email.trim();
    const fullName = this.fullName.trim();
    const role = this.accountType;

    if (fullName.length < 2) {
      this.errorMessage = 'Full name must be at least 2 characters.';
      return;
    }

    if (!isValidUsername(username)) {
      this.errorMessage = 'Username must be 3-20 characters and use only letters, numbers, dots, or underscores.';
      return;
    }

    if (!isValidEmail(email)) {
      this.errorMessage = 'Enter a valid email address.';
      return;
    }

    if (!isStrongPassword(this.password)) {
      this.errorMessage = 'Password must be 8+ characters and include one uppercase letter, one number, and one special character.';
      return;
    }

    if (!role) {
      this.errorMessage = 'Please select an account type.';
      return;
    }

    this.loading = true;
    this.errorMessage = '';
    this.successMessage = '';
    this.startSubmitSafetyTimer();

    this.authService.register({
      username,
      email,
      password: this.password,
      fullName,
      role
    }).subscribe({
      next: (response) => {
        this.clearSubmitSafetyTimer();
        this.loading = false;
        if (response.sessionEstablished) {
          this.navigateAfterLogin();
          this.cdr.detectChanges();
          return;
        }

        // Session not established, meaning OTP was sent
        this.otpSent = true;
        this.successMessage = 'Registration initiated. Please check your email for the verification code.';
        this.startResendCooldown();
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.clearSubmitSafetyTimer();
        this.loading = false;
        this.successMessage = '';
        this.otpSent = false;
        this.errorMessage = this.resolveAuthError(err, 'Registration failed. Please check your details and try again.');
        this.scrollToTop();
        this.cdr.detectChanges();
      }
    });
  }

  verifyOtp(): void {
    if (this.loading) {
      return;
    }

    const email = this.email.trim();
    if (!this.otp.trim()) {
      this.errorMessage = 'OTP is required.';
      return;
    }

    this.loading = true;
    this.errorMessage = '';
    this.authService.verifyRegister(email, this.otp).subscribe({
      next: (response) => {
        this.loading = false;
        if (response.sessionEstablished) {
          this.navigateAfterLogin();
        } else {
          this.router.navigate(['/login'], { queryParams: { registered: '1' } });
        }
      },
      error: (err) => {
        this.loading = false;
        this.successMessage = '';
        this.errorMessage = this.resolveAuthError(err, 'Invalid OTP. Please enter the latest code.');
        this.scrollToTop();
      }
    });
  }

  resendOtp(): void {
    if (this.resendCooldown > 0) return;
    this.onRegister(); // Simply re-submit the register info to resend OTP
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

  signupWithGoogle(): void {
    window.location.href = `${this.OAUTH_BASE}/auth/oauth/google/start`;
  }

  private resolveAuthError(err: any, fallback: string): string {
    const status = Number(err?.status ?? err?.error?.status ?? 0);
    const rawMessage =
      (typeof err?.message === 'string' && err.message.trim()) ||
      (typeof err?.error?.message === 'string' && err.error.message.trim()) ||
      fallback;

    const msg = rawMessage.toLowerCase();
    if (msg.includes('username already exists')) {
      return 'This username is already taken. Please choose another username.';
    }
    if (msg.includes('email already exists')) {
      return 'This email is already registered. Try logging in or use Forgot Password.';
    }
    if (msg.includes('please wait 60 seconds')) {
      return 'Please wait 60 seconds before requesting another code.';
    }
    if (msg.includes('too many otp requests')) {
      return 'Too many code requests. Please wait a few minutes and try again.';
    }
    if (msg.includes('otp expired') || msg.includes('expired')) {
      return 'This OTP has expired. Please request a new code.';
    }
    if (msg.includes('invalid otp') || msg.includes('wrong otp')) {
      return 'Incorrect OTP. Please enter the latest code from your email.';
    }
    if (msg.includes('google oauth is not configured')) {
      return 'Google sign-in is not configured yet. Please use email/password for now.';
    }
    if (status === 400) {
      return rawMessage || 'Invalid details. Please review all fields and try again.';
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
      this.errorMessage = 'Signup request is taking too long. Please check backend/proxy and try again.';
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
