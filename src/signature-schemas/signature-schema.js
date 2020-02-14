import AccountSignatureRequirements from '../account-signature-requirements'

class SignatureSchema {
    /**
     * Create new signature schema for a given transaction/account
     * @param {Array<AccountSignatureRequirements>} requirements - The requirements tree that fully describes source accounts and weights.
     * @param {Array<string>} warnings - Detailed description of conditions that can't be fully checked in runtime and may cause a transaction to fail.
     */
    constructor({requirements = [], warnings = []}) {
        this.requirements = requirements
        this.warnings = warnings
        Object.freeze(this)
    }

    /**
     * The requirements tree that fully describes source accounts and weights required for a transaction to succeed.
     * @type {Array<AccountSignatureRequirements>}
     */
    requirements

    /**
     * Detailed description of conditions that can't be fully checked in runtime and may cause a transaction to fail.
     * @type {Array<string>}
     */
    warnings

    /**
     * Retrieve all potential signers for a given transaction/account.
     * @returns {Array<string>} - A list of all available signers for a given transaction/account.
     */
    getAllPotentialSigners() {
        const allSigners = new Set()
        for (const {signers} of this.requirements) {
            for (const {key} of signers) {
                allSigners.add(key)
            }
        }
        return Array.from(allSigners)
    }
}

export default SignatureSchema