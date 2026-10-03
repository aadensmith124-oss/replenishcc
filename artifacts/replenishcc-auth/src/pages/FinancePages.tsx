import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownLeft, ArrowRight, Check, CheckCircle2, ChevronRight, ChevronLeft, CircleAlert, Clipboard, Menu,
  Clock3, Copy, ExternalLink, FileText, LockKeyhole, LogOut, RefreshCw, Search, ShieldCheck,
  WalletCards, XCircle, Columns3, Gift,
} from 'lucide-react';
import {
  getGetAdminDepositMethodsQueryKey, getGetAdminDepositsQueryKey, getGetDepositMethodsQueryKey,
  getGetAdminRedeemCodesQueryKey, getGetMyDepositsQueryKey, getGetMyReferralSummaryQueryKey, useCreateAdminRedeemCode, useGetAdminRedeemCodes, useCreateCryptoDeposit,
  useCreateManualDeposit, useGetAdminDepositMethods, useGetAdminDeposits, useGetAuthMe,
  useGetCryptoCurrencies, useGetDepositMethods, useGetMyDeposits, useGetMyReferralSummary,
  useReviewDeposit, useUpdateAdminDepositMethods,
  type AdminDeposit, type AdminRedeemCode, type Deposit,
} from '@workspace/api-client-react';
import { Link } from 'wouter';
import { MemberShell } from '../components/MemberShell';

function errorText(error: unknown): string {
  if (error && typeof error === 'object') {
    const candidate = error as { message?: unknown; error?: unknown; response?: { data?: { error?: unknown } } };
    if (typeof candidate.response?.data?.error === 'string') return candidate.response.data.error;
    if (typeof candidate.error === 'string') return candidate.error;
    if (typeof candidate.message === 'string') return candidate.message;
  }
  return 'We could not complete that request. Please try again.';
}

function referralLink(referralCode: string): string {
  const appBase = new URL(import.meta.env.BASE_URL || '/', window.location.origin);
  appBase.pathname = `${appBase.pathname.replace(/\/+$/, '')}/register`;
  appBase.searchParams.set('ref', referralCode);
  return appBase.toString();
}

function dollars(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

function dateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function Status({ value, testId }: { value: Deposit['status']; testId?: string }) {
  const Icon = value === 'confirmed' ? CheckCircle2 : value === 'rejected' || value === 'failed' || value === 'refunded' ? XCircle : Clock3;
  return <span className={`deposit-status status-${value}`} data-testid={testId}><Icon aria-hidden="true" />{value}</span>;
}

function Alert({ children, kind = 'error' }: { children: ReactNode; kind?: 'error' | 'success' | 'info' }) {
  return <div className={`portal-alert portal-alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div>;
}

function LoadingBlock({ label }: { label: string }) {
  return <div className="portal-loading" aria-busy="true" aria-label={label}><span /><span /><span /></div>;
}

function PortalFrame({ title, children }: { title: string; children: ReactNode }) {
  const session = useGetAuthMe();
  if (session.isLoading) return <MemberShell pageTitle={title} user={null} loading />;
  if (session.isError || !session.data?.authenticated || !session.data.user) {
    return <div className="app-frame"><div className="member-gate"><ShieldCheck /><h1>Sign in required</h1><p>Your account session is needed to open this private area.</p><Link href="/login" className="primary-button">Return to sign in</Link></div></div>;
  }
  return <MemberShell pageTitle={title} user={session.data.user} contentClassName="finance-content">{children}</MemberShell>;
}

function PageHeading({ eyebrow, title, copy, action }: { eyebrow?: string; title: string; copy: string; action?: ReactNode }) {
  return <div className="finance-heading"><div>{eyebrow && <div className="welcome-eyebrow">{eyebrow}</div>}<h1>{title}</h1><p>{copy}</p></div>{action}</div>;
}

function QueryError({ error, retry }: { error: unknown; retry: () => void }) {
  return <Alert><span>{errorText(error)}</span><button type="button" className="inline-retry" onClick={retry}><RefreshCw /> Retry</button></Alert>;
}

function History({ deposits }: { deposits: Deposit[] }) {
  if (!deposits.length) return <div className="finance-empty"><span className="empty-mark"><FileText /></span><h3>No deposit activity yet</h3><p>When you make a deposit request, its server-verified status will appear here.</p></div>;
  return <div className="deposit-table-wrap"><table className="deposit-table"><thead><tr><th>Request</th><th>Method</th><th>Amount</th><th>Status</th><th>Created</th></tr></thead><tbody>
    {deposits.map((deposit) => <tr key={deposit.id} data-testid={`row-deposit-${deposit.id}`}>
      <td><strong>#{deposit.id}</strong>{deposit.referenceCode && <small>Ref. {deposit.referenceCode}</small>}{deposit.rejectionReason && <small className="rejection-note">{deposit.rejectionReason}</small>}</td>
      <td className="method-cell">{deposit.method === 'nowpayments' ? (deposit.payCurrency ? deposit.payCurrency.toUpperCase() : 'Crypto') : deposit.method === 'cashapp' ? 'Cash App' : 'Chime'}</td>
      <td>{dollars(deposit.amountCents)}</td><td><Status value={deposit.status} />{deposit.providerStatus && <small className="provider-status">{deposit.providerStatus}</small>}</td><td>{dateTime(deposit.createdAt)}</td>
    </tr>)}
  </tbody></table></div>;
}

export function DepositsPage() {
  const client = useQueryClient();
  const methods = useGetDepositMethods();
  const account = useGetMyDeposits();
  const currencies = useGetCryptoCurrencies();
  const manualDeposit = useCreateManualDeposit();
  const cryptoDeposit = useCreateCryptoDeposit();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'nowpayments' | 'cashapp' | 'chime'>('nowpayments');
  const [currency, setCurrency] = useState('');
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [created, setCreated] = useState<Deposit | null>(null);
  const [copyMessage, setCopyMessage] = useState('');
  const config = methods.data;
  const availableCurrencies = currencies.data?.currencies ?? [];
  useEffect(() => {
    if (!config || method !== 'nowpayments' || config.nowPaymentsConfigured) return;
    if (config.cashAppHandle) setMethod('cashapp');
    else if (config.chimeHandle) setMethod('chime');
  }, [config, method]);
  const minimum = config ? Math.max(1500, config.minimumAmountCents) : 1500;
  const maximum = config ? Math.min(1_000_000, config.maximumAmountCents) : 1_000_000;
  const methodsError = methods.isError ? <QueryError error={methods.error} retry={() => void methods.refetch()} /> : null;
  const historyError = account.isError ? <QueryError error={account.error} retry={() => void account.refetch()} /> : null;
  const usable = config && (method === 'nowpayments' ? config.nowPaymentsConfigured : method === 'cashapp' ? Boolean(config.cashAppHandle) : Boolean(config.chimeHandle));
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null); setCreated(null);
    const amountNumber = Number(amount);
    if (!Number.isFinite(amountNumber) || amountNumber * 100 < minimum || amountNumber * 100 > maximum) {
      setMessage({ kind: 'error', text: `Enter an amount between ${dollars(minimum)} and ${dollars(maximum)}.` }); return;
    }
    if (!config) { setMessage({ kind: 'error', text: 'Deposit configuration is not available yet. Try again shortly.' }); return; }
    if (!usable) { setMessage({ kind: 'error', text: 'This deposit method is not currently configured.' }); return; }
    const amountCents = Math.round(amountNumber * 100);
    const onSuccess = (deposit: Deposit) => {
      setCreated(deposit);
      setMessage({ kind: 'success', text: 'Deposit request created. Follow the payment details below; your balance changes only after server confirmation.' });
      void client.invalidateQueries({ queryKey: getGetMyDepositsQueryKey() });
      void client.invalidateQueries({ queryKey: getGetMyReferralSummaryQueryKey() });
    };
    const onError = (error: unknown) => setMessage({ kind: 'error', text: errorText(error) });
    if (method === 'nowpayments') {
      if (!availableCurrencies.includes(currency)) { setMessage({ kind: 'error', text: 'Choose a currency returned by the live payment service.' }); return; }
      cryptoDeposit.mutate({ data: { amountCents, payCurrency: currency } }, {
        onSuccess: (response) => onSuccess(response.deposit), onError,
      });
    } else {
      manualDeposit.mutate({ data: { method, amountCents } }, { onSuccess, onError });
    }
  };
  const pending = manualDeposit.isPending || cryptoDeposit.isPending;
  const copy = async (value: string, label: string) => {
    try { await navigator.clipboard.writeText(value); setCopyMessage(`${label} copied.`); }
    catch { setCopyMessage('Clipboard unavailable. Select and copy the value manually.'); }
  };
  return <PortalFrame title="Deposits">
    <PageHeading eyebrow="Account funding" title="Deposits" copy="Add funds using a configured payment method. Your available balance updates only when the payment is verified." />
    <div className="balance-strip">
      <div className="balance-icon"><WalletCards /></div><div className="balance-copy"><span>Available balance</span>{account.isLoading ? <div className="skeleton balance-skeleton" /> : account.data ? <strong data-testid="text-account-balance">{dollars(account.data.balanceCents)}</strong> : <strong className="balance-unavailable">Unavailable</strong>}</div>
      <div className="balance-security"><ShieldCheck /><span>Verified account<br />balance</span></div>
    </div>
    {historyError}
    <div className="deposit-layout">
      <section className="finance-panel deposit-form-panel" aria-labelledby="deposit-form-title">
        <div className="panel-overline">01 / New request</div><h2 id="deposit-form-title">Choose how to fund</h2>
        {methods.isLoading ? <LoadingBlock label="Loading configured payment methods" /> : methodsError ? null : config && <form onSubmit={submit}>
          <fieldset className="method-picker"><legend>Payment method</legend>
            {([
              ['nowpayments', 'Crypto', 'NOWPayments'],
              ['cashapp', 'Cash App', config.cashAppHandle ? 'Manual transfer' : 'Not configured'],
              ['chime', 'Chime', config.chimeHandle ? 'Manual transfer' : 'Not configured'],
            ] as const).map(([id, label, note]) => {
              const configured = id === 'nowpayments' ? config.nowPaymentsConfigured : id === 'cashapp' ? Boolean(config.cashAppHandle) : Boolean(config.chimeHandle);
              return <button key={id} type="button" className={`method-option${method === id ? ' selected' : ''}`} onClick={() => { setMethod(id); setCreated(null); setMessage(null); }} aria-pressed={method === id} disabled={!configured} data-testid={`button-method-${id}`}>
                <span className="method-radio" /><span><strong>{label}</strong><small>{note}</small></span>{id === 'nowpayments' && configured && <span className="method-live">Live</span>}
              </button>;
            })}
          </fieldset>
          <label className="finance-label" htmlFor="deposit-amount">Amount in USD</label>
          <div className="amount-input-wrap"><span>$</span><input id="deposit-amount" type="number" min={dollars(minimum)} max={dollars(maximum)} step="0.01" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Enter an amount" required data-testid="input-deposit-amount" /></div>
          <div className="field-assist">Limits: {dollars(minimum)} – {dollars(maximum)} per request</div>
          {method === 'nowpayments' && <div className="currency-field"><label className="finance-label" htmlFor="deposit-currency">Receive payment in</label>
            {currencies.isLoading ? <LoadingBlock label="Loading live crypto currencies" /> : currencies.isError ? <QueryError error={currencies.error} retry={() => void currencies.refetch()} /> : availableCurrencies.length ? <select id="deposit-currency" value={currency} onChange={(event) => setCurrency(event.target.value)} required data-testid="select-crypto-currency"><option value="">Choose a currency</option>{availableCurrencies.map((item) => <option key={item} value={item}>{item.toUpperCase()}</option>)}</select> : <Alert kind="info">No payment currencies are currently offered by the live payment service.</Alert>}
          </div>}
          {method !== 'nowpayments' && <div className="manual-note"><CircleAlert /><span>After submitting, use the exact reference code shown below with your Cash App or Chime transfer. Requests are reviewed before your balance is credited.</span></div>}
          {message && <Alert kind={message.kind}>{message.text}</Alert>}
          <button className="primary-button finance-submit" type="submit" disabled={pending || methods.isLoading || (method === 'nowpayments' && (currencies.isLoading || !availableCurrencies.length))} data-testid="button-create-deposit">{pending ? 'Creating request…' : <>Continue to payment <ArrowRight /></>}</button>
        </form>}
        {!methods.isLoading && !methods.isError && config && !config.nowPaymentsConfigured && !config.cashAppHandle && !config.chimeHandle && <Alert kind="info">No deposit methods are configured at this time. Please check back later.</Alert>}
        {created && <div className="payment-instructions" aria-live="polite">
          <div className="instruction-title"><CheckCircle2 /><div><strong>Request #{created.id}</strong><span>{created.method === 'nowpayments' ? 'Payment instructions from the provider' : 'Manual transfer request'}</span></div></div>
          {created.method === 'nowpayments' ? <>
            {created.paymentUrl && <a className="provider-payment-link" href={created.paymentUrl} target="_blank" rel="noreferrer">Open secure payment page <ExternalLink /></a>}
            <div className="instruction-grid">
              {created.payAmount && <Instruction label={`Send amount${created.payCurrency ? ` (${created.payCurrency.toUpperCase()})` : ''}`} value={created.payAmount} onCopy={() => void copy(created.payAmount!, 'Payment amount')} />}
              {created.paymentAddress && <Instruction label="Payment address" value={created.paymentAddress} onCopy={() => void copy(created.paymentAddress!, 'Payment address')} />}
              {created.payinExtraId && <Instruction label="Payment memo / ID" value={created.payinExtraId} onCopy={() => void copy(created.payinExtraId!, 'Payment ID')} />}
              {created.expiresAt && <div className="instruction-field"><span>Payment expires</span><strong>{dateTime(created.expiresAt)}</strong></div>}
            </div>
            {!created.paymentUrl && !created.payAmount && !created.paymentAddress && <Alert kind="info">Provider instructions are not available on this response. Check your deposit history for updates.</Alert>}
          </> : <>
            <p className="manual-transfer-copy">Send <strong>{dollars(created.amountCents)}</strong> to the recipient below and include the request code exactly as shown. Keep this page for your records.</p>
            {created.recipient && <Instruction label="Send to" value={created.recipient} onCopy={() => void copy(created.recipient!, 'Recipient')} />}
            {created.referenceCode && <Instruction label="Required transfer note / code" value={created.referenceCode} onCopy={() => void copy(created.referenceCode!, 'Reference code')} />}
            {!created.recipient && !created.referenceCode && <Alert kind="info">Recipient details are not included in the response. Use the request ID in your account history and contact support before sending.</Alert>}
          </>}
          {copyMessage && <div className="copy-feedback" role="status">{copyMessage}</div>}
        </div>}
      </section>
      <aside className="deposit-aside">
        <div className="finance-panel assurance-panel"><span className="assurance-icon"><ShieldCheck /></span><div className="panel-overline">Account assurance</div><h3>Only verified funds count.</h3><p>Requests remain pending until payment confirmation or a manual review. The displayed balance comes from your account record, not from pending requests.</p></div>
        <div className="finance-panel method-guide"><div className="panel-overline">Before you send</div><h3>Check the details twice.</h3><ul><li>Use the exact amount and currency shown.</li><li>Manual transfers require their unique note code.</li><li>Do not send funds to unlisted recipients.</li></ul></div>
      </aside>
    </div>
    <section className="finance-panel history-panel" aria-labelledby="history-title">
      <div className="history-heading"><div><div className="panel-overline">Account record</div><h2 id="history-title">Deposit history</h2></div><button type="button" className="quiet-button" onClick={() => void account.refetch()} disabled={account.isFetching} data-testid="button-refresh-deposits"><RefreshCw className={account.isFetching ? 'spin' : ''} /> Refresh</button></div>
      {account.isLoading ? <LoadingBlock label="Loading deposit history" /> : account.isError ? null : <History deposits={account.data?.deposits ?? []} />}
    </section>
  </PortalFrame>;
}

type HistoryColumn = 'id' | 'amount' | 'status' | 'transaction' | 'created';
const historyColumns: { id: HistoryColumn; label: string }[] = [
  { id: 'id', label: 'Deposit ID' },
  { id: 'amount', label: 'Amount' },
  { id: 'status', label: 'Status' },
  { id: 'transaction', label: 'Transaction ID' },
  { id: 'created', label: 'Created' },
];
const depositStatuses: Deposit['status'][] = ['pending', 'confirmed', 'rejected', 'failed', 'expired', 'refunded'];

export function MyDepositsPage() {
  const account = useGetMyDeposits();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | Deposit['status']>('all');
  const [page, setPage] = useState(1);
  const [visible, setVisible] = useState<HistoryColumn[]>(historyColumns.map((column) => column.id));
  const normalizedSearch = search.trim().toLowerCase();
  const allDeposits = account.data?.deposits ?? [];
  const filtered = allDeposits.filter((deposit) => {
    const matchesId = deposit.id.toLowerCase().includes(normalizedSearch);
    return matchesId && (status === 'all' || deposit.status === status);
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / 10));
  const currentPage = Math.min(page, pageCount);
  const rows = filtered.slice((currentPage - 1) * 10, currentPage * 10);
  const toggleColumn = (column: HistoryColumn) => {
    setVisible((current) => current.includes(column)
      ? current.length > 1 ? current.filter((item) => item !== column) : current
      : [...current, column]);
  };
  const resetFilters = () => { setSearch(''); setStatus('all'); setPage(1); };
  useEffect(() => { setPage(1); }, [normalizedSearch, status]);
  useEffect(() => { document.title = 'My deposits | ReplenishCC'; }, []);
  return <PortalFrame title="Deposit history">
    <PageHeading eyebrow="Account record" title="My deposits" copy="A clear record of every deposit request associated with your account." action={<Link href="/deposits" className="quiet-button deposit-history-fund" data-testid="link-fund-account"><ArrowDownLeft /> Fund account</Link>} />
    {account.data && <div className="history-balance-strip" data-testid="text-history-balance">
      <span><ShieldCheck /> Verified available balance</span>
      <strong>{dollars(account.data.balanceCents)}</strong>
      <small>Pending requests are not included in this balance.</small>
    </div>}
    <section className="finance-panel my-deposits-panel" aria-labelledby="my-deposits-title">
      <div className="history-heading my-deposits-heading">
        <div><div className="panel-overline">Verified account activity</div><h2 id="my-deposits-title">Deposit history</h2></div>
        <button type="button" className="quiet-button" onClick={() => void account.refetch()} disabled={account.isFetching} data-testid="button-refresh-my-deposits"><RefreshCw className={account.isFetching ? 'spin' : ''} /> Refresh</button>
      </div>
      <div className="deposit-history-controls">
        <details className="column-chooser">
          <summary className="quiet-button" data-testid="button-choose-deposit-columns"><Columns3 /> Columns <ChevronRight className="chooser-chevron" /></summary>
          <div className="column-chooser-menu" role="group" aria-label="Choose visible columns">
            {historyColumns.map((column) => <label key={column.id} className="column-choice">
              <input type="checkbox" checked={visible.includes(column.id)} disabled={visible.length === 1 && visible.includes(column.id)} onChange={() => toggleColumn(column.id)} data-testid={`checkbox-column-${column.id}`} />
              <span>{column.label}</span>
            </label>)}
          </div>
        </details>
        <label className="history-search-field">
          <span>Search by deposit ID</span>
          <span className="history-search-input"><Search aria-hidden="true" /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by order ID…" aria-label="Search by deposit ID" data-testid="input-deposit-id-search" /></span>
        </label>
        <label className="history-status-field">
          <span>Status filter</span>
          <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} data-testid="select-deposit-status">
            <option value="all">All statuses</option>
            {depositStatuses.map((item) => <option key={item} value={item}>{item[0].toUpperCase() + item.slice(1)}</option>)}
          </select>
        </label>
      </div>
      {account.isLoading ? <div className="deposit-history-loading" data-testid="loading-my-deposits"><LoadingBlock label="Loading your deposit history" /></div>
        : account.isError ? <QueryError error={account.error} retry={() => void account.refetch()} />
        : allDeposits.length === 0 ? <div className="finance-empty deposit-history-empty" data-testid="empty-my-deposits"><span className="empty-mark"><FileText /></span><h3>No deposit activity yet</h3><p>Once you create a deposit request, its verified details and decision status will appear here.</p><Link href="/deposits" className="quiet-button" data-testid="link-empty-fund-account">Create a deposit request <ArrowRight /></Link></div>
        : filtered.length === 0 ? <div className="finance-empty deposit-history-empty no-results" data-testid="empty-deposit-search"><span className="empty-mark"><Search /></span><h3>No matching deposits</h3><p>Try a different deposit ID or status filter.</p><button type="button" className="quiet-button" onClick={resetFilters} data-testid="button-clear-deposit-filters">Clear filters</button></div>
        : <>
          <div className="deposit-history-table-scroll" role="region" aria-label="Deposit records" tabIndex={0} data-testid="region-deposit-table">
            <table className="deposit-table my-deposits-table">
              <thead><tr>{historyColumns.filter((column) => visible.includes(column.id)).map((column) => <th key={column.id} scope="col">{column.label}</th>)}</tr></thead>
              <tbody>{rows.map((deposit) => <tr key={deposit.id} data-testid={`row-my-deposit-${deposit.id}`}>
                {visible.includes('id') && <td data-label="Deposit ID"><strong className="history-deposit-id" data-testid={`text-deposit-id-${deposit.id}`}>{deposit.id}</strong></td>}
                {visible.includes('amount') && <td data-label="Amount"><strong className="history-amount" data-testid={`text-deposit-amount-${deposit.id}`}>{dollars(deposit.amountCents)}</strong></td>}
                {visible.includes('status') && <td data-label="Status"><Status value={deposit.status} testId={`status-my-deposit-${deposit.id}`} /></td>}
                {visible.includes('transaction') && <td data-label="Transaction ID"><span className="history-transaction" data-testid={`text-transaction-id-${deposit.id}`}>{deposit.transactionId || '—'}</span></td>}
                {visible.includes('created') && <td data-label="Created"><time dateTime={deposit.createdAt} data-testid={`text-deposit-created-${deposit.id}`}>{dateTime(deposit.createdAt)}</time></td>}
              </tr>)}</tbody>
            </table>
          </div>
          <div className="deposit-history-pagination">
            <span className="history-result-count" data-testid="text-deposit-result-count">Showing {(currentPage - 1) * 10 + 1}–{Math.min(currentPage * 10, filtered.length)} of {filtered.length} deposits</span>
            <div className="history-page-actions">
              <span className="history-page-number" aria-live="polite" data-testid="text-deposit-page">Page {currentPage} of {pageCount}</span>
              <button type="button" className="quiet-button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={currentPage <= 1} aria-label="Previous page" data-testid="button-deposit-previous"><ChevronLeft /> Previous</button>
              <button type="button" className="quiet-button" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={currentPage >= pageCount} aria-label="Next page" data-testid="button-deposit-next">Next <ChevronRight /></button>
            </div>
          </div>
        </>}
    </section>
  </PortalFrame>;
}

function Instruction({ label, value, onCopy }: { label: string; value: string; onCopy: () => void }) {
  return <div className="instruction-field"><span>{label}</span><div><strong>{value}</strong><button type="button" aria-label={`Copy ${label}`} onClick={onCopy} data-testid={`button-copy-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}><Copy /></button></div></div>;
}

export function ReferralsPage() {
  const summary = useGetMyReferralSummary({
    query: {
      queryKey: getGetMyReferralSummaryQueryKey(),
      refetchOnWindowFocus: true,
      refetchInterval: 120_000,
    },
  });
  const [copied, setCopied] = useState('');
  useEffect(() => { document.title = 'Referrals | ReplenishCC'; }, []);
  const copy = async (value: string, label: string) => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable.');
      await navigator.clipboard.writeText(value);
      setCopied(`${label} copied.`);
    } catch {
      setCopied('Copy failed. Select the value and copy it manually.');
    }
  };
  const invitationLink = summary.data
    ? referralLink(summary.data.referralCode)
    : '';
  const formattedRewardPercent = summary.data ? String(summary.data.rewardPercent) : '';
  return <PortalFrame title="Referrals">
    <PageHeading title="Referral Program" copy="Invite friends and earn rewards" />
    {summary.isLoading ? <div className="referral-skeleton"><LoadingBlock label="Loading referral summary" /><div className="referral-loading-cards" aria-hidden="true"><span /><span /><span /><span /></div></div> : summary.isError ? <QueryError error={summary.error} retry={() => void summary.refetch()} /> : summary.data && <>
      <section className="referral-link-panel finance-panel" aria-label="Your share details">
        <div className="referral-share-intro"><span className="panel-overline">Make an introduction</span><h2>One link. Yours to share.</h2><p>Send your link directly. The referral code is also ready to copy on its own.</p></div>
        <div className="referral-share-fields">
          <div className="referral-code-group"><label htmlFor="referral-code">Referral code</label><div><input id="referral-code" readOnly value={summary.data.referralCode} aria-label="Your referral code" data-testid="text-referral-code" /><button type="button" className="quiet-button" onClick={() => void copy(summary.data.referralCode, 'Referral code')} data-testid="button-copy-referral-code"><Copy aria-hidden="true" /> Copy code</button></div></div>
          <div className="referral-code-group"><label htmlFor="referral-url">Invitation link</label><div><input id="referral-url" readOnly value={invitationLink} aria-label="Your invitation link" data-testid="text-referral-url" /><button type="button" className="quiet-button referral-copy-link" onClick={() => void copy(invitationLink, 'Referral link')} data-testid="button-copy-referral-link"><Clipboard aria-hidden="true" /> Copy link</button></div></div>
          {copied && <div className={`copy-feedback referral-copy-feedback${copied.startsWith('Copy failed') ? ' copy-failed' : ''}`} role={copied.startsWith('Copy failed') ? 'alert' : 'status'} aria-live="polite">{copied}</div>}
        </div>
      </section>
      <section className="referral-results-section" aria-labelledby="referral-results-title">
        <div className="referral-section-heading"><div><div className="panel-overline">Your account record</div><h2 id="referral-results-title">Referral results</h2></div><button type="button" className="quiet-button referral-refresh" onClick={() => void summary.refetch()} disabled={summary.isFetching} aria-label="Refresh referral results" data-testid="button-refresh-referrals"><RefreshCw className={summary.isFetching ? 'spin' : ''} aria-hidden="true" /> Refresh</button></div>
        <section className="referral-stats" aria-label="Verified referral results" aria-busy={summary.isFetching}>
          <Metric label="Total referrals" value={summary.data.totalReferrals} detail="Accounts linked to your code" />
          <Metric label="Paid referrals" value={summary.data.paidReferrals} detail="Have a confirmed qualifying deposit" />
          <Metric label="Pending referrals" value={summary.data.pendingReferrals} detail="Have not qualified yet" />
          <Metric label="Rewards earned" value={dollars(summary.data.totalRewardsCents)} detail="Referral credits recorded" emphasis />
        </section>
      </section>
      <section className="finance-panel referral-terms" aria-labelledby="referral-terms-title">
        <div className="referral-terms-symbol"><ShieldCheck aria-hidden="true" /></div>
        <div className="referral-terms-copy"><div className="panel-overline">The reward rules</div><h2 id="referral-terms-title">{formattedRewardPercent}% when a deposit qualifies.</h2><p>A referred member’s deposit must be at least {dollars(summary.data.minimumDepositCents)} and confirmed before it qualifies. Your reward is added to your account balance automatically after confirmation. Processing and account updates may take time.</p></div>
        <div className="referral-totals">
          <div><span>Confirmed referred deposits</span><strong>{dollars(summary.data.totalDepositsCents)}</strong><small>Includes all confirmed deposits from referred members, whether or not each meets the reward threshold.</small></div>
          <div><span>Referral rewards recorded</span><strong>{dollars(summary.data.totalRewardsCents)}</strong></div>
        </div>
      </section>
    </>}
  </PortalFrame>;
}

function AdminRedeemCodes() {
  const client = useQueryClient();
  const codesQuery = useGetAdminRedeemCodes({ query: { queryKey: getGetAdminRedeemCodesQueryKey() } });
  const createCode = useCreateAdminRedeemCode();
  const [amount, setAmount] = useState('');
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [createdCode, setCreatedCode] = useState<AdminRedeemCode | null>(null);
  const create = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);
    setCreatedCode(null);
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0 || Math.round(value * 100) < 1 || value > 21_474_836.47) {
      setMessage({ kind: 'error', text: 'Enter a positive amount up to $21,474,836.47.' });
      return;
    }
    const normalizedCode = code.trim().toUpperCase();
    if (normalizedCode && !/^[A-Z0-9-]{1,40}$/.test(normalizedCode)) {
      setMessage({ kind: 'error', text: 'A custom code can contain letters, numbers, and hyphens (up to 40 characters).' });
      return;
    }
    createCode.mutate({ data: { amountCents: Math.round(value * 100), ...(normalizedCode ? { code: normalizedCode } : {}) } }, {
      onSuccess: (created) => {
        setCreatedCode(created);
        setAmount('');
        setCode('');
        setMessage({ kind: 'success', text: 'Redeem code created. Share it securely; the first redemption receives the credit.' });
        void client.invalidateQueries({ queryKey: getGetAdminRedeemCodesQueryKey() });
      },
      onError: (error) => setMessage({ kind: 'error', text: errorText(error) }),
    });
  };
  const copyCode = async () => {
    if (!createdCode) return;
    try {
      await navigator.clipboard.writeText(createdCode.code);
      setMessage({ kind: 'success', text: 'Code copied to clipboard.' });
    } catch {
      setMessage({ kind: 'error', text: 'Clipboard unavailable. Select and copy the code manually.' });
    }
  };
  return <section className="finance-panel redeem-admin-panel" aria-labelledby="admin-redeem-title">
    <div className="redeem-admin-head"><div><div className="panel-overline">Member account credits</div><h2 id="admin-redeem-title">Redeem codes</h2><p>Create single-use codes while managing deposits. Each successful redemption is credited directly to the member balance.</p></div><span className="redeem-admin-mark"><Gift aria-hidden="true" /></span></div>
    <form className="redeem-create-form" onSubmit={create} noValidate>
      <div><label className="finance-label" htmlFor="admin-redeem-amount">Credit amount (USD)</label><div className="amount-input-wrap"><span>$</span><input id="admin-redeem-amount" type="number" min="0.01" max="21474836.47" step="0.01" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="25.00" required data-testid="input-admin-redeem-amount" /></div></div>
      <div><label className="finance-label" htmlFor="admin-redeem-code">Custom code <span className="optional-label">optional</span></label><input id="admin-redeem-code" className="field-input" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} maxLength={40} placeholder="Leave blank to generate" autoComplete="off" data-testid="input-admin-redeem-code" /><span className="field-assist">Letters, numbers, and hyphens only. Blank creates a unique code.</span></div>
      <button className="primary-button redeem-create-button" type="submit" disabled={createCode.isPending} data-testid="button-create-redeem-code">{createCode.isPending ? 'Creating code…' : <>Create redeem code <ArrowRight aria-hidden="true" /></>}</button>
    </form>
    {message && <Alert kind={message.kind}>{message.text}</Alert>}
    {createdCode && <div className="created-code-result" role="status" aria-live="polite" data-testid="status-admin-code-created">
      <div><span>New code</span><strong data-testid="text-created-redeem-code">{createdCode.code}</strong><small>{dollars(createdCode.amountCents)} · Available until redeemed</small></div>
      <button className="quiet-button" type="button" onClick={() => void copyCode()} data-testid="button-copy-created-redeem-code"><Copy aria-hidden="true" /> Copy</button>
    </div>}
    <div className="redeem-code-list-heading"><div><h3>Issued codes</h3><p>Current server record and redemption status.</p></div><button type="button" className="quiet-button" onClick={() => void codesQuery.refetch()} disabled={codesQuery.isFetching} data-testid="button-refresh-redeem-codes"><RefreshCw className={codesQuery.isFetching ? 'spin' : ''} /> Refresh</button></div>
    {codesQuery.isLoading ? <LoadingBlock label="Loading issued redeem codes" /> : codesQuery.isError ? <QueryError error={codesQuery.error} retry={() => void codesQuery.refetch()} /> : !codesQuery.data?.codes.length ? <div className="finance-empty compact-empty" data-testid="empty-admin-redeem-codes"><span className="empty-mark"><Gift /></span><h3>No codes issued</h3><p>Codes you create will appear here with their live redemption status.</p></div> : <div className="redeem-code-table-wrap"><table className="deposit-table redeem-code-table"><thead><tr><th>Code</th><th>Credit</th><th>Status</th><th>Redeemed by</th><th>Created</th></tr></thead><tbody>
      {codesQuery.data.codes.map((item) => <tr key={item.id} data-testid={`row-admin-redeem-code-${item.id}`}><td><strong className="admin-code-value">{item.code}</strong></td><td>{dollars(item.amountCents)}</td><td><span className={`redeem-code-status${item.redeemedAt ? ' redeemed' : ''}`} data-testid={`status-admin-redeem-code-${item.id}`}>{item.redeemedAt ? 'Redeemed' : 'Available'}</span>{item.redeemedAt && <small>{dateTime(item.redeemedAt)}</small>}</td><td>{item.redeemedByName || item.redeemedByEmail || (item.redeemedAt ? 'Member' : '—')}</td><td>{dateTime(item.createdAt)}</td></tr>)}
    </tbody></table></div>}
  </section>;
}

function Metric({ label, value, detail, emphasis = false }: { label: string; value: string | number; detail: string; emphasis?: boolean }) {
  return <article className={`referral-metric${emphasis ? ' metric-emphasis' : ''}`}><span>{label}</span><strong data-testid={`text-referral-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>{value}</strong><small>{detail}</small></article>;
}

export function AdminDepositsPage() {
  const session = useGetAuthMe();
  const isAdmin = Boolean(session.data?.authenticated && session.data.user?.isDepositAdmin);
  const queue = useGetAdminDeposits({ query: { enabled: isAdmin, queryKey: getGetAdminDepositsQueryKey() } });
  const methods = useGetAdminDepositMethods({ query: { enabled: isAdmin, queryKey: getGetAdminDepositMethodsQueryKey() } });
  const review = useReviewDeposit();
  const saveMethods = useUpdateAdminDepositMethods();
  const client = useQueryClient();
  const [cashAppHandle, setCashAppHandle] = useState('');
  const [chimeHandle, setChimeHandle] = useState('');
  const [initialized, setInitialized] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [reviewMessage, setReviewMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [decidedIds, setDecidedIds] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (!methods.data || initialized) return;
    setCashAppHandle(methods.data.cashAppHandle ?? '');
    setChimeHandle(methods.data.chimeHandle ?? '');
    setInitialized(true);
  }, [methods.data, initialized]);
  if (session.isLoading) return <PortalFrame title="Deposit review"><LoadingBlock label="Checking administrator access" /></PortalFrame>;
  if (session.isError || !session.data?.authenticated || !session.data.user?.isDepositAdmin) {
    return <PortalFrame title="Deposit review"><div className="member-gate inline-gate"><ShieldCheck /><h1>Administrator access required</h1><p>This review area is limited to authorized deposit administrators.</p></div></PortalFrame>;
  }
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSettingsMessage(null);
    saveMethods.mutate({ data: { cashAppHandle: cashAppHandle.trim() || null, chimeHandle: chimeHandle.trim() || null } }, {
      onSuccess: () => { setSettingsMessage({ kind: 'success', text: 'Recipient settings saved.' }); void client.invalidateQueries({ queryKey: getGetDepositMethodsQueryKey() }); void client.invalidateQueries({ queryKey: getGetAdminDepositMethodsQueryKey() }); },
      onError: (error) => setSettingsMessage({ kind: 'error', text: errorText(error) }),
    });
  };
  const decide = (deposit: AdminDeposit, action: 'approve' | 'reject') => {
    if (action === 'reject' && rejecting !== deposit.id) { setRejecting(deposit.id); setReason(''); return; }
    if (action === 'reject' && !reason.trim()) { setReviewMessage({ kind: 'error', text: 'Add a reason before rejecting this request.' }); return; }
    setReviewMessage(null);
    review.mutate({ depositId: deposit.id, data: action === 'reject' ? { action, reason: reason.trim() } : { action } }, {
      onSuccess: () => {
        setReviewMessage({ kind: 'success', text: `Request #${deposit.id} ${action === 'approve' ? 'approved' : 'rejected'}.` });
        setDecidedIds((previous) => new Set(previous).add(deposit.id));
        setRejecting(null); setReason('');
        void client.invalidateQueries({ queryKey: getGetAdminDepositsQueryKey() });
        void client.invalidateQueries({ queryKey: getGetMyDepositsQueryKey() });
        void client.invalidateQueries({ queryKey: getGetMyReferralSummaryQueryKey() });
      },
      onError: (error) => setReviewMessage({ kind: 'error', text: errorText(error) }),
    });
  };
  const pendingDeposits = queue.data?.deposits.filter((deposit) => deposit.status === 'pending' && (deposit.method === 'cashapp' || deposit.method === 'chime') && !decidedIds.has(deposit.id)) ?? [];
  return <PortalFrame title="Deposit review">
    <PageHeading eyebrow="Operations / authorized" title="Deposit review" copy="Review manual Cash App and Chime requests. Each decision is recorded once by the server." />
    {reviewMessage && <Alert kind={reviewMessage.kind}>{reviewMessage.text}</Alert>}
    <section className="finance-panel admin-queue" aria-labelledby="queue-heading">
      <div className="history-heading"><div><div className="panel-overline">Manual transfers</div><h2 id="queue-heading">Pending requests</h2></div><button type="button" className="quiet-button" onClick={() => void queue.refetch()} disabled={queue.isFetching} data-testid="button-refresh-admin-deposits"><RefreshCw className={queue.isFetching ? 'spin' : ''} /> Refresh</button></div>
      {queue.isLoading ? <LoadingBlock label="Loading pending deposit requests" /> : queue.isError ? <QueryError error={queue.error} retry={() => void queue.refetch()} /> : pendingDeposits.length === 0 ? <div className="finance-empty compact-empty"><span className="empty-mark"><CheckCircle2 /></span><h3>Queue is clear</h3><p>There are no pending manual deposit requests to review.</p></div> : <div className="admin-request-list">{pendingDeposits.map((deposit) => <article className="admin-request" key={deposit.id} data-testid={`admin-deposit-${deposit.id}`}>
        <div className="admin-request-head"><div><span className="request-type">{deposit.method === 'cashapp' ? 'Cash App' : 'Chime'} · #{deposit.id}</span><h3>{deposit.memberName}</h3><a href={`mailto:${deposit.memberEmail}`}>{deposit.memberEmail}</a></div><div className="admin-request-amount">{dollars(deposit.amountCents)}<small>{dateTime(deposit.createdAt)}</small></div></div>
        <div className="admin-request-details"><div><span>Recipient</span><strong>{deposit.recipient || 'Not provided'}</strong></div><div><span>Reference code</span><strong>{deposit.referenceCode || 'Not provided'}</strong></div></div>
        {rejecting === deposit.id && <div className="reject-reason"><label htmlFor={`reject-reason-${deposit.id}`}>Reason for rejection</label><textarea id={`reject-reason-${deposit.id}`} value={reason} maxLength={250} onChange={(event) => setReason(event.target.value)} placeholder="Explain why this request cannot be approved" data-testid={`input-rejection-reason-${deposit.id}`} /><div className="reason-actions"><button type="button" className="quiet-button" onClick={() => setRejecting(null)}>Cancel</button><button type="button" className="admin-action reject-action" onClick={() => decide(deposit, 'reject')} disabled={review.isPending} data-testid={`button-confirm-reject-${deposit.id}`}>{review.isPending ? 'Saving…' : 'Confirm rejection'}</button></div></div>}
        {rejecting !== deposit.id && <div className="admin-request-actions"><button type="button" className="admin-action approve-action" onClick={() => decide(deposit, 'approve')} disabled={review.isPending} data-testid={`button-approve-deposit-${deposit.id}`}><Check /> Approve request</button><button type="button" className="admin-action reject-action" onClick={() => decide(deposit, 'reject')} disabled={review.isPending} data-testid={`button-reject-deposit-${deposit.id}`}>Reject</button></div>}
      </article>)}</div>}
    </section>
    <section className="finance-panel settings-panel" aria-labelledby="recipient-settings-title">
      <div className="panel-overline">Payment routing</div><h2 id="recipient-settings-title">Recipient settings</h2><p>These handles are shown to members when they create a manual request. Leave blank to make that method unavailable.</p>
      {methods.isLoading ? <LoadingBlock label="Loading recipient settings" /> : methods.isError ? <QueryError error={methods.error} retry={() => void methods.refetch()} /> : <form onSubmit={save} className="recipient-settings-form">
        <div><label className="finance-label" htmlFor="admin-cashapp">Cash App handle</label><input id="admin-cashapp" className="field-input" value={cashAppHandle} onChange={(event) => setCashAppHandle(event.target.value)} maxLength={100} placeholder="Leave empty to disable" data-testid="input-admin-cashapp-handle" /></div>
        <div><label className="finance-label" htmlFor="admin-chime">Chime handle</label><input id="admin-chime" className="field-input" value={chimeHandle} onChange={(event) => setChimeHandle(event.target.value)} maxLength={100} placeholder="Leave empty to disable" data-testid="input-admin-chime-handle" /></div>
        {settingsMessage && <Alert kind={settingsMessage.kind}>{settingsMessage.text}</Alert>}
        <button className="primary-button settings-save" type="submit" disabled={saveMethods.isPending || methods.isLoading} data-testid="button-save-recipient-settings">{saveMethods.isPending ? 'Saving…' : <>Save recipient settings <ArrowRight /></>}</button>
      </form>}
    </section>
    <AdminRedeemCodes />
  </PortalFrame>;
}