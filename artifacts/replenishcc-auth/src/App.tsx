import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
  LoaderCircle,
  LogOut,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import {
  AuthMeResponse,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
  getGetAuthMeQueryKey,
  useGetAuthMe,
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

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

function Brand() {
  return (
    <Link href="/login" className="brand" aria-label="ReplenishCC sign in">
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 32 32" fill="none">
          <path d="M16 2.8 27.4 9.4v13.2L16 29.2 4.6 22.6V9.4L16 2.8Z" stroke="currentColor" strokeWidth="1.15" />
          <path d="m10.1 18.6 5.9-10 5.9 10M12.6 14.5h6.8M9.7 22.2h12.6" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span>REPLENISHCC</span>
    </Link>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <main className="app-frame">
      <div className="page-shell">
        <header className="topbar">
          <Brand />
          <div className="secure-label"><ShieldCheck aria-hidden="true" /> Secure account portal</div>
        </header>
        {children}
        <footer className="site-footer">
          <span>© {new Date().getFullYear()} ReplenishCC</span>
          <nav className="footer-links" aria-label="Legal">
            <Link href="/privacy" data-testid="link-privacy">Privacy Policy</Link>
            <Link href="/terms" data-testid="link-terms">Terms of Service</Link>
          </nav>
        </footer>
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
}) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>{label}</label>
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
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  placeholder?: string;
  required?: boolean;
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
      <div className="auth-layout">
        <Story mode="login" />
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
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
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

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (register.isPending) return;
    setError('');
    if (fullName.trim().length === 0) return setError('Enter your full name to continue.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError('Enter a valid email address.');
    if (password.length < 10) return setError('Your password must contain at least 10 characters.');
    if (password !== confirmPassword) return setError('Your passwords do not match.');
    if (username.trim() && !/^[a-zA-Z0-9_]{3,24}$/.test(username.trim())) {
      return setError('Username must be 3–24 characters using letters, numbers, or underscores.');
    }
    const input: RegisterInput = {
      fullName: fullName.trim(),
      ...(username.trim() ? { username: username.trim() } : {}),
      email: email.trim(),
      password,
      confirmPassword,
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
      <div className="auth-layout">
        <Story mode="register" />
        <section className="form-card fade-in" aria-labelledby="register-title">
          <div className="eyebrow">Start here</div>
          <h2 id="register-title">Create your account</h2>
          <p className="form-intro">A few details are all it takes to get started.</p>
          {error && <FormMessage>{error}</FormMessage>}
          <form onSubmit={submit} noValidate>
            <Field id="full-name" label="Full name" value={fullName} onChange={setFullName} placeholder="Your full name" autoComplete="name" maxLength={100} />
            <Field id="username" label="Username" value={username} onChange={setUsername} placeholder="Choose a username" autoComplete="username" required={false} maxLength={24} />
            <Field id="email" label="Email address" type="email" value={email} onChange={setEmail} placeholder="you@example.com" autoComplete="email" maxLength={254} />
            <PasswordInput id="password" label="Password" value={password} onChange={setPassword} autoComplete="new-password" />
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
              {import.meta.env.DEV && <p className="dev-note" data-testid="status-development-recovery">Development mode: reset links for existing accounts are written to server logs. This build does not send email.</p>}
              <Link className="legal-back" href="/login"><ArrowLeft aria-hidden="true" /> Return to sign in</Link>
            </>
          ) : (
            <>
              <p className="form-intro">Enter your email address and we’ll send you a link to reset your password.</p>
              {import.meta.env.DEV && <p className="dev-note" data-testid="status-development-recovery">Development mode: reset links for existing accounts are written to server logs. This build does not send email.</p>}
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
  ['1. Information We Collect', 'This development placeholder describes information you may provide when creating or using a ReplenishCC account, such as your name, username, and email address. Replace this text with approved details about collected information and applicable retention practices.'],
  ['2. How We Use Information', 'Account information may be used to create and maintain access, support account security, and communicate about account-related requests. Replace this copy with the final, reviewed purposes and lawful bases that apply to the service.'],
  ['3. Information Sharing', 'This placeholder does not describe actual sharing practices. Replace it with accurate information about service providers, disclosures, and any circumstances in which account information may be shared.'],
  ['4. Data Security', 'ReplenishCC is designed to support secure account access. No method of transmission or storage can be guaranteed to be completely secure. Replace this section with an approved description of safeguards and incident response.'],
  ['5. Your Rights', 'You may have rights to access, correct, or delete personal information, depending on your location. Replace this section with the actual rights, controls, and contact process available in each region.'],
  ['6. Cookies and Tracking', 'This account portal uses a session cookie to keep signed-in users authenticated. Replace this section with a complete, accurate description of cookies and any tracking technologies used by the finished service.'],
  ['7. Changes to This Policy', 'ReplenishCC may revise this policy as the service changes. Replace this section with the approved update, notification, and effective-date process.'],
];
const termsSections = [
  ['1. Acceptance of Terms', 'This development placeholder is not a binding agreement. Replace it with the approved terms that govern access to and use of ReplenishCC.'],
  ['2. Use License', 'This section is a placeholder and does not grant a license. Replace it with the final approved rules for access to and use of the service.'],
  ['3. User Account', 'You are responsible for keeping your sign-in credentials confidential and for activity carried out through your account. Replace this summary with the final account requirements and security responsibilities.'],
  ['4. Prohibited Uses', 'Use of the account portal must comply with applicable laws and the final terms. Replace this section with the approved restrictions and prohibited activities.'],
  ['5. Limitation of Liability', 'This placeholder does not establish any warranty disclaimer or limit of liability. Insert the complete language reviewed and approved for the service and applicable jurisdictions.'],
  ['6. Changes to Terms', 'Replace this section with the process for updates, notice, and the effective date of revised terms.'],
];

function LegalPage({ kind }: { kind: 'privacy' | 'terms' }) {
  const isPrivacy = kind === 'privacy';
  const sections = isPrivacy ? privacySections : termsSections;
  useEffect(() => { document.title = `${isPrivacy ? 'Privacy Policy' : 'Terms of Service'} | ReplenishCC`; }, [isPrivacy]);
  return (
    <Frame>
      <article className="legal-layout fade-in">
        <div className="eyebrow">ReplenishCC account portal</div>
        <h1>{isPrivacy ? 'Privacy Policy' : 'Terms of Service'}</h1>
        <div className="legal-date">Development placeholder · Last updated: To be confirmed</div>
        <div className="placeholder-banner" role="note">
          <strong>Development placeholder — not legal advice.</strong> This page contains draft placeholder copy only. Replace it with text reviewed and approved for ReplenishCC before launch.
        </div>
        {sections.map(([heading, copy]) => (
          <section className="legal-section" key={heading}>
            <h2>{heading}</h2>
            <p>{copy}</p>
          </section>
        ))}
        <Link href="/login" className="legal-back"><ArrowLeft aria-hidden="true" /> Return to account access</Link>
      </article>
    </Frame>
  );
}

function DashboardPage() {
  const session = useGetAuthMe();
  const logout = usePostAuthLogout();
  const [logoutError, setLogoutError] = useState('');
  const [, setLocation] = useLocation();
  const user = session.data?.authenticated ? session.data.user : null;

  useEffect(() => { document.title = 'Your account | ReplenishCC'; }, []);
  useEffect(() => {
    if (!session.isLoading && (!session.data?.authenticated || session.isError)) setLocation('/login');
  }, [session.isLoading, session.data?.authenticated, session.isError, setLocation]);

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

  if (session.isLoading || (!session.data && !session.isError)) {
    return (
      <Frame>
        <section className="dashboard-wrap" aria-label="Loading your account" aria-busy="true">
          <div className="dashboard-card" style={{ maxWidth: 770 }}>
            <div className="skeleton" style={{ width: 128, marginBottom: 22 }} />
            <div className="skeleton" style={{ width: '65%', height: 38, marginBottom: 18 }} />
            <div className="skeleton" style={{ width: '88%', marginBottom: 9 }} />
            <div className="skeleton" style={{ width: '73%' }} />
          </div>
        </section>
      </Frame>
    );
  }
  if (!user) {
    return <Frame><div className="dashboard-wrap" role="status"><div className="dashboard-card"><div className="skeleton" style={{ width: 200 }} /></div></div></Frame>;
  }
  const initials = user.fullName.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();

  return (
    <Frame>
      <section className="dashboard-wrap">
        <div className="dashboard-card fade-in">
          <div className="dashboard-head">
            <div>
              <div className="eyebrow"><Sparkles aria-hidden="true" size={14} /> Your account</div>
              <h1 data-testid="text-welcome">Welcome to ReplenishCC</h1>
            </div>
            <button type="button" className="quiet-button" onClick={signOut} disabled={logout.isPending} data-testid="button-logout">
              {logout.isPending ? <LoaderCircle className="spin" aria-hidden="true" /> : <LogOut aria-hidden="true" />}
              {logout.isPending ? 'Signing out' : 'Sign out'}
            </button>
          </div>
          <p>Your dashboard is currently under development.</p>
          {logoutError && <FormMessage>{logoutError}</FormMessage>}
          <div className="user-pill" data-testid="user-identity">
            <div className="user-avatar" aria-hidden="true">{initials || 'R'}</div>
            <div className="user-meta">
              <strong data-testid="text-full-name">{user.fullName}</strong>
              <span data-testid="text-user-email">{user.email}</span>
            </div>
          </div>
          {user.username && <p style={{ margin: '18px 0 0', fontSize: 12 }} data-testid="text-username">Username <strong style={{ color: '#dfcf95', fontWeight: 500 }}>@{user.username}</strong></p>}
        </div>
      </section>
    </Frame>
  );
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