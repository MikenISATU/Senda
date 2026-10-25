import { describe, expect, it } from "vitest";
import { formatAmount, fromStroops, splitFee, toSdkAmount, toStroops } from "@/lib/stellar/amount";

describe("amount", () => {
  it("parses exact decimals to stroops", () => {
    expect(toStroops("1")).toBe(10_000_000n);
    expect(toStroops("0.0000001")).toBe(1n);
    expect(toStroops("12.5")).toBe(125_000_000n);
    expect(toStroops("999999999999.9999999")).toBe(9_999_999_999_999_999_999n);
  });
  it("rejects unsafe input", () => {
    for (const bad of ["", "-1", "1e5", "0.00000001", "1,000", " ", "01", "abc", "1.", ".5", "1000000000000"]) {
      expect(() => toStroops(bad)).toThrow();
    }
  });
  it("round-trips", () => {
    for (const s of ["0", "1", "0.1", "123.4567891", "5000"]) expect(fromStroops(toStroops(s))).toBe(s);
    expect(toSdkAmount(1n)).toBe("0.0000001");
  });
  it("fee split conserves value and floors the fee", () => {
    for (const [amt, bps] of [[1n, 250], [999n, 250], [10_000_000n, 250], [123_456_789n, 1000], [5n, 0]] as const) {
      const { net, fee } = splitFee(amt, bps);
      expect(net + fee).toBe(amt);
      expect(fee).toBe((amt * BigInt(bps)) / 10_000n);
    }
    expect(() => splitFee(1n, 10_001)).toThrow();
    expect(() => splitFee(-1n, 1)).toThrow();
  });
  it("formats", () => {
    expect(formatAmount("1234567.891", 2)).toBe("1,234,567.89");
    expect(formatAmount(10_000_000n)).toBe("1");
  });
});
