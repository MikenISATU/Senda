import { describe, expect, it } from "vitest";
import { escrowSalt as escrowKey, onchainJobId } from "@/lib/server/escrow";

describe("escrow key", () => {
  it("is a deterministic 32-byte hex id unique per contract and job", () => {
    const a = escrowKey("job-1", "CAAA");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(escrowKey("job-1", "CAAA")).toBe(a);
    expect(escrowKey("job-2", "CAAA")).not.toBe(a);
    expect(escrowKey("job-1", "CBBB")).not.toBe(a);
  });
});

describe("on-chain job id", () => {
  it("matches the contract's derive_job_id (same vector as the Rust test)", () => {
    const salt = "07".repeat(32);
    expect(onchainJobId("GCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYOJR", salt)).toBe("ae8afb6ee1bf72d47a7709ea20b54c1cfd9e586ddeb35ccf8df6c86677210a9e");
  });
});
