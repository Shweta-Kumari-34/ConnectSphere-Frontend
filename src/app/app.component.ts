import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from './services/auth.service';
import { NotificationService } from './services/notification.service';
import { Subscription, interval } from 'rxjs';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class App implements OnInit, OnDestroy {
  showCreateMenu = false;
  toastMessage = '';
  toastType: 'success' | 'error' | 'info' = 'info';
  unreadCount = 0;
  private pollSub?: Subscription;
  private unreadCountSub?: Subscription;

  constructor(
    public authService: AuthService,
    private notificationService: NotificationService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.refreshUnreadCount();
    this.unreadCountSub = this.notificationService.unreadCount$.subscribe((count) => {
      this.unreadCount = Number(count) || 0;
    });
    // Poll every 30 seconds for real-time badge
    this.pollSub = interval(30000).subscribe(() => {
      if (this.authService.isLoggedIn()) {
        this.refreshUnreadCount();
      }
    });
  }

  ngOnDestroy(): void {
    this.pollSub?.unsubscribe();
    this.unreadCountSub?.unsubscribe();
  }

  refreshUnreadCount(): void {
    if (!this.authService.isLoggedIn()) return;
    this.notificationService.getUnreadCount().subscribe({
      next: (count) => this.unreadCount = count,
      error: () => this.unreadCount = 0
    });
  }

  getInitial(): string {
    const name = this.authService.getUsername() || 'U';
    return name.charAt(0).toUpperCase();
  }

  /** Show guest top-nav on explore page when not logged in, or on login/register routes */
  isGuestPage(): boolean {
    const url = this.router.url;
    if (!this.authService.isLoggedIn()) return true;
    // Authenticated users seeing explore should still get the sidebar
    return false;
  }

  /** Show sidebar for authenticated users except on login/register */
  showSidebar(): boolean {
    if (!this.authService.isLoggedIn()) return false;
    const url = this.router.url;
    return !url.startsWith('/login') && !url.startsWith('/register');
  }

  logout(): void {
    this.authService.logout();
    this.router.navigate(['/public/explore']);
  }

  canAccessAdminPanel(): boolean {
    return this.authService.canAccessAdminPanel();
  }

  getAdminNavLabel(): string {
    return this.authService.isModerator() && !this.authService.isAdmin() ? 'Moderation' : 'Admin';
  }

  getAdminRouterLink(): string {
    return this.authService.isAdmin() ? '/admin' : '/moderator';
  }

  scrollSidebar(offset: number): void {
    const sidebarScroll = document.getElementById('sidebar-scroll');
    if (!sidebarScroll) return;

    sidebarScroll.scrollBy({
      top: offset,
      behavior: 'smooth'
    });
  }

  showToast(message: string, type: 'success' | 'error' | 'info' = 'info'): void {
    this.toastMessage = message;
    this.toastType = type;
    setTimeout(() => this.toastMessage = '', 3500);
  }
}
