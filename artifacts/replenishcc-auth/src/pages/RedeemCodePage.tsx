import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, Gift, ShieldCheck } from 'lucide-react';
import { getGetMyDepositsQueryKey, useGetAuthMe, useRedeemCode, type MyDepositsResponse, type RedeemCodeResult } from '@workspace/api-client-react';
import { Link } from 'wouter';
import { MemberShell } from '../components/MemberShell';

function dollars(cents: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

function errorText(error: unknown) {
  if (error && typeof error === 'object') {
    const candidate = error as { message?: unknown; error?: unknown; response?: { data?: { error?: unknown } } };
    if (typeof candidate.response?.data?.error === 'string') return candidate.response.data.error;
    if (typeof candidate.error === 'string') return candidate.error;
    if (typeof candidate.message === 'string') return candidate.message;
  }
  return 'We could not complete the redemption. Check the code and try again.';
}

export function RedeemCodePage() {
  const session = useGetAuthMe();
  const redeem = useRedeemCode();
  const client = useQueryClient();
  const [code, setCode] = useState('');
  const [result, setResult] = useState<RedeemCodeResult | null>(null);
  const [error, setError] = useState('');

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setResult(null);
    const normalized = code.trim().toUpperCase();
    if (!/^[A-Z0-9-]{1,40}$/.test(normalized)) {
      setError('Enter a code using letters, numbers, or hyphens (up to 40 characters).');
      return;
    }
    redeem.mutate({ data: { code: normalized } }, {
      onSuccess: (response) => {
        setResult(response);
        setCode('');
        client.setQueryData<MyDepositsResponse>(getGetMyDepositsQueryKey(), (old) =>
          old ? { ...old, balanceCents: response.balanceCents } : old);
        void client.invalidateQueries({ queryKey: getGetMyDepositsQueryKey() });
      },
      onError: (reason) => setError(`${errorText(reason)} No credit was added.`),
    });
  };

  if (session.isLoading) return <MemberShell pageTitle="Redeem Code" user={null} loading />;
  if (session.isError || !session.data?.authenticated || !session.data.user) {
    return <div className="app-frame"><div className="member-gate"><ShieldCheck /><h1>Sign in required</h1><p>Your account session is needed to redeem a code.</p><Link href="/login" className="primary-button">Return to sign in</Link></div></div>;
  }
  return <MemberShell pageTitle="Redeem Code" user={session.data.user} contentClassName="finance-content">
    <div className="finance-heading">
      <div><div className="welcome-eyebrow">Account credit</div><h1>Redeem Code</h1><p>Apply a one-time code directly to your available account balance.</p></div>
    </div>
    <div className="redeem-layout">
      <section className="finance-panel redeem-panel" aria-labelledby="redeem-title">
        <div className="redeem-emblem"><Gift aria-hidden="true" /></div>
        <div className="panel-overline">Single-use credit</div>
        <h2 id="redeem-title">Enter your code</h2>
        <p className="redeem-intro">A valid code credits its fixed amount to your balance immediately. Each code can be redeemed once globally.</p>
        <form onSubmit={submit} noValidate>
          <label className="finance-label" htmlFor="redeem-code">Redeem code</label>
          <input id="redeem-code" className="redeem-code-input" type="text" value={code} onChange={(event) => { setCode(event.target.value.toUpperCase()); setError(''); setResult(null); }} placeholder="Enter your code" autoComplete="off" maxLength={40} required aria-describedby="redeem-code-hint" data-testid="input-redeem-code" />
          <div className="field-assist" id="redeem-code-hint">Codes are not case-sensitive. Letters, numbers, and hyphens are accepted.</div>
          {error && <div className="portal-alert redeem-error" role="alert" data-testid="status-redeem-error">{error}</div>}
          {result && <div className="redeem-result" role="status" aria-live="polite" data-testid="status-redeem-success">
            <div className="redeem-result-icon"><CheckCircle2 aria-hidden="true" /></div>
            <div><div className="panel-overline">Credit applied</div><strong className="redeem-credited" data-testid="text-redeem-credit">+{dollars(result.amountCents)}</strong><span className="redeem-result-code">Code {result.code} was redeemed successfully.</span></div>
            <div className="redeem-new-balance"><span>New available balance</span><strong data-testid="text-redeem-new-balance">{dollars(result.balanceCents)}</strong></div>
          </div>}
          <button type="submit" className="primary-button finance-submit" disabled={redeem.isPending || !code.trim()} data-testid="button-redeem-code">
            {redeem.isPending ? 'Verifying code…' : <>Redeem code <ArrowRight aria-hidden="true" /></>}
          </button>
        </form>
      </section>
    </div>
  </MemberShell>;
}