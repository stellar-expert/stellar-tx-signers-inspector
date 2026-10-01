import {SignerKeyTypes} from '../signer-keys.js'
import SignatureRequirementsTypes from './requirements/signature-requirements-types.js'

/**
 * @typedef {Object} SignersResolution
 * @property {Boolean} feasible - Whether all requirements can be satisfied.
 * @property {Array<String>} signers - Optimal signers that need to provide signatures.
 */

/**
 * Signature scheme analysis result with requirements.
 * Concrete schema classes freeze the instance once all fields are initialized.
 * @abstract
 */
export default class SignatureSchema {
    /**
     * Create new signature schema for a given transaction/account
     * @param {Array<SignatureRequirementsBase>} requirements - The requirements tree that fully describes source accounts and weights.
     * @param {Array<SchemaWarning>} warnings - Detailed description of conditions that can't be fully checked in runtime and may cause a transaction to fail.
     */
    constructor({requirements = [], warnings = []}) {
        this.requirements = requirements
        this.warnings = warnings
    }

    /**
     * The requirements tree that fully describes source accounts and weights required for a transaction to succeed.
     * @type {Array<SignatureRequirementsBase>}
     */
    requirements

    /**
     * Detailed description of conditions that can't be fully checked in runtime and may cause a transaction to fail.
     * @type {Array<SchemaWarning>}
     */
    warnings

    /**
     * Retrieve all potential signers for a given transaction/account.
     * Pre-authorized transaction hashes are excluded since they never produce signatures.
     * @returns {Array<string>} - A list of all available signers for a given transaction/account.
     */
    getAllPotentialSigners() {
        const allSigners = new Set()
        for (const requirement of this.requirements) {
            switch (requirement.type) {
                case SignatureRequirementsTypes.ACCOUNT_SIGNATURE: {
                    for (const {key, type} of requirement.signers) {
                        if (type !== SignerKeyTypes.PRE_AUTH_TX) {
                            allSigners.add(key)
                        }
                    }
                }
                    break
                case SignatureRequirementsTypes.EXTRA_SIGNATURE:
                    if (requirement.signerType !== SignerKeyTypes.PRE_AUTH_TX) {
                        allSigners.add(requirement.key)
                    }
                    break
                case SignatureRequirementsTypes.CONTRACT_SIGNATURE:
                    break
                default:
                    throw new Error('Unknown/unsupported requirement type')
            }
        }
        return Array.from(allSigners)
    }

    /**
     * Find the optimal list of signers satisfying all requirements.
     * @param {Array<string>} [availableSigners] - Optional constraint, a list of available signers.
     * @param {function(AccountSignatureRequirements):Number} [thresholdOf] - Resolves the weight threshold for account requirements.
     * @return {SignersResolution}
     * @protected
     */
    resolveSigners(availableSigners, thresholdOf = requirement => requirement.minThreshold) {
        const infeasible = {feasible: false, signers: []}
        const signers = new Set()
        for (const requirement of this.requirements) {
            switch (requirement.type) {
                case SignatureRequirementsTypes.ACCOUNT_SIGNATURE: {
                    const selected = resolveAccountSigners(requirement, thresholdOf(requirement), availableSigners)
                    if (!selected)
                        return infeasible
                    for (const key of selected) {
                        signers.add(key)
                    }
                }
                    break
                case SignatureRequirementsTypes.EXTRA_SIGNATURE:
                    //pre-auth extra signer would have to match the hash of the transaction that contains it
                    if (requirement.signerType === SignerKeyTypes.PRE_AUTH_TX)
                        return infeasible
                    if (availableSigners && !availableSigners.includes(requirement.key))
                        return infeasible
                    signers.add(requirement.key)
                    break
                case SignatureRequirementsTypes.CONTRACT_SIGNATURE:
                    //custom account authentication is defined by the contract and can't be resolved offline
                    break
                default:
                    throw new Error('Unknown/unsupported signature requirements type')
            }
        }
        return {feasible: true, signers: Array.from(signers)}
    }
}

/**
 * Find optimal signers for a single account (signers are expected to be sorted by weight).
 * @param {AccountSignatureRequirements} requirement - Account signature requirements.
 * @param {Number} threshold - Weight threshold to meet.
 * @param {Array<string>} [availableSigners] - Optional constraint, a list of available signers.
 * @return {Array<string>|null} - Signers that need to provide signatures, or null if the threshold can't be met.
 */
function resolveAccountSigners(requirement, threshold, availableSigners) {
    const selected = []
    let weight = 0
    const isSatisfied = () => weight > 0 && weight >= threshold
    //pre-auth signers are matched against the tx hash without consuming signatures, Core counts them first
    for (const signer of requirement.signers) {
        if (signer.type === SignerKeyTypes.PRE_AUTH_TX && (signer.implicit || availableSigners?.includes(signer.key))) {
            weight += signer.weight
            if (isSatisfied())
                return selected
        }
    }
    for (const signer of requirement.signers) {
        if (signer.type === SignerKeyTypes.PRE_AUTH_TX)
            continue
        if (availableSigners && !availableSigners.includes(signer.key))
            continue
        weight += signer.weight
        selected.push(signer.key)
        if (isSatisfied())
            break
    }
    if (!isSatisfied())
        return null
    if (requirement.maxSignatures && selected.length > requirement.maxSignatures)
        return null
    return selected
}
