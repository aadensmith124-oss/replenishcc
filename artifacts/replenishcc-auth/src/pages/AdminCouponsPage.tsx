import { useEffect, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, CircleAlert, Copy, LoaderCircle, RefreshCw, ShieldCheck, TicketPercent } from 'lucide-react';
import {
  getGetAdminCouponsQueryKey,
  useCreateAdminCoupon,
  useGetAdminCoupons,
  useGetAuthMe,
  type AdminCoupon,
} from '@workspace/api-client-react';
import { useLocation } from 'wouter';
import { MemberShell } from '../components/MemberShell';

const readableDate = (value: string) => new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
function errorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return 'The request could not be completed. Please try again.';
}

export function AdminCouponsPage() {
  const session = useGetAuthMe();
  const [, setLocation] = useLocation();
  const client = useQueryClient();
  const user = session.data?.authenticated ? session.data.user : null;
  const couponsQuery = useGetAdminCoupons({
    query: {
      queryKey: getGetAdminCouponsQueryKey(),
      enabled: Boolean(user?.isDepositAdmin),
    },
  });
  const create = useCreateAdminCoupon();
  const [code, setCode] = useState('');
  const [percentOff, setPercentOff] = useState('10');
  const [maxRedemptions, setMaxRedemptions] = useState('100');
  const [createdCoupon, setCreatedCoupon] = useState<AdminCoupon | null>(null);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => { document.title = 'Coupon codes | ReplenishCC Admin'; }, []);
  useEffect(() => {
    if (!session.isLoading && (!session.data?.authenticated || session.isError)) setLocation('/login');
    else if (!session.isLoading && user && !user.isDepositAdmin) setLocation('/dashboard');
  }, [session.data?.authenticated, session.isError, session.isLoading, setLocation, user]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNotice(null);
    setCreatedCoupon(null);
    const percentage = Number(percentOff);
    const limit = Number(maxRedemptions);
    const normalizedCode = code.trim().toUpperCase();
    if (!Number.isInteger(percentage) || percentage < 1 || percentage > 100) {
      setNotice({ kind: 'error', text: 'Enter a whole-number discount between 1% and 100%.' });
      return;
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000_000) {
      setNotice({ kind: 'error', text: 'Set a redemption limit between 1 and 1,000,000 checkouts.' });
      return;
    }
    if (normalizedCode && !/^[A-Z0-9-]{1,40}$/.test(normalizedCode)) {
      setNotice({ kind: 'error', text: 'Coupon codes can use letters, numbers, and hyphens (up to 40 characters).' });
      return;
    }

    create.mutate({
      data: {
        percentOff: percentage,
        maxRedemptions: limit,
        ...(normalizedCode ? { code: normalizedCode } : {}),
      },
    }, {
      onSuccess: (coupon) => {
        setCreatedCoupon(coupon);
        setCode('');
        setNotice({ kind: 'success', text: `Coupon ${coupon.code} is ready to use at checkout.` });
        void client.invalidateQueries({ queryKey: getGetAdminCouponsQueryKey() });
      },
      onError: (error) => setNotice({ kind: 'error', text: errorMessage(error) }),
    });
  };

  const copyCode = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setNotice({ kind: 'success', text: `Coupon ${value} copied.` });
    } catch {
      setNotice({ kind: 'error', text: 'Clipboard unavailable. Select and copy the coupon code manually.' });
    }
  };

  if (session.isLoading || !user || !user.isDepositAdmin) return <MemberShell pageTitle="Coupon codes" user={null} loading />;
  const coupons = couponsQuery.data?.coupons ?? [];

  return <MemberShell pageTitle="Coupon codes" user={user} contentClassName="member-dashboard-content">
    <div className="workspace-page admin-coupons-page">
      <header className="workspace-heading">
        <div><div className="section-kicker"><TicketPercent aria-hidden="true" /> Administration · store offers</div><h1>Coupon codes</h1><p>Create percentage discounts for log purchases paid from member account balance.</p></div>
        <span className="license-admin-badge"><ShieldCheck aria-hidden="true" /> Deposit administrator</span>
      </header>
      {notice && <div className={`license-notice ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.kind === 'success' ? <Check aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}{notice.text}</div>}
      <div className="coupon-admin-layout">
        <section className="workspace-panel coupon-create-panel">
          <div className="section-kicker"><TicketPercent aria-hidden="true" /> New offer</div>
          <h2>Create a coupon</h2>
          <p>Each successful checkout uses one redemption from the limit. The code stops working when it reaches that limit.</p>
          <form className="license-admin-form" onSubmit={submit}>
            <label htmlFor="admin-coupon-code">Coupon code <span className="optional-label">optional</span></label>
            <input id="admin-coupon-code" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} maxLength={40} autoComplete="off" placeholder="Leave blank to generate" data-testid="input-admin-coupon-code" />
            <div className="license-form-pair">
              <div><label htmlFor="admin-coupon-percent">Discount (%)</label><input id="admin-coupon-percent" type="number" min="1" max="100" step="1" required value={percentOff} onChange={(event) => setPercentOff(event.target.value)} data-testid="input-admin-coupon-percent" /></div>
              <div><label htmlFor="admin-coupon-limit">Maximum checkouts</label><input id="admin-coupon-limit" type="number" min="1" max="1000000" step="1" required value={maxRedemptions} onChange={(event) => setMaxRedemptions(event.target.value)} data-testid="input-admin-coupon-limit" /></div>
            </div>
            <button className="workspace-primary-button license-submit" type="submit" disabled={create.isPending} data-testid="button-create-admin-coupon">{create.isPending ? <><LoaderCircle className="spin" aria-hidden="true" /> Creating…</> : <>Create coupon <TicketPercent aria-hidden="true" /></>}</button>
          </form>
          {createdCoupon && <div className="created-coupon-result" role="status" data-testid="status-created-admin-coupon">
            <div><span>New coupon · {createdCoupon.percentOff}% off</span><strong>{createdCoupon.code}</strong><small>Up to {createdCoupon.maxRedemptions.toLocaleString()} checkouts</small></div>
            <button className="workspace-secondary-button" type="button" onClick={() => void copyCode(createdCoupon.code)} data-testid="button-copy-admin-coupon"><Copy aria-hidden="true" /> Copy</button>
          </div>}
        </section>
        <section className="workspace-panel coupon-list-panel">
          <div className="license-stock-panel-heading"><div><div className="section-kicker">Live offers</div><h2>Issued coupons</h2><p>Usage counts update after a successful purchase.</p></div><button className="workspace-icon-button" type="button" onClick={() => void couponsQuery.refetch()} disabled={couponsQuery.isFetching} aria-label="Refresh coupon list" data-testid="button-refresh-admin-coupons"><RefreshCw aria-hidden="true" /></button></div>
          {couponsQuery.isLoading ? <div className="license-orders-loading" aria-busy="true"><div className="license-order-skeleton"><i /><i /><i /></div></div>
            : couponsQuery.isError ? <div className="license-query-error" role="alert"><CircleAlert aria-hidden="true" /><span>We couldn’t load coupon codes.</span><button type="button" onClick={() => void couponsQuery.refetch()}>Try again</button></div>
              : coupons.length === 0 ? <div className="workspace-empty compact"><TicketPercent aria-hidden="true" /><strong>No coupons created</strong><span>New coupons will appear here with their current usage.</span></div>
                : <div className="admin-coupon-list">{coupons.map((coupon) => {
                  const remaining = Math.max(0, coupon.maxRedemptions - coupon.redemptionCount);
                  const exhausted = remaining === 0;
                  return <article className={`admin-coupon-card${exhausted ? ' exhausted' : ''}`} key={coupon.id} data-testid={`card-admin-coupon-${coupon.id}`}>
                    <div className="admin-coupon-card-head"><div><span className="license-category-tag">{coupon.percentOff}% off</span><strong>{coupon.code}</strong></div><button className="workspace-icon-button" type="button" onClick={() => void copyCode(coupon.code)} aria-label={`Copy coupon ${coupon.code}`} data-testid={`button-copy-coupon-${coupon.id}`}><Copy aria-hidden="true" /></button></div>
                    <div className="admin-coupon-usage"><span>{coupon.redemptionCount.toLocaleString()} of {coupon.maxRedemptions.toLocaleString()} checkouts</span><strong>{exhausted ? 'Limit reached' : `${remaining.toLocaleString()} remaining`}</strong></div>
                    <div className="admin-coupon-progress" role="progressbar" aria-valuenow={coupon.redemptionCount} aria-valuemin={0} aria-valuemax={coupon.maxRedemptions}><i style={{ width: `${Math.min(100, (coupon.redemptionCount / coupon.maxRedemptions) * 100)}%` }} /></div>
                    <small>Created {readableDate(coupon.createdAt)} · applies to log orders</small>
                  </article>;
                })}</div>}
        </section>
      </div>
    </div>
  </MemberShell>;
}