import {Server, StrKey} from 'stellar-sdk'
import AccountThresholdsDescriptor from './account-thresholds-descriptor'
import AccountSignatureSchema from './signature-schemas/account-signature-schema'
import TransactionSignatureSchema from './signature-schemas/transaction-signature-schema'
import AccountSignatureRequirements from './account-signature-requirements'

const allThresholdLevels = ['low', 'med', 'high']

class SignersInspector {
    constructor() {
        this.sources = {}
        this.warnings = []
        this.accountsInfo = []
    }

    /**
     * @type {Object}
     */
    sources

    /**
     * @type {Array<string>}
     */
    warnings

    /**
     * @type {Array<AccountInfo>}
     */
    accountsInfo

    discoverRequiredThreshold(requiredThresholds, actualAccountThresholds) {
        let minThreshold = 0
        for (let key of allThresholdLevels) {
            if (requiredThresholds[key]) {
                const requiredThreshold = actualAccountThresholds[`${key}_threshold`]
                if (requiredThreshold > minThreshold) {
                    minThreshold = requiredThreshold
                }
            }
        }
        return minThreshold
    }

    detectOperationThreshold(operation) {
        switch (operation.type) {
            case 'allowTrust':
            case 'bumpSequence':
                return 'low'
            case 'accountMerge':
                return 'high'
            case 'setOptions':
                const highKeys = ['masterWeight', 'lowThreshold', 'medThreshold', 'highThreshold', 'signer']
                for (let key of highKeys) {
                    if (operation[key]) return 'high'
                }
                break
        }
        return 'med'
    }

    /**
     * Set threshold for a given source account.
     * @param {String} source - Account address.
     * @param {'low'|'med'|'high'} threshold - Threshold to meet.
     */
    addSource(source, threshold) {
        if (!StrKey.isValidEd25519PublicKey(source))
            throw new Error(`${source} is not a valid Stellar account public key.`)
        if (!threshold || !allThresholdLevels.includes(threshold))
            throw new Error(`"${threshold}" is not a valid threshold. Expected one 'low', 'med' or'high'.`)
        let container = this.sources[source]
        if (!container) {
            container = new AccountThresholdsDescriptor(source)
            this.sources[source] = container
        }
        container.setThreshold(threshold)
    }

    /**
     * Load account details for a group of source accounts.
     * @param horizonUrl
     * @param {Array<AccountInfo>} predefinedAccountsInfo
     * @return {Promise}
     */
    async loadAccounts(horizonUrl, predefinedAccountsInfo = []) {
        const horizon = new Server(horizonUrl),
            res = {}
        for (const source of Object.keys(this.sources)) {
            const existing = predefinedAccountsInfo.find(ai => ai.id === source)
            if (existing && existing.thresholds && existing.signers) {
                res[source] = existing
                continue
            }
            try {
                const accountInfo = await horizon.loadAccount(source)
                //cleanup extra information
                delete accountInfo._baseAccount
                res[source] = accountInfo
            } catch (err) {
                //handle empty accounts
                if (err.response && err.response.status === 404) {
                    this.warnings.push({
                        code: 'no_source',
                        message: `Source account ${source} does not exist on the ledger.`,
                        data: source
                    })
                    res[source] = {
                        id: source,
                        thresholds: {
                            low_threshold: 0,
                            med_threshold: 0,
                            high_threshold: 0
                        },
                        signers: [{
                            public_key: source,
                            weight: 1,
                            key: source,
                            type: 'ed25519_public_key'
                        }]
                    }
                    continue
                }
                throw err
            }
        }
        this.accountsInfo = res
        return res
    }

    /**
     * Compose a signature schema for a given input.
     * @param {('tx'|'account')} type - Schema type.
     * @return {TransactionSignatureSchema|AccountSignatureSchema}
     */
    buildSignatureSchema(type) {
        const req = []

        for (let source of Object.values(this.sources)) {
            const {id, thresholds: requiredThresholds} = source,
                accountInfo = this.accountsInfo[id],
                {thresholds = {}, signers = [{key: id, weight: 1}]} = accountInfo
            //discover minimum sufficient threshold
            const minThreshold = this.discoverRequiredThreshold(requiredThresholds, thresholds)
            //discover potential signers
            const signatureRequirements = new AccountSignatureRequirements(id, minThreshold)
            //set account operation thresholds
            const {low_threshold: low, med_threshold: med, high_threshold: high} = accountInfo.thresholds
            signatureRequirements.setThresholds({low, med, high})
            //detect min required threshold
            for (let {key, weight} of signers) {
                const signer = {key, weight}
                if (key === id) {
                    signer.isMaster = true
                }
                signatureRequirements.addSigner(signer)
            }
            //handle accounts that don't exist yet
            if (!signers.length) {
                signatureRequirements.addSigner({key: id, weight: 1})
            }
            //reorder by weight to simplify optimal schema calculation
            signatureRequirements.sortSigners()
            //add to schema
            req.push(signatureRequirements)
        }

        let schemaConstructor
        switch (type) {
            case 'tx':
                schemaConstructor = TransactionSignatureSchema
                break
            case 'account':
                schemaConstructor = AccountSignatureSchema
                break
            default:
                throw new Error(`Invalid schema type: "${type}".`)
        }

        return new schemaConstructor({
            warnings: this.warnings, //copy warnings
            requirements: req
        })
    }
}

export default SignersInspector
