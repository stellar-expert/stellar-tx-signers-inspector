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
 * @param {Transaction} tx - Transaction to assess.
 * @param {InspectionOptions} [options] - Inspection options.
 * @return {Promise<TransactionSignatureSchema>}
 */
async function inspectTransactionSigners(tx, options = null) {
    //check the input params using duck typing
    if (!tx.source || !(tx.operations instanceof Array))
        throw new Error('Invalid parameter "tx". Expected a Stellar transaction.')
    //initialize inspector
    const inspector = new SignersInspector()
    //add tx source account by default
    inspector.addSource(tx.source, 'low')
    //process source account for each operation
    for (let operation of tx.operations) {
        inspector.addSource(operation.source || tx.source, inspector.detectOperationThreshold(operation))
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
async function inspectAccountSigners(sourceAccount, options = null) {
    if (!sourceAccount)
        throw new Error('Invalid parameter "sourceAccount". Expected a valid Stellar public key.')

    const inspector = new SignersInspector()
    //analyze all thresholds
    for (let threshold of ['low', 'med', 'high']) {
        inspector.addSource(sourceAccount, threshold)
    }
    const {accountsInfo, horizon = defaultHorizon} = options || {}
    //load all source accounts
    await inspector.loadAccounts(horizon, accountsInfo)
    //build and return composed signatures schema
    return inspector.buildSignatureSchema('account')
}

export {inspectTransactionSigners, inspectAccountSigners}
