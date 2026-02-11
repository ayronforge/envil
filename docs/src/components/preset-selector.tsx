import { AnimatePresence, motion } from "motion/react";
import * as React from "react";

import { CopyButton } from "./copy-button";

interface PresetData {
  name: string;
  prefix: string;
  code: string;
  highlightedCode: string;
  iconLight: string;
  iconDark: string;
}

export function PresetSelector({ presets }: { presets: PresetData[] }) {
  const [selected, setSelected] = React.useState(0);
  const preset = presets[selected];

  return (
    <div>
      <div className="flex flex-wrap justify-center gap-2 mb-10">
        {presets.map((p, i) => {
          const isActive = i === selected;
          return (
            <button
              key={p.name}
              onClick={() => setSelected(i)}
              className={`relative flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors duration-200 cursor-pointer outline-none ${
                isActive ? "text-primary" : "text-muted hover:text-primary/70"
              }`}
            >
              {isActive && (
                <motion.div
                  layoutId="preset-pill"
                  className="absolute inset-0 rounded-xl glass-card"
                  style={{
                    borderColor: "rgba(234, 107, 62, 0.25)",
                    boxShadow: "0 0 20px rgba(234, 107, 62, 0.06)",
                  }}
                  transition={{ type: "spring", bounce: 0.15, duration: 0.4 }}
                />
              )}
              <span className="relative z-10 flex items-center gap-2.5 pointer-events-none">
                <span className="w-5 h-5 flex items-center justify-center shrink-0">
                  <img src={p.iconLight} alt="" className="w-4 h-4" data-theme-visible="light" />
                  <img
                    src={p.iconDark}
                    alt=""
                    className={`w-4 h-4${p.invertDark ? " brightness-0 invert" : ""}`}
                    data-theme-visible="dark"
                  />
                </span>
                <span>{p.name}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="max-w-2xl mx-auto">
        <div className="rounded-2xl overflow-hidden bg-[#0E1319] preset-code-block">
          <div className="flex items-center justify-between px-5 pt-4 pb-0">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-white/10" />
              <span className="w-2.5 h-2.5 rounded-full bg-white/10" />
              <span className="w-2.5 h-2.5 rounded-full bg-white/10" />
              <span className="text-[11px] text-white/20 ml-2 font-mono">env.ts</span>
            </div>
            <div className="flex items-center gap-2">
              <AnimatePresence mode="wait">
                <motion.span
                  key={preset.prefix}
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  transition={{ duration: 0.15 }}
                  className="text-[10px] font-mono text-white/30 px-2 py-0.5 rounded-md bg-white/[0.05] border border-white/[0.06]"
                >
                  {preset.prefix}
                </motion.span>
              </AnimatePresence>
              <CopyButton
                content={preset.code}
                variant="ghost"
                size="sm"
                className="text-white/30 hover:text-white/70"
              />
            </div>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={selected}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <pre className="px-5 py-4 text-[13px] leading-relaxed overflow-x-auto">
                <code
                  className="text-[#F1EDE4]/80"
                  dangerouslySetInnerHTML={{ __html: preset.highlightedCode }}
                />
              </pre>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
