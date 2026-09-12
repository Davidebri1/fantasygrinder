import { describe, expect, it } from "vitest";

import { cn, fmtDecimal, fmtMoney, fmtPercent } from "./utils";

describe("cn", () => {
  it("merges classes", () => {
    expect(cn("a", "b", "c")).toBe("a b c");
  });
  it("ignores falsy values", () => {
    expect(cn("a", undefined, false, null, "b")).toBe("a b");
  });
  it("resolves tailwind conflicts", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
  });
});

describe("formatters", () => {
  it("fmtMoney formats USD with no decimals", () => {
    expect(fmtMoney(5000)).toBe("$5,000");
    expect(fmtMoney(10500)).toBe("$10,500");
  });

  it("fmtDecimal respects digit count", () => {
    expect(fmtDecimal(2.123)).toBe("2.1");
    expect(fmtDecimal(2.123, 2)).toBe("2.12");
  });

  it("fmtPercent adds trailing %", () => {
    expect(fmtPercent(12.3)).toBe("12.3%");
    expect(fmtPercent(50)).toBe("50.0%");
  });
});
