import Image from "next/image";

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

/** Editorial mascot poses. The canonical mark remains the identity source. */
export function MascotPose({
  pose,
  className = "",
  priority = false,
}: {
  pose: keyof typeof POSES;
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
