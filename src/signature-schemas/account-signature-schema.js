import {isPreAuthTxKey} from '../signer-keys.js'
import SignatureSchema from './signature-schema.js'

/**
 * Signature scheme analysis result with requirements for a given account.
 * Pre-authorized transaction signers are counted only when explicitly listed in `availableSigners`,
 * as they can authorize only the transaction with a matching hash.
 */
export default class AccountSignatureSchema extends SignatureSchema {
    /**
     * @param {Array<SignatureRequirementsBase>} requirements - The requirements tree that fully describes source accounts and weights.
     * @param {Array<SchemaWarning>} warnings - Conditions that can't be fully checked in runtime.
     */
    constructor({requirements, warnings}) {
        super({requirements, warnings})
        Object.freeze(this)
    }

    /**
     * Discover optimal signers list based on preferred accounts.
     * @param {'low'|'med'|'high'|Number} threshold - Threshold to meet.
     * @param {Array<string>} [availableSigners] - Optional constraint, a list of available signers to check (public keys).
     * @returns {Array<string>} - An optimal transaction signature scheme with respect to restricted availableSigners if provided.
     */
    discoverSigners(threshold, availableSigners) {
        const {feasible, signers} = this.resolveThreshold(threshold, availableSigners)
        return feasible ? signers : []
    }

    /**
     * Check if potential total available weight matches the threshold.
     * @param {'low'|'med'|'high'|Number} threshold - Threshold to meet.
     * @param {Array<string>} signers - A potential list of transaction signers.
     * @returns {Boolean} - True if the total weight of proposed signers is enough for to fully sign the transaction and false otherwise.
     */
    checkFeasibility(threshold, signers) {
        return this.resolveThreshold(threshold, signers).feasible
    }

    /**
     * Check for possible TX_BAD_AUTH_EXTRA errors in case if Stellar Core detects more signatures than required for that particular transaction.
     * @param {'low'|'med'|'high'|Number} threshold - Threshold to meet.
     * @param {Array<string>} signers - A potential list of transaction signers.
     * @returns {Array<string>} - A list of unneeded signers that may cause a TX_BAD_AUTH_EXTRA error on submission.
     */
    checkAuthExtra(threshold, signers) {
        //skip if there are no proposed signers - no TX_BAD_AUTH_EXTRA in this case
        if (!signers || !signers.length) return []
        //detect optimal signature schema giving the proposes signers
        const {feasible, signers: optimalSigners} = this.resolveThreshold(threshold, signers)
        //verify that the proposed schema satisfies the requirements
        if (!feasible) return []
        //the transaction will fail if at least one extra signature is found (pre-auth hashes don't consume signatures)
        const unneededSigners = []
        for (const proposedSigner of signers) {
            if (!optimalSigners.includes(proposedSigner) && !isPreAuthTxKey(proposedSigner)) {
                unneededSigners.push(proposedSigner)
            }
        }
        return unneededSigners
    }

    /**
     * Convert threshold level from mnemonic to number if needed.
     * @param {String|Number} threshold
     * @return {Number}
     */
    normalizeThreshold(threshold) {
        const requested = threshold
        if (typeof threshold === 'string') {
            const [account] = this.requirements
            if (!account || !account.thresholds)
                throw new Error('Account thresholds are unavailable. Mnemonic threshold levels cannot be resolved.')
            //accept both "low" and "low_threshold" spellings
            threshold = account.thresholds[threshold.toLowerCase().split('_')[0]]
        }
        if (typeof threshold !== 'number')
            throw new Error(`Invalid threshold level: "${requested}".`)
        return threshold
    }

    /**
     * @param {'low'|'med'|'high'|Number} threshold - Threshold to meet.
     * @param {Array<string>} [availableSigners] - Optional constraint, a list of available signers.
     * @return {SignersResolution}
     * @private
     */
    resolveThreshold(threshold, availableSigners) {
        const weight = this.normalizeThreshold(threshold)
        return this.resolveSigners(availableSigners, () => weight)
    }
}
