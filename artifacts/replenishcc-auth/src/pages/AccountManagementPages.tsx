import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import {
  AlertTriangle, CheckCircle2, Clock3, LockKeyhole, Mail, RefreshCw, ShieldCheck, Trash2, X, XCircle,
} from 'lucide-react';
import {
  getGetAdminAccountDeletionRequestsQueryKey,
  getGetMyAccountDeletionRequestQueryKey,
  useCancelMyAccountDeletionRequest,
  useChangeAuthPassword,
  useCreateAccountDeletionRequest,
  useGetAdminAccountDeletionRequests,
  useGetMyAccountDeletionRequest,
  useGetAuthMe,
  useReviewAccountDeletionRequest,
  type AdminAccountDeletionRequest,
} from '@workspace/api-client-react';
import { Link } from 'wouter';
import { MemberShell } from '../components/MemberShell';
import { Form } from '../components/ui/form';
import { TelegramRewardCard } from './TelegramRewardCard';

type PasswordFormValues = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

type DeletionFormValues = {
  reason: string;
};

function errorText(error: unknown): string {
  if (error && typeof error === 'object') {
    const candidate = error as { error?: unknown; message?: unknown; response?: { data?: { error?: unknown } } };
    if (typeof candidate.response?.data?.error === 'string') return candidate.response.data.error;
    if (typeof candidate.error === 'string') return candidate.error;
    if (typeof candidate.message === 'string') return candidate.message;
  }
  return 'We could not complete that request. Please try again.';
}

function dateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function PrivateGate({ title }: { title: string }) {
  return <div className="app-frame"><div className="member-gate"><ShieldCheck /><h1>Sign in required</h1><p>Your ReplenishCC session is needed to open {title.toLowerCase()}.</p><Link href="/login" className="primary-button">Return to sign in</Link></div></div>;
}

export function AccountManagementPage() {
  const session = useGetAuthMe();
  const client = useQueryClient();
  const requestQuery = useGetMyAccountDeletionRequest({
    query: {
      queryKey: getGetMyAccountDeletionRequestQueryKey(),
      enabled: Boolean(session.data?.authenticated && session.data.user),
    },
  });
  const changePassword = useChangeAuthPassword();
  const createRequest = useCreateAccountDeletionRequest();
  const cancelRequest = useCancelMyAccountDeletionRequest();
  const passwordForm = useForm<PasswordFormValues>({
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });
  const deletionForm = useForm<DeletionFormValues>({
    defaultValues: { reason: '' },
  });
  const reason = deletionForm.watch('reason');
  const [passwordMessage, setPasswordMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [deletionMessage, setDeletionMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [passwordVisible, setPasswordVisible] = useState(false);
  useEffect(() => { document.title = 'Account management | ReplenishCC'; }, []);

  const submitPassword = (values: PasswordFormValues) => {
    setPasswordMessage(null);
    changePassword.mutate({ data: values }, {
      onSuccess: (response) => {
        passwordForm.reset();
        setPasswordMessage({ kind: 'success', text: response.message });
      },
      onError: (error) => setPasswordMessage({ kind: 'error', text: errorText(error) }),
    });
  };
  const submitDeletion = (values: DeletionFormValues) => {
    setDeletionMessage(null);
    createRequest.mutate({ data: values.reason.trim() ? { reason: values.reason.trim() } : {} }, {
      onSuccess: () => {
        deletionForm.reset();
        setDeletionMessage({ kind: 'success', text: 'Your deletion request has been submitted for review.' });
        void client.invalidateQueries({ queryKey: getGetMyAccountDeletionRequestQueryKey() });
      },
      onError: (error) => setDeletionMessage({ kind: 'error', text: errorText(error) }),
    });
  };
  const cancelDeletion = () => {
    setDeletionMessage(null);
    cancelRequest.mutate(undefined, {
      onSuccess: () => {
        setDeletionMessage({ kind: 'success', text: 'Your pending deletion request has been cancelled.' });
        void client.invalidateQueries({ queryKey: getGetMyAccountDeletionRequestQueryKey() });
      },
      onError: (error) => setDeletionMessage({ kind: 'error', text: errorText(error) }),
    });
  };

  if (session.isLoading) return <MemberShell pageTitle="Account management" user={null} loading />;
  if (session.isError || !session.data?.authenticated || !session.data.user) return <PrivateGate title="Account management" />;
  const request = requestQuery.data?.request ?? null;
  return <MemberShell pageTitle="Account management" user={session.data.user} contentClassName="finance-content account-management-content">
    <div className="finance-heading">
      <div><div className="welcome-eyebrow">Your access &amp; privacy</div><h1>Account management</h1><p>Manage how you enter ReplenishCC and what happens to your account data.</p></div>
      <div className="account-secure-mark"><ShieldCheck /><span>Private member area</span></div>
    </div>
    <div className="account-settings-grid">
      <section className="finance-panel account-panel" aria-labelledby="password-title">
        <div className="panel-overline">Sign-in credentials</div><h2 id="password-title">Change password</h2>
        <p className="account-panel-copy">Choose a new password that you do not use elsewhere. Use at least 10 characters.</p>
        {passwordMessage && <div className={`portal-alert portal-alert-${passwordMessage.kind}`} role={passwordMessage.kind === 'error' ? 'alert' : 'status'} data-testid={`status-password-${passwordMessage.kind}`}>{passwordMessage.text}</div>}
        <Form {...passwordForm}>
          <form onSubmit={passwordForm.handleSubmit(submitPassword)} className="account-form" noValidate>
            <label className="finance-label" htmlFor="account-current-password">Current password</label>
            <input id="account-current-password" className="account-field" type={passwordVisible ? 'text' : 'password'} autoComplete="current-password" maxLength={128} {...passwordForm.register('currentPassword', { required: 'Enter your current password.', maxLength: { value: 128, message: 'Use no more than 128 characters.' } })} data-testid="input-current-password" />
            {passwordForm.formState.errors.currentPassword && <p className="account-field-error" role="alert">{passwordForm.formState.errors.currentPassword.message}</p>}
            <label className="finance-label" htmlFor="account-new-password">New password</label>
            <input id="account-new-password" className="account-field" type={passwordVisible ? 'text' : 'password'} autoComplete="new-password" minLength={10} maxLength={128} {...passwordForm.register('newPassword', { required: 'Enter a new password.', minLength: { value: 10, message: 'Use at least 10 characters.' }, maxLength: { value: 128, message: 'Use no more than 128 characters.' }, validate: (value) => value !== passwordForm.getValues('currentPassword') || 'Choose a password different from your current password.' })} data-testid="input-new-password" />
            {passwordForm.formState.errors.newPassword && <p className="account-field-error" role="alert">{passwordForm.formState.errors.newPassword.message}</p>}
            <label className="finance-label" htmlFor="account-confirm-password">Confirm new password</label>
            <input id="account-confirm-password" className="account-field" type={passwordVisible ? 'text' : 'password'} autoComplete="new-password" minLength={10} maxLength={128} {...passwordForm.register('confirmPassword', { required: 'Confirm your new password.', minLength: { value: 10, message: 'Use at least 10 characters.' }, maxLength: { value: 128, message: 'Use no more than 128 characters.' }, validate: (value) => value === passwordForm.getValues('newPassword') || 'The new passwords do not match.' })} data-testid="input-confirm-password" />
            {passwordForm.formState.errors.confirmPassword && <p className="account-field-error" role="alert">{passwordForm.formState.errors.confirmPassword.message}</p>}
            <label className="account-reveal-password"><input type="checkbox" checked={passwordVisible} onChange={(event) => setPasswordVisible(event.target.checked)} data-testid="input-show-account-password" /> Show passwords</label>
            <button type="submit" className="primary-button account-submit" disabled={changePassword.isPending} data-testid="button-change-password">{changePassword.isPending ? 'Updating password…' : 'Update password'}</button>
          </form>
        </Form>
      </section>
      <section className="finance-panel account-panel mfa-panel" aria-labelledby="two-factor-title">
        <div className="panel-overline">Additional sign-in protection</div><h2 id="two-factor-title">Two-factor authentication</h2>
        <div className="mfa-status"><Mail /><div><strong>Email verification unavailable</strong><span>Not configured for ReplenishCC</span></div><span className="mfa-badge">Unavailable</span></div>
        <p className="account-panel-copy">Email delivery is not configured, so verification codes cannot currently be sent. Email two-factor authentication is unavailable and cannot be enabled here.</p>
        <div className="mfa-note"><ShieldCheck /> Your account remains protected by your password and signed-in session.</div>
      </section>
    </div>
    <TelegramRewardCard />
    <section className="finance-panel deletion-panel" aria-labelledby="deletion-title">
      <div className="deletion-heading"><div><div className="panel-overline">Data &amp; privacy</div><h2 id="deletion-title">Permanent account deletion</h2><p>Request a review if you want your ReplenishCC account erased.</p></div><span className="deletion-heading-icon"><Trash2 /></span></div>
      <div className="deletion-consequence"><AlertTriangle /><p><strong>What permanent deletion means</strong><br />If approved, your user account and all linked records—including deposits, balances and ledger entries, sessions, and request history—will be permanently deleted. This cannot be undone.</p></div>
      {requestQuery.isLoading ? <div className="account-request-loading" aria-busy="true" aria-label="Loading deletion request"><span /><span /></div>
        : requestQuery.isError ? <div className="portal-alert" role="alert"><span>{errorText(requestQuery.error)}</span><button type="button" className="inline-retry" onClick={() => void requestQuery.refetch()} data-testid="button-retry-deletion-request"><RefreshCw /> Retry</button></div>
        : request ? <div className={`request-state request-state-${request.status}`} data-testid="status-deletion-request">
          <span className="request-state-icon">{request.status === 'pending' ? <Clock3 /> : <XCircle />}</span>
          <div className="request-state-copy"><strong>{request.status === 'pending' ? 'Request pending review' : 'Previous request was rejected'}</strong><span>Submitted {dateTime(request.requestedAt)}</span>
            {request.reason && <p className="request-reason"><b>Your reason</b>{request.reason}</p>}
            {request.status === 'rejected' && request.reviewNote && <p className="request-reason"><b>Review note</b>{request.reviewNote}</p>}
            {request.status === 'rejected' && request.reviewedAt && <span>Reviewed {dateTime(request.reviewedAt)}</span>}
          </div>
          {request.status === 'pending' && <button type="button" className="quiet-button deletion-cancel" onClick={cancelDeletion} disabled={cancelRequest.isPending} data-testid="button-cancel-deletion">{cancelRequest.isPending ? 'Cancelling…' : 'Cancel request'}</button>}
          {request.status === 'rejected' && <span className="rejected-next-step">You may submit a new request below.</span>}
        </div> : <Form {...deletionForm}><form className="deletion-request-form" onSubmit={deletionForm.handleSubmit(submitDeletion)}>
          <label className="finance-label" htmlFor="deletion-reason">Reason for your request <span>(optional)</span></label>
          <textarea id="deletion-reason" className="account-field account-textarea" {...deletionForm.register('reason', { maxLength: { value: 500, message: 'Use no more than 500 characters.' } })} placeholder="Share any context that may help us review your request." data-testid="input-deletion-reason" />
          {deletionForm.formState.errors.reason && <p className="account-field-error" role="alert">{deletionForm.formState.errors.reason.message}</p>}
          <div className="deletion-form-foot"><span>{reason.length}/500 characters · A request is reviewed before deletion.</span><button type="submit" className="danger-button" disabled={createRequest.isPending} data-testid="button-request-deletion"><Trash2 />{createRequest.isPending ? 'Submitting…' : 'Request permanent deletion'}</button></div>
        </form></Form>}
      {request?.status === 'rejected' && <Form {...deletionForm}><form className="deletion-request-form rejected-request-form" onSubmit={deletionForm.handleSubmit(submitDeletion)}>
          <label className="finance-label" htmlFor="deletion-reason-retry">Reason for your new request <span>(optional)</span></label>
          <textarea id="deletion-reason-retry" className="account-field account-textarea" {...deletionForm.register('reason', { maxLength: { value: 500, message: 'Use no more than 500 characters.' } })} placeholder="Share any context that may help us review your request." data-testid="input-deletion-reason" />
          {deletionForm.formState.errors.reason && <p className="account-field-error" role="alert">{deletionForm.formState.errors.reason.message}</p>}
          <div className="deletion-form-foot"><span>{reason.length}/500 characters · A request is reviewed before deletion.</span><button type="submit" className="danger-button" disabled={createRequest.isPending} data-testid="button-request-deletion"><Trash2 />{createRequest.isPending ? 'Submitting…' : 'Request permanent deletion'}</button></div>
        </form></Form>}
      {deletionMessage && <div className={`portal-alert portal-alert-${deletionMessage.kind}`} role={deletionMessage.kind === 'error' ? 'alert' : 'status'} data-testid={`status-deletion-${deletionMessage.kind}`}>{deletionMessage.text}</div>}
    </section>
  </MemberShell>;
}

export function AdminAccountDeletionRequestsPage() {
  const session = useGetAuthMe();
  const client = useQueryClient();
  const queue = useGetAdminAccountDeletionRequests({
    query: {
      queryKey: getGetAdminAccountDeletionRequestsQueryKey(),
      enabled: Boolean(session.data?.authenticated && session.data.user?.isDepositAdmin),
      refetchOnWindowFocus: true,
    },
  });
  const review = useReviewAccountDeletionRequest();
  const [approvalTarget, setApprovalTarget] = useState<AdminAccountDeletionRequest | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [noteById, setNoteById] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const confirmDialogRef = useRef<HTMLElement>(null);
  const approveTriggerRef = useRef<HTMLElement | null>(null);
  const reviewPendingRef = useRef(review.isPending);
  reviewPendingRef.current = review.isPending;
  useEffect(() => { document.title = 'Account deletion requests | ReplenishCC'; }, []);
  useEffect(() => {
    if (!approvalTarget) return;
    const focusable = () => Array.from(confirmDialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? []);
    focusable().find((element) => element instanceof HTMLInputElement)?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !reviewPendingRef.current) {
        event.preventDefault();
        setApprovalTarget(null);
        setAcknowledged(false);
      }
      if (event.key !== 'Tab') return;
      const elements = focusable();
      if (!elements.length) return;
      const first = elements[0]!;
      const last = elements[elements.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      approveTriggerRef.current?.focus();
    };
  }, [approvalTarget]);
  if (session.isLoading) return <MemberShell pageTitle="Deletion review" user={null} loading />;
  if (session.isError || !session.data?.authenticated || !session.data.user) return <PrivateGate title="Deletion review" />;
  if (!session.data.user.isDepositAdmin) return <MemberShell pageTitle="Deletion review" user={session.data.user} contentClassName="finance-content"><div className="member-gate"><ShieldCheck /><h1>Admin access required</h1><p>This review queue is available to authorized ReplenishCC administrators.</p></div></MemberShell>;

  const submitReview = (item: AdminAccountDeletionRequest, action: 'approve' | 'reject') => {
    setError(''); setSuccess('');
    const note = noteById[item.id]?.trim();
    review.mutate({ requestId: item.id, data: { action, ...(note ? { note } : {}) } }, {
      onSuccess: (result) => {
        setApprovalTarget(null); setAcknowledged(false);
        setSuccess(result.status === 'approved'
          ? `Account deletion approved for ${result.memberName} (${result.memberEmail}). The account and linked records were permanently deleted.`
          : `Deletion request for ${result.memberName} was rejected.`);
        setNoteById((current) => { const next = { ...current }; delete next[item.id]; return next; });
        void client.invalidateQueries({ queryKey: getGetAdminAccountDeletionRequestsQueryKey() });
      },
      onError: (reason) => setError(errorText(reason)),
    });
  };
  const requests = queue.data?.requests ?? [];
  return <MemberShell pageTitle="Deletion review" user={session.data.user} contentClassName="finance-content admin-deletion-content">
    <div className="finance-heading"><div><div className="welcome-eyebrow">Administrator workspace</div><h1>Account deletion requests</h1><p>Review each request carefully. Approval permanently erases the member account and every linked record.</p></div><div className="admin-queue-count"><span>Pending</span><strong data-testid="text-deletion-queue-count">{queue.isLoading ? '—' : requests.length}</strong></div></div>
    <div className="admin-consequence-note"><AlertTriangle /><div><strong>Permanent action — verify before approving</strong><p>Approval deletes the user and all linked deposits, balances and ledger records, sessions, and request history. This action is irreversible. Rejection does not delete account data.</p></div></div>
    {error && <div className="portal-alert" role="alert" data-testid="status-admin-deletion-error">{error}</div>}
    {success && <div className="portal-alert portal-alert-success" role="status" data-testid="status-admin-deletion-success"><CheckCircle2 />{success}</div>}
    <section className="finance-panel admin-deletion-list" aria-label="Pending deletion requests" aria-busy={queue.isLoading}>
      <div className="admin-queue-heading"><div><div className="panel-overline">Review queue</div><h2>Awaiting a decision</h2></div><button type="button" className="quiet-button" onClick={() => void queue.refetch()} disabled={queue.isFetching} data-testid="button-refresh-deletion-queue"><RefreshCw className={queue.isFetching ? 'spin' : ''} /> Refresh</button></div>
      {queue.isLoading ? <div className="account-request-loading" aria-label="Loading deletion queue"><span /><span /><span /></div>
        : queue.isError ? <div className="portal-alert" role="alert"><span>{errorText(queue.error)}</span><button type="button" className="inline-retry" onClick={() => void queue.refetch()} data-testid="button-retry-deletion-queue"><RefreshCw /> Retry</button></div>
        : requests.length === 0 ? <div className="finance-empty admin-queue-empty" data-testid="empty-deletion-queue"><span className="empty-mark"><CheckCircle2 /></span><h3>The queue is clear</h3><p>There are no pending member deletion requests to review.</p></div>
        : <div className="admin-request-stack">{requests.map((item) => <article className="admin-request-card" key={item.id} data-testid={`row-deletion-request-${item.id}`}>
          <div className="admin-request-top"><div className="admin-member-avatar">{item.memberName.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'M'}</div><div className="admin-member-details"><strong data-testid={`text-deletion-member-${item.id}`}>{item.memberName}</strong><span data-testid={`text-deletion-email-${item.id}`}>{item.memberEmail}</span></div><div className="admin-request-id">Request <strong>#{item.id}</strong></div></div>
          <div className="admin-request-meta"><span><Clock3 /> Submitted {dateTime(item.requestedAt)}</span><span className="pending-pill">Pending review</span></div>
          <div className="admin-reason"><span>Member reason</span><p>{item.reason || 'No reason provided.'}</p></div>
          <label className="finance-label" htmlFor={`review-note-${item.id}`}>Review note <span>(optional, up to 250 characters)</span></label>
          <textarea id={`review-note-${item.id}`} className="account-field account-textarea admin-review-note" value={noteById[item.id] ?? ''} onChange={(event) => setNoteById((current) => ({ ...current, [item.id]: event.target.value.slice(0, 250) }))} maxLength={250} placeholder="Add context for the member or review record." data-testid={`input-review-note-${item.id}`} />
          <div className="admin-request-actions"><button type="button" className="quiet-button reject-button" onClick={() => submitReview(item, 'reject')} disabled={review.isPending} data-testid={`button-reject-deletion-${item.id}`}><XCircle /> Reject request</button><button type="button" className="danger-button" onClick={(event) => { approveTriggerRef.current = event.currentTarget; setApprovalTarget(item); setAcknowledged(false); }} disabled={review.isPending} data-testid={`button-approve-deletion-${item.id}`}><Trash2 /> Approve permanent deletion</button></div>
        </article>)}</div>}
    </section>
    {approvalTarget && <div className="deletion-dialog-backdrop" data-testid="backdrop-confirm-account-deletion" onMouseDown={(event) => { if (event.target === event.currentTarget && !review.isPending) { setApprovalTarget(null); setAcknowledged(false); } }}>
      <section ref={confirmDialogRef} className="deletion-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="approve-dialog-title" aria-describedby="approve-dialog-description" data-testid="dialog-confirm-account-deletion">
        <div className="confirm-dialog-mark"><AlertTriangle /></div><button type="button" className="confirm-dialog-close" onClick={() => { setApprovalTarget(null); setAcknowledged(false); }} aria-label="Close confirmation" disabled={review.isPending} data-testid="button-close-deletion-confirmation"><X /></button>
        <div className="panel-overline">Irreversible action</div><h2 id="approve-dialog-title">Permanently delete this account?</h2>
        <p id="approve-dialog-description">Approving <strong>{approvalTarget.memberName}</strong> ({approvalTarget.memberEmail}) immediately deletes their user account and all linked deposits, balances and ledger records, sessions, and request history. The member will lose account access. This cannot be undone.</p>
        <label className="confirm-acknowledgment"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} data-testid="checkbox-confirm-account-deletion" /><span>I understand this permanently deletes the account and all linked records.</span></label>
        <div className="confirm-dialog-actions"><button type="button" className="quiet-button" onClick={() => { setApprovalTarget(null); setAcknowledged(false); }} disabled={review.isPending} data-testid="button-cancel-deletion-confirmation">Go back</button><button type="button" className="danger-button" onClick={() => submitReview(approvalTarget, 'approve')} disabled={!acknowledged || review.isPending} data-testid="button-confirm-permanent-deletion"><Trash2 />{review.isPending ? 'Deleting account…' : 'Confirm permanent deletion'}</button></div>
      </section>
    </div>}
  </MemberShell>;
}