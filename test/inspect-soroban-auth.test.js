import {
    Address,
    Keypair,
    MuxedAccount,
    Account,
    Networks,
    Operation,
    StrKey,
    xdr,
    hash,
    nativeToScVal,
    authorizeEntry,
    authorizeInvocation,
    buildAuthorizationEntryPreimage,
    buildWithDelegatesEntry
} from '@stellar/stellar-sdk'
import {inspectTransactionSigners} from '../src/index.js'
import {compareBytes} from '../src/soroban-auth.js'
import SignatureRequirementsTypes from '../src/signature-schemas/requirements/signature-requirements-types.js'
import {fakeHorizon, buildTransaction, buildFeeBumpTransaction, expectSameMembers} from './account-signer-test-utils.js'
import FakeAccountInfo from './fake-account-info.js'

const validUntil = 1000
const tokenContract = randomContract()

function randomContract() {
    return StrKey.encodeContract(hash(Keypair.random().rawPublicKey()))
}

function buildInvocation() {
    return new xdr.SorobanAuthorizedInvocation({
        function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(new xdr.InvokeContractArgs({
            contractAddress: new Address(tokenContract).toScAddress(),
            functionName: 'transfer',
            args: []
        })),
        subInvocations: []
    })
}

function buildAddressCredentials(address, signature = xdr.ScVal.scvVoid()) {
    return new xdr.SorobanAddressCredentials({
        address: new Address(address).toScAddress(),
        nonce: 1n,
        signatureExpirationLedger: validUntil,
        signature
    })
}

function buildUnsignedEntry(address, authV2 = true) {
    const credentials = buildAddressCredentials(address)
    return new xdr.SorobanAuthorizationEntry({
        credentials: authV2 ?
            xdr.SorobanCredentials.sorobanCredentialsAddressV2(credentials) :
            xdr.SorobanCredentials.sorobanCredentialsAddress(credentials),
        rootInvocation: buildInvocation()
    })
}

/**
 * Build AccountEd25519Signature vector sorted by public key
 */
function buildAccountSignatures(keypairs, payload, reverse = false) {
    const sorted = [...keypairs].sort((a, b) => compareBytes(a.rawPublicKey(), b.rawPublicKey()))
    if (reverse) {
        sorted.reverse()
    }
    return xdr.ScVal.scvVec(sorted.map(kp => nativeToScVal(
        {public_key: kp.rawPublicKey(), signature: kp.sign(payload)},
        {type: {public_key: ['symbol', null], signature: ['symbol', null]}}
    )))
}

function signEntry(entry, keypairs, {forAddress, reverse} = {}) {
    return authorizeEntry(
        entry,
        async (preimage, payload) => ({signatureScVal: buildAccountSignatures(keypairs, payload, reverse)}),
        validUntil,
        Networks.TESTNET,
        forAddress
    )
}

function keypairOf(account) {
    return Keypair.fromSecret(account.secret)
}

function buildSorobanTx(source, entries) {
    return buildTransaction(source, [
        Operation.invokeContractFunction({contract: tokenContract, function: 'transfer', args: [], auth: entries})
    ])
}

function errorCodes(verification) {
    return verification.errors.map(e => e.code)
}

describe('inspectTransactionSigners() with Soroban authorization entries', () => {
    beforeEach(() => {
        fakeHorizon.stubRequests()
    })

    afterEach(() => {
        fakeHorizon.releaseRequests()
    })

    test('reports Soroban auth entries without inspecting them when disabled', async () => {
        const src = FakeAccountInfo.basic()
        const signer = FakeAccountInfo.basic()
        const entry = await authorizeInvocation({
            signer: keypairOf(signer),
            validUntilLedgerSeq: validUntil,
            invocation: buildInvocation(),
            networkPassphrase: Networks.TESTNET
        })
        const tx = buildSorobanTx(src, [entry])

        const schema = await inspectTransactionSigners(tx, {sorobanAuth: false})

        expect(schema.sorobanAuth).toEqual([])
        expect(schema.warnings.map(({code, data}) => ({code, data}))).toEqual([{code: 'soroban_auth', data: signer.id}])
        expect(schema.discoverSigners()).toEqual([src.id])
        expect(fakeHorizon.requests).toEqual([src.id])
    })

    test('skips entries with source account credentials', async () => {
        const src = FakeAccountInfo.basic()
        const entry = new xdr.SorobanAuthorizationEntry({
            credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
            rootInvocation: buildInvocation()
        })
        const tx = buildSorobanTx(src, [entry])

        const schema = await inspectTransactionSigners(tx)

        expect(schema.warnings).toEqual([])
        expect(schema.sorobanAuth).toEqual([])
        expect(schema.discoverSigners()).toEqual([src.id])
    })

    test.each([
        [false, 'address'],
        [true, 'address_v2']
    ])('discovers and verifies Stellar account credentials (authV2: %s)', async (authV2, credentialsType) => {
        const src = FakeAccountInfo.basic()
        const signer = FakeAccountInfo.basic()
        const entry = await authorizeInvocation({
            signer: keypairOf(signer),
            validUntilLedgerSeq: validUntil,
            invocation: buildInvocation(),
            networkPassphrase: Networks.TESTNET,
            authV2
        })
        const tx = buildSorobanTx(src, [entry])

        //auth entries are analyzed by default
        const schema = await inspectTransactionSigners(tx)

        //auth entries are signed separately from the tx envelope
        expect(schema.warnings).toEqual([])
        expect(schema.discoverSigners()).toEqual([src.id])
        expectSameMembers(fakeHorizon.requests, [src.id, signer.id])

        expect(schema.sorobanAuth.length).toBe(1)
        const [auth] = schema.sorobanAuth
        expect(auth.operationIndex).toBe(0)
        expect(auth.entryIndex).toBe(0)
        expect(auth.address).toBe(signer.id)
        expect(auth.credentialsType).toBe(credentialsType)
        expect(auth.signatureExpirationLedger).toBe(validUntil)
        expect(auth.warnings).toEqual([])
        expect(auth.requirements).toEqual([{
            type: SignatureRequirementsTypes.ACCOUNT_SIGNATURE,
            id: signer.id,
            minThreshold: 0,
            thresholds: {low: 0, med: 0, high: 0},
            path: [],
            maxSignatures: 20,
            signers: [{key: signer.id, weight: 1, type: 'ed25519_public_key', isMaster: true}]
        }])
        expect(auth.getAllPotentialSigners()).toEqual([signer.id])
        expect(auth.discoverSigners()).toEqual([signer.id])
        expect(auth.checkFeasibility([src.id])).toBe(false)
        expect(auth.checkFeasibility([signer.id])).toBe(true)
        expect(auth.getSignaturePayload())
            .toEqual(hash(buildAuthorizationEntryPreimage(entry, validUntil, Networks.TESTNET).toXdr()))
        expect(auth.verifySignatures()).toEqual([{
            id: signer.id,
            path: [],
            signed: true,
            valid: true,
            signers: [signer.id],
            weight: 1,
            errors: []
        }])
    })

    test('rejects legacy signatures attached to address-bound credentials', async () => {
        const src = FakeAccountInfo.basic()
        const signer = FakeAccountInfo.basic()
        const legacyEntry = await authorizeInvocation({
            signer: keypairOf(signer),
            validUntilLedgerSeq: validUntil,
            invocation: buildInvocation(),
            networkPassphrase: Networks.TESTNET,
            authV2: false
        })
        const entry = new xdr.SorobanAuthorizationEntry({
            credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(legacyEntry.credentials.address),
            rootInvocation: legacyEntry.rootInvocation
        })
        const tx = buildSorobanTx(src, [entry])

        const schema = await inspectTransactionSigners(tx)

        const [verification] = schema.sorobanAuth[0].verifySignatures()
        expect(verification.valid).toBe(false)
        expect(verification.errors).toEqual([{
            code: 'invalid_signature',
            message: expect.any(String),
            data: signer.id
        }])
    })

    describe('Stellar account multisig', () => {
        const cosignerA = Keypair.random()
        const cosignerB = Keypair.random()
        let account
        let accountKeypair

        beforeEach(() => {
            account = FakeAccountInfo.basic(10)
                .withThresholds(1, 3, 5)
                .withSigner(cosignerA.publicKey(), 2)
                .withSigner(cosignerB.publicKey(), 1)
                .withSigner(StrKey.encodePreAuthTx(hash(Keypair.random().rawPublicKey())), 5)
                .withSigner(StrKey.encodeSha256Hash(hash(Keypair.random().rawPublicKey())), 5)
            accountKeypair = keypairOf(account)
        })

        async function inspectEntries(entries) {
            const tx = buildSorobanTx(FakeAccountInfo.basic(), entries)
            const schema = await inspectTransactionSigners(tx)
            return schema.sorobanAuth
        }

        test('uses medium threshold and Ed25519 signers only', async () => {
            const [auth] = await inspectEntries([buildUnsignedEntry(account.id)])

            const [requirements] = auth.requirements
            expect(requirements.minThreshold).toBe(3)
            expect(requirements.signers.map(s => s.key)).toEqual([cosignerA.publicKey(), account.id, cosignerB.publicKey()])
            expectSameMembers(auth.getAllPotentialSigners(), [cosignerA.publicKey(), account.id, cosignerB.publicKey()])
            expect(auth.discoverSigners()).toEqual([cosignerA.publicKey(), account.id])
            expect(auth.discoverSigners([account.id, cosignerB.publicKey()])).toEqual([])
            expect(auth.checkFeasibility([cosignerA.publicKey(), cosignerB.publicKey()])).toBe(true)
        })

        test('verifies attached signatures weight', async () => {
            const [insufficient, sufficient] = await inspectEntries([
                await signEntry(buildUnsignedEntry(account.id), [accountKeypair, cosignerB]),
                await signEntry(buildUnsignedEntry(account.id), [accountKeypair, cosignerA])
            ])

            expect(insufficient.entryIndex).toBe(0)
            const [insufficientVerification] = insufficient.verifySignatures()
            expect(insufficientVerification.valid).toBe(false)
            expect(insufficientVerification.weight).toBe(2)
            expect(errorCodes(insufficientVerification)).toEqual(['insufficient_weight'])

            expect(sufficient.entryIndex).toBe(1)
            const [sufficientVerification] = sufficient.verifySignatures()
            expect(sufficientVerification.valid).toBe(true)
            expect(sufficientVerification.weight).toBe(3)
            expectSameMembers(sufficientVerification.signers, [account.id, cosignerA.publicKey()])
        })

        test('detects malformed signatures', async () => {
            const stranger = Keypair.random()
            const malformed = buildUnsignedEntry(account.id)
            malformed.credentials.addressV2.signature = xdr.ScVal.scvU32(1)
            const auth = await inspectEntries([
                buildUnsignedEntry(account.id),
                await signEntry(buildUnsignedEntry(account.id), [accountKeypair, cosignerA], {reverse: true}),
                await signEntry(buildUnsignedEntry(account.id), [cosignerA, stranger]),
                malformed
            ])
            const [[missing], [unordered], [unknown], [invalid]] = auth.map(a => a.verifySignatures())

            expect(missing.signed).toBe(false)
            expect(errorCodes(missing)).toEqual(['missing_signature'])
            expect(errorCodes(unordered)).toEqual(['unordered_signatures'])
            expect(unknown.errors.map(({code, data}) => ({code, data}))).toEqual([
                {code: 'unknown_signer', data: stranger.publicKey()},
                {code: 'insufficient_weight', data: account.id}
            ])
            expect(invalid.signed).toBe(true)
            expect(errorCodes(invalid)).toEqual(['malformed_signature'])
        })

        test('limits the number of signatures', async () => {
            const cosigners = Array.from({length: 21}, () => Keypair.random())
            const large = FakeAccountInfo.basic(10)
                .withThresholds(21, 21, 21)
                .withMasterWeight(0)
            for (const cosigner of cosigners) {
                large.withSigner(cosigner.publicKey(), 1)
            }

            const [auth] = await inspectEntries([await signEntry(buildUnsignedEntry(large.id), cosigners)])

            expect(auth.discoverSigners()).toEqual([])
            expect(auth.checkFeasibility(cosigners.map(kp => kp.publicKey()))).toBe(false)
            expect(errorCodes(auth.verifySignatures()[0])).toEqual(['too_many_signatures'])
        })
    })

    describe('delegated signers (CAP-71-01)', () => {
        test('inspects delegated signers of custom accounts', async () => {
            const src = FakeAccountInfo.basic()
            const smartAccount = randomContract()
            const nestedSmartAccount = randomContract()
            const delegateCosigner = Keypair.random()
            const delegate = FakeAccountInfo.basic()
                .withThresholds(2, 2, 2)
                .withSigner(delegateCosigner.publicKey(), 1)
            const nestedDelegate = FakeAccountInfo.basic()
            let entry = buildWithDelegatesEntry({
                entry: buildUnsignedEntry(smartAccount),
                validUntilLedgerSeq: validUntil,
                delegates: [
                    {address: nestedSmartAccount, nestedDelegates: [{address: nestedDelegate.id}]},
                    {address: delegate.id}
                ]
            })
            entry = await signEntry(entry, [keypairOf(delegate), delegateCosigner], {forAddress: delegate.id})
            entry = await signEntry(entry, [keypairOf(nestedDelegate)], {forAddress: nestedDelegate.id})
            const tx = buildSorobanTx(src, [entry])

            const schema = await inspectTransactionSigners(tx)

            //custom accounts are never loaded from Horizon
            expectSameMembers(fakeHorizon.requests, [src.id, delegate.id, nestedDelegate.id])
            const [auth] = schema.sorobanAuth
            expect(auth.credentialsType).toBe('address_with_delegates')
            expect(auth.address).toBe(smartAccount)
            //delegates are sorted by address, Stellar accounts go before contracts
            expect(auth.requirements.map(({type, id, path}) => ({type, id, path}))).toEqual([
                {type: SignatureRequirementsTypes.CONTRACT_SIGNATURE, id: smartAccount, path: []},
                {type: SignatureRequirementsTypes.ACCOUNT_SIGNATURE, id: delegate.id, path: [0]},
                {type: SignatureRequirementsTypes.CONTRACT_SIGNATURE, id: nestedSmartAccount, path: [1]},
                {type: SignatureRequirementsTypes.ACCOUNT_SIGNATURE, id: nestedDelegate.id, path: [1, 0]}
            ])
            expect(auth.warnings.map(({code, data}) => ({code, data}))).toEqual([
                {code: 'custom_account_auth', data: smartAccount},
                {code: 'custom_account_auth', data: nestedSmartAccount}
            ])
            expectSameMembers(auth.getAllPotentialSigners(), [delegate.id, delegateCosigner.publicKey(), nestedDelegate.id])
            expectSameMembers(auth.discoverSigners(), [delegate.id, delegateCosigner.publicKey(), nestedDelegate.id])
            expect(auth.checkFeasibility([delegate.id, nestedDelegate.id])).toBe(false)
            //all delegates sign the address-bound payload of the top-level account
            expect(auth.verifySignatures().map(({id, path, signed, valid, weight}) => ({id, path, signed, valid, weight}))).toEqual([
                {id: smartAccount, path: [], signed: false, valid: null, weight: 0},
                {id: delegate.id, path: [0], signed: true, valid: true, weight: 2},
                {id: nestedSmartAccount, path: [1], signed: false, valid: null, weight: 0},
                {id: nestedDelegate.id, path: [1, 0], signed: true, valid: true, weight: 1}
            ])
        })

        test('detects unordered delegates', async () => {
            const smartAccount = randomContract()
            const delegateSignature = address => new xdr.SorobanDelegateSignature({
                address: new Address(address).toScAddress(),
                signature: xdr.ScVal.scvVoid(),
                nestedDelegates: []
            })
            const entry = new xdr.SorobanAuthorizationEntry({
                credentials: xdr.SorobanCredentials.sorobanCredentialsAddressWithDelegates(new xdr.SorobanAddressCredentialsWithDelegates({
                    addressCredentials: buildAddressCredentials(smartAccount),
                    delegates: [delegateSignature(randomContract()), delegateSignature(FakeAccountInfo.basic().id)]
                })),
                rootInvocation: buildInvocation()
            })
            const tx = buildSorobanTx(FakeAccountInfo.basic(), [entry])

            const schema = await inspectTransactionSigners(tx)

            const [top] = schema.sorobanAuth[0].verifySignatures()
            expect(top.valid).toBe(false)
            expect(top.errors.map(({code, data}) => ({code, data}))).toEqual([{code: 'unordered_delegates', data: smartAccount}])
        })

        test('ignores delegates attached to Stellar accounts', async () => {
            const signer = FakeAccountInfo.basic()
            const delegate = FakeAccountInfo.basic()
            let entry = buildWithDelegatesEntry({
                entry: buildUnsignedEntry(signer.id),
                validUntilLedgerSeq: validUntil,
                delegates: [{address: delegate.id}]
            })
            entry = await signEntry(entry, [keypairOf(signer)], {forAddress: signer.id})
            const src = FakeAccountInfo.basic()
            const tx = buildSorobanTx(src, [entry])

            const schema = await inspectTransactionSigners(tx)

            expectSameMembers(fakeHorizon.requests, [src.id, signer.id])
            const [auth] = schema.sorobanAuth
            expect(auth.warnings.map(({code, data}) => ({code, data}))).toEqual([{code: 'ignored_soroban_delegates', data: signer.id}])
            expect(auth.requirements.map(r => r.id)).toEqual([signer.id])
            expect(auth.discoverSigners()).toEqual([signer.id])
            expect(auth.verifySignatures()[0].valid).toBe(true)
        })
    })

    test('requires authorizing accounts to exist', async () => {
        const src = FakeAccountInfo.basic()
        const missing = FakeAccountInfo.nonExisting(FakeAccountInfo.empty)
        const entry = await signEntry(buildUnsignedEntry(missing.id), [keypairOf(missing)])
        const tx = buildSorobanTx(src, [entry])

        const schema = await inspectTransactionSigners(tx)

        //the account is not a tx source, so there is no classic fallback for it
        expect(schema.warnings).toEqual([])
        const [auth] = schema.sorobanAuth
        expect(auth.warnings.map(({code, data}) => ({code, data}))).toEqual([{code: 'no_auth_account', data: missing.id}])
        expect(auth.discoverSigners()).toEqual([])
        expect(auth.checkFeasibility([missing.id])).toBe(false)
        expect(errorCodes(auth.verifySignatures()[0])).toEqual(['no_auth_account'])
    })

    test('rejects unsupported credentials addresses', async () => {
        const base = FakeAccountInfo.basic()
        const muxed = new MuxedAccount(new Account(base.id, '0'), '1').accountId()
        const tx = buildSorobanTx(FakeAccountInfo.basic(), [buildUnsignedEntry(muxed)])

        const schema = await inspectTransactionSigners(tx)

        const [auth] = schema.sorobanAuth
        expect(auth.warnings.map(({code, data}) => ({code, data}))).toEqual([{code: 'unsupported_auth_address', data: muxed}])
        expect(auth.checkFeasibility([base.id])).toBe(false)
        expect(errorCodes(auth.verifySignatures()[0])).toEqual(['unsupported_auth_address'])
    })

    test('uses pre-fetched account info for authorizing accounts', async () => {
        const src = FakeAccountInfo.basic()
        const signer = FakeAccountInfo.basic()
        const entry = await signEntry(buildUnsignedEntry(signer.id), [keypairOf(signer)])
        const tx = buildSorobanTx(src, [entry])

        const schema = await inspectTransactionSigners(tx, {accountsInfo: [src, signer]})

        expect(fakeHorizon.requests).toEqual([])
        expect(schema.sorobanAuth[0].verifySignatures()[0].valid).toBe(true)
    })

    test('verifies auth entries of fee bump inner transactions', async () => {
        const src = FakeAccountInfo.basic()
        const signer = FakeAccountInfo.basic()
        const feeSource = FakeAccountInfo.basic()
        const entry = await signEntry(buildUnsignedEntry(signer.id), [keypairOf(signer)])
        const bump = buildFeeBumpTransaction(buildSorobanTx(src, [entry]), feeSource)

        //inner transaction is already signed, so there is nothing to warn about
        const plain = await inspectTransactionSigners(bump, {sorobanAuth: false})
        expect(plain.warnings).toEqual([])
        expect(plain.sorobanAuth).toEqual([])

        const schema = await inspectTransactionSigners(bump)
        expect(schema.discoverSigners()).toEqual([feeSource.id])
        expect(schema.sorobanAuth[0].address).toBe(signer.id)
        expect(schema.sorobanAuth[0].verifySignatures()[0].valid).toBe(true)
    })
})
