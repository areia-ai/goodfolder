type IconProps = { className?: string };

/** One stroke weight, one grid, no fills — every UI icon is monochrome and
 *  inherits `currentColor` so it works on white, blue, and black surfaces. */
function Icon({ children, className = "" }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function ArrowLeftIcon(props: IconProps) {
  return <Icon {...props}><path d="M19 12H5" /><path d="m11 18-6-6 6-6" /></Icon>;
}

export function ArrowRightIcon(props: IconProps) {
  return <Icon {...props}><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></Icon>;
}

export function ChevronDownIcon(props: IconProps) {
  return <Icon {...props}><path d="m6 9 6 6 6-6" /></Icon>;
}

export function PlusIcon(props: IconProps) {
  return <Icon {...props}><path d="M12 5v14M5 12h14" /></Icon>;
}

export function SparklesIcon(props: IconProps) {
  return <Icon {...props}><path d="m12 3 1.2 4.3L17 9l-3.8 1.7L12 15l-1.2-4.3L7 9l3.8-1.7z" /><path d="m19 14 .6 2.4L22 17l-2.4.6L19 20l-.6-2.4L16 17l2.4-.6z" /></Icon>;
}

export function SearchIcon(props: IconProps) {
  return <Icon {...props}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></Icon>;
}

export function FolderIcon(props: IconProps) {
  return <Icon {...props}><path d="M3.5 8V6.8A1.8 1.8 0 0 1 5.3 5h3.9a1.8 1.8 0 0 1 1.4.7l1.2 1.6a1.8 1.8 0 0 0 1.4.7h5.5a1.8 1.8 0 0 1 1.8 1.8v7.4A1.8 1.8 0 0 1 18.7 19H5.3a1.8 1.8 0 0 1-1.8-1.8z" /></Icon>;
}

export function FileIcon(props: IconProps) {
  return <Icon {...props}><path d="M6 3.5h7.5L18 8v12.5H6z" /><path d="M13.5 3.5V8H18" /></Icon>;
}

export function DocumentIcon(props: IconProps) {
  return <Icon {...props}><path d="M6 3.5h7.5L18 8v12.5H6z" /><path d="M13.5 3.5V8H18" /><path d="M9 12.5h6M9 16h4" /></Icon>;
}

export function ClockIcon(props: IconProps) {
  return <Icon {...props}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 1.8" /></Icon>;
}

export function ProposalIcon(props: IconProps) {
  return <Icon {...props}><path d="M14.5 4.5h3.2a1.8 1.8 0 0 1 1.8 1.8V18a1.8 1.8 0 0 1-1.8 1.8H6.3A1.8 1.8 0 0 1 4.5 18V6.3a1.8 1.8 0 0 1 1.8-1.8h3.2" /><path d="M9.5 3.5h5v3h-5z" /><path d="m8.8 13 2 2 4.4-4.4" /></Icon>;
}

export function PeopleIcon(props: IconProps) {
  return <Icon {...props}><circle cx="10" cy="8.5" r="3.2" /><path d="M4 19.5c.8-3.2 3-4.7 6-4.7s5.2 1.5 6 4.7" /><path d="M16.5 6.2a3 3 0 0 1 0 5.6M18 15.2c1.4.6 2.3 1.9 2.7 3.6" /></Icon>;
}

export function SaveIcon(props: IconProps) {
  return <Icon {...props}><path d="M5 4.5h11L19.5 8v11.5h-15z" /><path d="M8 4.5v5h7v-5M8 16.5h8" /></Icon>;
}

export function SyncIcon(props: IconProps) {
  return <Icon {...props}><path d="M20 7.5v4.5h-4.5M4 16.5V12h4.5" /><path d="M5.8 10a6.7 6.7 0 0 1 11.4-2.4L20 10M4 14l2.8 2.4A6.7 6.7 0 0 0 18.2 14" /></Icon>;
}

export function RestoreIcon(props: IconProps) {
  return <Icon {...props}><path d="M4.5 6.5V11H9" /><path d="M5.6 11a7 7 0 1 1 1.2 5" /><path d="M12 8.5V12l2.8 1.7" /></Icon>;
}

export function TimelineIcon(props: IconProps) {
  return <Icon {...props}><path d="M7 4.5v15" /><circle cx="7" cy="8.5" r="1.8" /><circle cx="7" cy="15.5" r="1.8" /><path d="M11 8.5h8M11 15.5h5.5" /></Icon>;
}

export function CommentIcon(props: IconProps) {
  return <Icon {...props}><path d="M20 12.6c0 3.4-3.6 6.1-8 6.1a9.7 9.7 0 0 1-2.4-.3L5 20l1-3.2a5.7 5.7 0 0 1-2-4.2c0-3.4 3.6-6.1 8-6.1s8 2.7 8 6.1z" /></Icon>;
}

export function ShieldIcon(props: IconProps) {
  return <Icon {...props}><path d="M12 3.5 5 6.2v5.3c0 4 2.9 7.5 7 8.9 4.1-1.4 7-4.9 7-8.9V6.2z" /><path d="m9 12 2.2 2.2L15.5 10" /></Icon>;
}

export function CheckIcon(props: IconProps) {
  return <Icon {...props}><path d="m5 12.5 4.5 4.5L19 7.5" /></Icon>;
}

export function CheckCircleIcon(props: IconProps) {
  return <Icon {...props}><circle cx="12" cy="12" r="8.5" /><path d="m8.3 12.2 2.5 2.5 4.9-5" /></Icon>;
}

export function CircleIcon(props: IconProps) {
  return <Icon {...props}><circle cx="12" cy="12" r="8.5" /></Icon>;
}

export function CircleDotIcon(props: IconProps) {
  return <Icon {...props}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" /></Icon>;
}

export function AlertIcon(props: IconProps) {
  return <Icon {...props}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.8v4.6M12 16.1h.01" /></Icon>;
}

export function InfoIcon(props: IconProps) {
  return <Icon {...props}><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.2M12 7.9h.01" /></Icon>;
}

export function CrossCircleIcon(props: IconProps) {
  return <Icon {...props}><circle cx="12" cy="12" r="8.5" /><path d="m9.3 9.3 5.4 5.4M14.7 9.3l-5.4 5.4" /></Icon>;
}

export function LockIcon(props: IconProps) {
  return <Icon {...props}><rect x="4.8" y="10.5" width="14.4" height="9.2" rx="2" /><path d="M8.4 10.5V8a3.6 3.6 0 0 1 7.2 0v2.5" /></Icon>;
}

export function MailIcon(props: IconProps) {
  return <Icon {...props}><rect x="3.5" y="5.5" width="17" height="13" rx="2" /><path d="m4 7 8 5.5L20 7" /></Icon>;
}

export function ComputerIcon(props: IconProps) {
  return <Icon {...props}><rect x="3.5" y="5" width="17" height="11" rx="1.8" /><path d="M9 19.5h6M12 16v3.5" /></Icon>;
}

export function DownloadIcon(props: IconProps) {
  return <Icon {...props}><path d="M12 4v10" /><path d="m8 10 4 4 4-4" /><path d="M5 19.5h14" /></Icon>;
}

export function SignOutIcon(props: IconProps) {
  return <Icon {...props}><path d="M14 5.5H7A1.5 1.5 0 0 0 5.5 7v10A1.5 1.5 0 0 0 7 18.5h7" /><path d="M17 8.5 20.5 12 17 15.5M20 12h-9" /></Icon>;
}

/* --- Everyday file kinds -------------------------------------------------- */
/* One glyph per family the dashboard can open, drawn on the same grid so a
   row of them reads as a set rather than a pile of borrowed icons. */

export function ImageIcon(props: IconProps) {
  return <Icon {...props}><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><circle cx="8.75" cy="9.75" r="1.6" /><path d="m4 17 4.6-4.3a1.6 1.6 0 0 1 2.2 0L15 17" /><path d="m13.5 14.2 1.9-1.7a1.6 1.6 0 0 1 2.2 0L20 15" /></Icon>;
}

export function SheetIcon(props: IconProps) {
  return <Icon {...props}><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M3.5 9.5h17M3.5 14.5h17M9.5 9.5v10M15 9.5v10" /></Icon>;
}

export function SlidesIcon(props: IconProps) {
  return <Icon {...props}><rect x="3.5" y="4.5" width="17" height="11" rx="2" /><path d="M12 15.5v4M9 19.5h6" /></Icon>;
}

export function VideoIcon(props: IconProps) {
  return <Icon {...props}><rect x="3" y="5.5" width="12.5" height="13" rx="2" /><path d="m15.5 13 4.2 2.8a.7.7 0 0 0 1.1-.6V8.8a.7.7 0 0 0-1.1-.6L15.5 11z" /></Icon>;
}

export function AudioIcon(props: IconProps) {
  return <Icon {...props}><path d="M4 11v2M8 8.5v7M12 5.5v13M16 8.5v7M20 11v2" /></Icon>;
}

export function PdfIcon(props: IconProps) {
  return <Icon {...props}><path d="M6 3.5h7.5L18 8v12.5H6z" /><path d="M13.5 3.5V8H18" /><path d="M9 13.5h2a1.25 1.25 0 0 1 0 2.5H9v-2.5zM9 16v2.2" /><path d="M14 13.5v4.7" /></Icon>;
}

export function TerminalIcon(props: IconProps) {
  return <Icon {...props}><rect x="3" y="4.5" width="18" height="15" rx="2" /><path d="m7.5 10 2.5 2-2.5 2M13 15h4" /></Icon>;
}

export function DeviceIcon(props: IconProps) {
  return <Icon {...props}><rect x="2.5" y="5" width="14" height="10" rx="1.8" /><path d="M2.5 18.5h11" /><rect x="16.5" y="10.5" width="5" height="9" rx="1.4" /></Icon>;
}

export function NoteIcon(props: IconProps) {
  return <Icon {...props}><path d="M5 4.5h9.5L19 9v10.5H5z" /><path d="M8.5 9.5h5M8.5 13h6M8.5 16.5h3.5" /></Icon>;
}
