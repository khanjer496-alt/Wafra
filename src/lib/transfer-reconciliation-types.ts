/** Evidence copied from the bank alert, independent of editable account routing. */
export interface TransferEvidence {
  version: 1;
  /** Original alert currency, before any ledger conversion. */
  currency: string;
  attribution: 'source' | 'fallback';
  reference?: string;
  counterparty?: {
    last4: string;
    kind: 'credit' | 'debit' | 'account' | 'unknown';
    bankIdentity?: string;
  };
  explicitOwn?: true;
}

/** A user's ownership decision survives reparsing and a missing counterpart. */
export interface TransferDecision {
  version: 1;
  ownership: 'own' | 'external';
  decidedAt: number;
  counterpartId?: string;
}

/** A reciprocal link is valid only with both current transaction signatures. */
export interface TransferMatch {
  version: 1;
  counterpartId: string;
  basis: 'reference' | 'reciprocal-instruments' | 'user';
  signature: string;
  counterpartSignature: string;
}

export interface TransferAssessment {
  id: string;
  status: 'confirmed-own' | 'confirmed-external' | 'counterpart-missing' | 'ownership-unknown' | 'ambiguous';
  reason: 'user' | 'explicit-ownership' | 'reference' | 'reciprocal-instruments' | 'missing-evidence' |
    'multiple-candidates' | 'missing-counterpart' | 'account-unresolved';
  counterpartId?: string;
  candidateIds: string[];
}

export interface TransferReviewGroup {
  id: string;
  transactionIds: string[];
  accountId: string;
  direction: 'income' | 'expense';
  status: TransferAssessment['status'];
  counterparty?: TransferEvidence['counterparty'];
  bulkEligible: boolean;
}

export interface TransferReconciliationResult {
  byId: Map<string, TransferAssessment>;
  internalIds: Set<string>;
  pendingIds: Set<string>;
  groups: TransferReviewGroup[];
}

export interface TransferDecisionRequest {
  ids: string[];
  ownership: 'own' | 'external' | null;
  counterpartId?: string;
  expectedFingerprints: Record<string, string>;
  now: number;
}
