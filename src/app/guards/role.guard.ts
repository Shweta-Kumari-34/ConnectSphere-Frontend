import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { AuthService, UserRole } from '../services/auth.service';

/**
 * Role Guard
 * ----------
 * Ensures the authenticated user has the required roles to access a route.
 */
export const roleGuard: CanActivateFn = (route): boolean | UrlTree => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (!authService.isLoggedIn()) {
    return router.createUrlTree(['/login']);
  }

  const requiredRoles = (route.data?.['roles'] as UserRole[] | undefined) || [];
  if (!requiredRoles.length) {
    return true;
  }

  if (authService.hasAnyRole(...requiredRoles)) {
    return true;
  }

  // Redirect to dashboard if user doesn't have the required role
  return router.createUrlTree(['/dashboard']);
};
