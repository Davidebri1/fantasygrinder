/**
 * Tiny utility to combine class names with `clsx` and resolve conflicts
 * via `tailwind-merge`. Used everywhere in place of ad-hoc string concatenation.
 */
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function fmtMoney(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function fmtDecimal(n: number, digits = 1): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtPercent(n: number, digits = 1): string {
  return `${n.toFixed(digits)}%`;
}
