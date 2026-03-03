import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

type ButtonVariant = "default" | "outline" | "ghost" | "destructive";
type ButtonSize = "default" | "sm" | "icon" | "icon-sm";

const variantClassMap: Record<ButtonVariant, string> = {
  default: "ui-btn ui-btn-default",
  outline: "ui-btn ui-btn-outline",
  ghost: "ui-btn ui-btn-ghost",
  destructive: "ui-btn ui-btn-destructive",
};

const sizeClassMap: Record<ButtonSize, string> = {
  default: "ui-btn-size-default",
  sm: "ui-btn-size-sm",
  icon: "ui-btn-size-icon",
  "icon-sm": "ui-btn-size-icon-sm",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
};

export function Button({ className, variant = "default", size = "default", icon, children, ...props }: ButtonProps) {
  return (
    <button className={cn(variantClassMap[variant], sizeClassMap[size], className)} {...props}>
      {icon ? <span className="ui-btn-icon">{icon}</span> : null}
      {children}
    </button>
  );
}
