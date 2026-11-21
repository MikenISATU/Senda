import { describe, expect, it } from "vitest";
import { friendlyError } from "@/lib/client/errors";

const code = (msg: string, opts = {}) => friendlyError(new Error(msg), opts).code;

describe("friendly errors", () => {
  it("names connection problems, including the wording phones use", () => {
    expect(code("Failed to fetch")).toBe("NET-OFFLINE"); // Chrome, Android
    expect(code("Load failed")).toBe("NET-OFFLINE"); // Safari, iPhone
    expect(code("NetworkError when attempting to fetch resource.")).toBe("NET-OFFLINE"); // Firefox
    expect(code("The operation timed out")).toBe("NET-SLOW");
  });

  it("treats cancelling as a choice, not a failure", () => {
    const fr = friendlyError(new Error("User rejected the request"));
    expect(fr.code).toBe("WALLET-CANCELLED");
    expect(fr.safe).toBe(true);
    expect(fr.action).toBe("none");
  });

  it("explains wallet and in-app browser problems", () => {
    expect(code("Blocked a frame with origin from accessing a cross-origin frame")).toBe("WALLET-BLOCKED");
    expect(code("Embedded wallet proxy not initialized")).toBe("WALLET-NOT-READY");
  });

  it("translates Stellar result codes", () => {
    expect(code("tx_failed: op_underfunded")).toBe("PAY-BALANCE");
    expect(code("op_low_reserve")).toBe("PAY-RESERVE");
    expect(code("op_no_trust")).toBe("PAY-USDC-OFF");
    expect(code("op_no_destination")).toBe("PAY-NO-ACCOUNT");
    expect(code("tx_bad_seq")).toBe("PAY-BUSY");
    expect(code("HostError: Error(Contract, #7)")).toBe("PAY-REJECTED");
  });

  it("keeps the server's own plain words for a refused request", () => {
    const fr = friendlyError(new Error("Amount must be greater than zero."), { status: 400 });
    expect(fr.message).toBe("Amount must be greater than zero.");
    expect(fr.title).toBe("Please check and try again");
  });

  it("never shows technical text as the message", () => {
    for (const raw of ["TypeError: Cannot read properties of undefined (reading 'map')", "Request failed (500)", "Unexpected token < in JSON at position 0"]) {
      const fr = friendlyError(new Error(raw), { status: 500 });
      expect(fr.message).not.toContain("undefined");
      expect(fr.message).not.toMatch(/TypeError|JSON|\(500\)/);
      expect(fr.detail).toBe(raw); // still available under Details
    }
    expect(code("Request failed (500)", { status: 500 })).toBe("SERVER");
  });

  it("maps statuses that carry no friendly text", () => {
    expect(code("Request failed (401)", { status: 401 })).toBe("AUTH-ENDED");
    expect(friendlyError(new Error("x"), { status: 401 }).action).toBe("signin");
    expect(code("Request failed (429)", { status: 429 })).toBe("SLOW-DOWN");
    expect(code("Request failed (404)", { status: 404 })).toBe("NOT-FOUND");
  });

  it("never invites a second payment when money may have moved", () => {
    const fr = friendlyError(new Error("Failed to fetch"), { moneyMayHaveMoved: true });
    expect(fr.safe).toBe(false);
    expect(fr.action).toBe("none");
    expect(fr.message).toMatch(/Don't send it again/);
  });
});
