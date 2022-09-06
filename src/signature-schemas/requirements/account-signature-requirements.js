import SignatureRequirementsBase from './signature-requirements-base'
import SignatureRequirementsTypes from './signature-requirements-types'

/**
 * @typedef {Object} SignerDescriptor
 * @property {String} key - Signer id.
 * @property {Number} weight - Relative signer weight.
 * @property {Boolean} [isMaster] - True if the signer is an account public key.
 */

/**
 * Required account signatures descriptor.
 */
class AccountSignatureRequirements extends SignatureRequirementsBase {
    /**
     * @param {String} id - Account id.
     * @param {Number} minThreshold - Minimum required threshold.
     */
    constructor(id, minThreshold) {
        super(SignatureRequirementsTypes.ACCOUNT_SIGNATURE)
        this.id = id
        this.minThreshold = minThreshold
        this.signers = []
    }

    /**
     * Account id.
     * @type {String}
     */
    id

    /**
     * Minimum required threshold.
     * @type {Number}
     */
    minThreshold

    /**
     * All available signers for the account.
     * @type {Array<SignerDescriptor>}
     */
    signers

    /**
     * Account operation thresholds.
     * @type {{low: Number, med: Number, high: Number}}
     */
    thresholds

    /**
     * Set account operation thresholds.
     * @param {{low: Number, med: Number, high: Number}} thresholds
     */
    setThresholds(thresholds) {
        this.thresholds = thresholds
    }

    /**
     * Add available signer to the list.
     * @param {SignerDescriptor} signer
     */
    addSigner(signer) {
        if (signer.weight > 0) {
            this.signers.push(signer)
        }
    }

    /**
     * Reorder signers by their weight.
     */
    sortSigners() {
        this.signers.sort((a, b) => {
            const weightDiff = b.weight - a.weight
            if (weightDiff !== 0) return weightDiff
            if (b.isMaster) return 1
            if (a.isMaster) return -1
            return a.key > b.key ? 1 : -1
        })
    }
}

export default AccountSignatureRequirements
