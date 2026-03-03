type ClassNameValue = string | false | null | undefined;

export function cn(...inputs: ClassNameValue[]): string {
  return inputs.filter(Boolean).join(" ");
}
