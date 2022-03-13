import {Keypair} from 'stellar-sdk'
import Bignumber from 'bignumber.js'

class AccountInfo {
    constructor(keypair, sequence) {
        if (!keypair) keypair = Keypair.random()
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
    }

    sequenceNumber() {
        return this.sequence
    }

    accountId() {
        return this.id
    }

    incrementSequenceNumber() {
        this.sequence = new Bignumber(this.sequence).add(new Bignumber(1)).toString()
    }
}

export default AccountInfo