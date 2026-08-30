import {TransactionBuilder, Networks, Keypair} from '@stellar/stellar-sdk'

/**
 * In-memory Horizon mock that intercepts the global fetch used by the SDK http client.
 */
class FakeHorizon {
    constructor() {
        this.accounts = {}
        this.requests = []
    }

    /**
     * Registered accounts indexed by address.
     * @type {Object}
     */
    accounts

    /**
     * Addresses requested since the last stubRequests() call.
     * @type {Array<string>}
     */
    requests

    /**
     * @type {Function|null}
     * @private
     */
    originalFetch = null

    /**
     * Register an account so that it can be resolved by the fake Horizon.
     * @param {FakeAccountInfo} account
     * @return {FakeAccountInfo}
     */
    addAccount(account) {
        this.accounts[account.id] = account
        return account
    }

    /**
     * Unregister an account to emulate a missing ledger entry.
     * @param {FakeAccountInfo} account
     */
    removeAccount(account) {
        delete this.accounts[account.id]
    }

    /**
     * Find a registered account by address.
     * @param {String} id
     * @return {FakeAccountInfo|undefined}
     */
    lookup(id) {
        return this.accounts[id]
    }

    /**
     * Replace the global fetch with the fake Horizon responder.
     * SDK v17 dropped Horizon.AxiosClient in favor of a feaxios-based client that calls global fetch.
     */
    stubRequests() {
        if (this.originalFetch)
            throw new Error('Fake Horizon requests are already stubbed.')
        this.originalFetch = globalThis.fetch
        this.requests = []
        globalThis.fetch = async url => {
            const [, id] = /accounts\/(\w+)/.exec(url.toString())
            this.requests.push(id)
            const account = this.accounts[id]
            if (!account)
                return jsonResponse({
                    type: 'https://stellar.org/horizon-errors/not_found',
                    title: 'Resource Missing',
                    status: 404,
                    detail: 'The resource at the url requested was not found.'
                }, 404, 'Not Found')
            return jsonResponse(account)
        }
    }

    /**
     * Restore the original global fetch.
     */
    releaseRequests() {
        if (!this.originalFetch)
            return
        globalThis.fetch = this.originalFetch
        this.originalFetch = null
    }
}

/**
 * @param {Object} body
 * @param {Number} [status]
 * @param {String} [statusText]
 * @return {Response}
 */
function jsonResponse(body, status = 200, statusText = 'OK') {
    return new Response(JSON.stringify(body), {
        status,
        statusText,
        headers: {'content-type': 'application/json', date: new Date().toUTCString()}
    })
}

export const fakeHorizon = new FakeHorizon()

/**
 * Build test transaction.
 * @param {FakeAccountInfo|MuxedAccount} source - Source account info.
 * @param {Array<Operation>} operations - Operations to add.
 * @param {Array<String>} [extraSigners] - Extra signers to add.
 * @returns {Transaction}
 */
export function buildTransaction(source, operations, extraSigners) {
    const builder = new TransactionBuilder(source, {fee: 10000, networkPassphrase: Networks.TESTNET})
    for (const op of operations) {
        builder.addOperation(op)
    }
    if (extraSigners && extraSigners.constructor === Array && extraSigners.length > 0) {
        builder.setExtraSigners(extraSigners)
    }
    return builder.setTimeout(300).build()
}

/**
 * Build fee bump transaction.
 * @param {Transaction} innerTx - Inner transaction to wrap.
 * @param {FakeAccountInfo} source - Source account info.
 * @param {String} [baseFee] - Base fee for the transaction.
 * @returns {FeeBumpTransaction}
 */
export function buildFeeBumpTransaction(innerTx, source, baseFee = '10000') {
    return TransactionBuilder.buildFeeBumpTransaction(Keypair.fromPublicKey(source.id), baseFee, innerTx, Networks.TESTNET)
}

/**
 * Assert that two arrays contain the same elements regardless of their order.
 * @param {Array<string>} actual
 * @param {Array<string>} expected
 */
export function expectSameMembers(actual, expected) {
    expect([...actual].sort()).toEqual([...expected].sort())
}
