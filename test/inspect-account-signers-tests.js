import {fakeHorizon} from './account-signer-test-utils'
import FakeAccountInfo from './fake-account-info'
import {inspectAccountSigners} from '../src'

describe('inspectAccountSigners() tests', function () {
    before(() => {
        fakeHorizon.stubRequests()
    })

    after(() => {
        fakeHorizon.releaseRequests()
    })

    it('discovers signers for a simple account without multisig', async function () {
        const src = FakeAccountInfo.basic(),
            extra = FakeAccountInfo.empty

        const schema = await inspectAccountSigners(src.id)

        expect(schema.warnings.length).to.equal(0)
        expect(schema.getAllPotentialSigners()).to.have.members([src.id])
        expect(schema.discoverSigners(1)).to.have.members([src.id])
        expect(schema.discoverSigners(2)).to.have.members([])
        expect(schema.checkFeasibility('high', [src.id])).to.be.true
        expect(schema.checkFeasibility('med', [src.id])).to.be.true
        expect(schema.checkFeasibility(1, [src.id])).to.be.true
        expect(schema.checkAuthExtra('high', [src.id])).to.eql([])
        expect(schema.checkAuthExtra('high', [src.id, extra.id])).to.eql([extra.id])
    })

    it('discovers signers for a simple account with multisig', async function () {
        const signerA = FakeAccountInfo.empty,
            signerB = FakeAccountInfo.empty,
            signerC = FakeAccountInfo.empty,
            signerD = FakeAccountInfo.empty,
            src = FakeAccountInfo.basic()
                .withThresholds(2, 4, 6)
                .withMasterWeight(0)
                .withSigner(signerA, 4)
                .withSigner(signerB, 3)
                .withSigner(signerC, 2)
                .withSigner(signerD, 1)

        const schema = await inspectAccountSigners(src.id)

        expect(schema.warnings.length).to.equal(0)
        expect(schema.getAllPotentialSigners()).to.have.members([signerA.id, signerB.id, signerC.id, signerD.id])

        expect(schema.discoverSigners(2)).to.have.members([signerA.id])
        expect(schema.discoverSigners('low', [signerD.id, signerC.id, signerB.id])).to.have.members([signerB.id])
        expect(schema.discoverSigners(4, [signerD.id, signerC.id, signerB.id])).to.have.members([signerB.id, signerC.id])
        expect(schema.discoverSigners(6, [signerD.id, signerC.id, signerB.id])).to.have.members([signerB.id, signerC.id, signerD.id])
        expect(schema.discoverSigners('high')).to.have.members([signerA.id, signerB.id])

        expect(schema.checkFeasibility(2, [signerA.id])).to.be.true
        expect(schema.checkFeasibility('med', [signerD.id, signerC.id, signerB.id])).to.be.true
        expect(schema.checkFeasibility('med', [signerD.id])).to.be.false
        expect(schema.checkFeasibility('high', [signerA.id, signerD.id])).to.be.false
        expect(schema.checkFeasibility(6, [signerA.id, signerD.id, signerC.id])).to.be.true

        expect(schema.checkAuthExtra(2, [signerA.id])).to.eql([])
        expect(schema.checkAuthExtra(2, [signerD.id, signerC.id, signerB.id])).to.eql([signerD.id, signerC.id])
        expect(schema.checkAuthExtra('med', [signerD.id, signerC.id, signerB.id])).to.eql([signerD.id])
        expect(schema.checkAuthExtra('high', [signerD.id, signerC.id, signerB.id])).to.eql([])
        expect(schema.checkAuthExtra(6, [signerA.id, signerD.id])).to.eql([]) //not enough weight
        expect(schema.checkAuthExtra('high', [signerA.id, signerD.id, signerC.id])).to.eql([signerD.id])
    })

})