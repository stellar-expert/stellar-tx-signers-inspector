/*eslint-disable no-undef */
import {Operation, Asset, Keypair} from '@stellar/stellar-sdk'
import {inspectTransactionSigners} from '../src/index'
import SignatureRequirementsTypes from '../src/signature-schemas/requirements/signature-requirements-types'
import {fakeHorizon, buildTransaction, buildFeeBumpTransaction} from './account-signer-test-utils'
import FakeAccountInfo from './fake-account-info'

describe('inspectTransactionSigners() tests', function () {
    before(() => {
        fakeHorizon.stubRequests()
    })

    after(() => {
        fakeHorizon.releaseRequests()
    })

    it('discovers signers for a single-op tx without multisig', async function () {
        const src = FakeAccountInfo.basic(3)
        const dest = FakeAccountInfo.empty

        const tx = buildTransaction(src, [
            Operation.payment({destination: dest.id, amount: '1', asset: Asset.native()})
        ])

        const schema = await inspectTransactionSigners(tx)
        expect(schema.warnings.length).to.equal(0)
        expect(schema.getAllPotentialSigners()).to.have.members([src.id])
        expect(schema.discoverSigners()).to.have.members([src.id])
        expect(schema.checkFeasibility([src.id])).to.be.true
        expect(schema.checkAuthExtra([src.id])).to.eql([])
    })

    it('discovers signers for a multi-op tx without multisig (only one account exists)', async function () {
        const issuer = FakeAccountInfo.basic(3)
        const distributor = FakeAccountInfo.basic()

        const asset = new Asset('TTT', issuer.id)
        const tx = buildTransaction(issuer, [
            Operation.createAccount({destination: distributor.id, startingBalance: '1.6'}),
            Operation.changeTrust({source: distributor.id, asset}),
            Operation.payment({destination: distributor.id, amount: '1', asset})
        ])

        const schema = await inspectTransactionSigners(tx, {accountsInfo: [issuer, distributor]})
        expect(schema.warnings.length).to.equal(0)
        expect(schema.discoverSigners()).to.have.members([issuer.id, distributor.id])
        expect(schema.discoverSigners([issuer.id, distributor.id])).to.have.members([issuer.id, distributor.id])
        expect(schema.getAllPotentialSigners()).to.have.members([issuer.id, distributor.id])
        //verify feasibility
        expect(schema.checkFeasibility([issuer.id])).to.be.false
        expect(schema.checkFeasibility([distributor.id])).to.be.false
        expect(schema.checkFeasibility([issuer.id, distributor.id])).to.be.true
        //verify extra auth
        expect(schema.checkAuthExtra([issuer.id, distributor.id])).to.eql([])
    })

    it('discovers signers for a multi-op tx with multisig', async function () {
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
                        weight: 5
                    },
                    {
                        key: issuerCosigner1.id,
                        weight: 4
                    },
                    {
                        key: sharedCosigner.id,
                        weight: 3
                    },
                    {
                        isMaster: true,
                        key: issuer.id,
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
                        weight: 1
                    },
                    {
                        key: sharedCosigner.id,
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
        expect(schema.warnings.length).to.be.equal(0)

        //check requirements
        expect(schema.requirements).to.be.deep.equal(expectedRequirements)

        //verify potential signers
        expect(schema.getAllPotentialSigners()).to.have.members(potentialSigners)

        //without restrictions
        expect(schema.discoverSigners()).to.have.members([issuerCosigner2.id, distributor.id])

        //with constrained signers
        expect(schema.discoverSigners([sharedCosigner.id, issuer.id])).to.have.members([sharedCosigner.id, issuer.id])

        //check feasibility
        expect(schema.checkFeasibility([sharedCosigner.id])).to.be.false
        expect(schema.checkFeasibility([issuerCosigner2.id])).to.be.false
        expect(schema.checkFeasibility([distributor.id])).to.be.false
        expect(schema.checkFeasibility([issuer.id])).to.be.false
        expect(schema.checkFeasibility([sharedCosigner.id, issuer.id])).to.be.true
        expect(schema.checkFeasibility([issuerCosigner2.id, distributor.id])).to.be.true

        //check for TX_BAD_AUTH_EXTRA
        expect(schema.checkAuthExtra([sharedCosigner.id])).to.eql([])
        expect(schema.checkAuthExtra([issuer.id])).to.eql([])
        expect(schema.checkAuthExtra([sharedCosigner.id, issuer.id])).to.eql([])
        expect(schema.checkAuthExtra([issuerCosigner2.id, distributor.id, issuer.id])).to.eql([issuer.id])
        expect(schema.checkAuthExtra([issuerCosigner2.id, distributor.id, sharedCosigner.id, issuer.id])).to.eql([sharedCosigner.id, issuer.id])
    })

    it('handles duplicate signatures', async function () {
        const cosigner = FakeAccountInfo.empty
        const multisigAccount = FakeAccountInfo.basic(10)
            .withSigner(cosigner, 2)
            .withMasterWeight(2)
            .withThresholds(4, 4, 4)

        const tx = buildTransaction(multisigAccount, [
            Operation.payment({destination: cosigner.id, amount: '1', asset: Asset.native()})
        ])

        const schema = await inspectTransactionSigners(tx)
        expect(schema.warnings.length).to.be.equal(0)
        expect(schema.discoverSigners()).to.have.members([cosigner.id, multisigAccount.id])
        //with constrained signers
        expect(schema.discoverSigners([cosigner.id, cosigner.id])).to.have.members([])
        //check feasibility
        expect(schema.checkFeasibility([cosigner.id, cosigner.id])).to.be.false
        expect(schema.checkFeasibility([multisigAccount.id, multisigAccount.id])).to.be.false
        expect(schema.checkFeasibility([cosigner.id, multisigAccount.id])).to.be.true

        //check for TX_BAD_AUTH_EXTRA
        expect(schema.checkAuthExtra([cosigner.id, cosigner.id])).to.eql([cosigner.id])
        expect(schema.checkAuthExtra([cosigner.id, multisigAccount.id])).to.eql([])
    })

    it('notifies if source account does not exists', async function () {
        const src = FakeAccountInfo.empty
        const src2 = FakeAccountInfo.empty
        const dest = FakeAccountInfo.empty

        const tx = buildTransaction(FakeAccountInfo.nonExisting(src), [
            Operation.payment({destination: dest.id, amount: '1', asset: Asset.native()}),
            Operation.payment({source: src2.id, destination: dest.id, amount: '1', asset: Asset.native()})
        ])

        const shcema = await inspectTransactionSigners(tx, {accountsInfo: [src, dest]})
        expect(shcema.warnings.map(({code, data}) => ({code, data}))).to.eql([
            {code: 'no_source', data: src.id},
            {code: 'no_source', data: src2.id}
        ])
        expect(shcema.discoverSigners()).to.have.members([src.id, src2.id])
        expect(shcema.getAllPotentialSigners()).to.have.members([src.id, src2.id])
    })


    it('fetches source accounts info from Horizon', async function () {
        const issuer = FakeAccountInfo.basic(3)
        const distributor = FakeAccountInfo.empty

        const asset = new Asset('TTT', issuer.id)
        const tx = buildTransaction(issuer, [
            Operation.createAccount({destination: distributor.id, startingBalance: '1.6'}),
            Operation.changeTrust({source: distributor.id, asset}),
            Operation.payment({destination: distributor.id, amount: '1', asset})
        ])

        //skip accountsInfo entirely
        let schema = await inspectTransactionSigners(tx)
        expect(schema.warnings.length).to.be.equal(1)
        expect(schema.discoverSigners()).to.have.members([issuer.id, distributor.id])

        //partial accountsInfo
        schema = await inspectTransactionSigners(tx, {accountsInfo: [FakeAccountInfo.nonExisting(distributor)]})
        expect(schema.warnings.length).to.be.equal(0)
        expect(schema.discoverSigners()).to.have.members([issuer.id, distributor.id])
    })

    it('discovers signers for a fee bump transaction', async function () {
        const src = FakeAccountInfo.basic(2)
        const cosigner = FakeAccountInfo.empty
        const feeSource = FakeAccountInfo.basic(2)
            .withSigner(cosigner, 1)

        const tx = buildTransaction(src, [
            Operation.payment({destination: feeSource.id, amount: '1', asset: Asset.native()})
        ])

        const bump = buildFeeBumpTransaction(tx, feeSource)

        const schema = await inspectTransactionSigners(bump)
        expect(schema.warnings.length).to.equal(0)
        expect(schema.getAllPotentialSigners()).to.have.members([feeSource.id, cosigner.id])
        expect(schema.discoverSigners()).to.have.members([feeSource.id])
        expect(schema.checkFeasibility([feeSource.id])).to.be.true
        expect(schema.checkFeasibility([cosigner.id])).to.be.true
        expect(schema.checkAuthExtra([feeSource.id])).to.eql([])
        expect(schema.checkAuthExtra([feeSource.id, cosigner.id])).to.eql([cosigner.id])
    })

    it('discover signers for tx with extra signers', async function () {
        const src = FakeAccountInfo.basic(2)
        const extraSigner = Keypair.random()
        const extraSignerAddress = extraSigner.publicKey()
        const tx = buildTransaction(src, [
            Operation.payment({destination: Keypair.random().publicKey(), amount: '1', asset: Asset.native()})
        ], [extraSignerAddress])

        const schema = await inspectTransactionSigners(tx)
        expect(schema.warnings.length).to.equal(0)
        expect(schema.getAllPotentialSigners()).to.have.members([src.id, extraSignerAddress])
        expect(schema.discoverSigners()).to.have.members([src.id, extraSignerAddress])
        expect(schema.checkFeasibility([src.id])).to.be.false
        expect(schema.checkFeasibility([src.id, extraSignerAddress])).to.be.true
    })
})
