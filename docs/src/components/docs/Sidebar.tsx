import type { NavSection } from "@/data/docs-nav";

interface SidebarProps {
  sections: NavSection[];
  currentSlug: string;
  baseUrl: string;
}

export function Sidebar({ sections, currentSlug, baseUrl }: SidebarProps) {
  return (
    <nav className="space-y-6 text-sm">
      {sections.map((section) => (
        <div key={section.title}>
          <h4 className="font-semibold text-xs uppercase tracking-wider text-muted mb-2 px-3">
            {section.title}
          </h4>
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const href = item.slug === "" ? `${baseUrl}/docs` : `${baseUrl}/docs/${item.slug}`;
              const isActive = currentSlug === item.slug;
              return (
                <li key={item.slug}>
                  <a
                    href={href}
                    className={`block px-3 py-1.5 rounded-md transition-colors ${
                      isActive
                        ? "text-secondary font-medium border-l-2 border-secondary bg-secondary/5 -ml-px"
                        : "text-primary/70 hover:text-primary hover:bg-primary/5"
                    }`}
                  >
                    {item.title}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
