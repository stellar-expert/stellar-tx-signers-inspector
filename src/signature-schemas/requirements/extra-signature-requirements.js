import {getSignerKeyType} from '../../signer-keys.js'
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
        this.signerType = getSignerKeyType(key)
    }

    /**
     * Signer id.
     * @type {String}
     * @readonly
     */
    key

    /**
     * Signer key type ('ed25519_public_key', 'preauth_tx', 'sha256_hash', or 'ed25519_signed_payload').
     * @type {String|null}
     * @readonly
     */
    signerType
}
