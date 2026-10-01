import {Address, StrKey} from '@stellar/stellar-sdk'

/**
 * Maximum number of classic account signatures accepted by Soroban host for a single address.
 */
export const MAX_SOROBAN_ACCOUNT_SIGNATURES = 20

/**
 * Soroban address credentials types that require separate signatures, mapped to their public names.
 * @type {Object<string, string>}
 */
export const sorobanCredentialsTypes = Object.freeze({
    sorobanCredentialsAddress: 'address',
    sorobanCredentialsAddressV2: 'address_v2',
    sorobanCredentialsAddressWithDelegates: 'address_with_delegates'
})

/**
 * @typedef {Object} SorobanAuthEntryDescriptor
 * @property {Number} operationIndex - Index of the invokeHostFunction operation in the transaction.
 * @property {Number} entryIndex - Index of the authorization entry in the operation.
 * @property {xdr.SorobanAuthorizationEntry} entry - Authorization entry.
 */

/**
 * @typedef {Object} SorobanAuthNode
 * @property {String} address - Address that needs to authenticate.
 * @property {'account'|'contract'|'unsupported'} addressType - Address kind.
 * @property {xdr.ScVal} signature - Signature attached to the node.
 * @property {Array<xdr.SorobanDelegateSignature>} delegates - Delegated signers attached to the node.
 * @property {Array<Number>} path - Position of the node in the delegated signers tree.
 * @property {SignatureRequirementsBase} [requirement] - Signature requirements of the node.
 * @property {{code: String, message: String}} [issue] - Condition that makes the node unsatisfiable.
 */

/**
 * Find Soroban authorization entries with address credentials (entries with source account credentials are
 * authorized by the operation source account signature).
 * @param {Array<Object>} operations - Parsed transaction operations.
 * @return {Array<SorobanAuthEntryDescriptor>}
 */
export function collectAuthEntries(operations) {
    const res = []
    operations.forEach((operation, operationIndex) => {
        if (operation.type !== 'invokeHostFunction' || !operation.auth)
            return
        operation.auth.forEach((entry, entryIndex) => {
            if (sorobanCredentialsTypes[entry.credentials.type]) {
                res.push({operationIndex, entryIndex, entry})
            }
        })
    })
    return res
}

/**
 * Retrieve top-level address credentials.
 * @param {xdr.SorobanCredentials} credentials
 * @return {xdr.SorobanAddressCredentials}
 */
export function getAddressCredentials(credentials) {
    switch (credentials.type) {
        case 'sorobanCredentialsAddress':
            return credentials.address
        case 'sorobanCredentialsAddressV2':
            return credentials.addressV2
        case 'sorobanCredentialsAddressWithDelegates':
            return credentials.addressWithDelegates.addressCredentials
        default:
            throw new Error(`Unsupported Soroban credentials type: ${credentials.type}`)
    }
}

/**
 * List all addresses that need to authenticate the entry (depth-first, top-level address first).
 * Delegated signers (CAP-71) are processed only for custom accounts - Stellar accounts don't delegate authentication.
 * @param {xdr.SorobanCredentials} credentials
 * @return {Array<SorobanAuthNode>}
 */
export function traverseAuthNodes(credentials) {
    const {address, signature} = getAddressCredentials(credentials)
    const delegates = credentials.type === 'sorobanCredentialsAddressWithDelegates' ?
        credentials.addressWithDelegates.delegates :
        []
    const nodes = []
    visitAuthNode(nodes, address, signature, delegates, [])
    return nodes
}

/**
 * @param {Array<SorobanAuthNode>} nodes
 * @param {xdr.ScAddress} scAddress
 * @param {xdr.ScVal} signature
 * @param {Array<xdr.SorobanDelegateSignature>} delegates
 * @param {Array<Number>} path
 */
function visitAuthNode(nodes, scAddress, signature, delegates, path) {
    const addressType = getAddressType(scAddress)
    nodes.push({address: Address.fromScAddress(scAddress).toString(), addressType, signature, delegates, path})
    if (addressType !== 'contract')
        return
    delegates.forEach((delegate, i) =>
        visitAuthNode(nodes, delegate.address, delegate.signature, delegate.nestedDelegates, [...path, i]))
}

/**
 * @param {xdr.ScAddress} scAddress
 * @return {'account'|'contract'|'unsupported'}
 */
function getAddressType(scAddress) {
    switch (scAddress.type) {
        case 'scAddressTypeAccount':
            return 'account'
        case 'scAddressTypeContract':
            return 'contract'
        default:
            return 'unsupported'
    }
}

/**
 * Find credentials tree nodes with delegated signers not sorted in the strictly increasing order of addresses.
 * @param {xdr.SorobanCredentials} credentials
 * @return {Array<String>} - Addresses of the nodes with invalid delegates ordering.
 */
export function findUnorderedDelegates(credentials) {
    if (credentials.type !== 'sorobanCredentialsAddressWithDelegates')
        return []
    const res = []
    const check = (owner, delegates) => {
        for (let i = 1; i < delegates.length; i++) {
            if (compareBytes(delegates[i - 1].address.toXdr(), delegates[i].address.toXdr()) >= 0) {
                res.push(owner)
                break
            }
        }
        for (const delegate of delegates) {
            check(Address.fromScAddress(delegate.address).toString(), delegate.nestedDelegates)
        }
    }
    const {addressCredentials, delegates} = credentials.addressWithDelegates
    check(Address.fromScAddress(addressCredentials.address).toString(), delegates)
    return res
}

/**
 * @typedef {Object} AccountEd25519Signature
 * @property {String} publicKey - Signer public key.
 * @property {Uint8Array} rawPublicKey - Raw signer public key.
 * @property {Uint8Array} signature - Ed25519 signature.
 */

/**
 * Decode Stellar account signatures (a vector of AccountEd25519Signature structs) from Soroban credentials.
 * @param {xdr.ScVal} signature
 * @return {Array<AccountEd25519Signature>|null} - Decoded signatures, or null if the signature is malformed.
 */
export function parseAccountSignatures(signature) {
    switch (signature.type) {
        case 'scvVoid':
            return []
        case 'scvVec':
            break
        default:
            return null
    }
    const res = []
    for (const element of signature.value ?? []) {
        if (element.type !== 'scvMap')
            return null
        let rawPublicKey = null
        let sig = null
        for (const {key, val} of element.value ?? []) {
            if (key.type !== 'scvSymbol' || val.type !== 'scvBytes')
                return null
            switch (key.value.toString()) {
                case 'public_key':
                    rawPublicKey = val.value.value
                    break
                case 'signature':
                    sig = val.value.value
                    break
                default:
                    return null
            }
        }
        if (rawPublicKey?.length !== 32 || sig?.length !== 64)
            return null
        res.push({publicKey: StrKey.encodeEd25519PublicKey(rawPublicKey), rawPublicKey, signature: sig})
    }
    return res
}

/**
 * Check whether a signature value is attached to the credentials node.
 * @param {xdr.ScVal} signature
 * @return {Boolean}
 */
export function isSignaturePresent(signature) {
    switch (signature.type) {
        case 'scvVoid':
            return false
        case 'scvVec':
            return (signature.value ?? []).length > 0
        default:
            return true
    }
}

/**
 * Lexicographically compare two byte arrays.
 * @param {Uint8Array} a
 * @param {Uint8Array} b
 * @return {Number}
 */
export function compareBytes(a, b) {
    const length = Math.min(a.length, b.length)
    for (let i = 0; i < length; i++) {
        if (a[i] !== b[i])
            return a[i] - b[i]
    }
    return a.length - b.length
}
