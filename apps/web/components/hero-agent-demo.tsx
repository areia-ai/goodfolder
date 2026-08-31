import { BrandMark } from "@/components/brand";
import {
  CheckIcon,
  ComputerIcon,
  FolderIcon,
  SaveIcon,
  SyncIcon,
  TerminalIcon,
  TimelineIcon,
} from "@/components/icons";

/** The on-screen story. Keeping the lines here makes the motion follow a script. */
export const HERO_AGENT_DEMO_SCRIPT = {
  durationSeconds: 20,
  codex: {
    prompt: "Set up GoodFolder for this folder so another agent can use its history.",
    reply: "Q3 Report is connected. The files stay on this Mac.",
  },
  handoff: {
    folder: "Q3 Report",
    route: "MCP on this Mac",
  },
  telegram: {
    prompt: "What changed in Q3 Report since the last Save?",
    reply: "Codex changed 3 files. The summary is updated, and 1 Change Proposal is waiting for you.",
  },
} as const;

function WindowDots() {
  return <span className="gf-demo-window-dots"><i /><i /><i /></span>;
}

function TelegramMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M21 4.2 17.9 19c-.2 1-1 1.2-1.8.7l-4.8-3.5-2.3 2.2c-.3.3-.5.5-1 .5l.3-4.9 9-8.1c.4-.4-.1-.6-.6-.2L5.6 12.8.8 11.3c-1-.3-1-1 .2-1.5L19.7 2.6c.9-.3 1.7.2 1.3 1.6Z" />
    </svg>
  );
}

function CodexNavIcon({ name }: { name: "new" | "pull" | "scheduled" | "plugins" | "explore" | "folder" | "voice" | "help" | "sidebar" | "bell" }) {
  const paths = {
    new: <><path d="M4 20h4l11-11-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4M12 4H6a2 2 0 0 0-2 2v6"/></>,
    pull: <><circle cx="6" cy="5" r="2"/><circle cx="18" cy="19" r="2"/><path d="M6 7v10a2 2 0 0 0 2 2h8M18 17V9a4 4 0 0 0-4-4h-2"/><path d="m14 2-2 3 2 3"/></>,
    scheduled: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l-3 2"/></>,
    plugins: <><path d="M8 8V5m8 3V5M7 8h10v3a5 5 0 0 1-10 0V8Z"/><path d="M12 16v4M9 20h6"/></>,
    explore: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
    folder: <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>,
    voice: <><path d="M5 10v4m4-7v10m4-13v16m4-12v8m4-6v4"/></>,
    help: <><circle cx="12" cy="12" r="9"/><path d="M9.8 9a2.4 2.4 0 1 1 3.3 2.2c-.8.4-1.1.9-1.1 1.8M12 17h.01"/></>,
    sidebar: <><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/></>,
    bell: <><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7"/><path d="M10 20h4"/></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function CodexWindow() {
  return (
    <section className="gf-demo-codex" aria-hidden="true">
      <div className="gf-demo-codex__titlebar">
        <WindowDots />
        <span className="gf-demo-codex__toolbar-icon"><CodexNavIcon name="sidebar" /></span>
        <span className="gf-demo-codex__crumb"><FolderIcon /> Open Q3 Report</span>
        <span className="gf-demo-codex__toolbar-spacer" />
        <span className="gf-demo-codex__quiet">Share</span>
        <span className="gf-demo-codex__toolbar-icon"><TimelineIcon /></span>
      </div>

      <div className="gf-demo-codex__body">
        <aside className="gf-demo-codex__sidebar">
          <div className="gf-demo-codex__sidebar-head"><b>Codex</b><span>⌄</span><i className="gf-demo-codex__search">⌕</i><i><CodexNavIcon name="bell" /></i></div>
          <nav className="gf-demo-codex__nav">
            <span><CodexNavIcon name="new" />New chat</span>
            <span><CodexNavIcon name="pull" />Pull requests</span>
            <span><CodexNavIcon name="scheduled" />Scheduled</span>
            <span><CodexNavIcon name="plugins" />Plugins</span>
            <span><CodexNavIcon name="explore" />Explore</span>
          </nav>
          <div className="gf-demo-codex__projects">
            <small>Projects</small>
            {['goodfolder', 'atlas-notes', 'northstar', 'studio-kit'].map((project, index) => (
              <span className={index === 0 ? 'is-active' : ''} key={project}><CodexNavIcon name="folder" />{project}</span>
            ))}
          </div>
          <div className="gf-demo-codex__account">
            <span className="gf-demo-codex__account-avatar">JS</span><b>johnsmit</b>
            <i><CodexNavIcon name="voice" /></i><i><CodexNavIcon name="help" /></i>
          </div>
        </aside>

        <div className="gf-demo-codex__conversation">
          <div className="gf-demo-codex__date">Today&nbsp; 6:57 PM</div>

          <div className="gf-demo-codex__prompt">
            <p>{HERO_AGENT_DEMO_SCRIPT.codex.prompt}</p>
          </div>

          <div className="gf-demo-codex__answer">
            <div className="gf-demo-codex__worked">Worked for 8s <span>›</span></div>
            <div className="gf-demo-codex__answer-rule" />
            <p className="gf-demo-codex__stream">
              {"Done. Q3 Report is connected to GoodFolder. The files stay on this Mac, and its history is available to the other agent through MCP.".split(" ").map((word, index) => (
                <span key={`${word}-${index}`} style={{ animationDelay: `${index * 55}ms` }}>{word} </span>
              ))}
            </p>
            <div className="gf-demo-codex__checks">
              <span><CheckIcon /> 7 files found</span>
              <span><SaveIcon /> Save #1 ready</span>
              <span><SyncIcon /> MCP available</span>
            </div>
          </div>

          <div className="gf-demo-codex__composer">
            <span className="gf-demo-codex__typed">{HERO_AGENT_DEMO_SCRIPT.codex.prompt}</span>
            <div className="gf-demo-codex__composer-controls">
              <div className="gf-demo-codex__composer-left">
                <i className="gf-demo-codex__add">+</i>
                <span className="gf-demo-codex__approval">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 4.5 6v5.6c0 4.4 2.8 7.5 7.5 9.4 4.7-1.9 7.5-5 7.5-9.4V6L12 3Z"/><path d="m9 10 2 2-2 2m4 0h2"/></svg>
                  Approve for me
                </span>
              </div>
              <div className="gf-demo-codex__composer-right">
                <span className="gf-demo-codex__model-dot" />
                <span className="gf-demo-codex__model"><b>5.6 Sol</b><small>Light</small><em>⌄</em></span>
                <svg className="gf-demo-codex__mic" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3m-3 0h6"/></svg>
                <i className="gf-demo-codex__send">↑</i>
              </div>
            </div>
          </div>
        </div>

        <aside className="gf-demo-codex__environment">
          <div className="gf-demo-codex__environment-head"><span>Environment</span><b>+</b></div>
          <div className="gf-demo-codex__environment-row"><ComputerIcon /><span>Local</span><b>⌄</b></div>
          <div className="gf-demo-codex__environment-row"><FolderIcon /><span>Q3 Report</span></div>
          <div className="gf-demo-codex__environment-row is-connected"><BrandMark size={18} title="" /><span>GoodFolder</span><b>Connected</b></div>
          <div className="gf-demo-codex__environment-rule" />
          <small>Background</small>
          <div className="gf-demo-codex__process"><TerminalIcon /><span>goodfolder connect</span></div>
        </aside>
      </div>
    </section>
  );
}

function ConnectionBridge() {
  return (
    <div className="gf-demo-bridge" aria-hidden="true">
      <svg className="gf-demo-bridge__lines" viewBox="0 0 1000 560" preserveAspectRatio="none">
        <path className="gf-demo-bridge__line gf-demo-bridge__line--left" d="M200 280 C330 280 355 280 500 280" />
        <path className="gf-demo-bridge__line gf-demo-bridge__line--right" d="M500 280 C645 280 670 280 800 280" />
        <circle className="gf-demo-bridge__packet gf-demo-bridge__packet--left" r="7">
          <animateMotion dur="1.6s" repeatCount="indefinite" path="M200 280 C330 280 355 280 500 280" />
        </circle>
        <circle className="gf-demo-bridge__packet gf-demo-bridge__packet--right" r="7">
          <animateMotion dur="1.6s" begin=".45s" repeatCount="indefinite" path="M500 280 C645 280 670 280 800 280" />
        </circle>
      </svg>

      <div className="gf-demo-bridge__local-label"><ComputerIcon /><span><b>Codex</b><small>local agent</small></span></div>
      <div className="gf-demo-bridge__cloud-label"><TelegramMark /><span><b>OpenClaw</b><small>cloud agent</small></span></div>

      <div className="gf-demo-bridge__folder">
        <span className="gf-demo-bridge__folder-mark"><BrandMark size={42} title="" /></span>
        <span><b>{HERO_AGENT_DEMO_SCRIPT.handoff.folder}</b><small>{HERO_AGENT_DEMO_SCRIPT.handoff.route}</small></span>
        <i><CheckIcon /></i>
      </div>
    </div>
  );
}

function TelegramWindow() {
  return (
    <section className="gf-demo-telegram" aria-hidden="true">
      <div className="gf-demo-telegram__menubar">
        <span className="gf-demo-telegram__apple"></span>
        <b>Telegram</b>
        <span>File</span><span>Edit</span><span>Window</span>
      </div>
      <div className="gf-demo-telegram__window">
        <div className="gf-demo-telegram__titlebar">
          <WindowDots />
          <b>OpenClaw – (617)</b>
        </div>
        <div className="gf-demo-telegram__body">
          <aside className="gf-demo-telegram__avatars">
            <span className="gf-demo-telegram__hamburger">☰</span>
            <span className="gf-demo-telegram__avatar">GF</span>
            <span className="gf-demo-telegram__avatar is-active"><img src="/partners/openclaw.svg" alt="" /></span>
            <span className="gf-demo-telegram__avatar">OC</span>
            <span className="gf-demo-telegram__avatar"><TelegramMark /></span>
          </aside>

          <div className="gf-demo-telegram__chat">
            <div className="gf-demo-telegram__chat-head">
              <span><b>OpenClaw</b><small>bot</small></span>
              <span className="gf-demo-telegram__chat-actions">⌕ ◫ ⋮</span>
            </div>

            <div className="gf-demo-telegram__messages">
              <div className="gf-demo-telegram__date">Today</div>

              <div className="gf-demo-telegram__user-message">
                <p>{HERO_AGENT_DEMO_SCRIPT.telegram.prompt}</p>
                <small>10:42 ✓✓</small>
              </div>

              <div className="gf-demo-telegram__typing" aria-hidden="true"><i /><i /><i /></div>

              <div className="gf-demo-telegram__bot-message">
                <div className="gf-demo-telegram__quote">
                  <b>John Smith</b>
                  <span>{HERO_AGENT_DEMO_SCRIPT.telegram.prompt}</span>
                </div>
                <p>{HERO_AGENT_DEMO_SCRIPT.telegram.reply}</p>
                <div className="gf-demo-telegram__tool"><TimelineIcon /><span>get_timeline · Q3 Report</span><CheckIcon /></div>
                <small>10:42</small>
              </div>
            </div>

            <div className="gf-demo-telegram__composer">
              <b>Menu</b><span>⌕</span>
              <p><span className="gf-demo-telegram__composer-placeholder">Write a message…</span><span className="gf-demo-telegram__composer-typed">{HERO_AGENT_DEMO_SCRIPT.telegram.prompt}</span></p>
              <i className="gf-demo-telegram__send"><TelegramMark /></i>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function HeroAgentDemo() {
  return (
    <div
      className="gf-hero-demo"
      role="img"
      aria-label="An animated example showing Codex connecting the Q3 Report folder to GoodFolder on a Mac, then OpenClaw reading the same GoodFolder history through Telegram and MCP."
    >
      <span className="sr-only">
        Codex connects Q3 Report to GoodFolder on the computer holding the files. GoodFolder exposes that folder history
        through MCP, allowing OpenClaw in Telegram to answer what changed without moving the folder to the cloud.
      </span>
      <div className="gf-hero-demo__ambient" aria-hidden="true"><i /><i /><i /></div>
      <CodexWindow />
      <ConnectionBridge />
      <TelegramWindow />
    </div>
  );
}
