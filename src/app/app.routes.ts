import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';
import { roleGuard } from './guards/role.guard';
import { guestGuard } from './guards/guest.guard';

export const routes: Routes = [
  // Landing: guests see public/explore, logged-in users are redirected to /dashboard by guestGuard
  { path: '', redirectTo: 'public/explore', pathMatch: 'full' },
  // Alias: /feed → posts (main social feed for authenticated users)
  {
    path: 'feed',
    loadComponent: () => import('./pages/posts/posts.component').then(m => m.PostsComponent),
    canActivate: [authGuard]
  },
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login.component').then(m => m.LoginComponent),
    canActivate: [guestGuard]
  },
  {
    path: 'register',
    loadComponent: () => import('./pages/register/register.component').then(m => m.RegisterComponent),
    canActivate: [guestGuard]
  },
  {
    path: 'public/explore',
    loadComponent: () => import('./pages/explore/explore.component').then(m => m.ExploreComponent),
    canActivate: [guestGuard]
  },
  {
    path: 'explore',
    loadComponent: () => import('./pages/explore/explore.component').then(m => m.ExploreComponent),
    canActivate: [authGuard]
  },
  {
    path: 'dashboard',
    loadComponent: () => import('./pages/dashboard/dashboard.component').then(m => m.DashboardComponent),
    canActivate: [authGuard]
  },
  {
    path: 'posts',
    loadComponent: () => import('./pages/posts/posts.component').then(m => m.PostsComponent),
    canActivate: [authGuard]
  },
  {
    path: 'stories',
    loadComponent: () => import('./pages/stories/stories.component').then(m => m.StoriesComponent),
    canActivate: [authGuard]
  },
  {
    path: 'follows',
    loadComponent: () => import('./pages/follows/follows.component').then(m => m.FollowsComponent),
    canActivate: [authGuard]
  },
  {
    path: 'notifications',
    loadComponent: () => import('./pages/notifications/notifications.component').then(m => m.NotificationsComponent),
    canActivate: [authGuard]
  },
  {
    path: 'search',
    loadComponent: () => import('./pages/search/search.component').then(m => m.SearchComponent)
  },
  {
    path: 'payments',
    loadComponent: () => import('./pages/payments/payments.component').then(m => m.PaymentsComponent),
    canActivate: [authGuard]
  },
  {
    path: 'settings/subscription',
    loadComponent: () => import('./pages/subscription-settings/subscription-settings.component').then(m => m.SubscriptionSettingsComponent),
    canActivate: [authGuard]
  },
  {
    path: 'profile',
    loadComponent: () => import('./pages/profile/profile.component').then(m => m.ProfileComponent),
    canActivate: [authGuard]
  },
  {
    path: 'admin',
    loadComponent: () => import('./pages/admin/admin.component').then(m => m.AdminComponent),
    canActivate: [authGuard, roleGuard],
    data: { roles: ['ADMIN'] }
  },
  {
    path: 'moderator',
    loadComponent: () => import('./pages/moderator/moderator.component').then(m => m.ModeratorComponent),
    canActivate: [authGuard, roleGuard],
    data: { roles: ['MODERATOR'] }
  },
  {
    path: 'reels',
    loadComponent: () => import('./pages/reels/reels.component').then(m => m.ReelsComponent),
    canActivate: [authGuard]
  },
  {
    path: 'user/:email',
    loadComponent: () => import('./pages/user-profile/user-profile.component').then(m => m.UserProfileComponent)
  },
  { path: '**', redirectTo: 'public/explore' }
];
