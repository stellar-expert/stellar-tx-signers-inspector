import {MAX_SIGNER_WEIGHT} from '../../signer-keys.js'
import SignatureRequirementsBase from './signature-requirements-base.js'
import SignatureRequirementsTypes from './signature-requirements-types.js'

/**
 * @typedef {Object} SignerDescriptor
 * @property {String} key - Signer id.
 * @property {Number} weight - Relative signer weight.
 * @property {String} [type] - Signer key type ('ed25519_public_key', 'preauth_tx', 'sha256_hash', or 'ed25519_signed_payload').
 * @property {Boolean} [isMaster] - True if the signer is an account public key.
 * @property {Boolean} [implicit] - True for a pre-authorized transaction signer matching the inspected transaction hash.
 */

/**
 * Required account signatures descriptor.
 */
export default class AccountSignatureRequirements extends SignatureRequirementsBase {
    /**
     * @param {String} id - Account id.
     * @param {Number} minThreshold - Minimum required threshold.
     * @param {{path?: Array<Number>, maxSignatures?: Number}} [sorobanAuthNode] - Soroban authorization node properties.
     */
    constructor(id, minThreshold, sorobanAuthNode) {
        super(SignatureRequirementsTypes.ACCOUNT_SIGNATURE)
        this.id = id
        this.minThreshold = minThreshold
        this.signers = []
        if (sorobanAuthNode) {
            this.path = sorobanAuthNode.path
            this.maxSignatures = sorobanAuthNode.maxSignatures
        }
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
     * Position of the node in the Soroban delegated signers tree (Soroban authorization requirements only).
     * @type {Array<Number>|undefined}
     */
    path

    /**
     * Maximum number of signatures accepted for the account (Soroban authorization requirements only).
     * @type {Number|undefined}
     */
    maxSignatures

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
            this.signers.push(signer.weight > MAX_SIGNER_WEIGHT ? {...signer, weight: MAX_SIGNER_WEIGHT} : signer)
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
