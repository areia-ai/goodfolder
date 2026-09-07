"use client";

import { useEffect, useRef, useState } from "react";
import { BrandMark } from "@/components/brand";
import { CheckIcon, DocumentIcon, RestoreIcon, SaveIcon } from "@/components/icons";

/** Illustrative local-agent workflow, not a live dashboard or automatic backup. */
const SCENES = [
  {
    label: "Save before", title: "Keep the version you have.",
    prompt: "Save Q3 Board Pack before we rewrite the summary.",
    reply: "Saved as #23. You can return to this version later.",
    status: "Saved version · #23", text: "We recommend a limited launch while the team completes customer testing.",
  },
  {
    label: "Let your agent work", title: "Give the rewrite a try.",
    prompt: "Make the summary more decisive, then Save it.",
    reply: "Saved as #24. Changed summary.md. The earlier version is still in the history.",
    status: "Agent’s rewrite · #24", text: "We recommend a full launch. The team is ready to expand to all customers.",
  },
  {
    label: "Preview the return", title: "The rewrite went too far.",
    prompt: "We’re not ready for a full launch. Preview undoing the latest Save.",
    reply: "The preview would bring back the limited-launch wording in summary.md. Your folder is unchanged so far.",
    status: "Restore preview · #23", text: "We recommend a limited launch while the team completes customer testing.",
  },
  {
    label: "Restore", title: "Bring back the earlier wording.",
    prompt: "Undo the latest Save to bring back the earlier wording.",
    reply: "Restored as a new Save, #25. The rewrite remains in the history too.",
    status: "Restored version · #25", text: "We recommend a limited launch while the team completes customer testing.",
  },
] as const;

export function RecoveryDemo() {
  const [scene, setScene] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [visible, setVisible] = useState(false);
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setPlaying(!preference.matches);
    update();
    preference.addEventListener("change", update);
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.25 });
    if (root.current) observer.observe(root.current);
    return () => { preference.removeEventListener("change", update); observer.disconnect(); };
  }, []);

  useEffect(() => {
    if (!playing || !visible) return;
    const timer = window.setTimeout(() => {
      if (scene === SCENES.length - 1) setPlaying(false);
      else setScene(scene + 1);
    }, 6500);
    return () => window.clearTimeout(timer);
  }, [playing, visible, scene]);

  const current = SCENES[scene];
  return (
    <figure ref={root} className="gf-recovery" aria-label="Illustrated example of saving and restoring a report with a local agent">
      <div className="gf-recovery__heading">
        <div><p className="gf-eyebrow">An example, from Save to Restore</p><h2 className="gf-h3 mt-2">Try the change. Keep a way back.</h2></div>
        <button type="button" className="gf-recovery__play" aria-label={playing ? "Pause example" : scene === SCENES.length - 1 ? "Replay example" : "Play example"} onClick={() => {
          if (!playing && scene === SCENES.length - 1) setScene(0);
          setPlaying(!playing);
        }}>
          <svg viewBox="0 0 24 24" aria-hidden="true">{playing ? <path d="M8 6v12M16 6v12" /> : <path d="m9 6 9 6-9 6Z" />}</svg>
        </button>
      </div>
      <div className="gf-recovery__steps" role="group" aria-label="Example steps">
        {SCENES.map((item, index) => <button key={item.label} type="button" aria-pressed={scene === index} onClick={() => { setScene(index); setPlaying(false); }}>
          <span>{index + 1}</span>{item.label}
        </button>)}
      </div>
      <div className="gf-recovery__workspace">
        <div className="gf-recovery__agent">
          <div className="gf-recovery__bar"><img src="/partners/codex.svg" alt="" width="20" height="20" /><b>Codex</b><span>On your computer</span></div>
          <div key={scene} className="gf-recovery__exchange">
            <p className="gf-recovery__prompt">{current.prompt}</p>
            <div className="gf-recovery__typing" aria-hidden="true"><i /><i /><i /></div>
            <p className="gf-recovery__reply">{current.reply}</p>
          </div>
          <div className="gf-recovery__composer">
            <span className="gf-recovery__composer-add">+</span>
            <span className="gf-recovery__approval"><span>⌘</span> Approve for me</span>
            <span className="gf-recovery__composer-spacer" />
            <span className="gf-recovery__model"><i />5.6 Sol <small>Light</small>⌄</span>
            <span className="gf-recovery__mic" aria-hidden="true">♩</span>
            <span className="gf-recovery__send" aria-hidden="true">↑</span>
          </div>
          <div className="gf-recovery__connected"><BrandMark size={19} title="" />GoodFolder connected</div>
        </div>
        <div className="gf-recovery__folder">
          <div className="gf-recovery__bar"><BrandMark size={22} title="" /><b>Q3 Board Pack</b></div>
          <div key={scene} className="gf-recovery__document">
            <div className="gf-recovery__filename"><DocumentIcon />summary.md<span>{current.status}</span></div>
            <h3>Launch recommendation</h3>
            <p className={scene === 1 ? "gf-recovery__changed" : ""}>{current.text}</p>
          </div>
          <div className="gf-recovery__history">
            <b>Folder history</b>
            <ol>
              {scene === 3 && <li className="gf-recovery__restored"><RestoreIcon /><span><b>#25 · Restored by Codex</b>Returned to the limited-launch wording</span><CheckIcon /></li>}
              {scene >= 1 && <li><SaveIcon /><span><b>#24 · Saved by Codex</b>Rewrote the launch recommendation</span></li>}
              <li><SaveIcon /><span><b>#23 · Saved by Codex</b>Kept the summary before the rewrite</span></li>
            </ol>
          </div>
        </div>
      </div>
      <figcaption><b>{current.title}</b><span>Save and Restore run through your agent on the computer holding the folder. Restore creates a new Save.</span></figcaption>
    </figure>
  );
}
