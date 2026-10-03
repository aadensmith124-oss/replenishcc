import { useEffect, useRef, useState } from 'react';
import { ExternalLink, MessageCircle, X } from 'lucide-react';
import {
  getGetAnnouncementsQueryKey,
  useGetAnnouncements,
  type Announcement,
} from '@workspace/api-client-react';

function readDismissedPopups(storageKey: string): Set<string> {
  try {
    const value = window.localStorage.getItem(storageKey);
    const parsed: unknown = value ? JSON.parse(value) : [];
    return Array.isArray(parsed)
      ? new Set(parsed.filter((entry): entry is string => typeof entry === 'string'))
      : new Set();
  } catch {
    return new Set();
  }
}

function popupVersion(item: Announcement): string {
  return `${item.id}:${item.publishedAt}`;
}

function PopupDialog({ announcement, onDismiss }: { announcement: Announcement; onDismiss: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  if (!announcement.telegramUrl) return null;

  return (
    <dialog
      ref={dialogRef}
      className="telegram-popup-dialog"
      aria-labelledby="telegram-popup-title"
      aria-describedby="telegram-popup-message"
      onCancel={(event) => { event.preventDefault(); onDismiss(); }}
    >
      <div className="telegram-popup-top">
        <span className="telegram-popup-label"><MessageCircle aria-hidden="true" /> ReplenishCC on Telegram</span>
        <button type="button" className="telegram-popup-close" onClick={onDismiss} aria-label="Dismiss Telegram pop-up" data-testid="button-dismiss-telegram-popup">
          <X aria-hidden="true" />
        </button>
      </div>
      <h2 id="telegram-popup-title">{announcement.title}</h2>
      <p id="telegram-popup-message">{announcement.body}</p>
      <div className="telegram-popup-actions">
        <a
          className="telegram-popup-cta"
          href={announcement.telegramUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onDismiss}
          data-testid="link-telegram-channel"
        >
          Visit Telegram channel <ExternalLink aria-hidden="true" />
        </a>
        <button type="button" className="telegram-popup-secondary" onClick={onDismiss} data-testid="button-later-telegram-popup">
          Maybe later
        </button>
      </div>
    </dialog>
  );
}

export function TelegramAnnouncementPopup({ userId }: { userId: string }) {
  const storageKey = `replenishcc-dismissed-telegram-popups:${userId}`;
  const [dismissedVersions, setDismissedVersions] = useState<Set<string>>(
    () => readDismissedPopups(storageKey),
  );
  const announcements = useGetAnnouncements({
    query: {
      queryKey: getGetAnnouncementsQueryKey(),
      enabled: Boolean(userId),
      staleTime: 60_000,
      refetchInterval: 60_000,
      refetchOnWindowFocus: true,
    },
  });

  const activePopup = announcements.data?.announcements.find(
    (item) =>
      item.showAsPopup &&
      Boolean(item.telegramUrl) &&
      !dismissedVersions.has(popupVersion(item)),
  );

  const dismiss = (item: Announcement) => {
    const next = new Set(dismissedVersions);
    next.add(popupVersion(item));
    setDismissedVersions(next);
    try {
      window.localStorage.setItem(storageKey, JSON.stringify([...next]));
    } catch {
      // Keep the pop-up dismissed for this session when storage is unavailable.
    }
  };

  if (!activePopup) return null;
  return (
    <PopupDialog
      key={popupVersion(activePopup)}
      announcement={activePopup}
      onDismiss={() => dismiss(activePopup)}
    />
  );
}