import {Keypair, buildAuthorizationEntryPreimage, hash} from '@stellar/stellar-sdk'
import {
    MAX_SOROBAN_ACCOUNT_SIGNATURES,
    sorobanCredentialsTypes,
    getAddressCredentials,
    findUnorderedDelegates,
    parseAccountSignatures,
    isSignaturePresent,
    compareBytes
} from '../soroban-auth.js'
import SignatureRequirementsTypes from './requirements/signature-requirements-types.js'
import SignatureSchema from './signature-schema.js'

/**
 * @typedef {Object} SorobanVerificationError
 * @property {String} code - Machine-readable error code.
 * @property {String} message - Human-readable error description.
 * @property {String} [data] - Related address or signer key.
 */

/**
 * @typedef {Object} SorobanSignatureVerification
 * @property {String} id - Address of the credentials node.
 * @property {Array<Number>} path - Position of the node in the delegated signers tree.
 * @property {Boolean} signed - Whether the node has a signature attached.
 * @property {Boolean|null} valid - Verification result, null if the node is a custom account (contract-defined auth).
 * @property {Array<String>} signers - Public keys of the attached account signatures.
 * @property {Number} weight - Total weight of valid account signatures.
 * @property {Array<SorobanVerificationError>} errors - Detected problems.
 */

/**
 * Signature scheme analysis result for a Soroban authorization entry with address credentials.
 * All nodes (top-level address and CAP-71 delegated signers) sign the same payload.
 */
export default class SorobanAuthSignatureSchema extends SignatureSchema {
    /**
     * @param {Number} operationIndex - Index of the invokeHostFunction operation in the transaction.
     * @param {Number} entryIndex - Index of the authorization entry in the operation.
     * @param {xdr.SorobanAuthorizationEntry} entry - Authorization entry.
     * @param {String} networkPassphrase - Network passphrase of the transaction.
     * @param {Array<SorobanAuthNode>} nodes - Authorization nodes with resolved requirements.
     * @param {Array<SchemaWarning>} warnings - Conditions that can't be fully checked offline.
     */
    constructor({operationIndex, entryIndex, entry, networkPassphrase, nodes, warnings}) {
        super({requirements: nodes.map(node => node.requirement), warnings})
        const {nonce, signatureExpirationLedger} = getAddressCredentials(entry.credentials)
        this.operationIndex = operationIndex
        this.entryIndex = entryIndex
        this.address = nodes[0].address
        this.credentialsType = sorobanCredentialsTypes[entry.credentials.type]
        this.nonce = nonce
        this.signatureExpirationLedger = signatureExpirationLedger
        this.entry = entry
        this.networkPassphrase = networkPassphrase
        this.nodes = nodes
        Object.freeze(this)
    }

    /**
     * Index of the invokeHostFunction operation in the transaction.
     * @type {Number}
     * @readonly
     */
    operationIndex

    /**
     * Index of the authorization entry in the operation.
     * @type {Number}
     * @readonly
     */
    entryIndex

    /**
     * Top-level credentials address.
     * @type {String}
     * @readonly
     */
    address

    /**
     * Credentials type.
     * @type {'address'|'address_v2'|'address_with_delegates'}
     * @readonly
     */
    credentialsType

    /**
     * Credentials nonce.
     * @type {BigInt}
     * @readonly
     */
    nonce

    /**
     * Ledger sequence until which the signatures are valid.
     * @type {Number}
     * @readonly
     */
    signatureExpirationLedger

    /**
     * Inspected authorization entry.
     * @type {xdr.SorobanAuthorizationEntry}
     * @readonly
     */
    entry

    /**
     * Network passphrase of the transaction.
     * @type {String}
     * @readonly
     */
    networkPassphrase

    /**
     * @type {Array<SorobanAuthNode>}
     * @private
     */
    nodes

    /**
     * Discover optimal signers for the authorization entry payload.
     * @param {Array<string>} [availableSigners] - Optional constraint, a list of available signers to check (public keys).
     * @returns {Array<string>} - Public keys that need to sign the entry payload, or empty array if the entry can't be signed.
     */
    discoverSigners(availableSigners) {
        const {feasible, signers} = this.resolveSigners(availableSigners)
        return feasible ? signers : []
    }

    /**
     * Check if proposed signers can authorize the entry.
     * Custom account nodes are assumed to be satisfiable since their auth rules are defined by the contract.
     * @param {Array<string>} signers - A potential list of entry signers.
     * @returns {boolean}
     */
    checkFeasibility(signers) {
        return this.resolveSigners(signers).feasible
    }

    /**
     * Compute the payload that every node of the entry signs.
     * Legacy address credentials use ENVELOPE_TYPE_SOROBAN_AUTHORIZATION preimage, address-bound credentials
     * (ADDRESS_V2 and ADDRESS_WITH_DELEGATES) use ENVELOPE_TYPE_SOROBAN_AUTHORIZATION_WITH_ADDRESS preimage.
     * @param {Number} [signatureExpirationLedger] - Signature expiration ledger, defaults to the value set in the entry.
     * @return {Uint8Array} - SHA-256 hash of the authorization preimage.
     */
    getSignaturePayload(signatureExpirationLedger = this.signatureExpirationLedger) {
        return hash(buildAuthorizationEntryPreimage(this.entry, signatureExpirationLedger, this.networkPassphrase).toXdr())
    }

    /**
     * Verify signatures attached to the entry the same way Soroban host authenticates Stellar accounts.
     * @return {Array<SorobanSignatureVerification>} - Verification results for every node, top-level address first.
     */
    verifySignatures() {
        const payload = this.getSignaturePayload()
        const res = this.nodes.map(node => verifyNode(node, payload))
        //host validates delegates ordering for the entire credentials tree before entering the contract
        const [top] = res
        for (const owner of findUnorderedDelegates(this.entry.credentials)) {
            top.errors.push({
                code: 'unordered_delegates',
                message: `Delegated signers of ${owner} must be sorted by address in ascending order without duplicates.`,
                data: owner
            })
            top.valid = false
        }
        return res
    }
}

/**
 * @param {SorobanAuthNode} node
 * @param {Uint8Array} payload
 * @return {SorobanSignatureVerification}
 */
function verifyNode({address, path, signature, requirement, issue}, payload) {
    const errors = []
    const res = {id: address, path, signed: isSignaturePresent(signature), valid: null, signers: [], weight: 0, errors}
    if (issue) {
        errors.push({...issue, data: address})
        res.valid = false
        return res
    }
    if (requirement.type === SignatureRequirementsTypes.CONTRACT_SIGNATURE)
        return res
    const addError = (code, message, data = address) => {
        if (!errors.some(e => e.code === code && e.data === data)) {
            errors.push({code, message, data})
        }
    }
    const signatures = parseAccountSignatures(signature)
    if (!signatures) {
        addError('malformed_signature', `Signature of ${address} is not a vector of account Ed25519 signatures.`)
    } else if (!signatures.length) {
        addError('missing_signature', `Account ${address} has not signed the authorization entry.`)
    } else {
        if (signatures.length > MAX_SOROBAN_ACCOUNT_SIGNATURES) {
            addError('too_many_signatures', `Account ${address} has ${signatures.length} signatures, the limit is ${MAX_SOROBAN_ACCOUNT_SIGNATURES}.`)
        }
        let prevKey = null
        for (const {publicKey, rawPublicKey, signature: sig} of signatures) {
            if (prevKey && compareBytes(prevKey, rawPublicKey) >= 0) {
                addError('unordered_signatures', `Signatures of ${address} must be sorted by public key in ascending order without duplicates.`)
            }
            prevKey = rawPublicKey
            res.signers.push(publicKey)
            if (!Keypair.fromPublicKey(publicKey).verify(payload, sig)) {
                addError('invalid_signature', `Signature of ${publicKey} doesn't match the authorization entry payload.`, publicKey)
                continue
            }
            const signer = requirement.signers.find(s => s.key === publicKey)
            if (!signer) {
                addError('unknown_signer', `${publicKey} is not an Ed25519 signer of ${address}.`, publicKey)
                continue
            }
            res.weight += signer.weight
        }
        if (res.weight < requirement.minThreshold) {
            addError('insufficient_weight', `Signatures weight ${res.weight} of ${address} is lower than the medium threshold ${requirement.minThreshold}.`)
        }
    }
    res.valid = !errors.length
    return res
}
