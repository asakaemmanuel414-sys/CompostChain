// CompostVerification.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

// Interfaces for type safety
interface ClarityResponse<T> {
  ok: boolean;
  value: T | number; // number for error codes
}

interface VerificationRecord {
  verifier: string;
  timestamp: number;
  qualityScore: number;
  metadata: string;
  status: string;
  oracleData?: Uint8Array;
  expiry: number;
}

interface HistoryEntry {
  actor: string;
  action: string;
  timestamp: number;
  notes: string;
}

interface Auditor {
  active: boolean;
  addedBy: string;
  addedAt: number;
  verificationCount: number;
}

interface Dispute {
  disputer: string;
  reason: string;
  timestamp: number;
  resolved: boolean;
  resolver?: string;
  resolutionNotes?: string;
}

interface Oracle {
  trusted: boolean;
}

interface ContractState {
  compostVerifications: Map<string, VerificationRecord>;
  verificationHistory: Map<string, HistoryEntry>;
  auditors: Map<string, Auditor>;
  disputes: Map<string, Dispute>;
  oracles: Map<string, Oracle>;
  batchHistoryCounter: Map<string, number>;
  contractOwner: string;
  paused: boolean;
  totalVerifications: number;
  oracleCallbackFee: number;
}

// Mock contract implementation
class CompostVerificationMock {
  private state: ContractState = {
    compostVerifications: new Map(),
    verificationHistory: new Map(),
    auditors: new Map(),
    disputes: new Map(),
    oracles: new Map(),
    batchHistoryCounter: new Map(),
    contractOwner: "deployer",
    paused: false,
    totalVerifications: 0,
    oracleCallbackFee: 100,
  };

  private MAX_METADATA_LEN = 500;
  private MAX_HISTORY_ENTRIES = 20;
  private VERIFICATION_EXPIRY = 1440;
  private QUALITY_THRESHOLD = 80;
  private ERR_UNAUTHORIZED = 100;
  private ERR_INVALID_BATCH = 101;
  private ERR_ALREADY_VERIFIED = 102;
  private ERR_QUALITY_FAIL = 103;
  private ERR_PAUSED = 104;
  private ERR_INVALID_ORACLE = 105;
  private ERR_DISPUTE_ACTIVE = 106;
  private ERR_INVALID_METADATA = 107;
  private ERR_EXPIRED = 108;
  private ERR_INVALID_ROLE = 109;
  private ERR_MAX_HISTORY_EXCEEDED = 110;

  private mockBlockHeight = 1000;

  private incrementBlockHeight() {
    this.mockBlockHeight += 1;
  }

  private batchKey(batchId: string): string {
    return batchId;
  }

  private historyKey(batchId: string, entryId: number): string {
    return `${batchId}_${entryId}`;
  }

  // Mock traits
  private mockProcessingStatus: Map<string, string> = new Map();
  private mockCreditIssued: Map<string, { credits: number; recipient: string }> = new Map();

  setMockProcessingStatus(batchId: string, status: string) {
    this.mockProcessingStatus.set(this.batchKey(batchId), status);
  }

  getMockCreditIssued(batchId: string) {
    return this.mockCreditIssued.get(this.batchKey(batchId));
  }

  addAuditor(caller: string, newAuditor: string): ClarityResponse<boolean> {
    this.incrementBlockHeight();
    if (caller !== this.state.contractOwner) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.auditors.set(newAuditor, {
      active: true,
      addedBy: caller,
      addedAt: this.mockBlockHeight,
      verificationCount: 0,
    });
    return { ok: true, value: true };
  }

  removeAuditor(caller: string, auditor: string): ClarityResponse<boolean> {
    if (caller !== this.state.contractOwner) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    const entry = this.state.auditors.get(auditor);
    if (!entry) {
      return { ok: false, value: this.ERR_INVALID_ROLE };
    }
    entry.active = false;
    this.state.auditors.set(auditor, entry);
    return { ok: true, value: true };
  }

  addTrustedOracle(caller: string, oracle: string): ClarityResponse<boolean> {
    if (caller !== this.state.contractOwner) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.oracles.set(oracle, { trusted: true });
    return { ok: true, value: true };
  }

  removeTrustedOracle(caller: string, oracle: string): ClarityResponse<boolean> {
    if (caller !== this.state.contractOwner) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.oracles.set(oracle, { trusted: false });
    return { ok: true, value: true };
  }

  verifyCompost(
    caller: string,
    batchId: string,
    qualityScore: number,
    metadata: string,
    processingContract: { getBatchStatus: (id: string) => ClarityResponse<string>; updateBatchStatus: (id: string, status: string) => ClarityResponse<boolean> }
  ): ClarityResponse<boolean> {
    this.incrementBlockHeight();
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (!this.state.auditors.get(caller)?.active) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    const batchStatus = processingContract.getBatchStatus(batchId);
    if (!batchStatus.ok || batchStatus.value !== "processed") {
      return { ok: false, value: this.ERR_INVALID_BATCH };
    }
    if (this.state.compostVerifications.has(this.batchKey(batchId))) {
      return { ok: false, value: this.ERR_ALREADY_VERIFIED };
    }
    if (metadata.length > this.MAX_METADATA_LEN) {
      return { ok: false, value: this.ERR_INVALID_METADATA };
    }
    const verification: VerificationRecord = {
      verifier: caller,
      timestamp: this.mockBlockHeight,
      qualityScore,
      metadata,
      status: qualityScore < this.QUALITY_THRESHOLD ? "rejected" : "verified",
      oracleData: undefined,
      expiry: this.mockBlockHeight + this.VERIFICATION_EXPIRY,
    };
    this.state.compostVerifications.set(this.batchKey(batchId), verification);
    this.state.verificationHistory.set(
      this.historyKey(batchId, 1),
      {
        actor: caller,
        action: verification.status,
        timestamp: this.mockBlockHeight,
        notes: qualityScore < this.QUALITY_THRESHOLD ? "Quality below threshold" : `Score: ${qualityScore}`,
      }
    );
    this.state.batchHistoryCounter.set(this.batchKey(batchId), 1);
    if (verification.status === "verified") {
      processingContract.updateBatchStatus(batchId, "verified");
      this.state.totalVerifications += 1;
    }
    return { ok: true, value: verification.status === "verified" };
  }

  oracleCallback(batchId: string, oracleData: Uint8Array, qualityScore: number): ClarityResponse<boolean> {
    this.incrementBlockHeight();
    if (!this.state.oracles.get(txSender)?.trusted) {
      return { ok: false, value: this.ERR_INVALID_ORACLE };
    }
    const entry = this.state.compostVerifications.get(this.batchKey(batchId));
    if (!entry) {
      return { ok: false, value: this.ERR_INVALID_BATCH };
    }
    if (entry.status !== "pending") {
      return { ok: false, value: this.ERR_ALREADY_VERIFIED };
    }
    const status = qualityScore < this.QUALITY_THRESHOLD ? "rejected" : "verified";
    this.state.compostVerifications.set(this.batchKey(batchId), { ...entry, status, oracleData, qualityScore });
    this.state.verificationHistory.set(
      this.historyKey(batchId, (this.state.batchHistoryCounter.get(this.batchKey(batchId)) || 0) + 1),
      {
        actor: txSender,
        action: `oracle-${status}`,
        timestamp: this.mockBlockHeight,
        notes: status === "rejected" ? "Automated quality check failed" : "Automated verification successful",
      }
    );
    this.state.batchHistoryCounter.set(this.batchKey(batchId), (this.state.batchHistoryCounter.get(this.batchKey(batchId)) || 0) + 1);
    return { ok: true, value: status === "verified" };
  }

  initiateDispute(caller: string, batchId: string, reason: string): ClarityResponse<boolean> {
    this.incrementBlockHeight();
    const entry = this.state.compostVerifications.get(this.batchKey(batchId));
    if (!entry) {
      return { ok: false, value: this.ERR_INVALID_BATCH };
    }
    if (entry.status !== "verified") {
      return { ok: false, value: this.ERR_INVALID_BATCH };
    }
    if (this.state.disputes.has(this.batchKey(batchId))) {
      return { ok: false, value: this.ERR_DISPUTE_ACTIVE };
    }
    this.state.disputes.set(this.batchKey(batchId), {
      disputer: caller,
      reason,
      timestamp: this.mockBlockHeight,
      resolved: false,
    });
    this.state.compostVerifications.set(this.batchKey(batchId), { ...entry, status: "disputed" });
    this.state.verificationHistory.set(
      this.historyKey(batchId, (this.state.batchHistoryCounter.get(this.batchKey(batchId)) || 0) + 1),
      {
        actor: caller,
        action: "dispute-initiated",
        timestamp: this.mockBlockHeight,
        notes: reason,
      }
    );
    this.state.batchHistoryCounter.set(this.batchKey(batchId), (this.state.batchHistoryCounter.get(this.batchKey(batchId)) || 0) + 1);
    return { ok: true, value: true };
  }

  resolveDispute(caller: string, batchId: string, resolveToVerified: boolean, notes: string): ClarityResponse<boolean> {
    this.incrementBlockHeight();
    if (caller !== this.state.contractOwner) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    const dispute = this.state.disputes.get(this.batchKey(batchId));
    if (!dispute || dispute.resolved) {
      return { ok: false, value: this.ERR_INVALID_BATCH };
    }
    const entry = this.state.compostVerifications.get(this.batchKey(batchId));
    if (!entry) {
      return { ok: false, value: this.ERR_INVALID_BATCH };
    }
    this.state.disputes.set(this.batchKey(batchId), { ...dispute, resolved: true, resolver: caller, resolutionNotes: notes });
    this.state.compostVerifications.set(this.batchKey(batchId), { ...entry, status: resolveToVerified ? "verified" : "rejected" });
    this.state.verificationHistory.set(
      this.historyKey(batchId, (this.state.batchHistoryCounter.get(this.batchKey(batchId)) || 0) + 1),
      {
        actor: caller,
        action: resolveToVerified ? "dispute-resolved-verified" : "dispute-resolved-rejected",
        timestamp: this.mockBlockHeight,
        notes,
      }
    );
    this.state.batchHistoryCounter.set(this.batchKey(batchId), (this.state.batchHistoryCounter.get(this.batchKey(batchId)) || 0) + 1);
    return { ok: true, value: true };
  }

  triggerCreditIssuance(caller: string, batchId: string, creditContract: { issueCredits: (id: string, credits: number, recipient: string) => ClarityResponse<boolean> }): ClarityResponse<boolean> {
    this.incrementBlockHeight();
    const entry = this.state.compostVerifications.get(this.batchKey(batchId));
    if (!entry || entry.status !== "verified" || this.mockBlockHeight >= entry.expiry) {
      return { ok: false, value: this.ERR_INVALID_BATCH };
    }
    const bonus = entry.qualityScore > 90 ? 20 : entry.qualityScore > 85 ? 10 : 0;
    const credits = entry.qualityScore + bonus;
    const creditResult = creditContract.issueCredits(batchId, credits, caller);
    if (!creditResult.ok) {
      return creditResult;
    }
    this.state.verificationHistory.set(
      this.historyKey(batchId, (this.state.batchHistoryCounter.get(this.batchKey(batchId)) || 0) + 1),
      {
        actor: caller,
        action: "credits-issued",
        timestamp: this.mockBlockHeight,
        notes: `Credits: ${credits}`,
      }
    );
    this.state.batchHistoryCounter.set(this.batchKey(batchId), (this.state.batchHistoryCounter.get(this.batchKey(batchId)) || 0) + 1);
    this.mockCreditIssued.set(this.batchKey(batchId), { credits, recipient: caller });
    return { ok: true, value: true };
  }

  pauseContract(caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.contractOwner) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.paused = true;
    return { ok: true, value: true };
  }

  unpauseContract(caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.contractOwner) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.paused = false;
    return { ok: true, value: true };
  }

  setOracleFee(caller: string, newFee: number): ClarityResponse<boolean> {
    if (caller !== this.state.contractOwner) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.oracleCallbackFee = newFee;
    return { ok: true, value: true };
  }

  getVerificationDetails(batchId: string): ClarityResponse<VerificationRecord | undefined> {
    return { ok: true, value: this.state.compostVerifications.get(this.batchKey(batchId)) };
  }

  getHistoryEntry(batchId: string, entryId: number): ClarityResponse<HistoryEntry | undefined> {
    return { ok: true, value: this.state.verificationHistory.get(this.historyKey(batchId, entryId)) };
  }

  getHistoryCount(batchId: string): ClarityResponse<number> {
    return { ok: true, value: this.state.batchHistoryCounter.get(this.batchKey(batchId)) || 0 };
  }

  isBatchVerified(batchId: string): ClarityResponse<boolean> {
    const entry = this.state.compostVerifications.get(this.batchKey(batchId));
    return { ok: true, value: entry?.status === "verified" };
  }

  getDisputeDetails(batchId: string): ClarityResponse<Dispute | undefined> {
    return { ok: true, value: this.state.disputes.get(this.batchKey(batchId)) };
  }

  getTotalVerifications(): ClarityResponse<number> {
    return { ok: true, value: this.state.totalVerifications };
  }

  getAuditorInfo(auditor: string): ClarityResponse<Auditor | undefined> {
    return { ok: true, value: this.state.auditors.get(auditor) };
  }

  getOracleStatus(oracle: string): ClarityResponse<Oracle | undefined> {
    return { ok: true, value: this.state.oracles.get(oracle) };
  }

  getContractPaused(): ClarityResponse<boolean> {
    return { ok: true, value: this.state.paused };
  }

  getOracleFee(): ClarityResponse<number> {
    return { ok: true, value: this.state.oracleCallbackFee };
  }
}

// Test setup
const accounts = {
  deployer: "deployer",
  auditor: "wallet_1",
  oracle: "wallet_2",
  user: "wallet_3",
};

describe("CompostVerification Contract", () => {
  let contract: CompostVerificationMock;
  let mockProcessingContract: { getBatchStatus: (id: string) => ClarityResponse<string>; updateBatchStatus: (id: string, status: string) => ClarityResponse<boolean> };
  let mockCreditContract: { issueCredits: (id: string, credits: number, recipient: string) => ClarityResponse<boolean> };

  beforeEach(() => {
    contract = new CompostVerificationMock();
    mockProcessingContract = {
      getBatchStatus: vi.fn((batchId: string) => ({ ok: true, value: contract.mockProcessingStatus.get(contract.batchKey(batchId)) || "processed" })),
      updateBatchStatus: vi.fn(() => ({ ok: true, value: true })),
    };
    mockCreditContract = {
      issueCredits: vi.fn(() => ({ ok: true, value: true })),
    };
    vi.resetAllMocks();
  });

  it("should allow owner to add and remove auditors", () => {
    const addResult = contract.addAuditor(accounts.deployer, accounts.auditor);
    expect(addResult).toEqual({ ok: true, value: true });
    expect(contract.getAuditorInfo(accounts.auditor)).toEqual({
      ok: true,
      value: expect.objectContaining({ active: true, addedBy: accounts.deployer }),
    });

    const removeResult = contract.removeAuditor(accounts.deployer, accounts.auditor);
    expect(removeResult).toEqual({ ok: true, value: true });
    expect(contract.getAuditorInfo(accounts.auditor)).toEqual({
      ok: true,
      value: expect.objectContaining({ active: false }),
    });
  });

  it("should prevent non-owner from adding auditors", () => {
    const addResult = contract.addAuditor(accounts.user, accounts.auditor);
    expect(addResult).toEqual({ ok: false, value: 100 });
  });

  it("should allow owner to add and remove trusted oracles", () => {
    const addResult = contract.addTrustedOracle(accounts.deployer, accounts.oracle);
    expect(addResult).toEqual({ ok: true, value: true });
    expect(contract.getOracleStatus(accounts.oracle)).toEqual({
      ok: true,
      value: { trusted: true },
    });

    const removeResult = contract.removeTrustedOracle(accounts.deployer, accounts.oracle);
    expect(removeResult).toEqual({ ok: true, value: true });
    expect(contract.getOracleStatus(accounts.oracle)).toEqual({
      ok: true,
      value: { trusted: false },
    });
  });

  it("should allow auditor to verify compost batch", () => {
    contract.addAuditor(accounts.deployer, accounts.auditor);
    contract.setMockProcessingStatus("batch1", "processed");
    const verifyResult = contract.verifyCompost(accounts.auditor, "batch1", 90, "Compost metadata", mockProcessingContract);
    expect(verifyResult).toEqual({ ok: true, value: true });
    expect(mockProcessingContract.updateBatchStatus).toHaveBeenCalledWith("batch1", "verified");
    expect(contract.getVerificationDetails("batch1")).toEqual({
      ok: true,
      value: expect.objectContaining({ status: "verified", qualityScore: 90 }),
    });
    expect(contract.getHistoryEntry("batch1", 1)).toEqual({
      ok: true,
      value: expect.objectContaining({ action: "verified", notes: "Score: 90" }),
    });
    expect(contract.getTotalVerifications()).toEqual({ ok: true, value: 1 });
  });

  it("should reject low-quality compost", () => {
    contract.addAuditor(accounts.deployer, accounts.auditor);
    contract.setMockProcessingStatus("batch1", "processed");
    const verifyResult = contract.verifyCompost(accounts.auditor, "batch1", 70, "Low quality metadata", mockProcessingContract);
    expect(verifyResult).toEqual({ ok: true, value: false });
    expect(contract.getVerificationDetails("batch1")).toEqual({
      ok: true,
      value: expect.objectContaining({ status: "rejected", qualityScore: 70 }),
    });
    expect(contract.getHistoryEntry("batch1", 1)).toEqual({
      ok: true,
      value: expect.objectContaining({ action: "rejected", notes: "Quality below threshold" }),
    });
  });

  it("should prevent non-auditor from verifying", () => {
    contract.setMockProcessingStatus("batch1", "processed");
    const verifyResult = contract.verifyCompost(accounts.user, "batch1", 90, "Metadata", mockProcessingContract);
    expect(verifyResult).toEqual({ ok: false, value: 100 });
  });

  it("should prevent verification of already verified batch", () => {
    contract.addAuditor(accounts.deployer, accounts.auditor);
    contract.setMockProcessingStatus("batch1", "processed");
    contract.verifyCompost(accounts.auditor, "batch1", 90, "Metadata", mockProcessingContract);
    const verifyResult = contract.verifyCompost(accounts.auditor, "batch1", 95, "New metadata", mockProcessingContract);
    expect(verifyResult).toEqual({ ok: false, value: 102 });
  });

  it("should prevent verification when paused", () => {
    contract.pauseContract(accounts.deployer);
    contract.addAuditor(accounts.deployer, accounts.auditor);
    const verifyResult = contract.verifyCompost(accounts.auditor, "batch1", 90, "Metadata", mockProcessingContract);
    expect(verifyResult).toEqual({ ok: false, value: 104 });
  });

  it("should allow dispute initiation and resolution", () => {
    contract.addAuditor(accounts.deployer, accounts.auditor);
    contract.setMockProcessingStatus("batch1", "processed");
    contract.verifyCompost(accounts.auditor, "batch1", 90, "Metadata", mockProcessingContract);
    const disputeResult = contract.initiateDispute(accounts.user, "batch1", "Invalid quality score");
    expect(disputeResult).toEqual({ ok: true, value: true });
    expect(contract.getDisputeDetails("batch1")).toEqual({
      ok: true,
      value: expect.objectContaining({ disputer: accounts.user, resolved: false }),
    });

    const resolveResult = contract.resolveDispute(accounts.deployer, "batch1", false, "Dispute valid");
    expect(resolveResult).toEqual({ ok: true, value: true });
    expect(contract.getVerificationDetails("batch1")).toEqual({
      ok: true,
      value: expect.objectContaining({ status: "rejected" }),
    });
    expect(contract.getDisputeDetails("batch1")).toEqual({
      ok: true,
      value: expect.objectContaining({ resolved: true, resolutionNotes: "Dispute valid" }),
    });
  });

  it("should trigger credit issuance for verified batch", () => {
    contract.addAuditor(accounts.deployer, accounts.auditor);
    contract.setMockProcessingStatus("batch1", "processed");
    contract.verifyCompost(accounts.auditor, "batch1", 95, "High quality compost", mockProcessingContract);
    const creditResult = contract.triggerCreditIssuance(accounts.auditor, "batch1", mockCreditContract);
    expect(creditResult).toEqual({ ok: true, value: true });
    expect(mockCreditContract.issueCredits).toHaveBeenCalledWith("batch1", 115, accounts.auditor); // 95 + 20 bonus
    expect(contract.getMockCreditIssued("batch1")).toEqual({ credits: 115, recipient: accounts.auditor });
  });

  it("should prevent credit issuance for expired batch", () => {
    contract.addAuditor(accounts.deployer, accounts.auditor);
    contract.setMockProcessingStatus("batch1", "processed");
    contract.verifyCompost(accounts.auditor, "batch1", 90, "Metadata", mockProcessingContract);
    contract.getVerificationDetails("batch1").value!.expiry = 1000; // Simulate expiry
    const creditResult = contract.triggerCreditIssuance(accounts.auditor, "batch1", mockCreditContract);
    expect(creditResult).toEqual({ ok: false, value: 101 });
  });

  it("should update oracle fee", () => {
    const feeResult = contract.setOracleFee(accounts.deployer, 200);
    expect(feeResult).toEqual({ ok: true, value: true });
    expect(contract.getOracleFee()).toEqual({ ok: true, value: 200 });
  });
});