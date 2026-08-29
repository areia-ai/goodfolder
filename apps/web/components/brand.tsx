/** GoodFolder identity primitives backed by the checked-in SVG masters. */

/* The wordmark masters are cropped to their ink, so a height of 1em means the
   letters are 1em tall. These two ratios are what hold the lockup together:
   the wordmark's ink height sits at 52% of the mark's box, and the gap at 18%.
   The mark's own glyph fills 74% of its square box, so 52% lands the letters at
   roughly seven tenths of the mark's VISIBLE height — big enough that the word
   reads as the mark's equal rather than as a caption beside it, and small
   enough that the mark still leads. Both are derived from the mark's size so no
   caller can drift them apart by hand. Raised from 0.46 on 2026-08-29. */
const WORDMARK_RATIO = 0.52;
const GAP_RATIO = 0.18;

export function BrandMark({
  size = 40,
  className = "",
  title = "GoodFolder",
  inverse = false,
}: {
  size?: number;
  className?: string;
  title?: string;
  inverse?: boolean;
}) {
  const labelled = Boolean(title);
  return (
    <img
      src={inverse ? "/brand/goodfolder-mark-inverse.svg" : "/brand/goodfolder-mark.svg"}
      width={size}
      height={size}
      className={className}
      alt={labelled ? title : ""}
      aria-hidden={labelled ? undefined : true}
    />
  );
}

/** Exact casing is part of the identity contract and must never be altered. */
export function BrandWordmark({
  className = "",
  title = "GoodFolder",
  inverse = false,
  height,
}: {
  className?: string;
  title?: string;
  inverse?: boolean;
  /** Cap height in pixels. Left off, the wordmark is 1em tall. */
  height?: number;
}) {
  const labelled = Boolean(title);
  return (
    <img
      src={inverse ? "/brand/goodfolder-wordmark-inverse.svg" : "/brand/goodfolder-wordmark.svg"}
      className={`gf-wordmark ${inverse ? "gf-wordmark-inverse" : ""} ${className}`}
      style={height ? { height: `${height}px` } : undefined}
      alt={labelled ? title : ""}
      aria-hidden={labelled ? undefined : true}
    />
  );
}

export function BrandLockup({
  size = 40,
  className = "",
  wordmarkClassName = "",
  title = "GoodFolder",
  inverse = false,
}: {
  size?: number;
  className?: string;
  wordmarkClassName?: string;
  title?: string;
  inverse?: boolean;
}) {
  return (
    <span
      className={`gf-lockup ${className}`}
      style={{ ["--gf-lockup-gap" as string]: `${Math.round(size * GAP_RATIO)}px` }}
      role="img"
      aria-label={title}
    >
      <BrandMark size={size} title="" inverse={inverse} />
      <BrandWordmark
        className={wordmarkClassName}
        height={Math.round(size * WORDMARK_RATIO * 10) / 10}
        title=""
        inverse={inverse}
      />
    </span>
  );
}
