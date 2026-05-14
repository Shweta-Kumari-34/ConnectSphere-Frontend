import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { AuthService } from '../services/auth.service';

/**
 * Guest Guard
 * -----------
 * Prevents authenticated users from accessing "guest-only" routes like /login and /register.
 * Redirects to /feed (main social feed) if a JWT token is already present.
 */
export const guestGuard: CanActivateFn = (): boolean | UrlTree => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (!authService.isLoggedIn()) {
    return true;
  }

  // If already logged in, redirect to feed or appropriate landing page based on role
  const role = authService.getRole();
  if (role === 'ADMIN') {
    return router.createUrlTree(['/admin']);
  } else if (role === 'MODERATOR') {
    return router.createUrlTree(['/moderator']);
  }
  
  return router.createUrlTree(['/dashboard']);
};
