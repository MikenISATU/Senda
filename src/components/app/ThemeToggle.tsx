"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme, type ThemeChoice } from "@/lib/client/theme";

/** One-tap switch for the header. */
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const dark = theme === "dark";
  return (
    <button type="button" onClick={toggle} className="icon-btn" aria-label={dark ? "Switch to light mode" : "Switch to dark mode"} title={dark ? "Light mode" : "Dark mode"}>
      {dark ? <Sun size={19} aria-hidden /> : <Moon size={19} aria-hidden />}
    </button>
  );
}

const OPTIONS: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "Match device", icon: Monitor },
];

/** Three-way picker for Settings. */
export function ThemePicker() {
  const { choice, set } = useTheme();
  return (
    <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-2">
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const on = choice === value;
        return (
          <button key={value} type="button" role="radio" aria-checked={on} onClick={() => set(value)}
            className={`tap flex flex-col items-center justify-center gap-1.5 rounded-2xl px-2 py-3 text-sm font-semibold ring-1 transition-colors ${on ? "bg-cobalt-soft text-ink ring-cobalt" : "bg-cloud text-slate ring-line hover:text-ink"}`}>
            <Icon size={20} aria-hidden />{label}
          </button>
        );
      })}
    </div>
  );
}
