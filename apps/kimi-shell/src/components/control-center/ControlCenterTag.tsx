import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type ControlCenterTagProps = {
  children: ReactNode;
  className?: string;
};

export function ControlCenterTag({ children, className }: ControlCenterTagProps) {
  return <span className={cn("cc-tag", className)}>{children}</span>;
}
