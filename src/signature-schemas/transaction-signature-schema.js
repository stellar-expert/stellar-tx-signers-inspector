import {isPreAuthTxKey} from '../signer-keys.js'
import SignatureSchema from './signature-schema.js'

/**
 * Signature scheme analysis result with requirements for a given transactions.
 */
export default class TransactionSignatureSchema extends SignatureSchema {
    /**
     * @param {Array<SignatureRequirementsBase>} requirements - The requirements tree that fully describes source accounts and weights.
     * @param {Array<SchemaWarning>} warnings - Conditions that can't be fully checked in runtime.
     * @param {Array<SorobanAuthSignatureSchema>} [sorobanAuth] - Signature schemas for Soroban authorization entries.
     */
    constructor({requirements, warnings, sorobanAuth = []}) {
        super({requirements, warnings})
        this.sorobanAuth = sorobanAuth
        Object.freeze(this)
    }

    /**
     * Signature schemas of Soroban authorization entries that require address credentials signatures.
     * Empty if "sorobanAuth" inspection option is disabled.
     * @type {Array<SorobanAuthSignatureSchema>}
     * @readonly
     */
    sorobanAuth

    /**
     * Discover optimal signers list based on preferred accounts.
     * @param {Array<string>} [availableSigners] - Optional constraint, a list of available signers to check (public keys).
     * @returns {Array<string>} - An optimal transaction signature scheme with respect to restricted availableSigners if provided.
     */
    discoverSigners(availableSigners) {
        const {feasible, signers} = this.resolveSigners(availableSigners)
        return feasible ? signers : []
    }

    /**
     * Check if potential total available weight matches the threshold.
     * @param {Array<string>} signers - A potential list of transaction signers.
     * @returns {boolean} - True if the total weight of proposed signers is enough for to fully sign the transaction and false otherwise.
     */
    checkFeasibility(signers) {
        return this.resolveSigners(signers).feasible
    }

    /**
     * Check for possible TX_BAD_AUTH_EXTRA errors in case if Stellar Core detects more signatures than required for that particular transaction.
     * @param {Array<string>} signers - A potential list of transaction signers.
     * @returns {Array<string>} - A list of unneeded signers that may cause a TX_BAD_AUTH_EXTRA error on submission.
     */
    checkAuthExtra(signers) {
        //skip if there are no proposed signers - no TX_BAD_AUTH_EXTRA in this case
        if (!signers || !signers.length) return []
        //check signer uniqueness
        const unneededSigners = []
        const uniqueSigners = []
        for (const proposedSigner of signers) {
            if (!uniqueSigners.includes(proposedSigner)) {
                uniqueSigners.push(proposedSigner)
            } else if (!isPreAuthTxKey(proposedSigner)) {
                unneededSigners.push(proposedSigner)
            }
        }
        //detect optimal signature schema giving the proposes signers
        const {feasible, signers: optimalSigners} = this.resolveSigners(uniqueSigners)
        //verify that the proposed schema satisfies the requirements
        if (!feasible) return unneededSigners
        //the transaction will fail if at least one extra signature is found (pre-auth hashes don't consume signatures)
        for (const proposedSigner of uniqueSigners) {
            if (!optimalSigners.includes(proposedSigner) && !isPreAuthTxKey(proposedSigner)) {
                unneededSigners.push(proposedSigner)
            }
        }
        return unneededSigners
    }
}
