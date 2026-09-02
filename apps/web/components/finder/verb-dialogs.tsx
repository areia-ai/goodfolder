"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The two questions the window has to ask before it changes a folder.
 *
 * Both are the same small card, and both say what happens next in the same
 * breath as the button that does it — a rename reaches the person's own
 * computers at the next Sync, and taking a file out does not lose it.
 */

function useEscape(onCancel: () => void) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCancel();
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onCancel]);
}

function Scrim({ onCancel, children }: { onCancel: () => void; children: React.ReactNode }) {
  return (
    <div
      className="gf-win-glance-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      {children}
    </div>
  );
}

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
  useEscape(props.onCancel);

  useEffect(() => {
    const input = field.current;
    if (!input) return;
    input.focus();
    // Select the name and leave the extension alone: almost nobody means to
    // change ".png", and having to skip past it every time is a small tax on
    // the one thing this dialog is for.
    const dot = props.name.lastIndexOf(".");
    input.setSelectionRange(0, dot > 0 ? dot : props.name.length);
  }, [props.name]);

  const clean = name.trim();
  return (
    <Scrim onCancel={props.onCancel}>
      <form
        className="gf-card gf-card-lg w-full max-w-[24rem] p-6"
        role="dialog"
        aria-modal="true"
        aria-label="Rename"
        onSubmit={(event) => {
          event.preventDefault();
          if (clean && clean !== props.name) props.onRename(clean);
          else props.onCancel();
        }}
      >
        <h2 className="text-[17px] font-bold tracking-[-.02em]">
          {props.suggesting ? "Suggest a new name" : "Rename"}
        </h2>
        <p className="gf-body mt-1.5 text-[13px]">
          {props.suggesting
            ? `The folder's owner decides. The ${props.kind} keeps its name until they accept.`
            : `The ${props.kind} changes name here, and on your own computers at the next Sync.`}
        </p>
        <label htmlFor="gf-rename" className="gf-label mt-4">Name</label>
        <input
          id="gf-rename"
          ref={field}
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="gf-input"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="gf-button-secondary" onClick={props.onCancel}>Cancel</button>
          <button type="submit" className="gf-button-primary" disabled={!clean || clean === props.name}>
            {props.suggesting ? "Suggest" : "Rename"}
          </button>
        </div>
      </form>
    </Scrim>
  );
}

export function RemoveDialog(props: {
  names: string[];
  /** True for someone invited: this is asked of the owner, not done. */
  suggesting: boolean;
  onCancel: () => void;
  onRemove: () => void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEscape(props.onCancel);
  // Cancel holds the keyboard, so a key still travelling from the Delete
  // that opened this lands on the harmless half of the question.
  useEffect(() => cancel.current?.focus(), []);
  const many = props.names.length > 1;
  const shown = props.names.slice(0, 5);
  return (
    <Scrim onCancel={props.onCancel}>
      <div
        className="gf-card gf-card-lg w-full max-w-[26rem] p-6"
        role="dialog"
        aria-modal="true"
        aria-label="Take out of the folder"
      >
        <h2 className="text-[17px] font-bold tracking-[-.02em]">
          {props.suggesting
            ? many ? `Suggest taking ${props.names.length} files out?` : `Suggest taking “${props.names[0]}” out?`
            : many ? `Take ${props.names.length} files out?` : `Take “${props.names[0]}” out?`}
        </h2>
        <p className="gf-body mt-1.5 text-[13px]">
          {props.suggesting ? (
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
        </p>
        {many && (
          <ul className="gf-faint mt-3 grid gap-0.5 font-mono text-[12px]">
            {shown.map((name) => <li key={name} className="gf-truncate">{name}</li>)}
            {props.names.length > shown.length && <li>and {props.names.length - shown.length} more</li>}
          </ul>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button ref={cancel} type="button" className="gf-button-secondary" onClick={props.onCancel}>Cancel</button>
          <button type="button" className="gf-button-primary" onClick={props.onRemove}>
            {props.suggesting ? "Suggest" : "Take out"}
          </button>
        </div>
      </div>
    </Scrim>
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
  useEscape(() => {
    if (!props.busy) props.onCancel();
  });
  useEffect(() => cancel.current?.focus(), []);

  const confirmed = confirmation === props.name;
  return (
    <Scrim onCancel={() => {
      if (!props.busy) props.onCancel();
    }}>
      <form
        className="gf-card gf-card-lg w-full max-w-[27rem] p-6"
        role="dialog"
        aria-modal="true"
        aria-label={`Delete ${props.name} forever`}
        onSubmit={(event) => {
          event.preventDefault();
          if (confirmed && !props.busy) props.onDelete();
        }}
      >
        <h2 className="text-[17px] font-bold tracking-[-.02em]">Delete “{props.name}” forever?</h2>
        <p className="gf-body mt-1.5 text-[13px]">
          This permanently deletes every Save, stored file, invitation, and comment in this GoodFolder. It does not
          delete a local copy that still exists on a computer. This cannot be undone.
        </p>
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
        <div className="mt-4 flex justify-end gap-2">
          <button ref={cancel} type="button" className="gf-button-secondary" onClick={props.onCancel} disabled={props.busy}>
            Cancel
          </button>
          <button type="submit" className="gf-button-primary" disabled={!confirmed || props.busy}>
            {props.busy ? "Deleting…" : "Delete forever"}
          </button>
        </div>
      </form>
    </Scrim>
  );
}
