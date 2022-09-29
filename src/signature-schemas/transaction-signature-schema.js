import SignatureRequirementsTypes from './requirements/signature-requirements-types'
import SignatureSchema from './signature-schema'

/**
 * Signature scheme analysis result with requirements for a given transactions.
 */
export default class TransactionSignatureSchema extends SignatureSchema {
    /**
     * Discover optimal signers list based on preferred accounts.
     * @param {Array<string>} [availableSigners] - Optional constraint, a list of available signers to check (public keys).
     * @returns {Array<string>} - An optimal transaction signature scheme with respect to restricted availableSigners if provided.
     */
    discoverSigners(availableSigners) {
        const res = []
        for (const requirements of this.requirements) {
            switch (requirements.type) {
                case SignatureRequirementsTypes.ACCOUNT_SIGNATURE: {
                    const {signers, minThreshold} = requirements
                    let totalWeight = 0
                    //find optimal signers
                    for (const signer of signers) {
                        if (!availableSigners || availableSigners.includes(signer.key)) {
                            totalWeight += signer.weight
                            if (!res.includes(signer.key)) {
                                res.push(signer.key)
                            }
                            if (totalWeight >= minThreshold) break
                        }
                    }
                    //if total weight is still lower than the threshold, it means that we can't find the schema
                    if (totalWeight < minThreshold || totalWeight === 0) return []
                }
                    break
                case SignatureRequirementsTypes.EXTRA_SIGNATURE:
                    //if there is no extra signature signer, it means that we can't find the schema
                    if (availableSigners && !availableSigners.includes(requirements.key)) return []
                    res.push(requirements.key)
                    break
                default:
                    throw new Error('Unknow/unsupported signature requirements type')

            }
        }
        return res
    }

    /**
     * Check if potential total available weight matches the threshold.
     * @param {Array<string>} signers - A potential list of transaction signers.
     * @returns {boolean} - True if the total weight of proposed signers is enough for to fully sign the transaction and false otherwise.
     */
    checkFeasibility(signers) {
        return this.discoverSigners(signers).length > 0
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
            if (uniqueSigners.includes(proposedSigner)) {
                unneededSigners.push(proposedSigner)
            } else {
                uniqueSigners.push(proposedSigner)
            }
        }
        //detect optimal signature schema giving the proposes signers
        const optimalSigners = this.discoverSigners(uniqueSigners)
        //verify that the proposed schema satisfies the requirements
        if (!optimalSigners.length) return unneededSigners
        //the transaction will fail if at least one extra signature is found
        for (const proposedSigner of uniqueSigners) {
            if (!optimalSigners.includes(proposedSigner)) {
                unneededSigners.push(proposedSigner)
            }
        }
        return unneededSigners
    }
}