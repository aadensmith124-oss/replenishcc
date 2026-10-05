import { useState } from "react";
import {
  ArrowUpRight,
  Check,
  Copy,
  Gift,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import {
  useCreateTelegramReferralVerificationCode,
  type TelegramReferralVerificationCodeResponse,
} from "@workspace/api-client-react";

type BonusStatus = "eligible" | "earned";
type Notice = { kind: "success" | "error"; text: string };

const TELEGRAM_GROUP_INVITE_URL = "https://t.me/+UHNFYn2Jh0xiOTE5";

function errorText(error: unknown): string {
  if (error && typeof error === "object") {
    const candidate = error as {
      message?: unknown;
      data?: { error?: unknown };
      response?: { data?: { error?: unknown } };
    };
    if (typeof candidate.response?.data?.error === "string") {
      return candidate.response.data.error;
    }
    if (typeof candidate.data?.error === "string") return candidate.data.error;
    if (typeof candidate.message === "string") return candidate.message;
  }
  return "The Telegram verification code could not be created. Please try again.";
}

function formatExpiry(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

export function TelegramReferralBonusCard({ status }: { status: BonusStatus }) {
  const createCode = useCreateTelegramReferralVerificationCode();
  const [verificationCode, setVerificationCode] =
    useState<TelegramReferralVerificationCodeResponse | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [copied, setCopied] = useState(false);

  const generateCode = () => {
    setNotice(null);
    setCopied(false);
    createCode.mutate(undefined, {
      onSuccess: (response) => {
        setVerificationCode(response);
        setNotice({
          kind: "success",
          text: "Your Telegram group verification code is ready.",
        });
      },
      onError: (error) => setNotice({ kind: "error", text: errorText(error) }),
    });
  };

  const copyCommand = async () => {
    if (!verificationCode) return;
    try {
      await navigator.clipboard.writeText(`/verify ${verificationCode.code}`);
      setCopied(true);
      setNotice({ kind: "success", text: "Telegram verification command copied." });
    } catch {
      setNotice({
        kind: "error",
        text: "Clipboard access is unavailable. Select and copy the command manually.",
      });
    }
  };

  return (
    <section
      className="finance-panel telegram-reward-panel"
      aria-labelledby="telegram-referral-bonus-title"
      data-testid="panel-telegram-referral-bonus"
    >
      <div className="telegram-reward-heading">
        <div>
          <div className="panel-overline">Referred member bonus</div>
          <h2 id="telegram-referral-bonus-title">
            {status === "earned"
              ? "Your Telegram bonus is recorded"
              : "Earn your referrer a $0.50 bonus"}
          </h2>
          <p>
            {status === "earned"
              ? "This ReplenishCC account has already received credit for its Telegram group verification."
              : "Join the ReplenishCC Telegram group from this referred account, then verify your membership. Your referrer receives the one-time $0.50 credit."}
          </p>
        </div>
        <div className="telegram-reward-amount">
          {status === "earned" ? (
            <ShieldCheck aria-hidden="true" />
          ) : (
            <Gift aria-hidden="true" />
          )}
          <span>{status === "earned" ? "Earned" : "$0.50"}</span>
        </div>
      </div>
      {status === "eligible" && (
        <>
          <div className="telegram-reward-details">
            <p>
              Join the group first, then create a code and send the full{" "}
              <code>/verify</code> command to the bot in a private chat. Codes expire
              after 10 minutes.
            </p>
            <a
              href={TELEGRAM_GROUP_INVITE_URL}
              target="_blank"
              rel="noreferrer"
              className="telegram-reward-open"
              data-testid="link-telegram-referral-group"
            >
              Join Telegram group <ArrowUpRight aria-hidden="true" />
            </a>
          </div>
          <div className="telegram-reward-details">
            <p>The bonus is credited to the account that referred you.</p>
            <button
              type="button"
              className="telegram-reward-generate"
              onClick={generateCode}
              disabled={createCode.isPending}
              data-testid="button-create-telegram-referral-code"
            >
              {createCode.isPending ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="telegram-reward-spinner"
                />
              ) : (
                <RefreshCw aria-hidden="true" />
              )}
              {createCode.isPending
                ? "Creating code…"
                : verificationCode
                  ? "Create a new code"
                  : "Create verification code"}
            </button>
          </div>
          {notice && (
            <div
              className={`portal-alert portal-alert-${notice.kind}`}
              role={notice.kind === "error" ? "alert" : "status"}
              data-testid={`status-telegram-referral-${notice.kind}`}
            >
              {notice.text}
            </div>
          )}
          {verificationCode && (
            <div
              className="telegram-reward-code-result"
              data-testid="panel-telegram-referral-code"
            >
              <div>
                <strong>Send this command to @{verificationCode.botUsername}</strong>
                <span>Code expires {formatExpiry(verificationCode.expiresAt)}.</span>
                <code
                  className="telegram-reward-code"
                  data-testid="text-telegram-referral-command"
                >
                  /verify {verificationCode.code}
                </code>
              </div>
              <div className="telegram-reward-actions">
                <a
                  href={`https://t.me/${verificationCode.botUsername}`}
                  target="_blank"
                  rel="noreferrer"
                  className="telegram-reward-open"
                  data-testid="link-open-telegram-referral-bot"
                >
                  Open Telegram bot <ArrowUpRight aria-hidden="true" />
                </a>
                <button
                  type="button"
                  className="telegram-reward-copy"
                  onClick={copyCommand}
                  data-testid="button-copy-telegram-referral-command"
                >
                  {copied ? (
                    <Check aria-hidden="true" />
                  ) : (
                    <Copy aria-hidden="true" />
                  )}
                  {copied ? "Copied" : "Copy command"}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}