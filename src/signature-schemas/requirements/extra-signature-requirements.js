import SignatureRequirementsBase from './signature-requirements-base.js'
import SignatureRequirementsTypes from './signature-requirements-types.js'

/**
 * Extra signature descriptor (Preconditions.extraSigners).
 */
export default class ExtraSignatureRequirements extends SignatureRequirementsBase {
    /**
     * @param {String} key - Signer id.
     */
    constructor(key) {
        super(SignatureRequirementsTypes.EXTRA_SIGNATURE)
        this.key = key
    }

    /**
     * Signer id.
     * @type {String}
     * @readonly
     */
    key
}
