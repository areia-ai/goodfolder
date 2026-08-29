import { PlusIcon } from "@/components/icons";

export interface FaqItem {
  question: string;
  answer: string[];
  /** The first question is open on arrival — the page exists to answer it. */
  defaultOpen?: boolean;
}

/** Native disclosure elements: keyboard-operable and readable with no script. */
export function Faq({ items }: { items: FaqItem[] }) {
  return (
    <div className="mt-10">
      {items.map((item) => (
        <details key={item.question} className="gf-faq" name="goodfolder-faq" open={item.defaultOpen}>
          <summary>
            {item.question}
            <PlusIcon />
          </summary>
          <div className="gf-faq-answer">
            {item.answer.map((paragraph, i) => (
              <p key={i} className={i > 0 ? "mt-3" : ""}>
                {paragraph}
              </p>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}
