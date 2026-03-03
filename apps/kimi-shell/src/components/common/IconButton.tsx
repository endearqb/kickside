import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

type IconButtonProps = {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  className?: string;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
};

export function IconButton({
  icon,
  label,
  onClick,
  className,
  disabled,
  type = "button",
}: IconButtonProps) {
  const isGhost =
    className?.includes("ghost") || className?.includes("window-control-btn");

  return (
    <Button
      type={type}
      onClick={onClick}
      className={`icon-btn ${className ?? ""}`.trim()}
      disabled={disabled}
      aria-label={label}
      title={label}
      variant={isGhost ? "ghost" : "outline"}
      size="icon"
      icon={icon}
    />
  );
}
