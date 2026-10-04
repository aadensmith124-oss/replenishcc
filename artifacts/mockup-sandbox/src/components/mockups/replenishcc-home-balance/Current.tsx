import { ExternalLink, WalletCards } from "lucide-react";
import "./_group.css";

export function Current() {
  return (
    <main className="balance-preview">
      <section className="balance-feature balance-feature-current">
        <div className="balance-feature-copy">
          <div className="section-kicker">Available balance</div>
          <strong className="balance-amount">$0.08</strong>
          <span className="balance-caption">Current account balance</span>
        </div>
        <div className="balance-feature-mark"><WalletCards aria-hidden="true" /></div>
        <a href="#deposit-history" className="balance-history-link">
          View deposit history <ExternalLink aria-hidden="true" />
        </a>
        <div className="balance-metric"><span>Records in range</span><strong>2</strong></div>
        <div className="balance-metric"><span>Confirmed in range</span><strong>$0.08</strong></div>
      </section>
    </main>
  );
}