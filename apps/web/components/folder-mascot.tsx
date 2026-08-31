import Image from "next/image";
import { BrandMark } from "@/components/brand";

const POSES = {
  hero: {
    src: "/brand/mascot/mascot-hero.png",
    width: 1312,
    height: 1199,
  },
  review: {
    src: "/brand/mascot/mascot-review.png",
    width: 1220,
    height: 1289,
  },
  wave: {
    src: "/brand/mascot/mascot-wave.png",
    width: 1242,
    height: 1266,
  },
  pixel: {
    src: "/brand/mascot/mascot-pixel.png",
    width: 512,
    height: 512,
  },
  moments: {
    src: "/brand/mascot/mascot-moments.png",
    width: 1448,
    height: 1086,
  },
} as const;

export type MascotPoseName = keyof typeof POSES;

/** Editorial mascot poses. The canonical mark remains the identity source. */
export function MascotPose({
  pose,
  className = "",
  priority = false,
}: {
  pose: MascotPoseName;
  className?: string;
  priority?: boolean;
}) {
  const asset = POSES[pose];
  return (
    <Image
      src={asset.src}
      width={asset.width}
      height={asset.height}
      alt=""
      aria-hidden="true"
      className={className}
      priority={priority}
      sizes="(max-width: 640px) 150px, 260px"
    />
  );
}

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
