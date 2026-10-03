import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown, ChevronRight, CircleDollarSign, ClipboardList, CreditCard, Crown, FileText,
  Gift, Headphones, Home, LoaderCircle, LockKeyhole, LogOut, Menu, MessageSquare, Moon, Megaphone,
  Package, Settings2, ShieldCheck, ShoppingBag, Sparkles, Sun, Trophy, WalletCards, X, KeyRound,
} from 'lucide-react';
import {
  getGetAuthMeQueryKey, getGetMyDepositsQueryKey, useGetMyDeposits, usePostAuthLogout,
  type AuthMeResponse,
} from '@workspace/api-client-react';
import { Link, useLocation } from 'wouter';
import { Brand } from './Brand';
import { SiteFooter } from './SiteFooter';
import { TelegramAnnouncementPopup } from './TelegramAnnouncementPopup';

type MemberUser = NonNullable<AuthMeResponse['user']>;
type WorkspaceTheme = 'dark' | 'light';

function errorText(error: unknown): string {
  if (error && typeof error === 'object') {
    const candidate = error as { error?: unknown; message?: unknown; response?: { data?: { error?: unknown } } };
    if (typeof candidate.response?.data?.error === 'string') return candidate.response.data.error;
    if (typeof candidate.error === 'string') return candidate.error;
    if (typeof candidate.message === 'string') return candidate.message;
  }
  return 'Something went wrong. Please try again.';
}

function formatBalance(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

function WorkspaceThemeToggle({ theme, onToggle }: { theme: WorkspaceTheme; onToggle: () => void }) {
  const nextTheme = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={onToggle}
      aria-label={`Switch to ${nextTheme} theme`}
      aria-pressed={theme === 'light'}
      title={`Switch to ${nextTheme} theme`}
      data-testid="button-toggle-theme"
    >
      {theme === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
      <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
    </button>
  );
}

function UnavailableNav({ icon, label }: { icon: ReactNode; label: string }) {
  return <div className="nav-row nav-unavailable" aria-disabled="true" title={`${label} is not available yet`} data-testid={`nav-unavailable-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>
    {icon}<span>{label}</span><span className="soon-label">Soon</span>
  </div>;
}

export function MemberShell({
  pageTitle,
  user,
  children,
  loading = false,
  contentClassName = '',
}: {
  pageTitle: string;
  user: MemberUser | null;
  children?: ReactNode;
  loading?: boolean;
  contentClassName?: string;
}) {
  const queryClient = useQueryClient();
  const logout = usePostAuthLogout();
  const [theme, setTheme] = useState<WorkspaceTheme>(() => {
    try {
      return window.localStorage.getItem('replenishcc-dashboard-theme') === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  });
  const [logoutError, setLogoutError] = useState('');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [sidebarAccountOpen, setSidebarAccountOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    financeDeposit: true,
    shop: true,
    orders: true,
    support: true,
  });
  const [location, setLocation] = useLocation();
  const mobileSidebarRef = useRef<HTMLElement>(null);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const mobileCloseButtonRef = useRef<HTMLButtonElement>(null);
  const accountControlRef = useRef<HTMLDivElement>(null);
  const accountTriggerRef = useRef<HTMLButtonElement>(null);
  const sidebarAccountRef = useRef<HTMLDivElement>(null);
  const sidebarAccountTriggerRef = useRef<HTMLButtonElement>(null);
  const accountBalance = useGetMyDeposits({
    query: {
      queryKey: getGetMyDepositsQueryKey(),
      enabled: Boolean(user),
      refetchOnWindowFocus: false,
      staleTime: 5 * 60_000,
    },
  });
  const initials = user?.fullName.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'R';
  const isDepositPage = location === '/deposits' || location === '/my-deposits';
  const isSupportPage = location.startsWith('/support/') || location.startsWith('/admin/support/');

  useEffect(() => {
    try {
      window.localStorage.setItem('replenishcc-dashboard-theme', theme);
    } catch {
      // Keep the selected theme for this page even when storage is unavailable.
    }
  }, [theme]);
  useEffect(() => {
    if (!mobileNavOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    mobileCloseButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMobileNavOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(
        mobileSidebarRef.current?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)') ?? [],
      );
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      mobileMenuButtonRef.current?.focus();
    };
  }, [mobileNavOpen]);
  useEffect(() => {
    if (!accountOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!accountControlRef.current?.contains(event.target as Node)) setAccountOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setAccountOpen(false);
        accountTriggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [accountOpen]);
  useEffect(() => {
    if (!sidebarAccountOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!sidebarAccountRef.current?.contains(event.target as Node)) setSidebarAccountOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSidebarAccountOpen(false);
        if (!mobileNavOpen) sidebarAccountTriggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [sidebarAccountOpen, mobileNavOpen]);
  useEffect(() => {
    if (!mobileNavOpen) setSidebarAccountOpen(false);
  }, [mobileNavOpen]);

  const signOut = () => {
    if (logout.isPending) return;
    setLogoutError('');
    logout.mutate(undefined, {
      onSuccess: () => {
        queryClient.clear();
        queryClient.setQueryData<AuthMeResponse>(getGetAuthMeQueryKey(), { authenticated: false, user: null });
        setLocation('/login');
      },
      onError: (reason) => setLogoutError(errorText(reason)),
    });
  };
  const toggleGroup = (key: string) => setExpanded((current) => ({ ...current, [key]: !current[key] }));
  const closeMobileNav = () => setMobileNavOpen(false);

  const memberSidebar = (
    <>
      <div className="member-brand">
        <Brand href="/dashboard" label="ReplenishCC dashboard" />
        <button ref={mobileCloseButtonRef} className="mobile-close" type="button" onClick={closeMobileNav} aria-label="Close navigation" data-testid="button-close-navigation"><X /></button>
      </div>
      <nav className="member-nav" aria-label="Member navigation">
        <div className="nav-section-label">Workspace</div>
        <Link href="/dashboard" className={`nav-row nav-home${location === '/dashboard' ? ' active' : ''}`} aria-current={location === '/dashboard' ? 'page' : undefined} onClick={closeMobileNav} data-testid="link-dashboard-home">
          <Home aria-hidden="true" /><span>Home</span><span className="live-mark">Current</span>
        </Link>
        <div className="nav-section-label">Finance</div>
        <button className={`nav-row nav-group${isDepositPage ? ' active' : ''}`} type="button" onClick={() => toggleGroup('financeDeposit')} aria-expanded={expanded.financeDeposit} data-testid="button-toggle-deposit">
          <WalletCards aria-hidden="true" /><span>Deposit</span><ChevronDown className={`nav-chevron${expanded.financeDeposit ? ' is-open' : ''}`} aria-hidden="true" />
        </button>
        {expanded.financeDeposit && <div className="nav-children">
          <Link href="/deposits" className={`nav-row${location === '/deposits' ? ' active' : ''}`} aria-current={location === '/deposits' ? 'page' : undefined} onClick={closeMobileNav} data-testid="link-deposit-money"><CircleDollarSign aria-hidden="true" /><span>Deposit funds</span></Link>
          <Link href="/my-deposits" className={`nav-row${location === '/my-deposits' ? ' active' : ''}`} aria-current={location === '/my-deposits' ? 'page' : undefined} onClick={closeMobileNav} data-testid="link-my-deposits"><FileText aria-hidden="true" /><span>Deposit history</span></Link>
        </div>}
        <Link href="/referrals" className={`nav-row${location === '/referrals' ? ' active' : ''}`} aria-current={location === '/referrals' ? 'page' : undefined} onClick={closeMobileNav} data-testid="link-referrals"><Gift aria-hidden="true" /><span>Referrals</span></Link>
        {user?.isDepositAdmin && <Link href="/admin/deposits" className={`nav-row${location === '/admin/deposits' ? ' active' : ''}`} aria-current={location === '/admin/deposits' ? 'page' : undefined} onClick={closeMobileNav} data-testid="link-admin-deposits"><ShieldCheck aria-hidden="true" /><span>Deposit review</span></Link>}
        {user?.isDepositAdmin && <Link href="/admin/announcements" className={`nav-row${location === '/admin/announcements' ? ' active' : ''}`} aria-current={location === '/admin/announcements' ? 'page' : undefined} onClick={closeMobileNav} data-testid="link-admin-announcements"><Megaphone aria-hidden="true" /><span>Announcements</span></Link>}
        {user?.isDepositAdmin && <Link href="/admin/account-deletion-requests" className={`nav-row${location === '/admin/account-deletion-requests' ? ' active' : ''}`} aria-current={location === '/admin/account-deletion-requests' ? 'page' : undefined} onClick={closeMobileNav} data-testid="link-admin-account-deletion"><ShieldCheck aria-hidden="true" /><span>Account deletion review</span></Link>}
        <Link href="/redeem-code" className={`nav-row${location === '/redeem-code' ? ' active' : ''}`} aria-current={location === '/redeem-code' ? 'page' : undefined} onClick={closeMobileNav} data-testid="link-redeem-code"><Gift aria-hidden="true" /><span>Redeem Code</span></Link>
        <UnavailableNav icon={<Crown />} label="VIP & Free CC" />
        <Link href="/leaderboard" className={`nav-row${location === '/leaderboard' ? ' active' : ''}`} aria-current={location === '/leaderboard' ? 'page' : undefined} onClick={closeMobileNav} data-testid="link-leaderboard"><Trophy aria-hidden="true" /><span>Leaderboard</span></Link>
        <div className="nav-section-label">Shopping</div>
        <button className="nav-row nav-group" type="button" onClick={() => toggleGroup('shop')} aria-expanded={expanded.shop} data-testid="button-toggle-shop">
          <ShoppingBag aria-hidden="true" /><span>Shop</span><ChevronDown className={`nav-chevron${expanded.shop ? ' is-open' : ''}`} aria-hidden="true" />
        </button>
        {expanded.shop && <div className="nav-children">
          <Link href="/license-products" className={`nav-row${location === '/license-products' ? ' active' : ''}`} aria-current={location === '/license-products' ? 'page' : undefined} onClick={closeMobileNav} data-testid="link-license-products"><KeyRound aria-hidden="true" /><span>License keys</span></Link>
          <UnavailableNav icon={<CreditCard />} label="Buy Cards" />
          <UnavailableNav icon={<Package />} label="Bulk Cards" />
          <UnavailableNav icon={<ClipboardList />} label="Buy Logs" />
        </div>}
        <button className="nav-row nav-group" type="button" onClick={() => toggleGroup('orders')} aria-expanded={expanded.orders} data-testid="button-toggle-orders">
          <Package aria-hidden="true" /><span>My Orders</span><ChevronDown className={`nav-chevron${expanded.orders ? ' is-open' : ''}`} aria-hidden="true" />
        </button>
        {expanded.orders && <div className="nav-children">
          <Link href="/orders/license-keys" className={`nav-row${location === '/orders/license-keys' ? ' active' : ''}`} aria-current={location === '/orders/license-keys' ? 'page' : undefined} onClick={closeMobileNav} data-testid="link-license-orders"><KeyRound aria-hidden="true" /><span>License orders</span></Link>
          <UnavailableNav icon={<CreditCard />} label="My Card Orders" />
          <UnavailableNav icon={<ClipboardList />} label="My Log Orders" />
          <UnavailableNav icon={<Package />} label="My Bulk Card Purchases" />
        </div>}
        {user?.isDepositAdmin && <Link href="/admin/license-products" className={`nav-row${location === '/admin/license-products' ? ' active' : ''}`} aria-current={location === '/admin/license-products' ? 'page' : undefined} onClick={closeMobileNav} data-testid="link-admin-license-products"><ShieldCheck aria-hidden="true" /><span>License inventory</span></Link>}
        <div className="nav-section-label">Support</div>
        <button className={`nav-row nav-group${isSupportPage ? ' active' : ''}`} type="button" onClick={() => toggleGroup('support')} aria-expanded={expanded.support} data-testid="button-toggle-support">
          <Headphones aria-hidden="true" /><span>Support</span><ChevronDown className={`nav-chevron${expanded.support ? ' is-open' : ''}`} aria-hidden="true" />
        </button>
        {expanded.support && <div className="nav-children">
          <Link href="/support/tickets" className={`nav-row${location === '/support/tickets' ? ' active' : ''}`} aria-current={location === '/support/tickets' ? 'page' : undefined} onClick={closeMobileNav} data-testid="link-my-support-tickets"><MessageSquare aria-hidden="true" /><span>My Tickets</span></Link>
          <Link href="/support/create" className={`nav-row${location === '/support/create' ? ' active' : ''}`} aria-current={location === '/support/create' ? 'page' : undefined} onClick={closeMobileNav} data-testid="link-create-support-ticket"><MessageSquare aria-hidden="true" /><span>Create Ticket</span></Link>
          {user?.isDepositAdmin && <Link href="/admin/support/tickets" className={`nav-row${location === '/admin/support/tickets' ? ' active' : ''}`} aria-current={location === '/admin/support/tickets' ? 'page' : undefined} onClick={closeMobileNav} data-testid="link-admin-support-tickets"><ShieldCheck aria-hidden="true" /><span>Ticket Review</span></Link>}
        </div>}
        <div className="nav-section-label">Settings</div>
        <Link href="/account-management" className={`nav-row${location === '/account-management' ? ' active' : ''}`} aria-current={location === '/account-management' ? 'page' : undefined} onClick={closeMobileNav} data-testid="link-account-management"><Settings2 aria-hidden="true" /><span>Account management</span></Link>
      </nav>
      <div className="sidebar-foot">
        {user ? (
          <div ref={sidebarAccountRef} className="sidebar-account-control">
            {sidebarAccountOpen && <div id="sidebar-account-options" className="sidebar-account-menu" role="region" aria-label="Sidebar account options">
              {logoutError && <div className="account-error" role="alert">{logoutError}</div>}
              <button type="button" className="account-logout" onClick={signOut} disabled={logout.isPending} data-testid="button-sidebar-logout">
                {logout.isPending ? <LoaderCircle className="spin" aria-hidden="true" /> : <LogOut aria-hidden="true" />}
                {logout.isPending ? 'Signing out…' : 'Sign out'}
              </button>
            </div>}
            <button
              ref={sidebarAccountTriggerRef}
              type="button"
              className="sidebar-account-trigger"
              onClick={() => { setAccountOpen(false); setSidebarAccountOpen((open) => !open); }}
              aria-expanded={sidebarAccountOpen}
              aria-controls="sidebar-account-options"
              aria-label={`Account options for ${user.email}`}
              data-testid="button-sidebar-account"
            >
              <span className="account-avatar sidebar-account-avatar">{initials}</span>
              <span className="sidebar-account-email" data-testid="text-sidebar-email">{user.email}</span>
              <ChevronDown aria-hidden="true" />
            </button>
          </div>
        ) : <div className="skeleton sidebar-account-skeleton" aria-hidden="true" />}
      </div>
    </>
  );

  if (loading || !user) {
    return (
      <div className={`member-shell${mobileNavOpen ? ' mobile-nav-open' : ''}`} data-theme={theme}>
        <aside ref={mobileSidebarRef} id="member-navigation" className="member-sidebar">{memberSidebar}</aside>
        {mobileNavOpen && <button className="member-scrim" type="button" aria-label="Close navigation menu" onClick={closeMobileNav} data-testid="button-navigation-backdrop" />}
        <main className="member-main" aria-label={`Loading ${pageTitle.toLowerCase()}`} aria-busy="true">
          <header className="member-topbar">
            <button ref={mobileMenuButtonRef} type="button" className="mobile-menu-button" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation" aria-expanded={mobileNavOpen} aria-controls="member-navigation" data-testid="button-open-navigation"><Menu /></button>
            <div className="topbar-brand-tools"><div className="topbar-context">ReplenishCC</div></div>
            <div className="topbar-actions">
              <WorkspaceThemeToggle theme={theme} onToggle={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')} />
              <span className="skeleton topbar-balance-skeleton" aria-label="Loading available balance" />
              <div className="skeleton" style={{ width: 40, height: 40, borderRadius: '50%' }} />
            </div>
          </header>
          <div className="member-content"><div className="skeleton" style={{ width: 110, marginBottom: 22 }} /><div className="skeleton" style={{ width: '54%', height: 46, marginBottom: 16 }} /><div className="skeleton" style={{ width: '65%' }} /></div>
        </main>
      </div>
    );
  }

  return (
    <div className={`member-shell${mobileNavOpen ? ' mobile-nav-open' : ''}`} data-theme={theme}>
      <aside
        ref={mobileSidebarRef}
        id="member-navigation"
        className="member-sidebar"
        role={mobileNavOpen ? 'dialog' : undefined}
        aria-modal={mobileNavOpen || undefined}
        aria-label={mobileNavOpen ? 'Member navigation' : undefined}
      >{memberSidebar}</aside>
      {mobileNavOpen && <button className="member-scrim" type="button" aria-label="Close navigation menu" onClick={closeMobileNav} data-testid="button-navigation-backdrop" />}
      <main className="member-main" aria-label={pageTitle}>
        <header className="member-topbar">
          <button ref={mobileMenuButtonRef} type="button" className="mobile-menu-button" onClick={() => { setAccountOpen(false); setMobileNavOpen(true); }} aria-label="Open navigation" aria-expanded={mobileNavOpen} aria-controls="member-navigation" data-testid="button-open-navigation"><Menu /></button>
          <div className="topbar-brand-tools"><div className="topbar-context">ReplenishCC</div></div>
          <div className="topbar-actions">
            <WorkspaceThemeToggle theme={theme} onToggle={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')} />
            <Link
              href="/my-deposits"
              className="topbar-balance"
              aria-label={accountBalance.data ? `Available balance ${formatBalance(accountBalance.data.balanceCents)}. View deposit history.` : 'Balance unavailable. View deposit history.'}
              title="View deposit history"
              data-testid="link-topbar-balance"
            >
              <span className="topbar-balance-label">Balance</span>
              {accountBalance.isLoading
                ? <span className="skeleton topbar-balance-value-skeleton" aria-label="Loading available balance" />
                : accountBalance.data
                  ? <strong data-testid="text-topbar-balance">{formatBalance(accountBalance.data.balanceCents)}</strong>
                  : <span className="topbar-balance-unavailable" data-testid="text-topbar-balance-unavailable">Unavailable</span>}
            </Link>
            <div ref={accountControlRef} className="account-control">
              <button ref={accountTriggerRef} type="button" className="account-trigger" onClick={() => setAccountOpen((open) => !open)} aria-expanded={accountOpen} aria-controls="account-popover" data-testid="button-account-menu">
                <span className="account-avatar">{initials}</span><span className="account-trigger-name">{user.fullName}</span><ChevronDown aria-hidden="true" />
              </button>
              {accountOpen && <div id="account-popover" className="account-popover" role="region" aria-label="Account options">
                <div className="account-popover-head"><div className="account-avatar large">{initials}</div><div><strong data-testid="text-account-name">{user.fullName}</strong><span data-testid="text-account-email">{user.email}</span></div></div>
                {user.username && <div className="account-username" data-testid="text-account-username">Username <strong>@{user.username}</strong></div>}
                <Link href="/account-management" className="account-menu-note" onClick={() => setAccountOpen(false)} data-testid="link-account-management-menu"><LockKeyhole aria-hidden="true" /> Manage account security</Link>
                {logoutError && <div className="account-error" role="alert">{logoutError}</div>}
                <button type="button" className="account-logout" onClick={signOut} disabled={logout.isPending} data-testid="button-logout">
                  {logout.isPending ? <LoaderCircle className="spin" aria-hidden="true" /> : <LogOut aria-hidden="true" />}
                  {logout.isPending ? 'Signing out…' : 'Log out'}
                </button>
              </div>}
            </div>
          </div>
        </header>
        <div className={`member-content fade-in${contentClassName ? ` ${contentClassName}` : ''}`}>{children}</div>
        <SiteFooter />
        <TelegramAnnouncementPopup key={user.id} userId={user.id} />
      </main>
    </div>
  );
}