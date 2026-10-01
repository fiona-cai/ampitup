"use client";

import { useState } from "react";
import RampIcon, { type RampIconName } from "./RampIcon";

export type RampSection = "context" | "policy" | "sources";

type Props = {
  reviewCount: number;
  selected: RampSection;
  onNavigate: (target: RampSection) => void;
  onSearch: () => void;
  onSection: (label: string) => void;
};

export default function RampSidebar({ reviewCount, selected, onNavigate, onSearch, onSection }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const navigate = (target: RampSection) => {
    onNavigate(target);
    setMobileOpen(false);
  };
  const section = (label: string) => {
    onSection(label);
    setMobileOpen(false);
  };

  return (
    <>
      <button
        type="button"
        className="mobile-menu-button icon-button"
        aria-label="Open navigation"
        aria-controls="ramp-navigation"
        aria-expanded={mobileOpen}
        onClick={() => setMobileOpen(true)}
      >
        <RampIcon name="menu" size={18} />
      </button>
      {mobileOpen && (
        <button type="button" className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />
      )}
      <aside id="ramp-navigation" className={`sidebar${collapsed ? " is-collapsed" : ""}${mobileOpen ? " is-open" : ""}`}>
        <div className="brand-row">
          <div className="ramp-brand" aria-label="Ramp">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="ramp-brand-mark">
              <path fill="#5d5e59" stroke="none" d="M20 15.5A8 8 0 0 1 8.5 4 8.3 8.3 0 1 0 20 15.5Z" />
            </svg>
          </div>
          <button
            type="button"
            className="collapse-button"
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((value) => !value)}
          >
            <RampIcon name="columns" size={17} />
          </button>
          <button type="button" className="mobile-close-button" aria-label="Close navigation" onClick={() => setMobileOpen(false)}>
            <RampIcon name="close" size={18} />
          </button>
        </div>

        <nav aria-label="Main navigation" className="nav-main">
          <NavItem icon="search" label="Search" onClick={() => { onSearch(); setMobileOpen(false); }}><span className="shortcut">⌘ K</span></NavItem>
          <NavItem icon="inbox" label="Inbox" onClick={() => section("Inbox")}><Badge count={167} /></NavItem>
          <NavItem icon="chart" label="Insights" onClick={() => section("Insights")} />
          <NavItem icon="card" label="My Ramp" onClick={() => section("My Ramp")}><Badge count={2} /></NavItem>
          <NavItem icon="coin" label="Expenses & travel" onClick={() => section("Expenses & travel")} />
          <NavItem icon="briefcase" label="Funds & cards" onClick={() => section("Funds & cards")} />

          <div className="accounting-group">
            <NavItem icon="card" label="Spend programs" onClick={() => navigate("context")} className="group-heading" />
            <div className="accounting-links">
              <button
                type="button"
                className={`nav-item subnav-item${selected === "context" ? " is-active" : ""}`}
                aria-current={selected === "context" ? "page" : undefined}
                title="Allot"
                onClick={() => navigate("context")}
              >
                <span className="nav-label">Allot</span>
                {reviewCount > 0 && <Badge count={reviewCount} />}
              </button>
              <button
                type="button"
                className={`nav-item subnav-item${selected === "policy" ? " is-active" : ""}`}
                aria-current={selected === "policy" ? "page" : undefined}
                title="Policy"
                onClick={() => navigate("policy")}
              >
                <span className="nav-label">Policy</span>
              </button>
              <button
                type="button"
                className={`nav-item subnav-item${selected === "sources" ? " is-active" : ""}`}
                aria-current={selected === "sources" ? "page" : undefined}
                title="Calendar sync"
                onClick={() => navigate("sources")}
              >
                <span className="nav-label">Calendar sync</span>
              </button>
            </div>
          </div>

          <NavItem icon="cart" label="Procurement" onClick={() => section("Procurement")} />
          <NavItem icon="coin" label="Bill Pay" onClick={() => section("Bill Pay")} />
          <NavItem icon="book" label="Accounting" onClick={() => section("Accounting")} />
          <NavItem icon="building" label="Company" onClick={() => section("Company")}><Badge count={1} /></NavItem>
          <NavItem icon="store" label="Vendors" onClick={() => section("Vendors")} />
        </nav>

        <nav aria-label="Support navigation" className="sidebar-bottom">
          <NavItem icon="settings" label="Settings" onClick={() => section("Settings")} />
          <NavItem icon="bell" label="Refer & earn" onClick={() => section("Refer & earn")} />
          <NavItem icon="user" label="Chat for help" onClick={() => section("Chat for help")} />
        </nav>
      </aside>
    </>
  );
}

function NavItem({ icon, label, onClick, children, className = "" }: {
  icon: RampIconName;
  label: string;
  onClick: () => void;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <button type="button" className={`nav-item ${className}`} onClick={onClick} title={label}>
      <RampIcon name={icon} size={15} className="nav-icon" />
      <span className="nav-label">{label}</span>
      {children}
    </button>
  );
}

function Badge({ count }: { count: number }) {
  return <span className="badge">{count}</span>;
}
