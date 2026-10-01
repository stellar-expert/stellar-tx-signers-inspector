import {Horizon, NotFoundError} from '@stellar/stellar-sdk'
import AccountThresholdsDescriptor from './account-thresholds-descriptor.js'
import {SignerKeyTypes, createSignerDescriptor, normalizeAccountAddress} from './signer-keys.js'
import {MAX_SOROBAN_ACCOUNT_SIGNATURES, traverseAuthNodes} from './soroban-auth.js'
import AccountSignatureSchema from './signature-schemas/account-signature-schema.js'
import TransactionSignatureSchema from './signature-schemas/transaction-signature-schema.js'
import SorobanAuthSignatureSchema from './signature-schemas/soroban-auth-signature-schema.js'
import AccountSignatureRequirements from './signature-schemas/requirements/account-signature-requirements.js'
import ExtraSignatureRequirements from './signature-schemas/requirements/extra-signature-requirements.js'
import ContractSignatureRequirements from './signature-schemas/requirements/contract-signature-requirements.js'

const allThresholdLevels = ['low', 'med', 'high']

export default class SignersInspector {
    constructor() {
        this.sources = {}
        this.warnings = []
        this.accountsInfo = {}
        this.createdAccounts = {}
        this.authAccounts = new Set()
        this.missingAccounts = new Set()
    }

    /**
     * @type {Object<string, AccountThresholdsDescriptor>}
     */
    sources

    /**
     * @type {Array<string>}
     */
    extraSigners

    /**
     * @type {Array<SchemaWarning>}
     */
    warnings

    /**
     * @type {Object<string, AccountInfo>}
     */
    accountsInfo

    /**
     * Accounts created by the transaction, mapped to the index of the creating operation.
     * @type {Object<string, number>}
     * @private
     */
    createdAccounts

    /**
     * Accounts referenced by Soroban authorization entries.
     * @type {Set<string>}
     * @private
     */
    authAccounts

    /**
     * Accounts that don't exist on the ledger.
     * @type {Set<string>}
     * @private
     */
    missingAccounts

    discoverRequiredThreshold(requiredThresholds, actualAccountThresholds) {
        let minThreshold = 0
        for (const key of allThresholdLevels) {
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
            case 'setTrustLineFlags':
            case 'claimClaimableBalance':
            case 'inflation':
            case 'extendFootprintTtl':
            case 'restoreFootprint':
                return 'low'
            case 'accountMerge':
                return 'high'
            case 'setOptions': {
                //Core checks field presence, so setting master weight or threshold to 0 still requires high threshold
                const highKeys = ['masterWeight', 'lowThreshold', 'medThreshold', 'highThreshold', 'signer']
                for (const key of highKeys) {
                    if (operation[key] !== undefined && operation[key] !== null) return 'high'
                }
            }
                break
        }
        return 'med'
    }

    /**
     * Set threshold for a given source account.
     * @param {String} source - Account address.
     * @param {'low'|'med'|'high'} threshold - Threshold to meet.
     * @param {Number} [opIndex] - Index of the operation that uses the account as a source (-1 for tx source).
     */
    addSource(source, threshold, opIndex = -1) {
        source = normalizeAccountAddress(source)
        if (!threshold || !allThresholdLevels.includes(threshold))
            throw new Error(`"${threshold}" is not a valid threshold. Expected one of 'low', 'med' or 'high'.`)
        let container = this.sources[source]
        if (!container) {
            container = new AccountThresholdsDescriptor(source, opIndex)
            this.sources[source] = container
        }
        container.setThreshold(threshold)
    }

    /**
     * Register an account created by the transaction.
     * @param {String} account - Created account address.
     * @param {Number} opIndex - Index of the createAccount operation.
     */
    markCreated(account, opIndex) {
        if (!(account in this.createdAccounts)) {
            this.createdAccounts[account] = opIndex
        }
    }

    /**
     * Register an account that needs to authorize Soroban invocations.
     * @param {String} account - Account address.
     */
    addAuthAccount(account) {
        this.authAccounts.add(account)
    }

    /**
     * Set extra signers for a given source account.
     * @param {Array<string>} extraSigners - Extra signers.
     */
    addExtraSigners(extraSigners) {
        this.extraSigners = extraSigners
    }

    /**
     * Load account details for a group of source accounts.
     * @param horizonUrl
     * @param {Array<AccountInfo>} predefinedAccountsInfo
     * @return {Promise}
     */
    async loadAccounts(horizonUrl, predefinedAccountsInfo = []) {
        const horizon = new Horizon.Server(horizonUrl)
        const res = {}
        for (const id of new Set([...Object.keys(this.sources), ...this.authAccounts])) {
            const existing = predefinedAccountsInfo.find(ai => ai.id === id)
            if (existing && existing.thresholds && existing.signers) {
                res[id] = existing
                continue
            }
            try {
                const accountInfo = await horizon.loadAccount(id)
                //cleanup extra information
                delete accountInfo._baseAccount
                res[id] = accountInfo
            } catch (err) {
                //handle empty accounts - Horizon rejects missing accounts with NotFoundError
                if (!(err instanceof NotFoundError))
                    throw err
                this.missingAccounts.add(id)
                const source = this.sources[id]
                if (!source)
                    continue //Soroban host requires authorizing accounts to exist, no fallback for them
                if (!this.isCreatedBeforeUse(source)) {
                    this.warnings.push({
                        code: 'no_source',
                        message: `Source account ${id} does not exist on the ledger.`,
                        data: id
                    })
                }
                //Core checks signatures of missing source accounts against their master key
                res[id] = {
                    id,
                    thresholds: {
                        low_threshold: 0,
                        med_threshold: 0,
                        high_threshold: 0
                    },
                    signers: [{
                        public_key: id,
                        weight: 1,
                        key: id,
                        type: SignerKeyTypes.ED25519
                    }]
                }
            }
        }
        this.accountsInfo = res
        return res
    }

    /**
     * Compose a signature schema for a given input.
     * @param {('tx'|'account')} type - Schema type.
     * @param {Object} [options]
     * @param {String} [options.preAuthKey] - Transaction hash encoded as pre-auth signer key (T...).
     * @param {Array<SorobanAuthSignatureSchema>} [options.sorobanAuth] - Soroban authorization entries schemas.
     * @return {TransactionSignatureSchema|AccountSignatureSchema}
     */
    buildSignatureSchema(type, {preAuthKey, sorobanAuth} = {}) {
        const req = []

        for (const source of Object.values(this.sources)) {
            const {id, thresholds: requiredThresholds} = source
            const accountInfo = this.accountsInfo[id]
            const {thresholds = {}, signers = [{key: id, weight: 1}]} = accountInfo
            //discover minimum sufficient threshold
            const minThreshold = this.discoverRequiredThreshold(requiredThresholds, thresholds)
            //discover potential signers
            const signatureRequirements = new AccountSignatureRequirements(id, minThreshold)
            //set account operation thresholds
            const {low_threshold: low, med_threshold: med, high_threshold: high} = thresholds
            signatureRequirements.setThresholds({low, med, high})
            //detect min required threshold
            for (const signerInfo of signers) {
                const signer = createSignerDescriptor(id, signerInfo)
                if (type === 'tx' && signer.type === SignerKeyTypes.PRE_AUTH_TX) {
                    //pre-auth signer can authorize only the transaction with the matching hash
                    if (signer.key !== preAuthKey)
                        continue
                    signer.implicit = true
                }
                signatureRequirements.addSigner(signer)
            }
            //handle accounts that don't exist yet
            if (!signers.length) {
                signatureRequirements.addSigner({key: id, weight: 1, type: SignerKeyTypes.ED25519, isMaster: true})
            }
            //reorder by weight to simplify optimal schema calculation
            signatureRequirements.sortSigners()
            //add to schema
            req.push(signatureRequirements)
        }

        if (this.extraSigners && this.extraSigners.constructor === Array && this.extraSigners.length > 0) {
            for (const extraSigner of this.extraSigners) {
                const requirements = new ExtraSignatureRequirements(extraSigner)
                if (requirements.signerType === SignerKeyTypes.PRE_AUTH_TX) {
                    this.warnings.push({
                        code: 'unsatisfiable_extra_signer',
                        message: `Extra signer ${extraSigner} is a pre-authorized transaction hash that cannot match the transaction containing it.`,
                        data: extraSigner
                    })
                }
                req.push(requirements)
            }
        }

        switch (type) {
            case 'tx':
                return new TransactionSignatureSchema({
                    warnings: this.warnings, //copy warnings
                    requirements: req,
                    sorobanAuth
                })
            case 'account':
                return new AccountSignatureSchema({
                    warnings: this.warnings, //copy warnings
                    requirements: req
                })
            default:
                throw new Error(`Invalid schema type: "${type}".`)
        }
    }

    /**
     * Compose a signature schema for a Soroban authorization entry.
     * @param {SorobanAuthEntryDescriptor} authEntry - Authorization entry with address credentials.
     * @param {String} networkPassphrase - Network passphrase of the transaction.
     * @return {SorobanAuthSignatureSchema}
     */
    buildSorobanAuthSchema({operationIndex, entryIndex, entry}, networkPassphrase) {
        const warnings = []
        const nodes = traverseAuthNodes(entry.credentials)
        for (const node of nodes) {
            node.requirement = this.buildSorobanNodeRequirements(node, warnings)
        }
        return new SorobanAuthSignatureSchema({operationIndex, entryIndex, entry, networkPassphrase, nodes, warnings})
    }

    /**
     * @param {SorobanAuthNode} node - Authorization node.
     * @param {Array<SchemaWarning>} warnings - Warnings container.
     * @return {AccountSignatureRequirements|ContractSignatureRequirements}
     * @private
     */
    buildSorobanNodeRequirements(node, warnings) {
        const {address, addressType, delegates, path} = node
        const addIssue = (code, message) => {
            node.issue = {code, message}
            warnings.push({code, message, data: address})
        }
        switch (addressType) {
            case 'contract':
                warnings.push({
                    code: 'custom_account_auth',
                    message: `Authentication of ${address} is defined by the custom account contract and cannot be verified offline.`,
                    data: address
                })
                return new ContractSignatureRequirements(address, path)
            case 'account': {
                if (delegates.length) {
                    warnings.push({
                        code: 'ignored_soroban_delegates',
                        message: `Delegated signers attached to ${address} are ignored, Stellar accounts do not delegate Soroban authentication.`,
                        data: address
                    })
                }
                const accountInfo = this.accountsInfo[address]
                if (!accountInfo || this.missingAccounts.has(address)) {
                    addIssue('no_auth_account', `Account ${address} does not exist on the ledger and cannot authorize Soroban invocations.`)
                    return new AccountSignatureRequirements(address, 0, {path, maxSignatures: MAX_SOROBAN_ACCOUNT_SIGNATURES})
                }
                const {thresholds = {}, signers = []} = accountInfo
                const {low_threshold: low, med_threshold: med = 0, high_threshold: high} = thresholds
                //Soroban host authenticates Stellar accounts with medium threshold
                const requirements = new AccountSignatureRequirements(address, med, {path, maxSignatures: MAX_SOROBAN_ACCOUNT_SIGNATURES})
                requirements.setThresholds({low, med, high})
                for (const signerInfo of signers) {
                    const signer = createSignerDescriptor(address, signerInfo)
                    //only Ed25519 signers can sign Soroban authorization payloads
                    if (signer.type === SignerKeyTypes.ED25519) {
                        requirements.addSigner(signer)
                    }
                }
                requirements.sortSigners()
                return requirements
            }
            default:
                addIssue('unsupported_auth_address', `Address ${address} cannot be used in Soroban authorization credentials.`)
                return new AccountSignatureRequirements(address, 0, {path, maxSignatures: MAX_SOROBAN_ACCOUNT_SIGNATURES})
        }
    }

    /**
     * Check whether a missing source account is created by the transaction before its first use.
     * @param {AccountThresholdsDescriptor} source
     * @return {Boolean}
     * @private
     */
    isCreatedBeforeUse(source) {
        const createdAt = this.createdAccounts[source.id]
        return createdAt !== undefined && createdAt < source.firstUse
    }
}
