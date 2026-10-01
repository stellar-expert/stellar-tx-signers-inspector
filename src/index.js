import {SignerKey, StrKey} from '@stellar/stellar-sdk'
import SignersInspector from './signers-inspector.js'
import {validateSponsorships} from './sponsorship-validator.js'
import {collectAuthEntries, traverseAuthNodes} from './soroban-auth.js'

const defaultHorizon = 'https://horizon.stellar.org'


/**
 * @typedef {Object} SigningThresholds
 * @property {number} low_threshold - Account threshold for "low-threshold" operations.
 * @property {number} med_threshold - Account threshold for "medium-threshold" operations.
 * @property {number} high_threshold - Account threshold for "high-threshold" operations.
 */

/**
 * @typedef {Object} AccountInfo
 * @property {String} id - Account id.
 * @property {SigningThresholds} thresholds - Account id.
 * @property {Array<{key: string, weight: number, type: [string]}>} signers - Signers of the account.
 */

/**
 * @typedef {Object} SchemaWarning
 * @property {String} code - Unique warning code.
 * @property {String} message - Human-readable warning description.
 * @property {String} data - Address or signer key the warning refers to.
 */

/**
 * @typedef {Object} InspectionOptions
 * @property {String} [horizon] - Horizon address used to fetch accounts state if one more source accounts were not provided. Defaults to "https://horizon.stellar.org".
 * @property {Array<AccountInfo>} [accountsInfo] - Array containing accounts information pre-fetched from Horizon "/account/{id}" endpoint.
 * @property {Boolean} [sorobanAuth] - Analyze signature schemas of Soroban authorization entries. Defaults to true.
 */

/**
 * Discover required signers for a given transaction.
 * @param {Transaction|FeeBumpTransaction} tx - Transaction to assess.
 * @param {InspectionOptions} [options] - Inspection options.
 * @return {Promise<TransactionSignatureSchema>}
 */
export async function inspectTransactionSigners(tx, options = null) {
    const {accountsInfo, horizon = defaultHorizon, sorobanAuth = true} = options || {}
    //initialize inspector
    const inspector = new SignersInspector()
    let operations
    //check input params using duck typing
    if (tx.feeSource && tx.innerTransaction) { //fee source tx
        //add tx source account by default
        inspector.addSource(tx.feeSource, 'low')
        //inner transaction is already signed, its Soroban auth entries can only be verified
        operations = tx.innerTransaction.operations
    } else { //regular tx
        if (!tx.source || !(tx.operations instanceof Array))
            throw new Error('Invalid parameter "tx". Expected a Stellar transaction.')
        operations = tx.operations
        //add tx source account by default
        inspector.addSource(tx.source, 'low')
        //process source account for each operation
        operations.forEach((operation, index) => {
            inspector.addSource(operation.source || tx.source, inspector.detectOperationThreshold(operation), index)
            if (operation.type === 'createAccount') {
                inspector.markCreated(operation.destination, index)
            }
        })
        inspector.warnings.push(...validateSponsorships(operations, tx.source))
    }
    if (tx.extraSigners && tx.extraSigners.constructor === Array && tx.extraSigners.length > 0) {
        inspector.addExtraSigners(tx.extraSigners.map(signer => SignerKey.encodeSignerKey(signer)))
    }
    //Soroban auth entries with address credentials require signatures separate from the tx envelope signatures
    const authEntries = collectAuthEntries(operations || [])
    if (sorobanAuth) {
        for (const {entry} of authEntries) {
            for (const {address, addressType} of traverseAuthNodes(entry.credentials)) {
                if (addressType === 'account') {
                    inspector.addAuthAccount(address)
                }
            }
        }
    } else if (!tx.innerTransaction) {
        for (const {operationIndex, entryIndex, entry} of authEntries) {
            const {address} = traverseAuthNodes(entry.credentials)[0]
            inspector.warnings.push({
                code: 'soroban_auth',
                message: `Soroban authorization entry #${entryIndex} of operation #${operationIndex} requires a separate signature from ${address}. Enable "sorobanAuth" option to inspect it.`,
                data: address
            })
        }
    }
    //load all source accounts
    await inspector.loadAccounts(horizon, accountsInfo)
    //build and return composed signatures schema
    return inspector.buildSignatureSchema('tx', {
        preAuthKey: StrKey.encodePreAuthTx(tx.hash()),
        sorobanAuth: sorobanAuth ?
            authEntries.map(authEntry => inspector.buildSorobanAuthSchema(authEntry, tx.networkPassphrase)) :
            []
    })
}

/**
 * Discover required signers for a given account and thresholds.
 * @param {String} sourceAccount - Stellar account to examine.
 * @param {InspectionOptions} [options] - Inspection options.
 * @return {Promise<AccountSignatureSchema>}
 */
export async function inspectAccountSigners(sourceAccount, options = null) {
    if (!sourceAccount)
        throw new Error('Invalid parameter "sourceAccount". Expected a valid Stellar public key.')

    const inspector = new SignersInspector()
    //analyze all thresholds
    for (const threshold of ['low', 'med', 'high']) {
        inspector.addSource(sourceAccount, threshold)
    }
    const {accountsInfo, horizon = defaultHorizon} = options || {}
    //load all source accounts
    await inspector.loadAccounts(horizon, accountsInfo)
    //build and return composed signatures schema
    return inspector.buildSignatureSchema('account')
}
