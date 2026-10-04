import { ClipboardList, CreditCard, MessageSquare, Plus } from "lucide-react";
import "./_group.css";

export function BuyLogs() {
  return (
    <main className="balance-preview">
      <section className="balance-feature balance-feature-next" aria-labelledby="balance-preview-title">
        <div className="balance-feature-copy">
          <div className="section-kicker" id="balance-preview-title">Available balance</div>
          <strong className="balance-amount">$0.08</strong>
          <span className="balance-caption">Account overview · orders, deposits, and spend</span>
        </div>
        <nav className="balance-feature-actions" aria-label="Account shortcuts">
          <button type="button" className="balance-action balance-action-primary"><Plus aria-hidden="true" />Deposit</button>
          <button type="button" className="balance-action"><CreditCard aria-hidden="true" />Buy cards</button>
          <button type="button" className="balance-action"><ClipboardList aria-hidden="true" />Buy logs</button>
          <button type="button" className="balance-action"><MessageSquare aria-hidden="true" />Support</button>
        </nav>
      </section>
    </main>
  );
}