/** Evidence copied from the bank alert, independent of editable account routing. */
export interface TransferEvidence {
  version: 1;
  /** Original alert currency, before any ledger conversion. */
  currency: string;
  attribution: 'source' | 'fallback';
  /** Issuer stated by the captured alert, never learned from fallback routing. */
  sourceBank?: string;
  /** Hash of a bank-scoped, partly masked source identifier. Not a last-four claim. */
  sourceAccountKey?: string;
  /** The source clause said account/card, not an untyped card alone. */
  sourceKindAmbiguous?: true;
  reference?: string;
  counterparty?: {
    last4: string;
    kind: 'credit' | 'debit' | 'account' | 'unknown';
    bankIdentity?: string;
  };
  explicitOwn?: true;
  /** Literal third-party ownership wording, not merely an interbank/external route. */
  explicitExternal?: true;
  /** Bounded recipient label from the transfer clause; a name alone is not ownership proof. */
  counterpartyName?: string;
  /** A completed transfer clause explicitly states both endpoints. */
  endpointProof?: 'explicit-transfer';
  /** Complementary bank alert forms may describe the same posting. */
  postingForm?: 'transfer-detail' | 'remittance-debit' | 'credit-receipt';
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
  basis: 'reference' | 'reciprocal-instruments' | 'destination-and-receipt' | 'user';
  signature: string;
  counterpartSignature: string;
}

export interface TransferAssessment {
  id: string;
  status: 'confirmed-own' | 'confirmed-external' | 'counterpart-missing' | 'ownership-unknown' | 'ambiguous' |
    'card-repayment' | 'corroborating-alert' | 'likely-own' | 'likely-card-repayment';
  reason: 'user' | 'explicit-ownership' | 'reference' | 'reciprocal-instruments' | 'missing-evidence' |
    'multiple-candidates' | 'missing-counterpart' | 'account-unresolved' | 'destination-and-receipt' |
    'credit-card-receipt' | 'bank-confirmation' | 'amount-time' | 'explicit-external';
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
  counterpartyName?: string;
  bulkEligible: boolean;
}

export interface TransferReconciliationResult {
  byId: Map<string, TransferAssessment>;
  internalIds: Set<string>;
  pendingIds: Set<string>;
  groups: TransferReviewGroup[];
  /** Extra observations are retained for audit but must not post a second time. */
  corroboratingIds: Set<string>;
  corroboratingOf: Map<string, string>;
  /** Bank debit -> independently observed credit-card receipt. */
  cardRepaymentPairs: Map<string, string>;
}

export interface TransferDecisionRequest {
  ids: string[];
  ownership: 'own' | 'external' | null;
  counterpartId?: string;
  expectedFingerprints: Record<string, string>;
  now: number;
}
