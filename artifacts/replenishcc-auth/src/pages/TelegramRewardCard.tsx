import { useState } from "react";
import { ArrowUpRight, Check, Copy, Gift, LoaderCircle, RefreshCw } from "lucide-react";
import {
  useCreateTelegramRewardLink,
  type TelegramRewardLinkResponse,
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
  return "The reward link could not be created. Please try again.";
}

function formatExpiry(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function TelegramRewardCard() {
  const createLink = useCreateTelegramRewardLink();
  const [link, setLink] = useState<TelegramRewardLinkResponse | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [copied, setCopied] = useState(false);

  const generateLink = () => {
    setNotice(null);
    setCopied(false);
    createLink.mutate(undefined, {
      onSuccess: (response) => {
        setLink(response);
        setNotice({ kind: "success", text: "Your secure Telegram reward link is ready." });
      },
      onError: (error) => setNotice({ kind: "error", text: errorText(error) }),
    });
  };

  const copyLink = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.deepLink);
      setCopied(true);
      setNotice({ kind: "success", text: "Telegram link copied." });
    } catch {
      setNotice({ kind: "error", text: "Clipboard access is unavailable. Use the Telegram button instead." });
    }
  };

  return (
    <section className="finance-panel telegram-reward-panel" aria-labelledby="telegram-reward-title">
      <div className="telegram-reward-heading">
        <div>
          <div className="panel-overline">Member reward</div>
          <h2 id="telegram-reward-title">Get $1 in Telegram</h2>
          <p>Link your signed-in ReplenishCC account, then message the bot from a Telegram account whose display name contains ReplenishCC.xyz. Telegram usernames cannot include periods, so this exact phrase can only match the display name.</p>
        </div>
        <div className="telegram-reward-amount"><Gift aria-hidden="true" /><span>$1.00</span></div>
      </div>
      <div className="telegram-reward-details">
        <p>Each ReplenishCC account and Telegram account can receive this reward once per rolling 24 hours. The secure link expires in 10 minutes; do not share it.</p>
        <button
          type="button"
          className="telegram-reward-generate"
          onClick={generateLink}
          disabled={createLink.isPending}
          data-testid="button-create-telegram-reward-link"
        >
          {createLink.isPending ? <LoaderCircle aria-hidden="true" className="telegram-reward-spinner" /> : <RefreshCw aria-hidden="true" />}
          {createLink.isPending ? "Creating link…" : link ? "Create a new link" : "Create Telegram reward link"}
        </button>
      </div>
      {notice && <div className={`portal-alert portal-alert-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"} data-testid={`status-telegram-reward-${notice.kind}`}>{notice.text}</div>}
      {link && (
        <div className="telegram-reward-link-result" data-testid="panel-telegram-reward-link">
          <div>
            <strong>Open @{link.botUsername} to claim</strong>
            <span>Link expires {formatExpiry(link.expiresAt)}.</span>
          </div>
          <div className="telegram-reward-actions">
            <a href={link.deepLink} target="_blank" rel="noreferrer" className="telegram-reward-open" data-testid="link-open-telegram-bot">
              Open Telegram <ArrowUpRight aria-hidden="true" />
            </a>
            <button type="button" className="telegram-reward-copy" onClick={copyLink} data-testid="button-copy-telegram-reward-link">
              {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}