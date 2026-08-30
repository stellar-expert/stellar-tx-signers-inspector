import {inspectAccountSigners} from '../src/index.js'
import {fakeHorizon, expectSameMembers} from './account-signer-test-utils.js'
import FakeAccountInfo from './fake-account-info.js'

describe('inspectAccountSigners()', () => {
    beforeEach(() => {
        fakeHorizon.stubRequests()
    })

    afterEach(() => {
        fakeHorizon.releaseRequests()
    })

    test('discovers signers for a simple account without multisig', async () => {
        const src = FakeAccountInfo.basic()
        const extra = FakeAccountInfo.empty

        const schema = await inspectAccountSigners(src.id)

        expect(schema.warnings.length).toBe(0)
        expectSameMembers(schema.getAllPotentialSigners(), [src.id])
        expectSameMembers(schema.discoverSigners(1), [src.id])
        expectSameMembers(schema.discoverSigners(2), [])
        expect(schema.checkFeasibility('high', [src.id])).toBe(true)
        expect(schema.checkFeasibility('med', [src.id])).toBe(true)
        expect(schema.checkFeasibility(1, [src.id])).toBe(true)
        expect(schema.checkAuthExtra('high', [src.id])).toEqual([])
        expect(schema.checkAuthExtra('high', [src.id, extra.id])).toEqual([extra.id])
    })

    test('discovers signers for a simple account with multisig', async () => {
        const signerA = FakeAccountInfo.empty
        const signerB = FakeAccountInfo.empty
        const signerC = FakeAccountInfo.empty
        const signerD = FakeAccountInfo.empty
        const src = FakeAccountInfo.basic()
            .withThresholds(2, 4, 6)
            .withMasterWeight(0)
            .withSigner(signerA, 4)
            .withSigner(signerB, 3)
            .withSigner(signerC, 2)
            .withSigner(signerD, 1)

        const schema = await inspectAccountSigners(src.id)

        expect(schema.warnings.length).toBe(0)
        expectSameMembers(schema.getAllPotentialSigners(), [signerA.id, signerB.id, signerC.id, signerD.id])

        expectSameMembers(schema.discoverSigners(2), [signerA.id])
        expectSameMembers(schema.discoverSigners('low', [signerD.id, signerC.id, signerB.id]), [signerB.id])
        expectSameMembers(schema.discoverSigners(4, [signerD.id, signerC.id, signerB.id]), [signerB.id, signerC.id])
        expectSameMembers(schema.discoverSigners(6, [signerD.id, signerC.id, signerB.id]), [signerB.id, signerC.id, signerD.id])
        expectSameMembers(schema.discoverSigners('high'), [signerA.id, signerB.id])

        expect(schema.checkFeasibility(2, [signerA.id])).toBe(true)
        expect(schema.checkFeasibility('med', [signerD.id, signerC.id, signerB.id])).toBe(true)
        expect(schema.checkFeasibility('med', [signerD.id])).toBe(false)
        expect(schema.checkFeasibility('high', [signerA.id, signerD.id])).toBe(false)
        expect(schema.checkFeasibility(6, [signerA.id, signerD.id, signerC.id])).toBe(true)

        expect(schema.checkAuthExtra(2, [signerA.id])).toEqual([])
        expect(schema.checkAuthExtra(2, [signerD.id, signerC.id, signerB.id])).toEqual([signerD.id, signerC.id])
        expect(schema.checkAuthExtra('med', [signerD.id, signerC.id, signerB.id])).toEqual([signerD.id])
        expect(schema.checkAuthExtra('high', [signerD.id, signerC.id, signerB.id])).toEqual([])
        expect(schema.checkAuthExtra(6, [signerA.id, signerD.id])).toEqual([]) //not enough weight
        expect(schema.checkAuthExtra('high', [signerA.id, signerD.id, signerC.id])).toEqual([signerD.id])
    })

    test('rejects an empty source account address', async () => {
        await expect(inspectAccountSigners('')).rejects.toThrow('Invalid parameter "sourceAccount"')
    })

    test('reports a warning for an account that does not exist on the ledger', async () => {
        const missing = FakeAccountInfo.nonExisting(FakeAccountInfo.empty)

        const schema = await inspectAccountSigners(missing.id)

        expect(schema.warnings).toEqual([{
            code: 'no_source',
            message: `Source account ${missing.id} does not exist on the ledger.`,
            data: missing.id
        }])
        //a missing account falls back to a zero-threshold schema signed by its own master key
        expectSameMembers(schema.getAllPotentialSigners(), [missing.id])
        expect(schema.requirements[0].thresholds).toEqual({low: 0, med: 0, high: 0})
    })

    test('names the offending input when a threshold level cannot be resolved', async () => {
        const src = FakeAccountInfo.basic()

        const schema = await inspectAccountSigners(src.id)

        expect(() => schema.discoverSigners('nonsense')).toThrow('Invalid threshold level: "nonsense".')
        expect(() => schema.discoverSigners(null)).toThrow('Invalid threshold level: "null".')
    })
})
