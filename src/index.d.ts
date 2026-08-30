import {Transaction, FeeBumpTransaction} from '@stellar/stellar-sdk'

/** Account signing thresholds, as returned by the Horizon `/accounts/{id}` endpoint. */
export interface SigningThresholds {
    /** Account threshold for "low-threshold" operations. */
    low_threshold: number
    /** Account threshold for "medium-threshold" operations. */
    med_threshold: number
    /** Account threshold for "high-threshold" operations. */
    high_threshold: number
}

/** Account state required to analyze its signature requirements. */
export interface AccountInfo {
    /** Account address. */
    id: string
    /** Account operation thresholds. */
    thresholds: SigningThresholds
    /** Signers of the account. */
    signers: {key: string, weight: number, type?: string}[]
}

/** Inspection options. */
export interface InspectionOptions {
    /** Horizon address used to fetch accounts state. Defaults to "https://horizon.stellar.org". */
    horizon?: string
    /** Accounts information pre-fetched from the Horizon "/accounts/{id}" endpoint. */
    accountsInfo?: AccountInfo[]
}

/** Condition that cannot be fully verified at runtime and may cause a transaction to fail. */
export interface SchemaWarning {
    /** Machine-readable warning code. Currently only "no_source" is reported. */
    code: 'no_source'
    /** Human-readable warning description. */
    message: string
    /** Address of the account the warning refers to. */
    data: string
}

/** Supported signature requirements types. */
export type SignatureRequirementsType = 'account_signature' | 'extra_signature'

/** Potential signer of an account. */
export interface SignerDescriptor {
    /** Signer id. */
    key: string
    /** Relative signer weight. */
    weight: number
    /** True if the signer is the account master key. */
    isMaster?: boolean
}

/** Signature requirements for one of the accounts referenced by a transaction. */
export interface AccountSignatureRequirements {
    type: 'account_signature'
    /** Account address. */
    id: string
    /** Minimum weight required to authorize the transaction. */
    minThreshold: number
    /** All available signers, ordered by weight descending. */
    signers: SignerDescriptor[]
    /** Account operation thresholds. */
    thresholds: {low: number, med: number, high: number}
}

/** Signature required by the transaction `extraSigners` precondition. */
export interface ExtraSignatureRequirements {
    type: 'extra_signature'
    /** Signer id. */
    key: string
}

export type SignatureRequirements = AccountSignatureRequirements | ExtraSignatureRequirements

/** Threshold level, either a mnemonic name or an explicit weight. */
export type ThresholdLevel = 'low' | 'med' | 'high' | number

/** Signature schema analysis result. */
export declare class SignatureSchema {
    /** The requirements tree that fully describes source accounts and weights. */
    readonly requirements: SignatureRequirements[]
    /** Conditions that cannot be fully checked at runtime and may cause a transaction to fail. */
    readonly warnings: SchemaWarning[]

    /** Retrieve all signers that can potentially sign the transaction/account. */
    getAllPotentialSigners(): string[]
}

/** Signature schema analysis result for a transaction. */
export declare class TransactionSignatureSchema extends SignatureSchema {
    /**
     * Discover the optimal list of signers, optionally restricted to `availableSigners`.
     * Returns an empty array if the transaction cannot be fully signed.
     */
    discoverSigners(availableSigners?: string[]): string[]

    /** Check whether the provided signers are sufficient to fully sign the transaction. */
    checkFeasibility(signers: string[]): boolean

    /** List signers that would cause a TX_BAD_AUTH_EXTRA error on submission. */
    checkAuthExtra(signers: string[]): string[]
}

/** Signature schema analysis result for an account. */
export declare class AccountSignatureSchema extends SignatureSchema {
    /**
     * Discover the optimal list of signers for a given threshold, optionally restricted to `availableSigners`.
     * Returns an empty array if the threshold cannot be met.
     */
    discoverSigners(threshold: ThresholdLevel, availableSigners?: string[]): string[]

    /** Check whether the provided signers are sufficient to meet the threshold. */
    checkFeasibility(threshold: ThresholdLevel, signers: string[]): boolean

    /** List signers that would cause a TX_BAD_AUTH_EXTRA error for a given threshold. */
    checkAuthExtra(threshold: ThresholdLevel, signers: string[]): string[]

    /** Convert a mnemonic threshold level to its numeric weight. */
    normalizeThreshold(threshold: ThresholdLevel): number
}

/** Discover required signers for a given transaction. */
export declare function inspectTransactionSigners(
    tx: Transaction | FeeBumpTransaction,
    options?: InspectionOptions | null
): Promise<TransactionSignatureSchema>

/** Discover required signers for a given account and thresholds. */
export declare function inspectAccountSigners(
    sourceAccount: string,
    options?: InspectionOptions | null
): Promise<AccountSignatureSchema>
