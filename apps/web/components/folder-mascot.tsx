import { BrandMark } from "@/components/brand";

/** Compatibility wrapper for existing callers while the final vector master is approved. */
export function FolderMascot({
  size = 180,
  className = "",
}: {
  size?: number;
  body?: string;
  tab?: string;
  glasses?: boolean;
  className?: string;
}) {
  return <BrandMark size={size} className={className} title="GoodFolder mascot" />;
}
