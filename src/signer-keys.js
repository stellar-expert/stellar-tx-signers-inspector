import {StrKey} from '@stellar/stellar-sdk'

/**
 * Supported signer key types (Horizon naming).
 * @readonly
 * @enum {string}
 */
export const SignerKeyTypes = Object.freeze({
    ED25519: 'ed25519_public_key',
    PRE_AUTH_TX: 'preauth_tx',
    HASH_X: 'sha256_hash',
    ED25519_SIGNED_PAYLOAD: 'ed25519_signed_payload'
})

/**
 * Maximum effective signer weight - Stellar Core clamps signer weights to uint8 since protocol 10.
 */
export const MAX_SIGNER_WEIGHT = 255

const strKeySignerTypes = {
    ed25519PublicKey: SignerKeyTypes.ED25519,
    preAuthTx: SignerKeyTypes.PRE_AUTH_TX,
    sha256Hash: SignerKeyTypes.HASH_X,
    signedPayload: SignerKeyTypes.ED25519_SIGNED_PAYLOAD
}

/**
 * Detect signer key type from its StrKey prefix.
 * @param {String} key - StrKey-encoded signer key (G..., T..., X..., or P...).
 * @return {SignerKeyTypes|null} - Signer key type, or null for unrecognized keys.
 */
export function getSignerKeyType(key) {
    if (typeof key !== 'string')
        return null
    return strKeySignerTypes[StrKey.getVersionByteForPrefix(key)] || null
}

/**
 * Check whether a signer key is a pre-authorized transaction hash.
 * @param {String} key - StrKey-encoded signer key.
 * @return {Boolean}
 */
export function isPreAuthTxKey(key) {
    return getSignerKeyType(key) === SignerKeyTypes.PRE_AUTH_TX
}

/**
 * Build a normalized signer descriptor from an account signer record.
 * @param {String} accountId - Address of the account the signer belongs to.
 * @param {{key: String, weight: Number, type?: String}} signer - Signer record (Horizon format).
 * @return {SignerDescriptor}
 */
export function createSignerDescriptor(accountId, {key, weight, type}) {
    //Horizon type is authoritative, the key prefix is a fallback for pre-supplied account info
    const descriptor = {key, weight, type: type || getSignerKeyType(key)}
    if (key === accountId) {
        descriptor.isMaster = true
    }
    return descriptor
}

/**
 * Resolve account address, converting muxed (M...) addresses to their underlying G... accounts.
 * @param {String} address - Account address.
 * @return {String}
 */
export function normalizeAccountAddress(address) {
    if (StrKey.isValidMed25519PublicKey(address))
        return StrKey.encodeEd25519PublicKey(StrKey.decodeMed25519PublicKey(address).slice(0, 32))
    if (!StrKey.isValidEd25519PublicKey(address))
        throw new Error(`${address} is not a valid Stellar account public key.`)
    return address
}
