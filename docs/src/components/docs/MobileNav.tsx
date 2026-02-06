import { Menu, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import type { NavSection } from "@/data/docs-nav";
import { Sidebar } from "./Sidebar";

interface MobileNavProps {
  sections: NavSection[];
  currentSlug: string;
}

export function MobileNav({ sections, currentSlug }: MobileNavProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    if (open) {
      document.body.style.overflow = "hidden";
      document.addEventListener("keydown", onKey);
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="lg:hidden inline-flex items-center justify-center size-9 rounded-lg hover:bg-primary/10 transition-colors cursor-pointer"
        aria-label="Open navigation"
      >
        <Menu className="size-5" />
      </button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-black/50 z-40 lg:hidden"
              onClick={() => setOpen(false)}
            />
            <motion.div
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="fixed top-0 left-0 bottom-0 w-72 bg-background border-r border-border z-50 lg:hidden overflow-y-auto"
            >
              <div className="flex items-center justify-between p-4 border-b border-border">
                <span className="font-display font-semibold text-sm">Navigation</span>
                <button
                  onClick={() => setOpen(false)}
                  className="inline-flex items-center justify-center size-8 rounded-lg hover:bg-primary/10 transition-colors cursor-pointer"
                  aria-label="Close navigation"
                >
                  <X className="size-4" />
                </button>
              </div>
              <div className="p-4" onClick={() => setOpen(false)}>
                <Sidebar sections={sections} currentSlug={currentSlug} />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
