import {SignerKey} from 'stellar-sdk'
import SignersInspector from './signers-inspector'

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
 * @property {Array<{key: string, weight: number}>} signers - Signers of the account.
 */

/**
 * @typedef {Object} InspectionOptions
 * @property {String} [horizon] - Horizon address used to fetch accounts state if one more source accounts were not provided. Defaults to "https://horizon.stellar.org".
 * @property {Array<AccountInfo>} [accountsInfo] - Array containing accounts information pre-fetched from Horizon "/account/{id}" endpoint.
 */

/**
 * Discover required signers for a given transaction.
 * @param {Transaction|FeeBumpTransaction} tx - Transaction to assess.
 * @param {InspectionOptions} [options] - Inspection options.
 * @return {Promise<TransactionSignatureSchema>}
 */
export async function inspectTransactionSigners(tx, options = null) {
    //initialize inspector
    const inspector = new SignersInspector()
    //check input params using duck typing
    if (tx.feeSource && tx.innerTransaction) { //fee source tx
        //add tx source account by default
        inspector.addSource(tx.feeSource, 'low')
    } else { //regular tx
        if (!tx.source || !(tx.operations instanceof Array))
            throw new Error('Invalid parameter "tx". Expected a Stellar transaction.')
        //add tx source account by default
        inspector.addSource(tx.source, 'low')
        //process source account for each operation
        for (const operation of tx.operations) {
            inspector.addSource(operation.source || tx.source, inspector.detectOperationThreshold(operation))
        }
    }
    if (tx.extraSigners && tx.extraSigners.constructor === Array && tx.extraSigners.length > 0) {
        inspector.addExtraSigners(tx.extraSigners.map(signer => SignerKey.encodeSignerKey(signer)))
    }
    const {accountsInfo, horizon = defaultHorizon} = options || {}
    //load all source accounts
    await inspector.loadAccounts(horizon, accountsInfo)
    //build and return composed signatures schema
    return inspector.buildSignatureSchema('tx')
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
