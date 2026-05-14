import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { AuthService } from '../services/auth.service';

/**
 * Auth Guard
 * ----------
 * Protects routes that require authentication.
 * Redirects to /login if no JWT token is found.
 */
export const authGuard: CanActivateFn = (): boolean | UrlTree => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (authService.isLoggedIn()) {
    return true;
  }

  // Use UrlTree for clean redirection instead of manual navigate()
  return router.createUrlTree(['/login']);
};
