"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/dialog";

/**
 * The questions the window has to ask before it changes a folder.
 *
 * Each is the same small card, and each says what happens next in the same
 * breath as the button that does it: a rename reaches the person's own
 * computers at the next Sync, and taking a file out does not lose it.
 */

export function RenameDialog(props: {
  name: string;
  kind: "file" | "folder";
  /** True for someone invited: this is asked of the owner, not done. */
  suggesting: boolean;
  onCancel: () => void;
  onRename: (name: string) => void;
}) {
  const [name, setName] = useState(props.name);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = field.current;
    if (!input) return;
    // Select the name and leave the extension alone: almost nobody means to
    // change ".png", and having to skip past it every time is a small tax on
    // the one thing this dialog is for.
    const dot = props.name.lastIndexOf(".");
    input.setSelectionRange(0, dot > 0 ? dot : props.name.length);
  }, [props.name]);

  const clean = name.trim();
  return (
    <Dialog
      open
      onClose={props.onCancel}
      initialFocus={field}
      title={props.suggesting ? "Suggest a new name" : "Rename"}
      description={props.suggesting
        ? `The folder's owner decides. The ${props.kind} keeps its name until they accept.`
        : `The ${props.kind} changes name here, and on your own computers at the next Sync.`}
      onSubmit={() => {
        if (clean && clean !== props.name) props.onRename(clean);
        else props.onCancel();
      }}
      actions={
        <>
          <button type="button" className="gf-button-secondary" onClick={props.onCancel}>Cancel</button>
          <button type="submit" className="gf-button-primary" disabled={!clean || clean === props.name}>
            {props.suggesting ? "Suggest" : "Rename"}
          </button>
        </>
      }
    >
      <label htmlFor="gf-rename" className="gf-label mt-4">Name</label>
      <input
        id="gf-rename"
        ref={field}
        value={name}
        onChange={(event) => setName(event.target.value)}
        className="gf-input"
      />
    </Dialog>
  );
}

export function RemoveDialog(props: {
  names: string[];
  /** True for someone invited: this is asked of the owner, not done. */
  suggesting: boolean;
  onCancel: () => void;
  onRemove: () => void;
}) {
  // Cancel holds the keyboard, so a key still travelling from the Delete
  // that opened this lands on the harmless half of the question.
  const cancel = useRef<HTMLButtonElement>(null);
  const many = props.names.length > 1;
  const shown = props.names.slice(0, 5);
  return (
    <Dialog
      open
      onClose={props.onCancel}
      initialFocus={cancel}
      width="26rem"
      title={props.suggesting
        ? many ? `Suggest taking ${props.names.length} files out?` : `Suggest taking “${props.names[0]}” out?`
        : many ? `Take ${props.names.length} files out?` : `Take “${props.names[0]}” out?`}
      description={props.suggesting ? (
        <>
          The folder&apos;s owner decides. {many ? "They stay" : "It stays"} where {many ? "they are" : "it is"}
          {" "}until {many ? "each one is" : "it is"} accepted.
        </>
      ) : (
        <>
          {many ? "They stop" : "It stops"} being part of the folder from the next Save on. Every earlier Save
          still holds {many ? "them" : "it"}, and going back to one brings {many ? "them" : "it"} with it.
        </>
      )}
      actions={
        <>
          <button ref={cancel} type="button" className="gf-button-secondary" onClick={props.onCancel}>Cancel</button>
          <button type="button" className="gf-button-primary" onClick={props.onRemove}>
            {props.suggesting ? "Suggest" : "Take out"}
          </button>
        </>
      }
    >
      {many && (
        <ul className="gf-faint mt-3 grid gap-0.5 font-mono text-[12px]">
          {shown.map((name) => <li key={name} className="gf-truncate">{name}</li>)}
          {props.names.length > shown.length && <li>and {props.names.length - shown.length} more</li>}
        </ul>
      )}
    </Dialog>
  );
}

export function DeleteFolderDialog(props: {
  name: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const [confirmation, setConfirmation] = useState("");
  const cancel = useRef<HTMLButtonElement>(null);
  const confirmed = confirmation === props.name;
  return (
    <Dialog
      open
      onClose={props.onCancel}
      initialFocus={cancel}
      busy={props.busy}
      width="27rem"
      title={<>Delete “{props.name}” forever?</>}
      description="This permanently deletes every Save, stored file, invitation, and comment in this GoodFolder. It does not delete a local copy that still exists on a computer. This cannot be undone."
      onSubmit={() => {
        if (confirmed && !props.busy) props.onDelete();
      }}
      actions={
        <>
          <button ref={cancel} type="button" className="gf-button-secondary" onClick={props.onCancel} disabled={props.busy}>
            Cancel
          </button>
          <button type="submit" className="gf-button-primary" disabled={!confirmed || props.busy}>
            {props.busy ? "Deleting…" : "Delete forever"}
          </button>
        </>
      }
    >
      <label htmlFor="gf-delete-folder" className="gf-label mt-4">Type {props.name} to confirm</label>
      <input
        id="gf-delete-folder"
        value={confirmation}
        onChange={(event) => setConfirmation(event.target.value)}
        className="gf-input"
        autoComplete="off"
        spellCheck={false}
        disabled={props.busy}
      />
      {props.error && <p className="mt-2 text-[13px] font-semibold" role="alert">{props.error}</p>}
    </Dialog>
  );
}

export function NameFolderDialog({ onCancel, onName }: { onCancel: () => void; onName: (name: string) => void }) {
  const [name, setName] = useState("");
  const field = useRef<HTMLInputElement>(null);
  return (
    <Dialog
      open
      onClose={onCancel}
      initialFocus={field}
      title="New folder"
      description="Start a brand-new empty folder here, then bring it down to a computer. To protect an existing folder on this computer, use the GoodFolder MCP or CLI there instead."
      onSubmit={() => {
        if (name.trim()) onName(name);
      }}
      actions={
        <>
          <button type="button" className="gf-button-secondary" onClick={onCancel}>Cancel</button>
          <button type="submit" className="gf-button-primary" disabled={!name.trim()}>Create</button>
        </>
      }
    >
      <label htmlFor="gf-new-folder" className="gf-label mt-4">Name</label>
      <input
        id="gf-new-folder"
        ref={field}
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Q3 Report"
        className="gf-input"
      />
    </Dialog>
  );
}

export function ChallengeCodeDialog(props: {
  code: string;
  onCode: (code: string) => void;
  busy: boolean;
  onCancel: () => void;
  onRedeem: () => void;
}) {
  const field = useRef<HTMLInputElement>(null);
  return (
    <Dialog
      open
      onClose={props.onCancel}
      initialFocus={field}
      busy={props.busy}
      width="28rem"
      title="Redeem challenge code"
      description="This gives your account full access for the WebMCP Challenge. It ends October 1; your folders remain yours."
      onSubmit={() => { if (!props.busy && props.code.trim()) props.onRedeem(); }}
      actions={
        <>
          <button type="button" className="gf-button-secondary" onClick={props.onCancel} disabled={props.busy}>Cancel</button>
          <button type="submit" className="gf-button-primary" disabled={props.busy || !props.code.trim()}>
            {props.busy ? "Checking…" : "Redeem"}
          </button>
        </>
      }
    >
      <label className="gf-label mt-4" htmlFor="challenge-code">Code</label>
      <input
        id="challenge-code"
        ref={field}
        className="gf-input"
        value={props.code}
        onChange={(event) => props.onCode(event.target.value)}
        disabled={props.busy}
      />
    </Dialog>
  );
}
