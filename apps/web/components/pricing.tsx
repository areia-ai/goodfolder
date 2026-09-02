"use client";

import { useState, type CSSProperties } from "react";
import Link from "next/link";
import { CheckIcon, ArrowRightIcon } from "@/components/icons";

interface Tier {
  code: "starter" | "plus" | "studio";
  name: string;
  monthly: number;
  annual: number;
  includedGb: number;
  overageCents: number;
  blurb: string;
  features: string[];
  highlight?: boolean;
}

const TIERS: Tier[] = [
  {
    code: "starter", name: "Starter", monthly: 15, annual: 144, includedGb: 25, overageCents: 10,
    blurb: "For a folder of documents and photos. Light history, low churn.",
    features: ["25 GB of protected data", "Unlimited folders and contributors", "Extra capacity at $0.10 per GB-month"],
  },
  {
    code: "plus", name: "Plus", monthly: 29, annual: 278, includedGb: 100, overageCents: 10,
    blurb: "The one most people want. Room for photos, video, and an active agent.",
    features: ["100 GB of protected data", "Unlimited folders and contributors", "Extra capacity at $0.10 per GB-month", "No arbitrary history expiry"],
    highlight: true,
  },
  {
    code: "studio", name: "Studio", monthly: 79, annual: 758, includedGb: 300, overageCents: 8,
    blurb: "For heavy churn. A lot of generated media, replaced often.",
    features: ["300 GB of protected data", "Unlimited folders and contributors", "Extra capacity at $0.08 per GB-month", "Priority support"],
  },
];

const ROLL_STEP_MS = 100;
const ROLL_FRAME_MS = 180;

function RollingPrice({
  from,
  to,
  transitionKey,
  compact = false,
}: {
  from: number;
  to: number;
  transitionKey: number;
  compact?: boolean;
}) {
  const width = Math.max(String(from).length, String(to).length);
  const fromDigits = String(from).padStart(width, " ");
  const toDigits = String(to).padStart(width, " ");
  const shouldAnimate = transitionKey > 0 && from !== to;

  return (
    <strong aria-label={`$${to}`} className="gf-price-amount text-[38px] tracking-[-.04em]">
      <span className="gf-price-currency" aria-hidden="true">$</span>
      <span className={`gf-price-digits ${compact ? "gf-price-digits-compact" : ""}`} aria-hidden="true">
        {toDigits.split("").map((digit, index) => {
          const fromDigit = fromDigits[index];
          const fromNumber = Number(fromDigit);
          const toNumber = Number(digit);

          if (!shouldAnimate || fromDigit === digit || Number.isNaN(fromNumber) || Number.isNaN(toNumber)) {
            return (
              <span key={`${transitionKey}-${index}`} className="gf-price-digit">
                {digit}
              </span>
            );
          }

          const increasing = toNumber > fromNumber;
          const sequence = Array.from(
            { length: Math.abs(toNumber - fromNumber) + 1 },
            (_, offset) => fromNumber + (increasing ? offset : -offset),
          );
          const rollStyle = {
            animationDuration: `${ROLL_FRAME_MS}ms`,
          } as CSSProperties;

          return (
            <span key={`${transitionKey}-${index}`} className="gf-price-digit-window">
              {sequence.map((value, sequenceIndex) => (
                <span
                  key={value}
                  className={`gf-price-digit-frame ${increasing ? "is-increasing" : "is-decreasing"} ${
                    sequenceIndex === 0 ? "is-first" : ""
                  } ${sequenceIndex === sequence.length - 1 ? "is-last" : ""}`}
                  style={{
                    ...rollStyle,
                    animationDelay: `${sequenceIndex * ROLL_STEP_MS}ms`,
                  }}
                >
                  {value}
                </span>
              ))}
            </span>
          );
        })}
      </span>
    </strong>
  );
}

export function PricingTiers({ selfHostUrl }: { selfHostUrl: string }) {
  const [interval, setInterval] = useState<"month" | "year">("month");
  const [transitionKey, setTransitionKey] = useState(0);

  return (
    <div>
      <div className="mt-8 flex justify-center">
        <div className="inline-flex rounded-full border border-[var(--gf-line)] bg-white p-1" role="tablist" aria-label="Billing interval">
          {(["month", "year"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={interval === value}
              onClick={() => {
                if (value === interval) return;
                setInterval(value);
                setTransitionKey((key) => key + 1);
              }}
              className={`rounded-full px-4 py-1.5 text-[13.5px] font-medium transition ${
                interval === value ? "bg-[var(--gf-ink)] text-white" : "text-[var(--gf-ink-soft)]"
              }`}
            >
              {value === "month" ? (
                "Monthly"
              ) : (
                <>
                  <span>Yearly</span>
                  <span
                    className={`ml-1 align-middle text-[11px] font-semibold ${
                      interval === value ? "text-[var(--gf-blue)]" : "text-[var(--gf-blue-ink)]"
                    }`}
                  >
                    -20%
                  </span>
                </>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-8 grid gap-5 lg:grid-cols-3">
        {TIERS.map((tier) => {
          const price = interval === "month" ? tier.monthly : Math.round(tier.annual / 12);
          const previousPrice = interval === "month" ? Math.round(tier.annual / 12) : tier.monthly;
          return (
            <article
              key={tier.code}
              className={tier.highlight ? "gf-panel-dark relative p-7 sm:p-8" : "gf-card p-7 sm:p-8"}
            >
              {tier.highlight && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-[var(--gf-blue-ink)] px-3 py-1 text-[12px] font-semibold text-white">
                  Most popular
                </span>
              )}
              <p className={tier.highlight ? "gf-eyebrow gf-on-dark-faint" : "gf-eyebrow"}>{tier.name}</p>
              <div className="mt-4 flex items-end gap-3">
                <RollingPrice
                  from={previousPrice}
                  to={price}
                  transitionKey={transitionKey}
                  compact={tier.code === "starter"}
                />
                <span className={`pb-1 text-[14px] ${tier.highlight ? "gf-on-dark-faint" : "gf-faint"}`}>a month</span>
              </div>
              <p className={`mt-5 text-[14.5px] leading-relaxed ${tier.highlight ? "gf-on-dark" : "gf-body"}`}>{tier.blurb}</p>
              <ul className="mt-6 grid gap-2.5">
                {tier.features.map((line) => (
                  <li key={line} className="flex gap-2.5">
                    <CheckIcon className="gf-check" />
                    <span className={`text-[14px] ${tier.highlight ? "gf-on-dark" : "gf-body"}`}>{line}</span>
                  </li>
                ))}
              </ul>
              <Link
                href="/dashboard"
                className="gf-button-secondary mt-7"
              >
                {tier.highlight ? <>Start the 7-day trial <ArrowRightIcon /></> : "Start the 7-day trial"}
              </Link>
            </article>
          );
        })}
      </div>

      <div className="gf-card mx-auto mt-6 flex max-w-3xl flex-wrap items-center justify-between gap-4 p-5 sm:p-6">
        <div>
          <p className="gf-eyebrow">Self-hosted</p>
          <p className="gf-body mt-1 text-[14px]">
            Prefer to run it yourself? Free forever, unlimited, Docker Compose, AGPL.
          </p>
        </div>
        <a href={selfHostUrl} className="gf-button-secondary" target="_blank" rel="noreferrer">
          Read the source
        </a>
      </div>

      <p className="gf-body mx-auto mt-8 max-w-3xl text-center text-[14px]">
        Your current files and earlier versions stay protected without an arbitrary expiry date. We warn you before you reach the limit, and reaching it pauses new protection instead of deleting what is already there.
      </p>
    </div>
  );
}
