import SignatureRequirementsBase from './requirements/signature-requirements-base'
import SignatureRequirementsTypes from './requirements/signature-requirements-types'

class SignatureSchema {
    /**
     * Create new signature schema for a given transaction/account
     * @param {Array<SignatureRequirementsBase>} requirements - The requirements tree that fully describes source accounts and weights.
     * @param {Array<string>} warnings - Detailed description of conditions that can't be fully checked in runtime and may cause a transaction to fail.
     */
    constructor({ requirements = [], warnings = [] }) {
        this.requirements = requirements
        this.warnings = warnings
        Object.freeze(this)
    }

    /**
     * The requirements tree that fully describes source accounts and weights required for a transaction to succeed.
     * @type {Array<SignatureRequirementsBase>}
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
        for (const requirement of this.requirements) {
            switch (requirement.type) {
                case SignatureRequirementsTypes.ACCOUNT_SIGNATURE:
                    const { signers } = requirement
                    for (const { key } of signers) {
                        allSigners.add(key)
                    }
                    break
                case SignatureRequirementsTypes.EXTRA_SIGNATURE:
                    allSigners.add(requirement.key)
                    break
                default:
                    throw new Error('Unknown/unsupport requirement type')
            }
        }
        return Array.from(allSigners)
    }
}

export default SignatureSchema