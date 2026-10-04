import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownLeft, ArrowUpRight, Check, CircleAlert, Clock3, LockKeyhole,
  Mail, RefreshCw, Search, Shield, ShieldCheck, ShieldOff, UserRound, Wallet,
} from 'lucide-react';
import {
  getGetAdminUsersQueryKey, useCreateAdminBalanceAdjustment, useGetAdminUsers,
  useUpdateAdminUserAccess,
} from '@workspace/api-client-react';
import type { AdminUsersResponse } from '@workspace/api-client-react';
import './AdminUsersPage.css';

type AdminMember = AdminUsersResponse['users'][number];
type Notice = { kind: 'success' | 'error'; text: string };

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}

function getErrorText(error: unknown): string {
  if (error && typeof error === 'object') {
    const candidate = error as { message?: unknown; error?: unknown; response?: { data?: { error?: unknown } } };
    if (typeof candidate.response?.data?.error === 'string') return candidate.response.data.error;
    if (typeof candidate.error === 'string') return candidate.error;
    if (typeof candidate.message === 'string') return candidate.message;
  }
  return 'The request could not be completed. Please try again.';
}

function NoticeBanner({ notice }: { notice: Notice }) {
  const Icon = notice.kind === 'success' ? Check : CircleAlert;
  return <div className={`members-notice members-notice-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'} data-testid={`status-member-${notice.kind}`}>
    <Icon aria-hidden="true" /><span>{notice.text}</span>
  </div>;
}

function MemberCard({ member, onChanged }: { member: AdminMember; onChanged: () => void }) {
  const client = useQueryClient();
  const updateAccess = useUpdateAdminUserAccess();
  const adjustBalance = useCreateAdminBalanceAdjustment();
  const [accessReason, setAccessReason] = useState('');
  const [accessConfirm, setAccessConfirm] = useState(false);
  const [action, setAction] = useState<'credit' | 'debit'>('credit');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [accessNotice, setAccessNotice] = useState<Notice | null>(null);
  const [balanceNotice, setBalanceNotice] = useState<Notice | null>(null);
  const [resultBalance, setResultBalance] = useState<number | null>(null);
  const pendingRequest = useRef<{ fingerprint: string; requestId: string } | null>(null);

  const nextAdmin = !member.isAdmin;
  const cleanAccessReason = accessReason.trim();
  const accessInvalid = !cleanAccessReason || cleanAccessReason.length > 250;

  const submitAccess = () => {
    if (member.isEnvironmentAdmin || accessInvalid || updateAccess.isPending) return;
    setAccessNotice(null);
    updateAccess.mutate({ userId: member.id, data: { isAdmin: nextAdmin, reason: cleanAccessReason } }, {
      onSuccess: () => {
        setAccessNotice({ kind: 'success', text: `Stored admin access ${nextAdmin ? 'granted' : 'revoked'} for this account.` });
        setAccessReason('');
        setAccessConfirm(false);
        void client.invalidateQueries({ queryKey: getGetAdminUsersQueryKey({ email: onChangedEmail(member.email) }) });
        onChanged();
      },
      onError: (error) => {
        setAccessConfirm(false);
        setAccessNotice({ kind: 'error', text: getErrorText(error) });
      },
    });
  };

  const submitAdjustment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const numericAmount = Number(amount);
    const amountCents = Math.round(numericAmount * 100);
    const cleanReason = reason.trim();
    if (!Number.isFinite(numericAmount) || amountCents < 1 || amountCents > 2_147_483_647 || !cleanReason || cleanReason.length > 250) {
      setBalanceNotice({ kind: 'error', text: 'Enter a valid amount and a reason (up to 250 characters).' });
      return;
    }
    const fingerprint = `${action}:${amountCents}:${cleanReason}`;
    if (!pendingRequest.current || pendingRequest.current.fingerprint !== fingerprint) {
      pendingRequest.current = { fingerprint, requestId: crypto.randomUUID() };
    }
    setBalanceNotice(null);
    adjustBalance.mutate({
      userId: member.id,
      data: { action, amountCents, reason: cleanReason, requestId: pendingRequest.current.requestId },
    }, {
      onSuccess: (response) => {
        const adjustment = response.adjustment;
        setResultBalance(adjustment.balanceCents);
        setBalanceNotice({
          kind: 'success',
          text: `${action === 'credit' ? 'Credit' : 'Debit'} recorded: ${formatMoney(adjustment.amountCents)}${adjustment.replayed ? ' · previously processed request' : ''}.`,
        });
        setAmount('');
        setReason('');
        pendingRequest.current = null;
        void client.invalidateQueries({ queryKey: getGetAdminUsersQueryKey({ email: onChangedEmail(member.email) }) });
        onChanged();
      },
      onError: (error) => setBalanceNotice({ kind: 'error', text: getErrorText(error) }),
    });
  };

  return <article className="member-record" data-testid={`card-admin-member-${member.id}`}>
    <header className="member-record-head">
      <div className="member-identity">
        <span className="member-avatar" aria-hidden="true">{member.fullName.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || <UserRound />}</span>
        <div className="member-name-wrap">
          <h3 data-testid={`text-member-name-${member.id}`}>{member.fullName}</h3>
          <span className="member-email"><Mail aria-hidden="true" /><span data-testid={`text-member-email-${member.id}`}>{member.email}</span></span>
          <small>{member.username ? `@${member.username}` : 'No username'} · Member since {formatDate(member.createdAt)}</small>
        </div>
      </div>
      <div className="member-balance" data-testid={`text-member-balance-${member.id}`}>
        <span>Current balance</span>
        <strong>{formatMoney(resultBalance ?? member.balanceCents)}</strong>
        <small>USD · account ledger</small>
      </div>
    </header>

    <div className="member-access-strip">
      <div className="member-access-status">
        {member.isAdmin ? <ShieldCheck aria-hidden="true" /> : <ShieldOff aria-hidden="true" />}
        <span><strong>{member.isAdmin ? 'Admin access enabled' : 'Standard member'}</strong><small>{member.isEnvironmentAdmin ? 'Environment-managed access' : 'Stored access permission'}</small></span>
        <span className={`member-access-pill${member.isAdmin ? ' is-admin' : ''}`} data-testid={`status-member-access-${member.id}`}>{member.isAdmin ? 'Admin' : 'Member'}</span>
      </div>
      {member.isEnvironmentAdmin
        ? <div className="member-locked-note" data-testid={`status-member-environment-admin-${member.id}`}><LockKeyhole aria-hidden="true" /> Environment admin · managed outside this page</div>
        : <div className="member-access-action">
          {!accessConfirm ? <button type="button" className={member.isAdmin ? 'member-button member-button-caution' : 'member-button member-button-gold'} onClick={() => { setAccessConfirm(true); setAccessNotice(null); }} data-testid={`button-toggle-admin-${member.id}`}>
            <Shield aria-hidden="true" /> {member.isAdmin ? 'Revoke stored access' : 'Grant stored access'}
          </button> : <div className="member-access-confirm">
            <label htmlFor={`member-access-reason-${member.id}`}>Reason <span>Required</span></label>
            <input id={`member-access-reason-${member.id}`} value={accessReason} onChange={(event) => setAccessReason(event.target.value)} maxLength={250} placeholder="Record why this change is needed" data-testid={`input-access-reason-${member.id}`} />
            <div className="member-inline-actions">
              <button type="button" className="member-button member-button-muted" onClick={() => { setAccessConfirm(false); setAccessReason(''); }} disabled={updateAccess.isPending} data-testid={`button-cancel-access-${member.id}`}>Cancel</button>
              <button type="button" className={member.isAdmin ? 'member-button member-button-caution' : 'member-button member-button-gold'} onClick={submitAccess} disabled={accessInvalid || updateAccess.isPending} data-testid={`button-confirm-access-${member.id}`}>
                {updateAccess.isPending ? 'Saving…' : `${nextAdmin ? 'Grant' : 'Revoke'} access`}
              </button>
            </div>
          </div>}
        </div>}
    </div>
    {accessNotice && <NoticeBanner notice={accessNotice} />}

    <form className="member-adjust-form" onSubmit={submitAdjustment} noValidate>
      <div className="member-adjust-title">
        <span className="member-adjust-icon"><Wallet aria-hidden="true" /></span>
        <div><strong>Balance adjustment</strong><small>Every change is recorded with its reason.</small></div>
      </div>
      <div className="member-adjust-fields">
        <div className="member-field member-action-field">
          <label htmlFor={`member-action-${member.id}`}>Action</label>
          <select id={`member-action-${member.id}`} value={action} onChange={(event) => setAction(event.target.value as 'credit' | 'debit')} data-testid={`select-adjustment-action-${member.id}`}>
            <option value="credit">Credit · add funds</option><option value="debit">Debit · remove funds</option>
          </select>
        </div>
        <div className="member-field member-amount-field">
          <label htmlFor={`member-amount-${member.id}`}>Amount <span>USD</span></label>
          <div className="member-money-input"><span aria-hidden="true">$</span><input id={`member-amount-${member.id}`} type="number" min="0.01" step="0.01" inputMode="decimal" placeholder="0.00" value={amount} onChange={(event) => setAmount(event.target.value)} data-testid={`input-adjustment-amount-${member.id}`} /></div>
        </div>
        <div className="member-field member-reason-field">
          <label htmlFor={`member-adjust-reason-${member.id}`}>Reason <span>Required</span></label>
          <input id={`member-adjust-reason-${member.id}`} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={250} placeholder="Describe the account correction" data-testid={`input-adjustment-reason-${member.id}`} />
        </div>
        <button type="submit" className={`member-button member-adjust-submit${action === 'debit' ? ' is-debit' : ''}`} disabled={adjustBalance.isPending || !amount || !reason.trim()} data-testid={`button-submit-adjustment-${member.id}`}>
          {adjustBalance.isPending ? 'Submitting…' : <>{action === 'credit' ? <ArrowDownLeft aria-hidden="true" /> : <ArrowUpRight aria-hidden="true" />}{action === 'credit' ? 'Apply credit' : 'Apply debit'}</>}
        </button>
      </div>
      {balanceNotice && <NoticeBanner notice={balanceNotice} />}
      <div className="member-ledger-hint"><Clock3 aria-hidden="true" /><span>Request ID is generated for each submission to prevent duplicate processing.</span></div>
    </form>
  </article>;
}

function onChangedEmail(email: string): string {
  return email.trim().toLowerCase();
}

function MemberSkeleton() {
  return <div className="members-skeleton" aria-busy="true" aria-label="Loading member records" data-testid="loading-admin-members">
    {[0, 1].map((item) => <div className="members-skeleton-card" key={item}><i /><span /><span /><span /></div>)}
  </div>;
}

export function AdminUsersPage() {
  const [emailInput, setEmailInput] = useState('');
  const [searchedEmail, setSearchedEmail] = useState('');
  const [searchError, setSearchError] = useState('');
  const params = { email: searchedEmail };
  const usersQuery = useGetAdminUsers(params, {
    query: { queryKey: getGetAdminUsersQueryKey(params), enabled: Boolean(searchedEmail), staleTime: 0 },
  });

  useEffect(() => { document.title = 'Member accounts | ReplenishCC Admin'; }, []);

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanEmail = emailInput.trim().toLowerCase();
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setSearchError('Enter a valid member email address to search.');
      return;
    }
    setSearchError('');
    setSearchedEmail(cleanEmail);
    if (cleanEmail === searchedEmail) void usersQuery.refetch();
  };

  const users = usersQuery.data?.users ?? [];
  return <div className="workspace-page admin-users-page">
    <header className="admin-users-heading">
      <div>
        <div className="admin-users-eyebrow"><ShieldCheck aria-hidden="true" /> Account operations <span>·</span> restricted access</div>
        <h1>Member accounts</h1>
        <p>Find an account, review its current standing, and record deliberate changes to access or balance.</p>
      </div>
      <div className="admin-users-safety"><span className="admin-users-safety-mark"><LockKeyhole aria-hidden="true" /></span><span><strong>Controlled actions</strong><small>Every change requires a reason</small></span></div>
    </header>

    <section className="members-search-panel" aria-labelledby="member-search-title">
      <div className="members-search-copy">
        <span className="members-search-index">01</span>
        <div><div className="section-kicker">Member lookup</div><h2 id="member-search-title">Search by email</h2><p>Use the member’s exact email address to open their account record.</p></div>
      </div>
      <form className="members-search-form" onSubmit={submitSearch} noValidate>
        <label htmlFor="admin-member-email">Member email</label>
        <div className="members-search-control">
          <Mail aria-hidden="true" />
          <input id="admin-member-email" type="email" autoComplete="off" placeholder="member@example.com" value={emailInput} onChange={(event) => { setEmailInput(event.target.value); setSearchError(''); }} data-testid="input-admin-member-email" />
          <button type="submit" disabled={!emailInput.trim() || usersQuery.isFetching} data-testid="button-search-admin-member">
            <Search aria-hidden="true" /> {usersQuery.isFetching ? 'Searching…' : 'Find member'}
          </button>
        </div>
        {searchError && <small className="members-search-error" role="alert" data-testid="error-admin-member-search">{searchError}</small>}
      </form>
      <div className="members-search-foot"><span><LockKeyhole aria-hidden="true" /> Search is limited to member email.</span><span>Exact match</span></div>
    </section>

    {!searchedEmail ? <section className="members-empty members-empty-welcome" data-testid="empty-admin-members">
      <span className="members-empty-icon"><Search aria-hidden="true" /></span><div className="section-kicker">Ready for lookup</div><h2>Start with a member email</h2><p>Account details and authorized actions will appear here after a successful search.</p>
    </section> : usersQuery.isLoading ? <MemberSkeleton /> : usersQuery.isError ? <div className="members-query-error" role="alert" data-testid="error-admin-members">
      <CircleAlert aria-hidden="true" /><div><strong>Member records unavailable</strong><span>{getErrorText(usersQuery.error)}</span></div>
      <button type="button" onClick={() => void usersQuery.refetch()} disabled={usersQuery.isFetching} data-testid="button-retry-admin-members"><RefreshCw aria-hidden="true" /> Retry</button>
    </div> : users.length === 0 ? <section className="members-empty" data-testid="empty-admin-members-results">
      <span className="members-empty-icon"><UserRound aria-hidden="true" /></span><div className="section-kicker">No record found</div><h2>No member matches that email</h2><p>Check the address and search again. No account changes have been made.</p>
      <button type="button" className="member-button member-button-muted" onClick={() => { setEmailInput(''); setSearchedEmail(''); }} data-testid="button-clear-member-search">Clear search</button>
    </section> : <section className="members-results" aria-label="Member account results" data-testid="list-admin-members">
      <div className="members-results-head">
        <div><div className="section-kicker">Account record{users.length > 1 ? 's' : ''}</div><h2>{users.length} {users.length === 1 ? 'member' : 'members'} found</h2></div>
        <button type="button" className="members-refresh-button" onClick={() => void usersQuery.refetch()} disabled={usersQuery.isFetching} data-testid="button-refresh-admin-members"><RefreshCw aria-hidden="true" /> Refresh</button>
      </div>
      {users.map((member) => <MemberCard key={member.id} member={member} onChanged={() => void usersQuery.refetch()} />)}
      <div className="members-results-foot"><LockKeyhole aria-hidden="true" /><span>Environment-managed administrator access is read-only here. Balance changes are recorded in the account ledger.</span></div>
    </section>}
  </div>;
}
