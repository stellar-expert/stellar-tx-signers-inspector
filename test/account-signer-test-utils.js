import {Asset, Operation, TransactionBuilder, Networks} from 'stellar-sdk'
import {HorizonAxiosClient} from 'stellar-sdk'

class FakeHorizon {
    constructor(props) {
        this.accounts = {}
    }

    /**
     * @type {object}
     */
    accounts

    addAccount(account) {
        this.accounts[account.id] = account
        return account
    }

    removeAccount(account) {
        delete this.accounts[account.id]
    }

    lookup(id) {
        return this.accounts[id]
    }

    stubRequests() {
        sinon
            .stub(HorizonAxiosClient, 'get')
            .callsFake(url => {
                const [_, id] = /accounts\/(\w+)/.exec(url),
                    account = this.accounts[id]
                if (account) return Promise.resolve({data: account})
                return Promise.reject({response: {status: 404, statusText: 'Not found', data: {status: 404}}})
            })
    }

    releaseRequests() {
        HorizonAxiosClient.get.restore()
    }
}

const fakeHorizon = new FakeHorizon()

/**
 * Build test transaction.
 * @param {FakeAccountInfo} source - Soruce account info.
 * @param {Array<Operation>} operations - Operations to add.
 * @returns {Transaction}
 */
function buildTransaction(source, operations) {
    const builder = new TransactionBuilder(source, {fee: 10000, networkPassphrase: Networks.TESTNET})
    for (const op of operations) {
        builder.addOperation(op)
    }
    return builder.setTimeout(300).build()
}

export {fakeHorizon, buildTransaction}