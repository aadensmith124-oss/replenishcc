import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  Eye,
  EyeOff,
  LoaderCircle,
  LogOut,
  Moon,
  Menu,
  Sun,
  X,
  ChevronDown,
  Home,
  WalletCards,
  CircleDollarSign,
  FileText,
  Gift,
  Crown,
  Trophy,
  ShoppingBag,
  CreditCard,
  Package,
  ClipboardList,
  Headphones,
  MessageSquare,
  Settings2,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import {
  AuthMeResponse,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
  getGetMyDepositsQueryKey,
  getGetAuthMeQueryKey,
  useGetAuthMe,
  useGetMyDeposits,
  usePostAuthForgotPassword,
  usePostAuthLogin,
  usePostAuthLogout,
  usePostAuthRegister,
  usePostAuthResetPassword,
} from '@workspace/api-client-react';
import {
  Link,
  Route,
  Switch,
  useLocation,
  useParams,
  Router as WouterRouter,
} from 'wouter';
import { SiteFooter } from './components/SiteFooter';
import { Brand } from './components/Brand';
import { MemberShell } from './components/MemberShell';
import { AdminDepositsPage, DepositsPage, MyDepositsPage, ReferralsPage } from './pages/FinancePages';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

const passwordCharacterGroups = [
  'abcdefghijkmnopqrstuvwxyz',
  'ABCDEFGHJKLMNPQRSTUVWXYZ',
  '23456789',
  '!@#$%^&*()-_=+?',
];

function secureRandomIndex(maxExclusive: number): number {
  if (!window.isSecureContext || typeof window.crypto?.getRandomValues !== 'function') {
    throw new Error('Secure password generation is unavailable in this browser.');
  }
  const range = 0x1_0000_0000;
  const limit = range - (range % maxExclusive);
  const sample = new Uint32Array(1);
  let value: number;
  do {
    window.crypto.getRandomValues(sample);
    value = sample[0]!;
  } while (value >= limit);
  return value % maxExclusive;
}

function generateSignupPassword(length = 20): string {
  if (length < passwordCharacterGroups.length) throw new Error('Password length is too short.');
  const characters = passwordCharacterGroups.map((group) => group[secureRandomIndex(group.length)]!);
  const allCharacters = passwordCharacterGroups.join('');
  while (characters.length < length) {
    characters.push(allCharacters[secureRandomIndex(allCharacters.length)]!);
  }
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapIndex = secureRandomIndex(index + 1);
    const current = characters[index]!;
    characters[index] = characters[swapIndex]!;
    characters[swapIndex] = current;
  }
  return characters.join('');
}

type WorkspaceTheme = 'dark' | 'light';

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

function formatBalance(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <main className="app-frame">
      <div className="page-shell">
        {children}
        <SiteFooter />
      </div>
    </main>
  );
}

function Story({ mode }: { mode: 'login' | 'register' | 'recovery' }) {
  const copy = {
    login: {
      kicker: 'A considered way forward',
      headline: <>Good to have<br />you <em>back.</em></>,
      body: 'Your ReplenishCC account is the starting point for a more thoughtful way to manage what matters.',
      note: 'A calmer experience begins here.',
    },
    register: {
      kicker: 'Your next chapter',
      headline: <>Make room<br />for <em>better.</em></>,
      body: 'Create your account and be among the first to step into the ReplenishCC experience.',
      note: 'One account. A more considered future.',
    },
    recovery: {
      kicker: 'Account access',
      headline: <>A secure path<br />back to <em>you.</em></>,
      body: 'We’ll help you regain access without revealing whether an account exists.',
      note: 'Your privacy stays protected at every step.',
    },
  }[mode];

  return (
    <section className="story fade-in" aria-label="ReplenishCC">
      <div className="story-kicker">{copy.kicker}</div>
      <h1>{copy.headline}</h1>
      <p className="story-copy">{copy.body}</p>
      <div className="story-rule" />
      <div className="story-note">{copy.note}</div>
    </section>
  );
}

function Field({
  id,
  label,
  type = 'text',
  value,
  onChange,
  placeholder,
  autoComplete,
  required = true,
  maxLength,
  action,
  hint,
  labelAction,
}: {
  id: string;
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
  maxLength?: number;
  action?: ReactNode;
  hint?: string;
  labelAction?: ReactNode;
}) {
  return (
    <div className="field">
      <div className="field-label-row">
        <label className="field-label" htmlFor={id}>{label}</label>
        {labelAction}
      </div>
      <div className="input-wrap">
        <input
          className={`field-input${action ? ' has-action' : ''}`}
          id={id}
          name={id}
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required={required}
          maxLength={maxLength}
          data-testid={`input-${id}`}
          aria-describedby={hint ? `${id}-hint` : undefined}
        />
        {action}
      </div>
      {hint && <div id={`${id}-hint`} className="strength-caption">{hint}</div>}
    </div>
  );
}

function PasswordInput({
  id,
  label,
  value,
  onChange,
  autoComplete,
  placeholder = 'Enter your password',
  required = true,
  labelAction,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  placeholder?: string;
  required?: boolean;
  labelAction?: ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <Field
      id={id}
      label={label}
      type={visible ? 'text' : 'password'}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      autoComplete={autoComplete}
      required={required}
      maxLength={128}
      labelAction={labelAction}
      action={
        <button
          type="button"
          className="input-action"
          onClick={() => setVisible((shown) => !shown)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          data-testid={`button-toggle-${id}`}
        >
          {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </button>
      }
    />
  );
}

function ActionButton({ children, pending, testId }: { children: ReactNode; pending: boolean; testId: string }) {
  return (
    <button type="submit" className="primary-button" disabled={pending} data-testid={testId}>
      {pending ? <><LoaderCircle className="spin" aria-hidden="true" /> Please wait</> : children}
    </button>
  );
}

function FormMessage({ children, kind = 'error' }: { children: ReactNode; kind?: 'error' | 'success' }) {
  return <div className={kind === 'error' ? 'form-error' : 'form-success'} role={kind === 'error' ? 'alert' : 'status'} data-testid={`status-${kind}`}>{children}</div>;
}

function errorText(error: unknown): string {
  if (error && typeof error === 'object') {
    const candidate = error as { error?: unknown; message?: unknown; response?: { data?: { error?: unknown } } };
    if (typeof candidate.response?.data?.error === 'string') return candidate.response.data.error;
    if (typeof candidate.error === 'string') return candidate.error;
    if (typeof candidate.message === 'string') return candidate.message;
  }
  return 'Something went wrong. Please try again.';
}

function syncSession(user: AuthMeResponse['user']) {
  queryClient.setQueryData<AuthMeResponse>(getGetAuthMeQueryKey(), {
    authenticated: Boolean(user),
    user,
  });
  void queryClient.invalidateQueries({ queryKey: getGetAuthMeQueryKey() });
}

function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState('');
  const [, setLocation] = useLocation();
  const login = usePostAuthLogin();

  useEffect(() => { document.title = 'Sign in | ReplenishCC'; }, []);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (login.isPending) return;
    setError('');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError('Enter a valid email address.');
    const input: LoginInput = { email: email.trim(), password, rememberMe };
    login.mutate({ data: input }, {
      onSuccess: (response) => {
        syncSession(response.user);
        setLocation('/dashboard');
      },
      onError: (reason) => setError(errorText(reason)),
    });
  };

  return (
    <Frame>
      <div className="auth-layout auth-layout-single">
        <section className="form-card fade-in" aria-labelledby="signin-title">
          <div className="eyebrow">Member access</div>
          <h2 id="signin-title">Welcome back</h2>
          <p className="form-intro">Sign in to your ReplenishCC account</p>
          {error && <FormMessage>{error}</FormMessage>}
          <form onSubmit={submit} noValidate>
            <Field id="email" label="Email" type="email" value={email} onChange={setEmail} placeholder="Enter your email" autoComplete="email" maxLength={254} />
            <PasswordInput id="password" label="Password" value={password} onChange={setPassword} autoComplete="current-password" />
            <div className="form-row">
              <label className="check-label">
                <input type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} data-testid="input-remember-me" />
                Remember me
              </label>
              <Link className="text-link" href="/forgot-password" data-testid="link-forgot-password">Forgot password?</Link>
            </div>
            <ActionButton pending={login.isPending} testId="button-sign-in">
              Sign In <ArrowRight aria-hidden="true" />
            </ActionButton>
          </form>
          <p className="form-bottom">Don’t have an account? <Link className="text-link" href="/register" data-testid="link-register">Sign up</Link></p>
        </section>
      </div>
    </Frame>
  );
}

function RegisterPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [generatedPassword, setGeneratedPassword] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const [error, setError] = useState('');
  const [referralCode, setReferralCode] = useState(() => {
    try { return new URLSearchParams(window.location.search).get('ref')?.slice(0, 16) ?? ''; }
    catch { return ''; }
  });
  const [, setLocation] = useLocation();
  const register = usePostAuthRegister();
  useEffect(() => { document.title = 'Create account | ReplenishCC'; }, []);

  const strength = [
    password.length >= 10,
    /[A-Z]/.test(password) && /[a-z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ].filter(Boolean).length;
  const strengthLabel = password.length === 0 ? 'Use at least 10 characters' : ['Needs work', 'Fair', 'Good', 'Strong', 'Excellent'][strength];

  const generatePassword = () => {
    setError('');
    try {
      const nextPassword = generateSignupPassword();
      setPassword(nextPassword);
      setConfirmPassword(nextPassword);
      setGeneratedPassword(nextPassword);
      setCopyStatus('');
    } catch {
      setGeneratedPassword('');
      setCopyStatus('');
      setError('Secure password generation is unavailable here. Enter a password manually.');
    }
  };

  const copyGeneratedPassword = async () => {
    if (!generatedPassword) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable.');
      await navigator.clipboard.writeText(generatedPassword);
      setCopyStatus('Generated password copied to clipboard.');
    } catch {
      setCopyStatus('Clipboard access failed. Show the password and copy it manually.');
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (register.isPending) return;
    setError('');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError('Enter a valid email address.');
    if (password.length < 10) return setError('Your password must contain at least 10 characters.');
    if (password !== confirmPassword) return setError('Your passwords do not match.');
    const input: RegisterInput = {
      fullName: displayNameFromEmail(email.trim()),
      email: email.trim(),
      password,
      confirmPassword,
      ...(referralCode.trim() ? { referralCode: referralCode.trim() } : {}),
    };
    register.mutate({ data: input }, {
      onSuccess: (response) => {
        syncSession(response.user);
        setLocation('/dashboard');
      },
      onError: (reason) => setError(errorText(reason)),
    });
  };

  return (
    <Frame>
      <div className="auth-layout auth-layout-single">
        <section className="form-card fade-in" aria-labelledby="register-title">
          <div className="eyebrow">Start here</div>
          <h2 id="register-title">Create your account</h2>
          <p className="form-intro">A few details are all it takes to get started.</p>
          {error && <FormMessage>{error}</FormMessage>}
          <form onSubmit={submit} noValidate>
            <Field id="email" label="Email address" type="email" value={email} onChange={setEmail} placeholder="you@example.com" autoComplete="email" maxLength={254} />
            <Field id="referral-code" label="Referral code" value={referralCode} onChange={setReferralCode} placeholder="Optional" autoComplete="off" required={false} maxLength={16} hint="If you were invited, your referral code is included here." />
            <PasswordInput
              id="password"
              label="Password"
              value={password}
              onChange={(value) => { setPassword(value); setGeneratedPassword(''); setCopyStatus(''); }}
              autoComplete="new-password"
              labelAction={
                <button className="password-generator-button" type="button" onClick={generatePassword} disabled={register.isPending} data-testid="button-generate-password">
                  <Sparkles aria-hidden="true" /> Generate
                </button>
              }
            />
            {generatedPassword && (
              <div className="generated-password-status" role="status" data-testid="status-generated-password">
                <span>{copyStatus || 'Strong password generated and filled in both fields.'}</span>
                <button className="generated-password-copy" type="button" onClick={copyGeneratedPassword} disabled={register.isPending} data-testid="button-copy-generated-password">
                  {copyStatus.startsWith('Generated password copied') ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                  {copyStatus.startsWith('Generated password copied') ? 'Copied' : 'Copy'}
                </button>
              </div>
            )}
            <div className="password-strength" aria-live="polite">
              <div className="strength-track"><div className="strength-fill" style={{ width: `${strength * 25}%` }} /></div>
              <div className="strength-caption" data-testid="text-password-strength"><span>Password strength</span><span>{strengthLabel}</span></div>
            </div>
            <PasswordInput id="confirm-password" label="Confirm password" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" placeholder="Enter your password again" />
            <p className="legal-hint">By creating an account, you agree to our <Link href="/terms">Terms</Link> and acknowledge our <Link href="/privacy">Privacy Policy</Link>.</p>
            <div style={{ marginTop: 19 }}>
              <ActionButton pending={register.isPending} testId="button-create-account">
                Create Account <ArrowRight aria-hidden="true" />
              </ActionButton>
            </div>
          </form>
          <p className="form-bottom">Already have an account? <Link className="text-link" href="/login" data-testid="link-sign-in">Sign in</Link></p>
        </section>
      </div>
    </Frame>
  );
}

function displayNameFromEmail(email: string): string {
  const localPart = email.slice(0, email.lastIndexOf('@')).split('+')[0] ?? '';
  const words = localPart.replace(/[._-]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  return words.map((word) => word[0].toUpperCase() + word.slice(1)).join(' ') || 'Member';
}

function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const forgot = usePostAuthForgotPassword();
  useEffect(() => { document.title = 'Reset password | ReplenishCC'; }, []);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (forgot.isPending) return;
    setError('');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError('Enter a valid email address.');
    forgot.mutate({ data: { email: email.trim() } }, {
      onSuccess: () => setSent(true),
      onError: (reason) => setError(errorText(reason)),
    });
  };

  return (
    <Frame>
      <div className="auth-layout">
        <Story mode="recovery" />
        <section className="form-card fade-in" aria-labelledby="forgot-title">
          <div className="eyebrow">Password assistance</div>
          <h2 id="forgot-title">{sent ? 'Check your inbox' : 'Forgot your password?'}</h2>
          {sent ? (
            <>
              <div className="form-success" role="status" data-testid="status-reset-request">
                If an account matches that email address, we’ll send instructions to reset its password.
              </div>
              <p className="form-intro">For your privacy, this message is the same whether or not an account exists.</p>
              <Link className="legal-back" href="/login"><ArrowLeft aria-hidden="true" /> Return to sign in</Link>
            </>
          ) : (
            <>
              <p className="form-intro">Enter your email address and we’ll send you a link to reset your password.</p>
              {error && <FormMessage>{error}</FormMessage>}
              <form onSubmit={submit} noValidate>
                <Field id="email" label="Email" type="email" value={email} onChange={setEmail} placeholder="Enter your email address" autoComplete="email" maxLength={254} />
                <div style={{ marginTop: 22 }}>
                  <ActionButton pending={forgot.isPending} testId="button-send-reset">
                    Send Reset Link <ArrowRight aria-hidden="true" />
                  </ActionButton>
                </div>
              </form>
              <p className="form-bottom"><Link className="text-link" href="/login" data-testid="link-back-to-login">Back to sign in</Link></p>
            </>
          )}
        </section>
      </div>
    </Frame>
  );
}

function ResetPasswordPage() {
  const { token = '' } = useParams<{ token: string }>();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [complete, setComplete] = useState(false);
  const reset = usePostAuthResetPassword();
  useEffect(() => { document.title = 'Choose a new password | ReplenishCC'; }, []);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (reset.isPending) return;
    setError('');
    if (!token) return setError('This password reset link is incomplete. Request a new link to continue.');
    if (password.length < 10) return setError('Your password must contain at least 10 characters.');
    if (password !== confirmPassword) return setError('Your passwords do not match.');
    const data: ResetPasswordInput = { token, password, confirmPassword };
    reset.mutate({ data }, {
      onSuccess: () => setComplete(true),
      onError: (reason) => setError(errorText(reason)),
    });
  };
  return (
    <Frame>
      <div className="auth-layout">
        <Story mode="recovery" />
        <section className="form-card fade-in" aria-labelledby="reset-title">
          <div className="eyebrow">Secure your account</div>
          <h2 id="reset-title">{complete ? 'Password updated' : 'Choose a new password'}</h2>
          {complete ? (
            <>
              <FormMessage kind="success">Your password has been updated. You can now sign in with your new password.</FormMessage>
              <Link className="legal-back" href="/login">Continue to sign in <ArrowRight aria-hidden="true" /></Link>
            </>
          ) : (
            <>
              <p className="form-intro">Use a new password with at least 10 characters.</p>
              {error && <FormMessage>{error}</FormMessage>}
              <form onSubmit={submit} noValidate>
                <PasswordInput id="new-password" label="New password" value={password} onChange={setPassword} autoComplete="new-password" />
                <PasswordInput id="confirm-password" label="Confirm new password" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" />
                <div style={{ marginTop: 22 }}>
                  <ActionButton pending={reset.isPending} testId="button-update-password">
                    Update password <ArrowRight aria-hidden="true" />
                  </ActionButton>
                </div>
              </form>
              <p className="form-bottom"><Link className="text-link" href="/login">Back to sign in</Link></p>
            </>
          )}
        </section>
      </div>
    </Frame>
  );
}

const privacySections = [
  ['1. Information We Collect', 'This draft describes information you may provide when creating or using a ReplenishCC account, such as your name, username, and email address. Replace this text with approved details about collected information and applicable retention practices.'],
  ['2. How We Use Information', 'Account information may be used to create and maintain access, support account security, and communicate about account-related requests. Replace this copy with the final, reviewed purposes and lawful bases that apply to the service.'],
  ['3. Information Sharing', 'This placeholder does not describe actual sharing practices. Replace it with accurate information about service providers, disclosures, and any circumstances in which account information may be shared.'],
  ['4. Data Security', 'ReplenishCC is designed to support secure account access. No method of transmission or storage can be guaranteed to be completely secure. Replace this section with an approved description of safeguards and incident response.'],
  ['5. Your Rights', 'You may have rights to access, correct, or delete personal information, depending on your location. Replace this section with the actual rights, controls, and contact process available in each region.'],
  ['6. Cookies and Tracking', 'This account portal uses a session cookie to keep signed-in users authenticated. Replace this section with a complete, accurate description of cookies and any tracking technologies used by the finished service.'],
  ['7. Changes to This Policy', 'ReplenishCC may revise this policy as the service changes. Replace this section with the approved update, notification, and effective-date process.'],
];
const termsSections = [
  ['1. Acceptance of Terms', 'This draft is not a binding agreement. Replace it with the approved terms that govern access to and use of ReplenishCC.'],
  ['2. Use License', 'This section is a placeholder and does not grant a license. Replace it with the final approved rules for access to and use of the service.'],
  ['3. User Account', 'You are responsible for keeping your sign-in credentials confidential and for activity carried out through your account. Replace this summary with the final account requirements and security responsibilities.'],
  ['4. Prohibited Uses', 'Use of the account portal must comply with applicable laws and the final terms. Replace this section with the approved restrictions and prohibited activities.'],
  ['5. Limitation of Liability', 'This placeholder does not establish any warranty disclaimer or limit of liability. Insert the complete language reviewed and approved for the service and applicable jurisdictions.'],
  ['6. Changes to Terms', 'Replace this section with the process for updates, notice, and the effective date of revised terms.'],
];

function LegalPage({ kind }: { kind: 'privacy' | 'terms' }) {
  const isPrivacy = kind === 'privacy';
  const sections = isPrivacy ? privacySections : termsSections;
  const session = useGetAuthMe();
  const [, setLocation] = useLocation();
  useEffect(() => { document.title = `${isPrivacy ? 'Privacy Policy' : 'Terms of Service'} | ReplenishCC`; }, [isPrivacy]);
  const returnToPreviousPage = () => {
    let previousPath = '';
    try {
      previousPath = window.sessionStorage.getItem('replenishcc-legal-return-path') ?? '';
      window.sessionStorage.removeItem('replenishcc-legal-return-path');
    } catch {
      // Use the signed-in or signed-out fallback when session storage is unavailable.
    }
    if (previousPath.startsWith('/') && !previousPath.startsWith('//') && previousPath !== '/terms' && previousPath !== '/privacy') {
      setLocation(previousPath);
    } else {
      setLocation(session.data?.authenticated ? '/dashboard' : '/login');
    }
  };
  return (
    <Frame>
      <article className="legal-layout fade-in">
        <div className="eyebrow">ReplenishCC account portal</div>
        <h1>{isPrivacy ? 'Privacy Policy' : 'Terms of Service'}</h1>
        <div className="legal-date">Draft policy · Last updated: To be confirmed</div>
        <div className="placeholder-banner" role="note">
          <strong>Draft placeholder — not legal advice.</strong> This page needs review and approval before it can be used as ReplenishCC’s policy.
        </div>
        {sections.map(([heading, copy]) => (
          <section className="legal-section" key={heading}>
            <h2>{heading}</h2>
            <p>{copy}</p>
          </section>
        ))}
        <button type="button" className="legal-back" onClick={returnToPreviousPage} data-testid="button-return-from-legal">
          <ArrowLeft aria-hidden="true" /> Return to {session.data?.authenticated ? 'your account' : 'account access'}
        </button>
      </article>
    </Frame>
  );
}

function DashboardPage() {
  const session = useGetAuthMe();
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
  const mobileSidebarRef = useRef<HTMLElement>(null);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const mobileCloseButtonRef = useRef<HTMLButtonElement>(null);
  const accountControlRef = useRef<HTMLDivElement>(null);
  const accountTriggerRef = useRef<HTMLButtonElement>(null);
  const sidebarAccountRef = useRef<HTMLDivElement>(null);
  const sidebarAccountTriggerRef = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    financeDeposit: true,
    shop: true,
    orders: true,
    support: true,
  });
  const [, setLocation] = useLocation();
  const user = session.data?.authenticated ? session.data.user : null;
  const accountBalance = useGetMyDeposits({
    query: {
      queryKey: getGetMyDepositsQueryKey(),
      enabled: Boolean(user),
      refetchOnWindowFocus: true,
    },
  });

  useEffect(() => { document.title = 'Your account | ReplenishCC'; }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem('replenishcc-dashboard-theme', theme);
    } catch {
      // Keep the selected theme for this page even when storage is unavailable.
    }
  }, [theme]);
  useEffect(() => {
    if (!session.isLoading && (!session.data?.authenticated || session.isError)) setLocation('/login');
  }, [session.isLoading, session.data?.authenticated, session.isError, setLocation]);
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
  const initials = user?.fullName.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'R';

  const memberSidebar = (
    <>
      <div className="member-brand">
        <Brand href="/dashboard" label="ReplenishCC dashboard" />
        <button ref={mobileCloseButtonRef} className="mobile-close" type="button" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation" data-testid="button-close-navigation"><X /></button>
      </div>
      <nav className="member-nav" aria-label="Member navigation">
        <div className="nav-section-label">Workspace</div>
        <Link href="/dashboard" className={`nav-row nav-home${window.location.pathname === '/dashboard' ? ' active' : ''}`} aria-current={window.location.pathname === '/dashboard' ? 'page' : undefined} onClick={() => setMobileNavOpen(false)} data-testid="link-dashboard-home">
          <Home aria-hidden="true" /><span>Home</span><span className="live-mark">Current</span>
        </Link>

        <div className="nav-section-label">Finance</div>
        <button className="nav-row nav-group" type="button" onClick={() => toggleGroup('financeDeposit')} aria-expanded={expanded.financeDeposit} data-testid="button-toggle-deposit">
          <WalletCards aria-hidden="true" /><span>Deposit</span><ChevronDown className={`nav-chevron${expanded.financeDeposit ? ' is-open' : ''}`} aria-hidden="true" />
        </button>
        {expanded.financeDeposit && <div className="nav-children">
          <Link href="/deposits" className="nav-row" onClick={() => setMobileNavOpen(false)} data-testid="link-deposit-money"><CircleDollarSign aria-hidden="true" /><span>Deposit funds</span></Link>
          <Link href="/my-deposits" className="nav-row" onClick={() => setMobileNavOpen(false)} data-testid="link-my-deposits"><FileText aria-hidden="true" /><span>Deposit history</span></Link>
        </div>}
        <Link href="/referrals" className="nav-row" onClick={() => setMobileNavOpen(false)} data-testid="link-referrals"><Gift aria-hidden="true" /><span>Referrals</span></Link>
        {user?.isDepositAdmin && <Link href="/admin/deposits" className="nav-row" onClick={() => setMobileNavOpen(false)} data-testid="link-admin-deposits"><ShieldCheck aria-hidden="true" /><span>Deposit review</span></Link>}
        <UnavailableNav icon={<Gift />} label="Redeem Code" />
        <UnavailableNav icon={<Crown />} label="VIP & Free CC" />
        <UnavailableNav icon={<Trophy />} label="Leaderboard" />

        <div className="nav-section-label">Shopping</div>
        <button className="nav-row nav-group" type="button" onClick={() => toggleGroup('shop')} aria-expanded={expanded.shop} data-testid="button-toggle-shop">
          <ShoppingBag aria-hidden="true" /><span>Shop</span><ChevronDown className={`nav-chevron${expanded.shop ? ' is-open' : ''}`} aria-hidden="true" />
        </button>
        {expanded.shop && <div className="nav-children">
          <UnavailableNav icon={<CreditCard />} label="Buy Cards" />
          <UnavailableNav icon={<Package />} label="Bulk Cards" />
          <UnavailableNav icon={<ClipboardList />} label="Buy Logs" />
        </div>}
        <button className="nav-row nav-group" type="button" onClick={() => toggleGroup('orders')} aria-expanded={expanded.orders} data-testid="button-toggle-orders">
          <Package aria-hidden="true" /><span>My Orders</span><ChevronDown className={`nav-chevron${expanded.orders ? ' is-open' : ''}`} aria-hidden="true" />
        </button>
        {expanded.orders && <div className="nav-children">
          <UnavailableNav icon={<CreditCard />} label="My Card Orders" />
          <UnavailableNav icon={<ClipboardList />} label="My Log Orders" />
          <UnavailableNav icon={<Package />} label="My Bulk Card Purchases" />
        </div>}

        <div className="nav-section-label">Support</div>
        <button className="nav-row nav-group" type="button" onClick={() => toggleGroup('support')} aria-expanded={expanded.support} data-testid="button-toggle-support">
          <Headphones aria-hidden="true" /><span>Support</span><ChevronDown className={`nav-chevron${expanded.support ? ' is-open' : ''}`} aria-hidden="true" />
        </button>
        {expanded.support && <div className="nav-children">
          <UnavailableNav icon={<MessageSquare />} label="My Tickets" />
          <UnavailableNav icon={<MessageSquare />} label="Create Ticket" />
        </div>}

        <div className="nav-section-label">Settings</div>
        <UnavailableNav icon={<Settings2 />} label="Account Management" />
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
        ) : (
          <div className="skeleton sidebar-account-skeleton" aria-hidden="true" />
        )}
      </div>
    </>
  );

  if (session.isLoading || (!session.data && !session.isError)) {
    return <MemberShell pageTitle="Your account" user={null} loading />;
  }
  if (!user) {
    return <MemberShell pageTitle="Your account" user={null} loading />;
  }

  return (
    <MemberShell pageTitle="Your account" user={user}>
      <section className="fade-in" aria-labelledby="member-welcome">
          <div className="welcome-eyebrow"><Sparkles aria-hidden="true" size={14} /> Your account</div>
          <div className="welcome-heading-row">
            <div>
              <h1 id="member-welcome" data-testid="text-welcome">Welcome, {user.fullName.split(/\s+/)[0]}.</h1>
              <p className="welcome-copy">Your ReplenishCC member space is ready.</p>
            </div>
            <div className="welcome-seal" aria-label="Secure member workspace"><ShieldCheck aria-hidden="true" /><span>SECURE<br />WORKSPACE</span></div>
          </div>
          <div className="member-divider" />
          <div className="home-lower">
            <div className="home-message">
              <span className="home-message-index">01 <span /> ACCOUNT OVERVIEW</span>
              <h2>A clear place<br />to begin.</h2>
              <p>Account services will appear here as they become available. For now, your signed-in identity is the only information shown.</p>
            </div>
            <div className="identity-panel" data-testid="user-identity">
              <div className="identity-panel-heading"><span>Signed in as</span><span className="identity-status"><i /> Active session</span></div>
              <div className="identity-user">
                <div className="user-avatar">{initials}</div>
                <div className="user-meta"><strong data-testid="text-full-name">{user.fullName}</strong><span data-testid="text-user-email">{user.email}</span></div>
              </div>
              {user.username && <div className="identity-detail"><span>Username</span><strong data-testid="text-member-username">@{user.username}</strong></div>}
              <div className="identity-detail"><span>Account access</span><strong><ShieldCheck aria-hidden="true" /> Protected</strong></div>
            </div>
          </div>
          <div className="home-footnote"><ShieldCheck aria-hidden="true" /> ReplenishCC keeps this workspace tied to your authenticated session.</div>
      </section>
    </MemberShell>
  );
}

function UnavailableNav({ icon, label }: { icon: ReactNode; label: string }) {
  return <div className="nav-row nav-unavailable" aria-disabled="true" title={`${label} is not available yet`} data-testid={`nav-unavailable-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>
    {icon}<span>{label}</span><span className="soon-label">Soon</span>
  </div>;
}

function RootRedirect() {
  const [, setLocation] = useLocation();
  useEffect(() => setLocation('/login', { replace: true }), [setLocation]);
  return <div className="app-frame" aria-label="Redirecting to sign in" />;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={RootRedirect} />
      <Route path="/login" component={LoginPage} />
      <Route path="/register" component={RegisterPage} />
      <Route path="/forgot-password" component={ForgotPasswordPage} />
      <Route path="/reset-password/:token" component={ResetPasswordPage} />
      <Route path="/privacy"><LegalPage kind="privacy" /></Route>
      <Route path="/terms"><LegalPage kind="terms" /></Route>
      <Route path="/dashboard" component={DashboardPage} />
      <Route path="/deposits" component={DepositsPage} />
      <Route path="/my-deposits" component={MyDepositsPage} />
      <Route path="/referrals" component={ReferralsPage} />
      <Route path="/admin/deposits" component={AdminDepositsPage} />
      <Route>
        <Frame>
          <div className="legal-layout">
            <div className="eyebrow">Page not found</div>
            <h1>This page isn’t here.</h1>
            <p className="story-copy">The page may have moved, or the address may be incomplete.</p>
            <Link className="legal-back" href="/login"><ArrowLeft aria-hidden="true" /> Return to sign in</Link>
          </div>
        </Frame>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter>
        <Router />
      </WouterRouter>
    </QueryClientProvider>
  );
}

export default App;