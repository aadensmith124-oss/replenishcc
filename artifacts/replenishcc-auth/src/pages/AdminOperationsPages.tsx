import { useEffect, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Activity, AlertCircle, ArrowRight, Banknote, Boxes, Check, Eye, EyeOff, RefreshCw, UsersRound } from 'lucide-react';
import {
  getGetAdminDashboardOverviewQueryKey,
  getGetAdminDepositMethodsQueryKey,
  getGetDepositMethodsQueryKey,
  getGetMemberPageVisibilityQueryKey,
  useGetAdminDashboardOverview,
  useGetAdminDepositMethods,
  useGetMemberPageVisibility,
  useUpdateAdminDepositMethods,
  useUpdateAdminMemberPageVisibility,
  type DepositMethodsResponse,
  type MemberPageVisibilityPages,
} from '@workspace/api-client-react';

const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
const friendlyError = (error: unknown) => {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return 'The request could not be completed. Please try again.';
};

function QueryState({ loading, error, onRetry }: { loading: boolean; error?: unknown; onRetry: () => void }) {
  if (loading) return <div className="admin-op-skeleton" aria-busy="true"><i /><i /><i /></div>;
  if (error) return <div className="admin-op-error" role="alert"><AlertCircle /><span>{friendlyError(error)}</span><button type="button" onClick={onRetry}>Retry</button></div>;
  return null;
}

export function AdminOverviewPage() {
  const overview = useGetAdminDashboardOverview();
  const total = overview.data;
  return <div className="admin-ops-page">
    <header className="admin-ops-heading">
      <div><div className="admin-ops-kicker"><Activity /> Operational snapshot</div><h2>Overview</h2><p>Verified account activity and sellable inventory value from the live ReplenishCC record.</p></div>
      <button type="button" className="quiet-button" onClick={() => void overview.refetch()} disabled={overview.isFetching}><RefreshCw className={overview.isFetching ? 'spin' : ''} /> Refresh totals</button>
    </header>
    <QueryState loading={overview.isLoading} error={overview.isError ? overview.error : undefined} onRetry={() => void overview.refetch()} />
    {total && <div className="admin-overview-grid" aria-busy={overview.isFetching}>
      <article className="admin-overview-metric">
        <span className="admin-overview-icon"><UsersRound /></span><small>Registered accounts</small><strong data-testid="text-admin-total-users">{total.totalUsers.toLocaleString()}</strong><em>Real member count</em>
      </article>
      <article className="admin-overview-metric is-sales">
        <span className="admin-overview-icon"><Banknote /></span><small>Recorded sales</small><strong data-testid="text-admin-total-sales">{money(total.totalSalesCents)}</strong><em>Completed transactions</em>
      </article>
      <article className="admin-overview-metric is-stock">
        <span className="admin-overview-icon"><Boxes /></span><small>Available inventory value</small><strong data-testid="text-admin-stock-worth">{money(total.stockWorthCents)}</strong><em>Current sellable stock</em>
      </article>
    </div>}
    <div className="admin-ops-note"><Check /><span>Totals are supplied by the operations service and refresh on demand.</span></div>
  </div>;
}

const paymentMethods = [
  { key: 'cashAppEnabled', title: 'Cash App', descriptor: 'Manual transfer', input: 'admin-cashapp-enabled' },
  { key: 'chimeEnabled', title: 'Chime', descriptor: 'Manual transfer', input: 'admin-chime-enabled' },
  { key: 'applePayEnabled', title: 'Apple Pay', descriptor: 'Manual transfer', input: 'admin-applepay-enabled' },
  { key: 'venmoEnabled', title: 'Venmo', descriptor: 'Manual transfer', input: 'admin-venmo-enabled' },
  { key: 'nowPaymentsEnabled', title: 'Cryptocurrency', descriptor: 'NOWPayments', input: 'admin-nowpayments-enabled' },
] as const;

type PaymentDraft = Omit<DepositMethodsResponse, 'maximumAmountCents' | 'nowPaymentsConfigured'>;

export function AdminPaymentSettingsPage() {
  const client = useQueryClient();
  const methods = useGetAdminDepositMethods({ query: { queryKey: getGetAdminDepositMethodsQueryKey() } });
  const update = useUpdateAdminDepositMethods();
  const [draft, setDraft] = useState<PaymentDraft | null>(null);
  const [minimumAmount, setMinimumAmount] = useState('');
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const source = methods.data;
    if (!source || draft) return;
    setMinimumAmount((source.minimumAmountCents / 100).toFixed(2));
    setDraft({
      cashAppHandle: source.cashAppHandle,
      chimeHandle: source.chimeHandle,
      applePayRecipient: source.applePayRecipient,
      venmoHandle: source.venmoHandle,
      cashAppEnabled: source.cashAppEnabled,
      chimeEnabled: source.chimeEnabled,
      applePayEnabled: source.applePayEnabled,
      venmoEnabled: source.venmoEnabled,
      nowPaymentsEnabled: source.nowPaymentsEnabled,
      minimumAmountCents: source.minimumAmountCents,
    });
  }, [methods.data, draft]);

  const setField = <K extends keyof PaymentDraft>(field: K, value: PaymentDraft[K]) => {
    setDraft((current) => current ? { ...current, [field]: value } : current);
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft) return;
    setNotice(null);
    const minimumAmountCents = Math.round(Number(minimumAmount) * 100);
    if (!Number.isInteger(minimumAmountCents) || minimumAmountCents < 100 || minimumAmountCents > 1_000_000) {
      setNotice({ kind: 'error', text: 'Set a minimum deposit between $1.00 and $10,000.00.' });
      return;
    }
    update.mutate({ data: {
      cashAppHandle: draft.cashAppHandle?.trim() || null,
      chimeHandle: draft.chimeHandle?.trim() || null,
      applePayRecipient: draft.applePayRecipient?.trim() || null,
      venmoHandle: draft.venmoHandle?.trim() || null,
      cashAppEnabled: draft.cashAppEnabled,
      chimeEnabled: draft.chimeEnabled,
      applePayEnabled: draft.applePayEnabled,
      venmoEnabled: draft.venmoEnabled,
      nowPaymentsEnabled: draft.nowPaymentsEnabled,
      minimumAmountCents,
    } }, {
      onSuccess: (saved) => {
        setDraft({
          cashAppHandle: saved.cashAppHandle, chimeHandle: saved.chimeHandle, applePayRecipient: saved.applePayRecipient,
          venmoHandle: saved.venmoHandle, cashAppEnabled: saved.cashAppEnabled, chimeEnabled: saved.chimeEnabled,
          applePayEnabled: saved.applePayEnabled, venmoEnabled: saved.venmoEnabled, nowPaymentsEnabled: saved.nowPaymentsEnabled,
          minimumAmountCents: saved.minimumAmountCents,
        });
        setMinimumAmount((saved.minimumAmountCents / 100).toFixed(2));
        setNotice({ kind: 'success', text: 'Payment settings saved and member deposit options refreshed.' });
        void client.invalidateQueries({ queryKey: getGetAdminDepositMethodsQueryKey() });
        void client.invalidateQueries({ queryKey: getGetDepositMethodsQueryKey() });
      },
      onError: (error) => setNotice({ kind: 'error', text: friendlyError(error) }),
    });
  };

  return <div className="admin-ops-page">
    <header className="admin-ops-heading"><div><div className="admin-ops-kicker"><Banknote /> Payment routing</div><h2>Payment settings</h2><p>Manage the payment methods, member-facing recipients, and funding threshold used for new deposits.</p></div></header>
    <QueryState loading={methods.isLoading} error={methods.isError ? methods.error : undefined} onRetry={() => void methods.refetch()} />
    {draft && <form className="admin-settings-layout" onSubmit={submit}>
      <section className="finance-panel settings-panel admin-settings-panel">
        <div className="panel-overline">01 / Availability</div><h3>Methods visible to members</h3>
        <div className="payment-method-visibility-list">{paymentMethods.map((method) => <label key={method.key} className="payment-method-visibility-option" htmlFor={method.input}>
          <input id={method.input} type="checkbox" checked={draft[method.key]} onChange={(event) => setField(method.key, event.target.checked)} data-testid={`input-admin-${method.key}`} />
          <span><strong>{method.title}</strong><small>{method.descriptor}</small></span><em>{draft[method.key] ? 'Enabled' : 'Disabled'}</em>
        </label>)}</div>
        <div className="admin-settings-hint"><Eye /> Disabled payment methods are hidden from member deposit screens.</div>
      </section>
      <section className="finance-panel settings-panel admin-settings-panel">
        <div className="panel-overline">02 / Recipients</div><h3>Transfer destinations</h3>
        <label className="finance-label" htmlFor="admin-cashapp-handle">Cash App tag</label><input id="admin-cashapp-handle" className="field-input" value={draft.cashAppHandle ?? ''} onChange={(event) => setField('cashAppHandle', event.target.value)} maxLength={100} placeholder="$yourtag" data-testid="input-admin-cashapp-handle" />
        <label className="finance-label admin-input-label" htmlFor="admin-chime-handle">Chime handle</label><input id="admin-chime-handle" className="field-input" value={draft.chimeHandle ?? ''} onChange={(event) => setField('chimeHandle', event.target.value)} maxLength={100} placeholder="Chime recipient" data-testid="input-admin-chime-handle" />
        <label className="finance-label admin-input-label" htmlFor="admin-applepay-recipient">Apple Pay recipient</label><input id="admin-applepay-recipient" className="field-input" value={draft.applePayRecipient ?? ''} onChange={(event) => setField('applePayRecipient', event.target.value)} maxLength={100} placeholder="Email or phone" data-testid="input-admin-applepay-recipient" />
        <label className="finance-label admin-input-label" htmlFor="admin-venmo-handle">Venmo handle</label><input id="admin-venmo-handle" className="field-input" value={draft.venmoHandle ?? ''} onChange={(event) => setField('venmoHandle', event.target.value)} maxLength={100} placeholder="@yourhandle" data-testid="input-admin-venmo-handle" />
        <label className="finance-label admin-input-label" htmlFor="admin-minimum-deposit">Minimum deposit (USD)</label>
        <div className="amount-input-wrap"><span>$</span><input id="admin-minimum-deposit" type="number" min="1.00" max="10000.00" step="0.01" inputMode="decimal" value={minimumAmount} onChange={(event) => setMinimumAmount(event.target.value)} required data-testid="input-admin-minimum-deposit" /></div>
        {notice && <div className={`admin-ops-feedback ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.kind === 'success' ? <Check /> : <AlertCircle />}{notice.text}</div>}
        <button className="primary-button settings-save" type="submit" disabled={update.isPending || methods.isLoading} data-testid="button-save-recipient-settings">{update.isPending ? 'Saving…' : <>Save payment settings <ArrowRight /></>}</button>
      </section>
    </form>}
  </div>;
}

const visibilityOptions: Array<{ key: keyof MemberPageVisibilityPages; title: string; detail: string }> = [
  { key: 'deposits', title: 'Deposit funds', detail: 'New funding requests' },
  { key: 'depositHistory', title: 'Deposit history', detail: 'Member deposit records' },
  { key: 'referrals', title: 'Referrals', detail: 'Referral links and rewards' },
  { key: 'redeemCode', title: 'Redeem code', detail: 'Balance credit redemption' },
  { key: 'leaderboard', title: 'Leaderboard', detail: 'Weekly member rankings' },
  { key: 'buyLogs', title: 'Buy logs', detail: 'Log product catalog' },
  { key: 'buyCards', title: 'Buy cards', detail: 'Card product catalog' },
  { key: 'myLogOrders', title: 'My log orders', detail: 'Purchased log orders' },
  { key: 'myCardOrders', title: 'My card orders', detail: 'Purchased card orders' },
  { key: 'support', title: 'Support', detail: 'Ticket inbox and ticket creation' },
  { key: 'accountManagement', title: 'Account management', detail: 'Security and account actions' },
];

export function AdminPageVisibilityPage() {
  const client = useQueryClient();
  const visibility = useGetMemberPageVisibility({ query: { queryKey: getGetMemberPageVisibilityQueryKey() } });
  const update = useUpdateAdminMemberPageVisibility();
  const [pages, setPages] = useState<MemberPageVisibilityPages | null>(null);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  useEffect(() => {
    if (visibility.data && !pages) setPages({ ...visibility.data.pages });
  }, [visibility.data, pages]);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!pages) return;
    setNotice(null);
    update.mutate({ data: { pages } }, {
      onSuccess: (saved) => {
        setPages({ ...saved.pages });
        client.setQueryData(getGetMemberPageVisibilityQueryKey(), saved);
        void client.invalidateQueries({ queryKey: getGetMemberPageVisibilityQueryKey() });
        setNotice({ kind: 'success', text: 'Member page access updated.' });
      },
      onError: (error) => setNotice({ kind: 'error', text: friendlyError(error) }),
    });
  };
  return <div className="admin-ops-page">
    <header className="admin-ops-heading"><div><div className="admin-ops-kicker"><Eye /> Member experience</div><h2>Page visibility</h2><p>Choose which member destinations are available. Disabled pages are removed from navigation and direct access is blocked.</p></div></header>
    <QueryState loading={visibility.isLoading} error={visibility.isError ? visibility.error : undefined} onRetry={() => void visibility.refetch()} />
    {pages && <form className="finance-panel admin-visibility-panel" onSubmit={submit}>
      <div className="admin-visibility-top"><div><div className="panel-overline">Access controls</div><h3>Member destinations</h3><p>Settings apply to the full page group and its associated member actions.</p></div><span className="admin-visibility-count">{Object.values(pages).filter(Boolean).length} of 11 enabled</span></div>
      <div className="admin-visibility-list">{visibilityOptions.map((item) => <label className="admin-visibility-row" htmlFor={`visibility-${item.key}`} key={item.key}>
        <span className="admin-visibility-toggle"><input id={`visibility-${item.key}`} type="checkbox" checked={pages[item.key]} onChange={(event) => setPages((current) => current ? { ...current, [item.key]: event.target.checked } : current)} data-testid={`input-visibility-${item.key}`} /><i aria-hidden="true" /></span>
        <span className="admin-visibility-name"><strong>{item.title}</strong><small>{item.detail}</small></span>
        <span className={`admin-visibility-state${pages[item.key] ? ' enabled' : ''}`}>{pages[item.key] ? <><Eye /> Available</> : <><EyeOff /> Hidden</>}</span>
      </label>)}</div>
      {notice && <div className={`admin-ops-feedback ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.kind === 'success' ? <Check /> : <AlertCircle />}{notice.text}</div>}
      <div className="admin-visibility-actions"><span>Complete settings map is saved together.</span><button className="primary-button" type="submit" disabled={update.isPending}>{update.isPending ? 'Saving access…' : <>Save visibility <ArrowRight /></>}</button></div>
    </form>}
  </div>;
}