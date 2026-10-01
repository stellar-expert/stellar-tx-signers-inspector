import {Transaction, FeeBumpTransaction, xdr} from '@stellar/stellar-sdk'

/** Account signing thresholds, as returned by the Horizon `/accounts/{id}` endpoint. */
export interface SigningThresholds {
    /** Account threshold for "low-threshold" operations. */
    low_threshold: number
    /** Account threshold for "medium-threshold" operations. */
    med_threshold: number
    /** Account threshold for "high-threshold" operations. */
    high_threshold: number
}

/** Signer key type (Horizon naming). */
export type SignerKeyType = 'ed25519_public_key' | 'preauth_tx' | 'sha256_hash' | 'ed25519_signed_payload'

/** Account state required to analyze its signature requirements. */
export interface AccountInfo {
    /** Account address. */
    id: string
    /** Account operation thresholds. */
    thresholds: SigningThresholds
    /** Signers of the account. Signer type is derived from the key prefix if omitted. */
    signers: {key: string, weight: number, type?: SignerKeyType | string}[]
}

/** Inspection options. */
export interface InspectionOptions {
    /** Horizon address used to fetch accounts state if one or more source accounts were not provided. Defaults to "https://horizon.stellar.org". */
    horizon?: string
    /** Accounts information pre-fetched from the Horizon "/accounts/{id}" endpoint. */
    accountsInfo?: AccountInfo[]
    /**
     * Analyze signature schemas of Soroban authorization entries. Authorizing Stellar accounts are loaded
     * from Horizon (or taken from `accountsInfo`). When disabled, entries that need separate signatures are
     * reported with `soroban_auth` warnings instead. Used only by `inspectTransactionSigners()`. Defaults to true.
     */
    sorobanAuth?: boolean
}

/** Warning codes reported on the transaction/account schema level. */
export type SchemaWarningCode =
    /** Source account does not exist on the ledger (and is not created by the transaction before use). */
    | 'no_source'
    /** Extra signer is a pre-authorized transaction hash that can never match the transaction itself. */
    | 'unsatisfiable_extra_signer'
    /** Invalid BeginSponsoringFutureReserves operation (self, repeated, or recursive sponsorship). */
    | 'invalid_sponsorship'
    /** EndSponsoringFutureReserves operation without active sponsorship of its source account. */
    | 'orphan_sponsorship_end'
    /** BeginSponsoringFutureReserves operation that is never ended within the transaction. */
    | 'unterminated_sponsorship'
    /** Soroban authorization entry requires a separate signature (reported only if "sorobanAuth" option is disabled). */
    | 'soroban_auth'

/** Warning codes reported by Soroban authorization entry schemas. */
export type SorobanAuthWarningCode =
    /** Authentication rules of the address are defined by the custom account contract. */
    | 'custom_account_auth'
    /** Delegated signers attached to a Stellar account are ignored by the host. */
    | 'ignored_soroban_delegates'
    /** Authorizing Stellar account does not exist on the ledger. */
    | 'no_auth_account'
    /** Address type cannot be used in Soroban authorization credentials. */
    | 'unsupported_auth_address'

/** Condition that cannot be fully verified at runtime and may cause a transaction to fail. */
export interface SchemaWarning<Code extends string = SchemaWarningCode> {
    /** Unique warning code. */
    code: Code
    /** Human-readable warning description. */
    message: string
    /** Address or signer key the warning refers to. */
    data: string
}

/** Supported signature requirements types. */
export type SignatureRequirementsType = 'account_signature' | 'extra_signature' | 'contract_signature'

/** Potential signer of an account. */
export interface SignerDescriptor {
    /** Signer id. */
    key: string
    /** Relative signer weight (clamped to 255). */
    weight: number
    /** Signer key type. */
    type?: SignerKeyType | string
    /** True if the signer is the account master key. */
    isMaster?: boolean
    /** True for a pre-authorized transaction signer that matches the inspected transaction hash. */
    implicit?: boolean
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
    /** Position in the Soroban delegated signers tree (Soroban authorization requirements only). */
    path?: number[]
    /** Maximum number of accepted signatures (Soroban authorization requirements only). */
    maxSignatures?: number
}

/** Signature required by the transaction `extraSigners` precondition. */
export interface ExtraSignatureRequirements {
    type: 'extra_signature'
    /** Signer id. */
    key: string
    /** Signer key type. */
    signerType: SignerKeyType | null
}

/** Soroban custom account authentication, defined by the contract `__check_auth` function. */
export interface ContractSignatureRequirements {
    type: 'contract_signature'
    /** Contract address. */
    id: string
    /** Position in the Soroban delegated signers tree. */
    path: number[]
}

export type SignatureRequirements =
    AccountSignatureRequirements
    | ExtraSignatureRequirements
    | ContractSignatureRequirements

/** Threshold level, either a mnemonic name or an explicit weight. */
export type ThresholdLevel = 'low' | 'med' | 'high' | number

/** Signature schema analysis result. */
export declare class SignatureSchema {
    /** The requirements tree that fully describes source accounts and weights. */
    readonly requirements: SignatureRequirements[]
    /** Conditions that cannot be fully checked at runtime and may cause a transaction to fail. */
    readonly warnings: SchemaWarning<string>[]

    /** Retrieve all signers that can potentially sign the transaction/account (pre-auth hashes excluded). */
    getAllPotentialSigners(): string[]
}

/** Signature schema analysis result for a transaction. */
export declare class TransactionSignatureSchema extends SignatureSchema {
    readonly warnings: SchemaWarning[]
    /**
     * Signature schemas of Soroban authorization entries with address credentials, one per entry.
     * Empty if the `sorobanAuth` option is disabled.
     */
    readonly sorobanAuth: SorobanAuthSignatureSchema[]

    /**
     * Discover the optimal list of signers, optionally restricted to `availableSigners`.
     * Returns an empty array if the transaction cannot be fully signed
     * (or if it is fully authorized by a pre-auth signer - use `checkFeasibility()` to distinguish).
     */
    discoverSigners(availableSigners?: string[]): string[]

    /** Check whether the provided signers are sufficient to fully sign the transaction. */
    checkFeasibility(signers: string[]): boolean

    /** List signers that would cause a TX_BAD_AUTH_EXTRA error on submission. */
    checkAuthExtra(signers: string[]): string[]
}

/** Signature schema analysis result for an account. */
export declare class AccountSignatureSchema extends SignatureSchema {
    readonly warnings: SchemaWarning[]

    /**
     * Discover the optimal list of signers for a given threshold, optionally restricted to `availableSigners`.
     * Pre-auth signers are counted only when listed in `availableSigners`.
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

/** Soroban signature verification error. */
export interface SorobanVerificationError {
    /** Machine-readable error code. */
    code: 'missing_signature' | 'malformed_signature' | 'too_many_signatures' | 'unordered_signatures' |
        'invalid_signature' | 'unknown_signer' | 'insufficient_weight' | 'unordered_delegates' |
        'no_auth_account' | 'unsupported_auth_address'
    /** Human-readable error description. */
    message: string
    /** Related address or signer key. */
    data?: string
}

/** Verification result for a single Soroban credentials node. */
export interface SorobanSignatureVerification {
    /** Address of the credentials node. */
    id: string
    /** Position in the delegated signers tree (empty for the top-level address). */
    path: number[]
    /** Whether a signature is attached to the node. */
    signed: boolean
    /** Verification result, null for custom accounts (contract-defined authentication). */
    valid: boolean | null
    /** Public keys of the attached account signatures. */
    signers: string[]
    /** Total weight of valid account signatures. */
    weight: number
    /** Detected problems. */
    errors: SorobanVerificationError[]
}

/** Signature schema analysis result for a Soroban authorization entry with address credentials. */
export declare class SorobanAuthSignatureSchema extends SignatureSchema {
    readonly warnings: SchemaWarning<SorobanAuthWarningCode>[]
    /** Index of the invokeHostFunction operation in the transaction. */
    readonly operationIndex: number
    /** Index of the authorization entry in the operation. */
    readonly entryIndex: number
    /** Top-level credentials address. */
    readonly address: string
    /** Credentials type. */
    readonly credentialsType: 'address' | 'address_v2' | 'address_with_delegates'
    /** Credentials nonce. */
    readonly nonce: bigint
    /** Ledger sequence until which the signatures are valid. */
    readonly signatureExpirationLedger: number
    /** Inspected authorization entry. */
    readonly entry: xdr.SorobanAuthorizationEntry
    /** Network passphrase of the transaction. */
    readonly networkPassphrase: string

    /**
     * Discover public keys that need to sign the entry payload, optionally restricted to `availableSigners`.
     * Returns an empty array if the entry cannot be signed.
     */
    discoverSigners(availableSigners?: string[]): string[]

    /** Check whether the provided signers are sufficient to authorize the entry (custom accounts are assumed satisfiable). */
    checkFeasibility(signers: string[]): boolean

    /** Compute the payload signed by every node of the entry. */
    getSignaturePayload(signatureExpirationLedger?: number): Uint8Array

    /** Verify signatures attached to the entry. */
    verifySignatures(): SorobanSignatureVerification[]
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
