import { useEffect, useRef, type KeyboardEvent } from 'react';
import { Activity, Archive, Banknote, ChartNoAxesCombined, Eye, Gift, Headphones, PackageCheck, ShieldCheck, Trash2, WalletCards, Megaphone, TicketPercent, CreditCard, UsersRound } from 'lucide-react';
import { useGetAuthMe } from '@workspace/api-client-react';
import { useLocation } from 'wouter';
import { MemberShell } from '../components/MemberShell';
import { AdminDepositsPage } from './FinancePages';
import { AdminAnnouncementsPage } from './AdminAnnouncementsPage';
import { AdminAccountDeletionRequestsPage } from './AccountManagementPages';
import { AdminLicenseProductsPage } from './LicensePages';
import { AdminSupportTicketsPage } from './SupportPages';
import { AdminCouponsPage } from './AdminCouponsPage';
import { AdminCardInventoryPage } from './CardPages';
import { AdminUsersPage } from './AdminUsersPage';
import { AdminOverviewPage, AdminPaymentSettingsPage, AdminPageVisibilityPage } from './AdminOperationsPages';
import { AdminRedeemCodesPage } from './FinancePages';

const sections = [
  { id: 'overview', label: 'Overview', hint: 'Live service totals', icon: ChartNoAxesCombined, legacy: '/admin/dashboard/overview' },
  { id: 'deposits', label: 'Deposits', hint: 'Payment review', icon: WalletCards, legacy: '/admin/deposits' },
  { id: 'payment-settings', label: 'Payment settings', hint: 'Methods & recipients', icon: Banknote, legacy: '/admin/dashboard/payment-settings' },
  { id: 'page-visibility', label: 'Page visibility', hint: 'Member navigation', icon: Eye, legacy: '/admin/dashboard/page-visibility' },
  { id: 'redeem-codes', label: 'Redeem codes', hint: 'Account credits', icon: Gift, legacy: '/admin/dashboard/redeem-codes' },
  { id: 'announcements', label: 'Announcements', hint: 'Member communications', icon: Megaphone, legacy: '/admin/announcements' },
  { id: 'deletions', label: 'Deletion requests', hint: 'Account review', icon: Trash2, legacy: '/admin/account-deletion-requests' },
  { id: 'inventory', label: 'Log inventory', hint: 'Products & stock', icon: PackageCheck, legacy: '/admin/license-products' },
  { id: 'card-inventory', label: 'Bases', hint: 'Card bases', icon: CreditCard, legacy: '/admin/dashboard/card-inventory' },
  { id: 'coupons', label: 'Coupon codes', hint: 'Store discounts', icon: TicketPercent, legacy: '/admin/dashboard/coupons' },
  { id: 'tickets', label: 'Support inbox', hint: 'Member care', icon: Headphones, legacy: '/admin/support/tickets' },
  { id: 'users', label: 'Members', hint: 'Access & balances', icon: UsersRound, legacy: '/admin/dashboard/users' },
] as const;

function sectionFromPath(path: string): (typeof sections)[number]['id'] {
  if (path === '/admin/announcements') return 'announcements';
  if (path === '/admin/account-deletion-requests') return 'deletions';
  if (path === '/admin/license-products') return 'inventory';
  if (path === '/admin/support/tickets') return 'tickets';
  if (path === '/admin/deposits') return 'deposits';
  const candidate = path.split('/')[3];
  return sections.some((section) => section.id === candidate) ? candidate as (typeof sections)[number]['id'] : 'overview';
}

export function AdminDashboardPage() {
  const session = useGetAuthMe();
  const [location, setLocation] = useLocation();
  const navRef = useRef<HTMLElement>(null);
  const sectionId = sectionFromPath(location);
  const current = sections.find((section) => section.id === sectionId) ?? sections[0]!;
  const user = session.data?.authenticated ? session.data.user : null;

  useEffect(() => { document.title = `${current.label} | ReplenishCC Admin`; }, [current.label]);
  useEffect(() => {
    if (!session.isLoading && (session.isError || !session.data?.authenticated)) setLocation('/login');
    else if (!session.isLoading && user && !user.isDepositAdmin) setLocation('/dashboard');
  }, [session.data?.authenticated, session.isError, session.isLoading, setLocation, user]);

  const navigateSection = (id: string) => setLocation(`/admin/dashboard/${id}`);
  const onNavKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = sections.findIndex((section) => section.id === sectionId);
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? sections.length - 1
      : (currentIndex + (event.key === 'ArrowRight' ? 1 : sections.length - 1)) % sections.length;
    navigateSection(sections[nextIndex]!.id);
    requestAnimationFrame(() => navRef.current?.querySelector<HTMLButtonElement>(`[data-section="${sections[nextIndex]!.id}"]`)?.focus());
  };

  if (session.isLoading || !user || !user.isDepositAdmin) {
    return <MemberShell pageTitle="Admin dashboard" user={null} loading shellMode="force" />;
  }

  const ActiveSection = sectionId === 'overview' ? AdminOverviewPage
    : sectionId === 'payment-settings' ? AdminPaymentSettingsPage
    : sectionId === 'page-visibility' ? AdminPageVisibilityPage
    : sectionId === 'redeem-codes' ? AdminRedeemCodesPage
    : sectionId === 'users' ? AdminUsersPage
    : sectionId === 'card-inventory' ? AdminCardInventoryPage
    : sectionId === 'announcements' ? AdminAnnouncementsPage
    : sectionId === 'deletions' ? AdminAccountDeletionRequestsPage
      : sectionId === 'inventory' ? AdminLicenseProductsPage
        : sectionId === 'coupons' ? AdminCouponsPage
        : sectionId === 'tickets' ? AdminSupportTicketsPage : AdminDepositsPage;

  return <MemberShell pageTitle="Admin dashboard" user={user} shellMode="force" contentClassName="admin-dashboard-content">
    <div className="admin-workspace">
      <header className="admin-workspace-head">
        <div>
          <div className="admin-workspace-kicker"><ShieldCheck aria-hidden="true" /> ReplenishCC · operations</div>
          <h1>Admin workspace</h1>
          <p>Member services, account actions, and operational queues in one place.</p>
        </div>
        <div className="admin-workspace-identity"><span className="admin-status-dot" /><span>Authorized administrator</span><strong>{user.fullName}</strong></div>
      </header>
      <nav className="admin-section-nav" aria-label="Admin dashboard sections" role="tablist" ref={navRef} onKeyDown={onNavKeyDown} data-testid="nav-admin-sections">
        {sections.map(({ id, label, hint, icon: Icon }) => <button key={id} id={`admin-tab-${id}`} type="button" role="tab" aria-selected={sectionId === id} aria-controls="admin-dashboard-panel" tabIndex={sectionId === id ? 0 : -1} className={`admin-section-tab${sectionId === id ? ' active' : ''}`} onClick={() => navigateSection(id)} data-section={id} data-testid={`tab-admin-${id}`}>
          <Icon aria-hidden="true" /><span><strong>{label}</strong><small>{hint}</small></span>{sectionId === id && <Activity className="admin-tab-current" aria-hidden="true" />}
        </button>)}
      </nav>
      <section className="admin-dashboard-panel" id="admin-dashboard-panel" role="tabpanel" aria-labelledby={`admin-tab-${sectionId}`} key={sectionId} data-testid={`panel-admin-${sectionId}`}>
        <ActiveSection />
      </section>
      <footer className="admin-workspace-foot"><Archive aria-hidden="true" /><span>Live records from ReplenishCC systems · access governed by administrator permissions</span></footer>
    </div>
  </MemberShell>;
}