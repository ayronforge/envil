import { useEffect, useMemo, useState } from "react";

interface TocItem {
  depth: number;
  slug: string;
  text: string;
}

interface TableOfContentsProps {
  headings: TocItem[];
}

export function TableOfContents({ headings }: TableOfContentsProps) {
  const [activeId, setActiveId] = useState<string>("");

  const filtered = useMemo(
    () => headings.filter((h) => h.depth === 2 || h.depth === 3),
    [headings],
  );

  useEffect(() => {
    const elements = filtered
      .map((h) => document.getElementById(h.slug))
      .filter(Boolean) as HTMLElement[];

    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Find the topmost visible heading
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

        if (visible.length > 0) {
          setActiveId(visible[0].target.id);
        }
      },
      { rootMargin: "-80px 0px -60% 0px" },
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [filtered]);

  if (filtered.length === 0) return null;

  return (
    <nav className="text-sm">
      <h4 className="font-semibold text-xs uppercase tracking-wider text-muted mb-3">
        On this page
      </h4>
      <ul className="space-y-1 border-l border-border pb-8">
        {filtered.map((heading) => {
          const isActive = activeId === heading.slug;
          return (
            <li key={heading.slug}>
              <a
                href={`#${heading.slug}`}
                className={`block py-1 text-[13px] leading-snug transition-colors ${
                  heading.depth === 3 ? "pl-6" : "pl-3"
                } ${
                  isActive
                    ? "text-secondary border-l-2 border-secondary -ml-px font-medium"
                    : "text-muted hover:text-primary"
                }`}
              >
                {heading.text}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
