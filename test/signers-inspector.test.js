import {Keypair, Operation} from '@stellar/stellar-sdk'
import SignersInspector from '../src/signers-inspector.js'
import {buildTransaction} from './account-signer-test-utils.js'
import FakeAccountInfo from './fake-account-info.js'

const address = Keypair.random().publicKey()

describe('SignersInspector.addSource()', () => {
    test('rejects malformed addresses', () => {
        const inspector = new SignersInspector()
        expect(() => inspector.addSource('not-an-address', 'low'))
            .toThrow('is not a valid Stellar account public key')
    })

    test('rejects unknown threshold levels', () => {
        const inspector = new SignersInspector()
        expect(() => inspector.addSource(address, 'medium'))
            .toThrow(`"medium" is not a valid threshold. Expected one of 'low', 'med' or 'high'.`)
    })
})

describe('SignersInspector.detectOperationThreshold()', () => {
    const inspector = new SignersInspector()

    test('maps operation types to threshold levels', () => {
        expect(inspector.detectOperationThreshold({type: 'bumpSequence'})).toBe('low')
        expect(inspector.detectOperationThreshold({type: 'claimClaimableBalance'})).toBe('low')
        expect(inspector.detectOperationThreshold({type: 'accountMerge'})).toBe('high')
        expect(inspector.detectOperationThreshold({type: 'payment'})).toBe('med')
    })

    test('maps inflation and Soroban footprint operations to low threshold', () => {
        expect(inspector.detectOperationThreshold({type: 'inflation'})).toBe('low')
        expect(inspector.detectOperationThreshold({type: 'extendFootprintTtl', extendTo: 100})).toBe('low')
        expect(inspector.detectOperationThreshold({type: 'restoreFootprint'})).toBe('low')
        expect(inspector.detectOperationThreshold({type: 'invokeHostFunction'})).toBe('med')
    })

    test('maps sponsorship operations to medium threshold', () => {
        for (const type of ['beginSponsoringFutureReserves', 'endSponsoringFutureReserves', 'revokeAccountSponsorship', 'revokeSignerSponsorship'])
            expect(inspector.detectOperationThreshold({type})).toBe('med')
    })

    test('treats signer-altering setOptions as high threshold', () => {
        expect(inspector.detectOperationThreshold({type: 'setOptions', signer: {}})).toBe('high')
        expect(inspector.detectOperationThreshold({type: 'setOptions', masterWeight: 2})).toBe('high')
        expect(inspector.detectOperationThreshold({type: 'setOptions', homeDomain: 'x.com'})).toBe('med')
    })

    //Core checks field presence, not the value
    test('treats zero master weight and thresholds as high threshold changes', () => {
        const op = Operation.setOptions({masterWeight: 0})
        const [parsed] = buildTransaction(FakeAccountInfo.basic(), [op]).operations
        expect(inspector.detectOperationThreshold(parsed)).toBe('high')
        expect(inspector.detectOperationThreshold({type: 'setOptions', lowThreshold: 0})).toBe('high')
        expect(inspector.detectOperationThreshold({type: 'setOptions', highThreshold: 0})).toBe('high')
    })
})

describe('SignersInspector.buildSignatureSchema()', () => {
    test('rejects unknown schema types', () => {
        const inspector = new SignersInspector()
        expect(() => inspector.buildSignatureSchema('nope')).toThrow('Invalid schema type: "nope".')
    })

    //guards the defensive default in buildSignatureSchema - loadAccounts always supplies thresholds,
    //but the previous code read accountInfo.thresholds directly and threw instead of using the fallback
    test('tolerates account info without thresholds', () => {
        const inspector = new SignersInspector()
        inspector.addSource(address, 'med')
        inspector.accountsInfo = {[address]: {id: address, signers: [{key: address, weight: 1}]}}

        const schema = inspector.buildSignatureSchema('tx')

        expect(schema.requirements[0].thresholds).toEqual({low: undefined, med: undefined, high: undefined})
        expect(schema.discoverSigners()).toEqual([address])
    })
})
