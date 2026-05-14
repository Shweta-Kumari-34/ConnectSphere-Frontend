import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AdminService } from '../../services/admin.service';
import { AuthService } from '../../services/auth.service';

type AdminTabKey = 'analytics' | 'users' | 'posts' | 'reports' | 'verification' | 'trending' | 'notify';

interface AdminTab {
  key: AdminTabKey;
  label: string;
}

interface TrendingHashtag {
  tag: string;
  count: number;
}

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin.component.html',
  styleUrl: './admin.component.scss'
})
export class AdminComponent implements OnInit {

  activeTab: AdminTabKey = 'reports';
  tabs: AdminTab[] = [];

  users: any[] = [];
  posts: any[] = [];
  searchKeyword = '';
  loading = false;
  successMessage = '';

  bulkMessage = '';
  bulkType = 'SYSTEM';

  totalUsers = 0;
  totalPosts = 0;
  activeUsers = 0;
  suspendedUsers = 0;
  adminCount = 0;
  publicPosts = 0;
  privatePosts = 0;
  followersOnlyPosts = 0;

  trendingHashtags: TrendingHashtag[] = [];

  reports: Report[] = [];
  reportFilter: 'all' | 'pending' | 'resolved' | 'dismissed' = 'all';
  reportStats = { total: 0, pending: 0, resolved: 0, dismissed: 0 };
  verificationRequests: any[] = [];

  constructor(
    private adminService: AdminService,
    private authService: AuthService,
    private router: Router
  ) {}

  ngOnInit(): void {
    if (!this.authService.canAccessAdminPanel()) {
      void this.router.navigate(['/dashboard']);
      return;
    }

    this.tabs = this.buildTabsForRole();
    this.activeTab = this.tabs[0]?.key || 'reports';

    if (this.canHandleReports()) {
      this.loadReports();
    }

    if (this.canManagePosts()) {
      this.loadPosts();
    }

    if (this.canReviewVerification()) {
      this.loadVerificationRequests();
    }

    if (this.canViewTrending()) {
      this.loadTrending();
    }

    if (this.canManageUsers()) {
      this.loadUsers();
    }
  }

  get dashboardTitle(): string {
    return this.authService.isModerator() && !this.authService.isAdmin()
      ? 'Moderator Dashboard'
      : 'Admin Dashboard';
  }

  selectTab(tab: AdminTabKey): void {
    if (!this.tabs.find((item) => item.key === tab)) {
      return;
    }
    this.activeTab = tab;
  }

  loadUsers(): void {
    if (!this.canManageUsers()) return;

    this.adminService.getAllUsers().subscribe({
      next: (users) => {
        this.users = users;
        this.syncUserStats(users);
      },
      error: (err) => {
        if (Number(err?.status) === 401) {
          this.showSuccess('Session not authorized for admin users API. Please sign in again.');
          return;
        }
        this.users = [];
      }
    });
  }

  loadPosts(): void {
    if (!this.canManagePosts()) return;

    this.adminService.getAllPosts().subscribe({
      next: (posts) => {
        this.posts = posts;
        this.totalPosts = posts.length;
        this.publicPosts = posts.filter((p: any) => p.visibility === 'PUBLIC').length;
        this.privatePosts = posts.filter((p: any) => p.visibility === 'PRIVATE').length;
        this.followersOnlyPosts = posts.filter((p: any) => p.visibility === 'FOLLOWERS_ONLY').length;
      },
      error: (err) => {
        if (Number(err?.status) === 401) {
          this.showSuccess('Session not authorized for posts API. Please sign in again.');
          return;
        }
        this.posts = [];
      }
    });
  }

  loadTrending(): void {
    if (!this.canViewTrending()) return;

    this.adminService.getTrendingHashtags(20).subscribe({
      next: (data) => {
        this.trendingHashtags = (data || []).map((item: any) => ({
          tag: item?.tag ?? item?.[0] ?? '',
          count: Number(item?.count ?? item?.[1] ?? 0)
        }));
      },
      error: () => this.trendingHashtags = []
    });
  }

  loadReports(): void {
    if (!this.canHandleReports()) return;

    this.adminService.getAllReports().subscribe({
      next: (reports) => this.reports = reports,
      error: () => this.reports = []
    });

    this.adminService.getReportStats().subscribe({
      next: (stats) => this.reportStats = stats,
      error: () => {}
    });
  }

  loadVerificationRequests(): void {
    if (!this.canReviewVerification()) return;

    this.adminService.getVerificationRequests('PENDING').subscribe({
      next: (requests) => this.verificationRequests = requests,
      error: () => this.verificationRequests = []
    });
  }

  searchUsers(): void {
    if (!this.canManageUsers()) return;
    if (!this.searchKeyword.trim()) { this.loadUsers(); return; }

    this.adminService.searchUsers(this.searchKeyword).subscribe({
      next: (users) => this.users = users,
      error: () => this.users = []
    });
  }

  suspendUser(userId: number): void {
    if (!this.canManageUsers()) return;
    if (!confirm('Suspend this user account?')) return;

    this.adminService.suspendUser(userId).subscribe({
      next: () => {
        this.showSuccess('User suspended');
        this.loadUsers();
      },
      error: () => this.showSuccess('Suspend request sent')
    });
  }

  reactivateUser(userId: number): void {
    if (!this.canManageUsers()) return;

    this.adminService.reactivateUser(userId).subscribe({
      next: () => {
        this.showSuccess('User reactivated');
        this.loadUsers();
      },
      error: () => this.showSuccess('Reactivate request sent')
    });
  }

  deleteUser(userId: number): void {
    if (!this.canManageUsers()) return;

    this.adminService.deleteUser(userId).subscribe({
      next: () => {
        this.users = this.users.filter((user) => Number(user?.id) !== Number(userId));
        this.syncUserStats(this.users);
      },
      error: () => this.showSuccess('Unable to delete user right now. Please retry.')
    });
  }

  deletePost(id: number): void {
    if (!this.canManagePosts()) return;

    this.adminService.deletePost(id).subscribe({
      next: () => {
        this.showSuccess('Post removed');
        this.posts = this.posts.filter((post) => Number(post?.id) !== Number(id));
        this.totalPosts = this.posts.length;
        this.publicPosts = this.posts.filter((p: any) => p.visibility === 'PUBLIC').length;
        this.privatePosts = this.posts.filter((p: any) => p.visibility === 'PRIVATE').length;
        this.followersOnlyPosts = this.posts.filter((p: any) => p.visibility === 'FOLLOWERS_ONLY').length;
      },
      error: (err) => {
        if (Number(err?.status) === 401) {
          this.showSuccess('Not authorized to remove this post. Please sign in again as admin.');
          return;
        }
        this.showSuccess('Unable to remove post right now. Please retry.');
      }
    });
  }

  get filteredReports(): Report[] {
    if (this.reportFilter === 'all') return this.reports;
    return this.reports.filter(r => r.status === this.reportFilter);
  }

  resolveReport(report: Report, action: 'resolved' | 'dismissed'): void {
    if (!this.canHandleReports()) return;

    const obs = action === 'resolved'
      ? this.adminService.resolveReport(report.id)
      : this.adminService.dismissReport(report.id);

    obs.subscribe({
      next: () => {
        report.status = action;
        this.showSuccess(`Report #${report.id} ${action}`);
        this.loadReports();
      },
      error: () => {
        report.status = action;
        this.showSuccess(`Report #${report.id} ${action}`);
      }
    });
  }

  removeReportedContent(report: Report): void {
    if (!this.canHandleReports()) return;

    if (report.targetType === 'Post') {
      this.adminService.deletePost(report.targetId).subscribe({
        next: () => {
          report.status = 'resolved';
          this.showSuccess('Reported post removed');
          this.loadPosts();
        }
      });
    } else if (report.targetType === 'Comment') {
      this.adminService.deleteComment(report.targetId).subscribe({
        next: () => {
          report.status = 'resolved';
          this.showSuccess('Reported comment removed');
        }
      });
    }
  }

  sendBulkNotification(): void {
    if (!this.canBroadcast()) return;
    if (!this.bulkMessage.trim()) return;

    const emails = this.users.map(u => u.email);
    this.adminService.sendBulkNotification(emails, this.bulkType, this.bulkMessage).subscribe({
      next: () => {
        this.showSuccess(`Notification sent to ${emails.length} users`);
        this.bulkMessage = '';
      },
      error: () => this.showSuccess(`Broadcast queued for ${this.users.length} users`)
    });
  }

  approveVerification(request: any): void {
    if (!this.canReviewVerification()) return;

    this.adminService.reviewVerificationRequest(request.id, 'APPROVE', undefined, 'Approved by admin panel').subscribe({
      next: () => {
        this.showSuccess(`Verification #${request.id} approved`);
        this.loadVerificationRequests();
      },
      error: () => {
        this.showSuccess(`Verification #${request.id} approved`);
        this.loadVerificationRequests();
      }
    });
  }

  rejectVerification(request: any): void {
    if (!this.canReviewVerification()) return;

    this.adminService.reviewVerificationRequest(request.id, 'REJECT', 'Profile details did not meet verification standards', 'Rejected from admin panel').subscribe({
      next: () => {
        this.showSuccess(`Verification #${request.id} rejected`);
        this.loadVerificationRequests();
      },
      error: () => {
        this.showSuccess(`Verification #${request.id} rejected`);
        this.loadVerificationRequests();
      }
    });
  }

  showSuccess(msg: string): void {
    this.successMessage = msg;
    setTimeout(() => this.successMessage = '', 4000);
  }

  getTimeAgo(dateStr: string): string {
    if (!dateStr) return '';
    const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
  }

  canManageUsers(): boolean {
    return this.authService.isAdmin();
  }

  canViewAnalytics(): boolean {
    return this.authService.isAdmin();
  }

  canManagePosts(): boolean {
    return this.authService.isAdmin();
  }

  canHandleReports(): boolean {
    return this.authService.isAdmin();
  }

  canReviewVerification(): boolean {
    return this.authService.isAdmin();
  }

  canViewTrending(): boolean {
    return this.authService.isAdmin();
  }

  canBroadcast(): boolean {
    return this.authService.isAdmin();
  }

  private buildTabsForRole(): AdminTab[] {
    const tabs: AdminTab[] = [];

    if (this.canViewAnalytics()) {
      tabs.push({ key: 'analytics', label: 'Analytics' });
    }

    if (this.canManageUsers()) {
      tabs.push({ key: 'users', label: 'Users' });
    }

    if (this.canManagePosts()) {
      tabs.push({ key: 'posts', label: 'Posts' });
    }

    if (this.canHandleReports()) {
      tabs.push({ key: 'reports', label: 'Reports' });
    }

    if (this.canReviewVerification()) {
      tabs.push({ key: 'verification', label: 'Verified Reviews' });
    }

    if (this.canViewTrending()) {
      tabs.push({ key: 'trending', label: 'Trending' });
    }

    if (this.canBroadcast()) {
      tabs.push({ key: 'notify', label: 'Broadcast' });
    }

    return tabs;
  }

  private syncUserStats(users: any[]): void {
    this.totalUsers = users.length;
    this.activeUsers = users.filter((u: any) => u.active !== false).length;
    this.suspendedUsers = users.filter((u: any) => u.active === false).length;
    this.adminCount = users.filter((u: any) => u.role === 'ADMIN').length;
  }
}

interface Report {
  id: number;
  reporterEmail: string;
  targetType: string;
  targetId: number;
  reason: string;
  status: string;
  createdAt: string;
}
