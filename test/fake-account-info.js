import {Keypair} from '@stellar/stellar-sdk'
import {fakeHorizon} from './account-signer-test-utils'

/**
 * Clone of account wrapper from StellarSdk
 */
export default class FakeAccountInfo {
    constructor(keypair, sequence) {
        if (!keypair)
            keypair = Keypair.random()
        this.secret = keypair.secret()
        this.id = this.account_id = keypair.publicKey()
        this.sequence = (sequence || 0).toString()
        this.subentry_count = 0
        this.balances = []
        this.signers = [{ //add default master key signer
            type: 'ed25519_public_key',
            key: this.id,
            weight: 1
        }]
        this.thresholds = {
            low_threshold: 0,
            med_threshold: 0,
            high_threshold: 0
        }
        this.flags = {
            auth_required: false,
            auth_revocable: false,
            auth_immutable: false
        }
        fakeHorizon.addAccount(this)
    }

    sequenceNumber() {
        return this.sequence
    }

    accountId() {
        return this.id
    }

    incrementSequenceNumber() {
        this.sequence = (BigInt(this.sequence)+1n).toString()
    }

    /**
     * Add specific signer to the list of signers.
     * @param {string|FakeAccountInfo} key - Signer id (public key, hash, or tx hash)
     * @param {number} weight - Signer weight.
     * @return {FakeAccountInfo}
     */
    withSigner(key, weight) {
        if (key.id) {
            key = key.id
        }
        //{'ed25519_public_key'|'sha256_hash'|'preauth_tx'} type - Signer type.
        this.signers.push({type: 'ed25519_public_key', key, weight})
        return this
    }

    /**
     * Set weight for a master key.
     * @param {number} weight - Master key weight to set.
     * @returns {FakeAccountInfo}
     */
    withMasterWeight(weight) {
        const self = this.signers.find(s => s.key === this.id)
        self.weight = weight
        return this
    }

    /**
     * Set account thresholds.
     * @param {number} low - Low threshold value.
     * @param {number} med - Medium threshold value.
     * @param {number} high - High threshold value.
     * @returns {FakeAccountInfo}
     */
    withThresholds(low, med, high) {
        Object.assign(this.thresholds, {
            low_threshold: low,
            med_threshold: med,
            high_threshold: high
        })
        return this
    }

    /**
     * Add account balance record.
     * @param {string|number} balance - Asset balance amount.
     * @param {string} [assetCode] - Asset code.
     * @param {string} [assetIssuer] - Asset issuer address.
     * @param {string} [buyingLiabilities] - Locked asset buying liabilities amount.
     * @param {string} [sellingLiabilities] - Locked asset selling liabilities amount.
     * @returns {FakeAccountInfo}
     */
    withBalance(balance, assetCode, assetIssuer, buyingLiabilities, sellingLiabilities) {
        const asset_type = assetCode ? (assetCode.length > 4 ? 'credit_alphanum12' : 'credit_alphanum4') : 'native'
        this.balances.push({
            balance: parseFloat(balance).toFixed(7),
            asset_type,
            asset_code: assetCode,
            asset_issuer: assetIssuer,
            buying_liabilities: buyingLiabilities || '0.0000000',
            selling_liabilities: sellingLiabilities || '0.0000000'
        })
        return this
    }

    /**
     * Create basic account with a given starting XLM balance and sequence number.
     * @param {string|number} [startingBalance] - Account starting XLM balance.
     * @param {string|number} [sequence] - Sequence number.
     * @returns {FakeAccountInfo}
     */
    static basic(startingBalance = 1.01, sequence = 1) {
        return new FakeAccountInfo(Keypair.random(), sequence).withBalance(startingBalance)
    }

    /**
     * Create a raw keypair with balances/liabilities.
     * @returns {FakeAccountInfo}
     */
    static get empty() {
        const keypair = Keypair.random()
        return {id: keypair.publicKey(), secret: keypair.secret()}
    }

    /**
     * Create an account that "does not exist" on fake Horizon
     * @param {string} secret - Account secret key.
     * @returns {FakeAccountInfo}
     */
    static nonExisting({secret}) {
        const account = new FakeAccountInfo(Keypair.fromSecret(secret))
        //fake Horizon shouldn't return the record for this account
        fakeHorizon.removeAccount(account)
        return account
    }
}