import {Operation, Asset, Keypair, MuxedAccount, SignerKey, StrKey, hash, xdr} from '@stellar/stellar-sdk'
import {inspectTransactionSigners} from '../src/index.js'
import SignatureRequirementsTypes from '../src/signature-schemas/requirements/signature-requirements-types.js'
import {fakeHorizon, buildTransaction, buildFeeBumpTransaction, expectSameMembers} from './account-signer-test-utils.js'
import FakeAccountInfo from './fake-account-info.js'

describe('inspectTransactionSigners()', () => {
    beforeEach(() => {
        fakeHorizon.stubRequests()
    })

    afterEach(() => {
        fakeHorizon.releaseRequests()
    })

    test('discovers signers for a single-op tx without multisig', async () => {
        const src = FakeAccountInfo.basic(3)
        const dest = FakeAccountInfo.empty

        const tx = buildTransaction(src, [
            Operation.payment({destination: dest.id, amount: '1', asset: Asset.native()})
        ])

        const schema = await inspectTransactionSigners(tx)
        expect(schema.warnings.length).toBe(0)
        expectSameMembers(schema.getAllPotentialSigners(), [src.id])
        expectSameMembers(schema.discoverSigners(), [src.id])
        expect(schema.checkFeasibility([src.id])).toBe(true)
        expect(schema.checkAuthExtra([src.id])).toEqual([])
    })

    test('discovers signers for a multi-op tx without multisig (only one account exists)', async () => {
        const issuer = FakeAccountInfo.basic(3)
        const distributor = FakeAccountInfo.basic()

        const asset = new Asset('TTT', issuer.id)
        const tx = buildTransaction(issuer, [
            Operation.createAccount({destination: distributor.id, startingBalance: '1.6'}),
            Operation.changeTrust({source: distributor.id, asset}),
            Operation.payment({destination: distributor.id, amount: '1', asset})
        ])

        const schema = await inspectTransactionSigners(tx, {accountsInfo: [issuer, distributor]})
        expect(schema.warnings.length).toBe(0)
        expectSameMembers(schema.discoverSigners(), [issuer.id, distributor.id])
        expectSameMembers(schema.discoverSigners([issuer.id, distributor.id]), [issuer.id, distributor.id])
        expectSameMembers(schema.getAllPotentialSigners(), [issuer.id, distributor.id])
        //verify feasibility
        expect(schema.checkFeasibility([issuer.id])).toBe(false)
        expect(schema.checkFeasibility([distributor.id])).toBe(false)
        expect(schema.checkFeasibility([issuer.id, distributor.id])).toBe(true)
        //verify extra auth
        expect(schema.checkAuthExtra([issuer.id, distributor.id])).toEqual([])
        //pre-supplied accounts must not hit Horizon at all
        expect(fakeHorizon.requests).toEqual([])
    })

    test('discovers signers for a multi-op tx with multisig', async () => {
        const issuerCosigner1 = FakeAccountInfo.empty
        const issuerCosigner2 = FakeAccountInfo.empty
        const sharedCosigner = FakeAccountInfo.empty
        const issuer = FakeAccountInfo.basic(10)
            .withSigner(issuerCosigner1, 4)
            .withSigner(issuerCosigner2, 5)
            .withSigner(sharedCosigner, 3)
            .withMasterWeight(2)
            .withThresholds(4, 4, 4)
        const distributor = FakeAccountInfo.basic(10)
            .withSigner(sharedCosigner, 1)
            .withThresholds(1, 1, 1)

        const asset = new Asset('TTT', issuer.id)
        const tx = buildTransaction(issuer, [
            Operation.changeTrust({source: distributor.id, asset}),
            Operation.payment({destination: distributor.id, amount: '1', asset})
        ])

        const potentialSigners = [issuer.id, distributor.id, issuerCosigner1.id, issuerCosigner2.id, sharedCosigner.id]
        const expectedRequirements = [
            {
                id: issuer.id,
                signers: [
                    {
                        key: issuerCosigner2.id,
                        type: 'ed25519_public_key',
                        weight: 5
                    },
                    {
                        key: issuerCosigner1.id,
                        type: 'ed25519_public_key',
                        weight: 4
                    },
                    {
                        key: sharedCosigner.id,
                        type: 'ed25519_public_key',
                        weight: 3
                    },
                    {
                        isMaster: true,
                        key: issuer.id,
                        type: 'ed25519_public_key',
                        weight: 2
                    }
                ],
                minThreshold: 4,
                thresholds: {
                    high: 4,
                    low: 4,
                    med: 4
                },
                type: SignatureRequirementsTypes.ACCOUNT_SIGNATURE
            },
            {
                id: distributor.id,
                signers: [
                    {
                        isMaster: true,
                        key: distributor.id,
                        type: 'ed25519_public_key',
                        weight: 1
                    },
                    {
                        key: sharedCosigner.id,
                        type: 'ed25519_public_key',
                        weight: 1
                    }
                ],
                minThreshold: 1,
                thresholds: {
                    high: 1,
                    low: 1,
                    med: 1
                },
                type: SignatureRequirementsTypes.ACCOUNT_SIGNATURE
            }]

        const schema = await inspectTransactionSigners(tx)
        expect(schema.warnings.length).toBe(0)

        //check requirements
        expect(schema.requirements).toEqual(expectedRequirements)

        //verify potential signers
        expectSameMembers(schema.getAllPotentialSigners(), potentialSigners)

        //without restrictions
        expectSameMembers(schema.discoverSigners(), [issuerCosigner2.id, distributor.id])

        //with constrained signers
        expectSameMembers(schema.discoverSigners([sharedCosigner.id, issuer.id]), [sharedCosigner.id, issuer.id])

        //check feasibility
        expect(schema.checkFeasibility([sharedCosigner.id])).toBe(false)
        expect(schema.checkFeasibility([issuerCosigner2.id])).toBe(false)
        expect(schema.checkFeasibility([distributor.id])).toBe(false)
        expect(schema.checkFeasibility([issuer.id])).toBe(false)
        expect(schema.checkFeasibility([sharedCosigner.id, issuer.id])).toBe(true)
        expect(schema.checkFeasibility([issuerCosigner2.id, distributor.id])).toBe(true)

        //check for TX_BAD_AUTH_EXTRA
        expect(schema.checkAuthExtra([sharedCosigner.id])).toEqual([])
        expect(schema.checkAuthExtra([issuer.id])).toEqual([])
        expect(schema.checkAuthExtra([sharedCosigner.id, issuer.id])).toEqual([])
        expect(schema.checkAuthExtra([issuerCosigner2.id, distributor.id, issuer.id])).toEqual([issuer.id])
        expect(schema.checkAuthExtra([issuerCosigner2.id, distributor.id, sharedCosigner.id, issuer.id]))
            .toEqual([sharedCosigner.id, issuer.id])
    })

    test('handles duplicate signatures', async () => {
        const cosigner = FakeAccountInfo.empty
        const multisigAccount = FakeAccountInfo.basic(10)
            .withSigner(cosigner, 2)
            .withMasterWeight(2)
            .withThresholds(4, 4, 4)

        const tx = buildTransaction(multisigAccount, [
            Operation.payment({destination: cosigner.id, amount: '1', asset: Asset.native()})
        ])

        const schema = await inspectTransactionSigners(tx)
        expect(schema.warnings.length).toBe(0)
        expectSameMembers(schema.discoverSigners(), [cosigner.id, multisigAccount.id])
        //with constrained signers
        expectSameMembers(schema.discoverSigners([cosigner.id, cosigner.id]), [])
        //check feasibility
        expect(schema.checkFeasibility([cosigner.id, cosigner.id])).toBe(false)
        expect(schema.checkFeasibility([multisigAccount.id, multisigAccount.id])).toBe(false)
        expect(schema.checkFeasibility([cosigner.id, multisigAccount.id])).toBe(true)

        //check for TX_BAD_AUTH_EXTRA
        expect(schema.checkAuthExtra([cosigner.id, cosigner.id])).toEqual([cosigner.id])
        expect(schema.checkAuthExtra([cosigner.id, multisigAccount.id])).toEqual([])
    })

    test('notifies if source account does not exist', async () => {
        const src = FakeAccountInfo.empty
        const src2 = FakeAccountInfo.empty
        const dest = FakeAccountInfo.empty

        const tx = buildTransaction(FakeAccountInfo.nonExisting(src), [
            Operation.payment({destination: dest.id, amount: '1', asset: Asset.native()}),
            Operation.payment({source: src2.id, destination: dest.id, amount: '1', asset: Asset.native()})
        ])

        const schema = await inspectTransactionSigners(tx, {accountsInfo: [src, dest]})
        expect(schema.warnings.map(({code, data}) => ({code, data}))).toEqual([
            {code: 'no_source', data: src.id},
            {code: 'no_source', data: src2.id}
        ])
        expectSameMembers(schema.discoverSigners(), [src.id, src2.id])
        expectSameMembers(schema.getAllPotentialSigners(), [src.id, src2.id])
    })

    test('fetches source accounts info from Horizon', async () => {
        const issuer = FakeAccountInfo.basic(3)
        const distributor = FakeAccountInfo.empty

        const asset = new Asset('TTT', issuer.id)
        const tx = buildTransaction(issuer, [
            Operation.createAccount({destination: distributor.id, startingBalance: '1.6'}),
            Operation.changeTrust({source: distributor.id, asset}),
            Operation.payment({destination: distributor.id, amount: '1', asset})
        ])

        //skip accountsInfo entirely - distributor doesn't exist yet, but it's created before use, so no warning
        let schema = await inspectTransactionSigners(tx)
        expect(schema.warnings.length).toBe(0)
        expectSameMembers(schema.discoverSigners(), [issuer.id, distributor.id])
        expectSameMembers(fakeHorizon.requests, [issuer.id, distributor.id])

        //partial accountsInfo
        schema = await inspectTransactionSigners(tx, {accountsInfo: [FakeAccountInfo.nonExisting(distributor)]})
        expect(schema.warnings.length).toBe(0)
        expectSameMembers(schema.discoverSigners(), [issuer.id, distributor.id])
    })

    test('ignores pre-supplied account info that omits thresholds and falls back to Horizon', async () => {
        const src = FakeAccountInfo.basic(3)
        const dest = FakeAccountInfo.empty
        const tx = buildTransaction(src, [
            Operation.payment({destination: dest.id, amount: '1', asset: Asset.native()})
        ])
        const partial = {id: src.id, signers: [{key: src.id, weight: 1, type: 'ed25519_public_key'}]}

        const schema = await inspectTransactionSigners(tx, {accountsInfo: [partial]})

        expect(fakeHorizon.requests).toEqual([src.id])
        expect(schema.requirements[0].thresholds).toEqual({low: 0, med: 0, high: 0})
        expectSameMembers(schema.discoverSigners(), [src.id])
    })

    test('discovers signers for a fee bump transaction', async () => {
        const src = FakeAccountInfo.basic(2)
        const cosigner = FakeAccountInfo.empty
        const feeSource = FakeAccountInfo.basic(2)
            .withSigner(cosigner, 1)

        const tx = buildTransaction(src, [
            Operation.payment({destination: feeSource.id, amount: '1', asset: Asset.native()})
        ])

        const bump = buildFeeBumpTransaction(tx, feeSource)

        const schema = await inspectTransactionSigners(bump)
        expect(schema.warnings.length).toBe(0)
        expectSameMembers(schema.getAllPotentialSigners(), [feeSource.id, cosigner.id])
        expectSameMembers(schema.discoverSigners(), [feeSource.id])
        expect(schema.checkFeasibility([feeSource.id])).toBe(true)
        expect(schema.checkFeasibility([cosigner.id])).toBe(true)
        expect(schema.checkAuthExtra([feeSource.id])).toEqual([])
        expect(schema.checkAuthExtra([feeSource.id, cosigner.id])).toEqual([cosigner.id])
    })

    test('discovers signers for a tx with extra signers', async () => {
        const src = FakeAccountInfo.basic(2)
        const extraSignerAddress = Keypair.random().publicKey()
        const tx = buildTransaction(src, [
            Operation.payment({destination: Keypair.random().publicKey(), amount: '1', asset: Asset.native()})
        ], [extraSignerAddress])

        const schema = await inspectTransactionSigners(tx)
        expect(schema.warnings.length).toBe(0)
        expectSameMembers(schema.getAllPotentialSigners(), [src.id, extraSignerAddress])
        expectSameMembers(schema.discoverSigners(), [src.id, extraSignerAddress])
        expect(schema.checkFeasibility([src.id])).toBe(false)
        expect(schema.checkFeasibility([src.id, extraSignerAddress])).toBe(true)
    })

    test('discovers signers for a tx with muxed source', async () => {
        const src = FakeAccountInfo.basic('2')
        const tx = buildTransaction(new MuxedAccount(src, '1'), [
            Operation.payment({
                destination: Keypair.random().publicKey(),
                amount: '1',
                asset: Asset.native()
            })
        ], [])

        const schema = await inspectTransactionSigners(tx)
        expect(schema.warnings.length).toBe(0)
        expectSameMembers(schema.getAllPotentialSigners(), [src.id])
        expectSameMembers(schema.discoverSigners(), [src.id])
        expect(schema.checkFeasibility([src.id])).toBe(true)
        //the muxed M... address must be resolved to its underlying G... account before the Horizon lookup
        expect(fakeHorizon.requests).toEqual([src.id])
    })

    describe('signer key types', () => {
        const payment = () => Operation.payment({destination: Keypair.random().publicKey(), amount: '1', asset: Asset.native()})

        test('counts pre-auth tx signer matching the transaction hash implicitly', async () => {
            const cosigner = FakeAccountInfo.empty
            const src = FakeAccountInfo.basic(10)
                .withSigner(cosigner, 1)
                .withThresholds(2, 2, 2)
            const tx = buildTransaction(src, [payment()])
            const preAuthKey = StrKey.encodePreAuthTx(tx.hash())
            src.withSigner(preAuthKey, 1)

            const schema = await inspectTransactionSigners(tx)

            expect(schema.warnings).toEqual([])
            expect(schema.requirements[0].signers).toContainEqual({key: preAuthKey, weight: 1, type: 'preauth_tx', implicit: true})
            //pre-auth hashes never produce signatures
            expectSameMembers(schema.getAllPotentialSigners(), [src.id, cosigner.id])
            expect(schema.discoverSigners()).toEqual([src.id])
            expect(schema.discoverSigners([cosigner.id])).toEqual([cosigner.id])
            expect(schema.checkFeasibility([cosigner.id])).toBe(true)
            expect(schema.checkFeasibility([])).toBe(false)
            expect(schema.checkAuthExtra([src.id, cosigner.id])).toEqual([cosigner.id])
            expect(schema.checkAuthExtra([preAuthKey, src.id])).toEqual([])
        })

        test('treats a transaction fully authorized by pre-auth signer as feasible without signatures', async () => {
            const src = FakeAccountInfo.basic(10)
                .withThresholds(1, 1, 1)
            const tx = buildTransaction(src, [payment()])
            src.withSigner(StrKey.encodePreAuthTx(tx.hash()), 1)

            const schema = await inspectTransactionSigners(tx)

            expect(schema.discoverSigners()).toEqual([])
            expect(schema.checkFeasibility([])).toBe(true)
            //Core counts pre-auth signers first, so any extra signature remains unused
            expect(schema.checkAuthExtra([src.id])).toEqual([src.id])
        })

        test('ignores pre-auth signers of other transactions', async () => {
            const preAuthKey = StrKey.encodePreAuthTx(hash(Keypair.random().rawPublicKey()))
            const src = FakeAccountInfo.basic(10)
                .withSigner(preAuthKey, 5)
                .withThresholds(2, 2, 2)
                .withMasterWeight(2)
            const tx = buildTransaction(src, [payment()])

            const schema = await inspectTransactionSigners(tx)

            expect(schema.requirements[0].signers.map(s => s.key)).toEqual([src.id])
            expectSameMembers(schema.getAllPotentialSigners(), [src.id])
            expect(schema.discoverSigners()).toEqual([src.id])
            expect(schema.checkFeasibility([preAuthKey])).toBe(false)
        })

        test('counts hash-x and signed payload signers as regular signers', async () => {
            const cosigner = Keypair.random()
            const hashX = StrKey.encodeSha256Hash(hash(Uint8Array.from([1, 2, 3])))
            const signedPayload = SignerKey.encodeSignerKey(xdr.SignerKey.signerKeyTypeEd25519SignedPayload(
                new xdr.SignerKeyEd25519SignedPayload({ed25519: cosigner.rawPublicKey(), payload: Uint8Array.from([4, 5, 6])})
            ))
            const src = FakeAccountInfo.basic(10)
                .withSigner(hashX, 1)
                .withSigner(signedPayload, 1)
                .withThresholds(3, 3, 3)
            const tx = buildTransaction(src, [payment()])

            const schema = await inspectTransactionSigners(tx)

            expect(schema.requirements[0].signers.map(s => s.type).sort())
                .toEqual(['ed25519_public_key', 'ed25519_signed_payload', 'sha256_hash'])
            expectSameMembers(schema.getAllPotentialSigners(), [src.id, hashX, signedPayload])
            expectSameMembers(schema.discoverSigners(), [src.id, hashX, signedPayload])
            //plain signature of the payload signer key does not satisfy the signed payload signer
            expect(schema.checkFeasibility([src.id, hashX, cosigner.publicKey()])).toBe(false)
            expect(schema.checkFeasibility([src.id, hashX, signedPayload])).toBe(true)
        })

        test('clamps signer weights to 255', async () => {
            const cosigner = FakeAccountInfo.empty
            const src = FakeAccountInfo.basic(10)
                .withSigner(cosigner, 1000)
            const tx = buildTransaction(src, [payment()])

            const schema = await inspectTransactionSigners(tx)

            expect(schema.requirements[0].signers[0]).toEqual({key: cosigner.id, weight: 255, type: 'ed25519_public_key'})
        })

        test('does not duplicate extra signers that are also account signers', async () => {
            const src = FakeAccountInfo.basic(2)
            const tx = buildTransaction(src, [payment()], [src.id])

            const schema = await inspectTransactionSigners(tx)

            expect(schema.discoverSigners()).toEqual([src.id])
            expect(schema.checkAuthExtra([src.id])).toEqual([])
        })

        test('flags pre-auth extra signers as unsatisfiable', async () => {
            const src = FakeAccountInfo.basic(2)
            const preAuthKey = StrKey.encodePreAuthTx(hash(Keypair.random().rawPublicKey()))
            const tx = buildTransaction(src, [payment()], [preAuthKey])

            const schema = await inspectTransactionSigners(tx)

            expect(schema.warnings.map(({code, data}) => ({code, data}))).toEqual([{code: 'unsatisfiable_extra_signer', data: preAuthKey}])
            expectSameMembers(schema.getAllPotentialSigners(), [src.id])
            expect(schema.discoverSigners()).toEqual([])
            expect(schema.checkFeasibility([src.id, preAuthKey])).toBe(false)
        })
    })

    describe('sponsorship', () => {
        const warningCodes = schema => schema.warnings.map(({code, data}) => ({code, data}))

        test('handles sponsored account creation', async () => {
            const sponsor = FakeAccountInfo.basic(10)
            const newAccount = FakeAccountInfo.empty
            const tx = buildTransaction(sponsor, [
                Operation.beginSponsoringFutureReserves({sponsoredId: newAccount.id}),
                Operation.createAccount({destination: newAccount.id, startingBalance: '0'}),
                Operation.endSponsoringFutureReserves({source: newAccount.id})
            ])

            const schema = await inspectTransactionSigners(tx)

            //new account doesn't exist yet, but it's created before use, so its master key signature is expected
            expect(schema.warnings).toEqual([])
            expectSameMembers(schema.discoverSigners(), [sponsor.id, newAccount.id])
            expect(schema.checkFeasibility([sponsor.id])).toBe(false)
        })

        test('handles sponsorship transfer', async () => {
            const oldSponsor = FakeAccountInfo.basic(10)
            const newSponsor = FakeAccountInfo.basic(10)
            const owner = FakeAccountInfo.basic(10)
            const tx = buildTransaction(newSponsor, [
                Operation.beginSponsoringFutureReserves({sponsoredId: oldSponsor.id}),
                Operation.revokeAccountSponsorship({source: oldSponsor.id, account: owner.id}),
                Operation.endSponsoringFutureReserves({source: oldSponsor.id})
            ])

            const schema = await inspectTransactionSigners(tx)

            expect(schema.warnings).toEqual([])
            expectSameMembers(schema.discoverSigners(), [newSponsor.id, oldSponsor.id])
        })

        test('warns about sponsorship that is never ended', async () => {
            const sponsor = FakeAccountInfo.basic(10)
            const sponsored = FakeAccountInfo.basic(10)
            const tx = buildTransaction(sponsor, [
                Operation.beginSponsoringFutureReserves({sponsoredId: sponsored.id}),
                Operation.changeTrust({source: sponsored.id, asset: new Asset('TTT', sponsor.id)})
            ])

            const schema = await inspectTransactionSigners(tx)

            expect(warningCodes(schema)).toEqual([{code: 'unterminated_sponsorship', data: sponsored.id}])
        })

        test('warns about sponsorship end without an active sponsorship', async () => {
            const src = FakeAccountInfo.basic(10)
            const other = FakeAccountInfo.basic(10)
            const tx = buildTransaction(src, [
                Operation.beginSponsoringFutureReserves({sponsoredId: other.id}),
                Operation.endSponsoringFutureReserves({source: other.id}),
                Operation.endSponsoringFutureReserves()
            ])

            const schema = await inspectTransactionSigners(tx)

            expect(warningCodes(schema)).toEqual([{code: 'orphan_sponsorship_end', data: src.id}])
        })

        test('warns about invalid sponsorships', async () => {
            const a = FakeAccountInfo.basic(10)
            const b = FakeAccountInfo.basic(10)
            const c = FakeAccountInfo.basic(10)
            const tx = buildTransaction(a, [
                Operation.beginSponsoringFutureReserves({sponsoredId: a.id}), //self-sponsorship
                Operation.beginSponsoringFutureReserves({sponsoredId: b.id}),
                Operation.beginSponsoringFutureReserves({source: c.id, sponsoredId: b.id}), //already sponsored
                Operation.beginSponsoringFutureReserves({source: b.id, sponsoredId: c.id}), //recursive
                Operation.endSponsoringFutureReserves({source: b.id})
            ])

            const schema = await inspectTransactionSigners(tx)

            expect(warningCodes(schema)).toEqual([
                {code: 'invalid_sponsorship', data: a.id},
                {code: 'invalid_sponsorship', data: b.id},
                {code: 'invalid_sponsorship', data: c.id}
            ])
        })

        test('keeps missing source warning for accounts used before creation', async () => {
            const src = FakeAccountInfo.basic(10)
            const newAccount = FakeAccountInfo.empty
            const tx = buildTransaction(src, [
                Operation.bumpSequence({source: newAccount.id, bumpTo: '1'}),
                Operation.createAccount({destination: newAccount.id, startingBalance: '1'})
            ])

            const schema = await inspectTransactionSigners(tx)

            expect(warningCodes(schema)).toEqual([{code: 'no_source', data: newAccount.id}])
        })
    })

    test('rejects input that is not a transaction', async () => {
        await expect(inspectTransactionSigners({})).rejects.toThrow('Invalid parameter "tx"')
    })
})
