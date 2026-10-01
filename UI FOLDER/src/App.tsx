import { useMemo, useState, type ReactNode } from "react";

type IconName =
  | "accounting"
  | "bell"
  | "building"
  | "calendar"
  | "card"
  | "chevron"
  | "close"
  | "columns"
  | "expenses"
  | "filter"
  | "funds"
  | "gear"
  | "inbox"
  | "insights"
  | "menu"
  | "moon"
  | "plus"
  | "procurement"
  | "search"
  | "spark"
  | "trash"
  | "user"
  | "vendors";

const paths: Record<IconName, ReactNode> = {
  accounting: <><path d="M4 5.5h5a3 3 0 0 1 3 3v9a3 3 0 0 0-3-3H4z"/><path d="M20 5.5h-5a3 3 0 0 0-3 3v9a3 3 0 0 1 3-3h5z"/></>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></>,
  building: <><path d="M4 21V3h12v18"/><path d="M16 9h4v12M8 7h4M8 11h4M8 15h4M2 21h20"/></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></>,
  card: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/></>,
  chevron: <path d="m8 10 4 4 4-4"/>,
  close: <><path d="m7 7 10 10M17 7 7 17"/></>,
  columns: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/></>,
  expenses: <><circle cx="12" cy="12" r="9"/><path d="M12 7v10M15 9.5c-.7-.8-1.7-1.2-3-1.2-1.7 0-2.8.8-2.8 2s1.1 1.8 2.8 2.1c1.8.3 2.8.9 2.8 2.1s-1.1 2-2.8 2c-1.3 0-2.5-.5-3.2-1.3"/></>,
  filter: <path d="M4 6h16l-6.2 7.2V19l-3.6-2v-3.8z"/>,
  funds: <><rect x="3" y="7" width="18" height="13" rx="2"/><path d="m5 7 3-4h10l2 4M7 12h10M7 16h6"/></>,
  gear: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
  inbox: <><path d="M4 5h16l2 9v5H2v-5z"/><path d="M2 14h5l2 3h6l2-3h5"/></>,
  insights: <><path d="M5 19V9M12 19V4M19 19v-7"/></>,
  menu: <><path d="M4 7h16M4 12h16M4 17h16"/></>,
  moon: <path d="M20 15.5A8 8 0 0 1 8.5 4 8.3 8.3 0 1 0 20 15.5Z"/>,
  plus: <path d="M12 5v14M5 12h14"/>,
  procurement: <><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/><path d="M3 4h2l2.5 11h10l2-7H7"/></>,
  search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
  spark: <path d="m13 2-7 11h6l-1 9 7-12h-6z"/>,
  trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6"/></>,
  user: <><circle cx="12" cy="8" r="3"/><path d="M6 20v-2a6 6 0 0 1 12 0v2"/></>,
  vendors: <><path d="M4 9h16v11H4zM2 9l3-5h14l3 5"/><path d="M9 20v-6h6v6"/></>,
};

function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg aria-hidden="true" className="icon" height={size} viewBox="0 0 24 24" width={size}>
      {paths[name]}
    </svg>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return <span className="badge">{children}</span>;
}

function NavItem({
  badge,
  children,
  icon,
}: {
  badge?: string;
  children: ReactNode;
  icon?: IconName;
}) {
  return (
    <div className="nav-item">
      {icon ? <Icon name={icon} size={15} /> : <span className="nav-indent" />}
      <span>{children}</span>
      {badge && <Badge>{badge}</Badge>}
    </div>
  );
}

function IconButton({ children, label, onClick }: { children: ReactNode; label: string; onClick?: () => void }) {
  return <button aria-label={label} className="icon-button" onClick={onClick}>{children}</button>;
}

type Status = "review" | "live" | "matched" | "declined" | "skipped";

const initialRows: {
  id: number; event: string; meta: string; guests: string; budget: number | null; reason: string;
  window: string; status: Status; logo: string; kind: string; ai: boolean; lowConfidence?: boolean; charge?: string;
}[] = [
  { id: 1, event: "Dinner with Acme", meta: "Tue, Oct 6 · 7:00 PM · Carbone, NYC", guests: "4 guests", budget: 240, reason: "Client dinner for 4 in Manhattan; clamped to $60/guest cap", window: "6:30 PM – 11:00 PM", status: "review", logo: "ac", kind: "sg", ai: true },
  { id: 2, event: "Lunch between sessions", meta: "Wed, Oct 7 · 12:30 PM · Midtown", guests: "Solo", budget: 25, reason: "Solo lunch; conference catering ends at noon", window: "12:00 PM – 2:00 PM", status: "declined", logo: "", kind: "amazon", ai: true, charge: "$90.00 declined" },
  { id: 3, event: "Airport transfer", meta: "Mon, Oct 5 · 4:15 PM · JFK → Hotel", guests: "Solo", budget: 85, reason: "Rideshare JFK to Midtown at rush hour", window: "3:30 PM – 7:00 PM", status: "matched", logo: "", kind: "delta", ai: true, charge: "Matched · $71.40" },
  { id: 4, event: "Catch up with Jordan", meta: "Wed, Oct 7 · 5:00 PM · TBD", guests: "1 guest", budget: 30, reason: "Vague event, low confidence; falls back to standard per diem", window: "4:30 PM – 8:00 PM", status: "review", logo: "jd", kind: "zoom", ai: true, lowConfidence: true },
  { id: 5, event: "Breakfast with Northwind", meta: "Thu, Oct 8 · 8:00 AM · Ace Hotel", guests: "2 guests", budget: 75, reason: "Prospect breakfast for 3; under $25/guest cap", window: "7:30 AM – 10:00 AM", status: "review", logo: "nw", kind: "sg", ai: true },
  { id: 6, event: "Team standup", meta: "Daily · 9:00 AM · Zoom", guests: "Internal", budget: null, reason: "Internal recurring meeting", window: "—", status: "skipped", logo: "zoom", kind: "zoom", ai: false },
  { id: 7, event: "Conference lunch", meta: "Tue, Oct 6 · 12:00 PM · Javits Center", guests: "Catered", budget: null, reason: "Catered by organizer", window: "—", status: "skipped", logo: "", kind: "amazon", ai: false },
  { id: 8, event: "Focus block", meta: "Wed, Oct 7 · 2:00 PM", guests: "Solo", budget: null, reason: "No spend expected", window: "—", status: "skipped", logo: "fb", kind: "delta", ai: false },
];

const tabFilter: Record<string, (s: Status) => boolean> = {
  Overview: () => true,
  "Needs review": (s) => s === "review",
  Live: (s) => s === "live" || s === "matched" || s === "declined",
  "No budget": (s) => s === "skipped",
};

function MerchantLogo({ kind, logo }: { kind: string; logo: string }) {
  return (
    <div className={`merchant-logo ${kind}`}>
      {kind === "amazon" && <span className="amazon-smile" />}
      {kind === "delta" && <span className="delta-mark" />}
      {logo}
    </div>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState("Overview");
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState<string | null>("Budgets clamped to policy caps · 3 need review");
  const [filterOn, setFilterOn] = useState(true);
  const [rows, setRows] = useState(initialRows);

  const setStatus = (id: number, status: Status, message: string) => {
    setRows(rows.map((row) => (row.id === id ? { ...row, status } : row)));
    setToast(message);
  };

  const filteredRows = useMemo(
    () => rows.filter((row) => tabFilter[activeTab](row.status) && `${row.event} ${row.meta} ${row.reason}`.toLowerCase().includes(query.toLowerCase())),
    [rows, activeTab, query],
  );
  const count = (tab: string) => String(rows.filter((row) => tabFilter[tab](row.status)).length);
  const budgeted = filteredRows.reduce((sum, row) => sum + (row.budget ?? 0), 0);

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-row">
          <Icon name="moon" size={20} />
          <Icon name="columns" size={14} />
        </div>
        <nav className="nav-main" aria-label="Main navigation">
          <NavItem icon="search">Search <span className="shortcut">⌘&nbsp; K</span></NavItem>
          <NavItem badge="167" icon="inbox">Inbox</NavItem>
          <NavItem icon="insights">Insights</NavItem>
          <NavItem badge="2" icon="card">My Ramp</NavItem>
          <NavItem icon="expenses">Expenses &amp; travel</NavItem>
          <NavItem icon="funds">Funds &amp; cards</NavItem>
          <div className="accounting-group">
            <NavItem icon="card">Spend programs</NavItem>
            <div className="accounting-links">
              <NavItem badge={count("Needs review")}>ContextCard</NavItem>
              <NavItem>Policy</NavItem>
              <NavItem>Calendar sync</NavItem>
            </div>
          </div>
          <NavItem icon="procurement">Procurement</NavItem>
          <NavItem icon="expenses">Bill Pay</NavItem>
          <NavItem icon="accounting">Accounting</NavItem>
          <NavItem badge="1" icon="building">Company</NavItem>
          <NavItem icon="vendors">Vendors</NavItem>
        </nav>
        <div className="sidebar-bottom">
          <NavItem icon="gear">Settings</NavItem>
          <NavItem icon="bell">Refer &amp; earn</NavItem>
          <NavItem icon="user">Chat for help</NavItem>
        </div>
      </aside>

      <section className="workspace">
        <header className="page-header">
          <div className="eyebrow">Spend programs · ContextCard</div>
          <div className="title-row">
            <div className="page-title">NYC client trip</div>
            <span className="title-count">Oct 5 – 8 · {rows.length} events synced</span>
          </div>
          {toast && (
            <div className="toast">
              <span>{toast}</span>
              <IconButton label="Dismiss notification" onClick={() => setToast(null)}><Icon name="close" size={21} /></IconButton>
            </div>
          )}
        </header>

        <div className="tabs" role="tablist" aria-label="Event budget status">
          {Object.keys(tabFilter).map((label) => (
            <button
              aria-selected={activeTab === label}
              className={`tab ${activeTab === label ? "active" : ""}`}
              key={label}
              onClick={() => setActiveTab(label)}
              role="tab"
            >
              {label} <span className="tab-count">{count(label)}</span>
            </button>
          ))}
        </div>

        <div className="controls">
          <label className="search-box">
            <Icon name="search" size={15} />
            <input aria-label="Search events" onChange={(event) => setQuery(event.target.value)} placeholder="Search events..." value={query} />
          </label>
          <div className="control-row">
            <div className="filter-pills">
              <div className="locked-filter"><span className="lock">♙</span> Calendar <span>Google · fiona@ramp.com</span></div>
              <button className="filter-button" onClick={() => setFilterOn(!filterOn)}><Icon name="plus" size={14} /> Filter</button>
            </div>
            <div className="view-actions">
              <IconButton label="Filters"><Icon name="filter" size={15} /><span className="tiny-count">{filterOn ? "1" : "0"}</span></IconButton>
              <IconButton label="Calendar"><Icon name="calendar" size={16} /></IconButton>
              <IconButton label="Cards view"><Icon name="card" size={16} /></IconButton>
              <IconButton label="Delete"><Icon name="trash" size={16} /></IconButton>
              <button className="options-button">Options <Icon name="chevron" size={14} /></button>
            </div>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="check-col"><input aria-label="Select all" type="checkbox" /></th>
                <th className="merchant-col">Event</th>
                <th>Budget</th>
                <th>Reason</th>
                <th>Card window</th>
                <th className="small-col">Approve</th>
                <th className="actions-col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr className={row.status === "skipped" ? "skipped" : ""} key={row.id}>
                  <td className="check-col"><input aria-label={`Select ${row.event}`} type="checkbox" /></td>
                  <td>
                    <div className="merchant-cell">
                      <MerchantLogo kind={row.kind} logo={row.logo} />
                      <div className="merchant-copy">
                        <div>{row.event}</div>
                        <small>
                          <span className={row.lowConfidence || row.status === "declined" ? "flagged" : ""}>
                            {row.lowConfidence ? "Low confidence" : row.status === "skipped" ? "No budget" : row.status === "declined" ? "Charge declined" : ""}
                          </span>
                          {(row.lowConfidence || row.status === "skipped" || row.status === "declined") ? " · " : ""}{row.meta}
                        </small>
                      </div>
                      <div className="row-indicator">
                        {row.status === "skipped" ? <span className="clock">◷</span> : <Icon name="user" size={17} />}
                        {row.status !== "skipped" && <sup>{row.guests === "Solo" ? "1" : row.guests.split(" ")[0]}</sup>}
                      </div>
                    </div>
                  </td>
                  <td><div className="department">{row.ai && <Icon name="spark" size={15} />}{row.budget === null ? "—" : `$${row.budget}`}</div></td>
                  <td className="reason">{row.reason}</td>
                  <td>{row.window}</td>
                  <td className="small-col">
                    {row.status !== "skipped" && (
                      <input
                        aria-label={`Approve ${row.event}`}
                        checked={row.status !== "review"}
                        disabled={row.status === "matched" || row.status === "declined"}
                        onChange={(event) => setStatus(row.id, event.target.checked ? "live" : "review", event.target.checked ? `${row.event} is now a $${row.budget} Ramp limit` : `${row.event} moved back to review`)}
                        type="checkbox"
                      />
                    )}
                  </td>
                  <td className="actions-col">
                    {row.status === "review" && <>Needs review. <button className="undo" onClick={() => setStatus(row.id, "live", `${row.event} is now a $${row.budget} Ramp limit`)}>Approve</button></>}
                    {row.status === "live" && <>Live · self-closing. <button className="undo" onClick={() => setStatus(row.id, "review", `${row.event} moved back to review`)}>Undo</button></>}
                    {(row.status === "matched" || row.status === "declined") && <span className={row.status === "declined" ? "flagged" : ""}>{row.charge}</span>}
                    {row.status === "skipped" && <span>Skipped by Jev</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredRows.length === 0 && <div className="empty-state">No matching events</div>}
        </div>

        <footer className="table-footer">
          <button className="select-footer">Select <Icon name="chevron" size={13} /></button>
          <div>1 – {filteredRows.length} of {filteredRows.length} events&nbsp;&nbsp; · &nbsp;&nbsp;${budgeted.toFixed(2)} budgeted vs $400.00 flat per diem&nbsp;&nbsp; · &nbsp;&nbsp;0 reimbursements</div>
        </footer>
      </section>
    </main>
  );
}
