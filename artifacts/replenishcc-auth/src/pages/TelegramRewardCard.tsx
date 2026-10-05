import { useState } from "react";
import { ArrowUpRight, Check, Copy, Gift, LoaderCircle, RefreshCw } from "lucide-react";
import {
  useCreateTelegramRewardCode,
  type TelegramRewardCodeResponse,
} from "@workspace/api-client-react";

type Notice = { kind: "success" | "error"; text: string };

function errorText(error: unknown): string {
  if (error && typeof error === "object") {
    const candidate = error as {
      message?: unknown;
      data?: { error?: unknown };
      response?: { data?: { error?: unknown } };
    };
    if (typeof candidate.response?.data?.error === "string") return candidate.response.data.error;
    if (typeof candidate.data?.error === "string") return candidate.data.error;
    if (typeof candidate.message === "string") return candidate.message;
  }
  return "The reward code could not be created. Please try again.";
}

function formatExpiry(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function TelegramRewardCard() {
  const createCode = useCreateTelegramRewardCode();
  const [rewardCode, setRewardCode] = useState<TelegramRewardCodeResponse | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [copied, setCopied] = useState(false);

  const generateCode = () => {
    setNotice(null);
    setCopied(false);
    createCode.mutate(undefined, {
      onSuccess: (response) => {
        setRewardCode(response);
        setNotice({ kind: "success", text: "Your secure Telegram reward code is ready." });
      },
      onError: (error) => setNotice({ kind: "error", text: errorText(error) }),
    });
  };

  const copyCode = async () => {
    if (!rewardCode) return;
    try {
      await navigator.clipboard.writeText(rewardCode.code);
      setCopied(true);
      setNotice({ kind: "success", text: "Telegram reward code copied." });
    } catch {
      setNotice({ kind: "error", text: "Clipboard access is unavailable. Select and copy the code manually." });
    }
  };

  return (
    <section className="finance-panel telegram-reward-panel" aria-labelledby="telegram-reward-title">
      <div className="telegram-reward-heading">
        <div>
          <div className="panel-overline">Member reward</div>
          <h2 id="telegram-reward-title">Get $1 in Telegram</h2>
          <p>Create a code while signed in, then send it to the Telegram bot from an account whose display name contains ReplenishCC.xyz. Telegram usernames cannot include periods, so this exact phrase can only match the display name.</p>
        </div>
        <div className="telegram-reward-amount"><Gift aria-hidden="true" /><span>$1.00</span></div>
      </div>
      <div className="telegram-reward-details">
        <p>Each ReplenishCC account and Telegram account can receive this reward once per rolling 24 hours. The secure code expires in 10 minutes; do not share it.</p>
        <button
          type="button"
          className="telegram-reward-generate"
          onClick={generateCode}
          disabled={createCode.isPending}
          data-testid="button-create-telegram-reward-code"
        >
          {createCode.isPending ? <LoaderCircle aria-hidden="true" className="telegram-reward-spinner" /> : <RefreshCw aria-hidden="true" />}
          {createCode.isPending ? "Creating code…" : rewardCode ? "Create a new code" : "Create Telegram reward code"}
        </button>
      </div>
      {notice && <div className={`portal-alert portal-alert-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"} data-testid={`status-telegram-reward-${notice.kind}`}>{notice.text}</div>}
      {rewardCode && (
        <div className="telegram-reward-code-result" data-testid="panel-telegram-reward-code">
          <div>
            <strong>Send this code to @{rewardCode.botUsername}</strong>
            <span>Code expires {formatExpiry(rewardCode.expiresAt)}.</span>
            <code className="telegram-reward-code" data-testid="text-telegram-reward-code">{rewardCode.code}</code>
          </div>
          <div className="telegram-reward-actions">
            <a href={`https://t.me/${rewardCode.botUsername}`} target="_blank" rel="noreferrer" className="telegram-reward-open" data-testid="link-open-telegram-bot">
              Open Telegram <ArrowUpRight aria-hidden="true" />
            </a>
            <button type="button" className="telegram-reward-copy" onClick={copyCode} data-testid="button-copy-telegram-reward-code">
              {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
              {copied ? "Copied" : "Copy code"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}