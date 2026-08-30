import SignatureRequirementsTypes from './signature-requirements-types.js'

/**
 * Base class for all signature requirements descriptors.
 */
export default class SignatureRequirementsBase {
    /**
     * @param {SignatureRequirementsTypes} type - Requirements type discriminator.
     */
    constructor(type) {
        if (!Object.values(SignatureRequirementsTypes).includes(type))
            throw new Error(`Invalid signature requirements type: "${type}".`)
        this.type = type
    }

    /**
     * Requirements type discriminator.
     * @type {SignatureRequirementsTypes}
     * @readonly
     */
    type
}
