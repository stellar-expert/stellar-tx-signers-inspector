import SignatureSchema from './signature-schema'

class TransactionSignatureSchema extends SignatureSchema {
    constructor(options) {
        super(options)
    }

    /**
     * Discover optimal signers list based on preferred accounts.
     * @param {Array<string>} [availableSigners] - Optional constraint, a list of available signers to check (public keys).
     * @returns {Array<string>} - An optimal transaction signature scheme with respect to restricted availableSigners if provided.
     */
    discoverSigners(availableSigners) {
        const res = []
        for (let {signers, minThreshold} of this.requirements) {
            let totalWeight = 0
            //find optimal signers
            for (let signer of signers) {
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
        return res
    }

    /**
     * Check if potential total available weight matches the threshold.
     * @param {Array<string>} signers - A potential list of transaction signers.
     * @returns {Boolean} - True if the total weight of proposed signers is enough for to fully sign the transaction and false otherwise.
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
        const unneededSigners = [],
            uniqueSigners = []
        for (const proposedSigner of signers){
            if (uniqueSigners.includes(proposedSigner)) {
                unneededSigners.push(proposedSigner)
            } else {
                uniqueSigners.push(proposedSigner)
            }
        }
        signers = uniqueSigners
        //detect optimal signature schema giving the proposes signers
        const optimalSigners = this.discoverSigners(signers)
        //verify that the proposed schema satisfies the requirements
        if (!optimalSigners.length) return unneededSigners
        //the transaction will fail if at least one extra signature is found
        for (const proposedSigner of signers) {
            if (!optimalSigners.includes(proposedSigner)) {
                unneededSigners.push(proposedSigner)
            }
        }
        return unneededSigners
    }
}

export default TransactionSignatureSchema