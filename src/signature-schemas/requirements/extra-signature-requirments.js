import SignatureRequirementsBase from './signature-requirements-base'
import SignatureRequirementsTypes from './signature-requirements-types'

export default class ExtraSignatureRequirments extends SignatureRequirementsBase {
    /**
     * @param {String} key - Signer id.
     */
    constructor(key) {
        super(SignatureRequirementsTypes.EXTRA_SIGNATURE)
        this.key = key
    }
}