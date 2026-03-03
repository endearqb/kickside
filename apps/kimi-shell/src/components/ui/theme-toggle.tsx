import { MoonIcon, SunIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

type ThemeMode = "light" | "dark";

type ThemeToggleProps = {
  theme: ThemeMode;
  onToggle: () => void;
  className?: string;
};

export function ThemeToggle({ theme, onToggle, className }: ThemeToggleProps) {
  const isDark = theme === "dark";

  return (
    <Button
      type="button"
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className={className}
      onClick={onToggle}
      size="icon"
      variant="outline"
      icon={isDark ? <SunIcon size={16} /> : <MoonIcon size={16} />}
    />
  );
}
