import SignatureRequirementsBase from './signature-requirements-base.js'
import SignatureRequirementsTypes from './signature-requirements-types.js'

/**
 * Soroban custom account (contract) authentication descriptor.
 * Authentication rules are defined by the contract `__check_auth` function and can't be resolved offline.
 */
export default class ContractSignatureRequirements extends SignatureRequirementsBase {
    /**
     * @param {String} id - Contract address.
     * @param {Array<Number>} path - Position of the node in the delegated signers tree.
     */
    constructor(id, path) {
        super(SignatureRequirementsTypes.CONTRACT_SIGNATURE)
        this.id = id
        this.path = path
    }

    /**
     * Contract address.
     * @type {String}
     * @readonly
     */
    id

    /**
     * Position of the node in the Soroban delegated signers tree - empty array for the top-level credentials address,
     * delegate indexes for delegated signers (CAP-71).
     * @type {Array<Number>}
     * @readonly
     */
    path
}
