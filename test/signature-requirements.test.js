import {StrKey} from '@stellar/stellar-sdk'
import SignatureRequirementsBase from '../src/signature-schemas/requirements/signature-requirements-base.js'
import SignatureRequirementsTypes from '../src/signature-schemas/requirements/signature-requirements-types.js'
import AccountSignatureRequirements from '../src/signature-schemas/requirements/account-signature-requirements.js'
import ExtraSignatureRequirements from '../src/signature-schemas/requirements/extra-signature-requirements.js'
import ContractSignatureRequirements from '../src/signature-schemas/requirements/contract-signature-requirements.js'
import {getSignerKeyType} from '../src/signer-keys.js'

describe('SignatureRequirementsBase', () => {
    test('accepts every supported requirements type', () => {
        for (const type of Object.values(SignatureRequirementsTypes)) {
            expect(new SignatureRequirementsBase(type).type).toBe(type)
        }
    })

    test('rejects unsupported requirements types', () => {
        //the enum key is not a valid discriminator - only its value is
        for (const type of ['ACCOUNT_SIGNATURE', 'bogus', '', null, undefined, 42])
            expect(() => new SignatureRequirementsBase(type)).toThrow('Invalid signature requirements type')
    })
})

describe('AccountSignatureRequirements', () => {
    const master = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ'
    const cosigner = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H'

    test('skips signers with zero weight', () => {
        const req = new AccountSignatureRequirements(master, 2)
        req.addSigner({key: master, weight: 0, isMaster: true})
        req.addSigner({key: cosigner, weight: 1})
        expect(req.signers).toEqual([{key: cosigner, weight: 1}])
    })

    test('sorts signers by weight desc, preferring the master key on ties', () => {
        const req = new AccountSignatureRequirements(master, 2)
        req.addSigner({key: cosigner, weight: 1})
        req.addSigner({key: master, weight: 1, isMaster: true})
        req.sortSigners()
        expect(req.signers.map(s => s.key)).toEqual([master, cosigner])

        const byWeight = new AccountSignatureRequirements(master, 2)
        byWeight.addSigner({key: master, weight: 1, isMaster: true})
        byWeight.addSigner({key: cosigner, weight: 5})
        byWeight.sortSigners()
        expect(byWeight.signers.map(s => s.key)).toEqual([cosigner, master])
    })

    test('clamps signer weights to uint8', () => {
        const req = new AccountSignatureRequirements(master, 2)
        req.addSigner({key: cosigner, weight: 300})
        expect(req.signers).toEqual([{key: cosigner, weight: 255}])
    })

    test('carries Soroban authorization node properties', () => {
        const req = new AccountSignatureRequirements(master, 2, {path: [1, 0], maxSignatures: 20})
        expect(req.path).toEqual([1, 0])
        expect(req.maxSignatures).toBe(20)
    })
})

describe('ExtraSignatureRequirements', () => {
    test('carries the extra signer key', () => {
        const req = new ExtraSignatureRequirements('GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ')
        expect(req.type).toBe(SignatureRequirementsTypes.EXTRA_SIGNATURE)
        expect(req.key).toBe('GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ')
        expect(req.signerType).toBe('ed25519_public_key')
    })
})

describe('ContractSignatureRequirements', () => {
    test('carries the contract address and node path', () => {
        const contract = StrKey.encodeContract(new Uint8Array(32))
        const req = new ContractSignatureRequirements(contract, [0])
        expect(req.type).toBe(SignatureRequirementsTypes.CONTRACT_SIGNATURE)
        expect(req.id).toBe(contract)
        expect(req.path).toEqual([0])
    })
})

describe('getSignerKeyType()', () => {
    test('detects signer key types by StrKey prefix', () => {
        const raw = new Uint8Array(32)
        expect(getSignerKeyType(StrKey.encodeEd25519PublicKey(raw))).toBe('ed25519_public_key')
        expect(getSignerKeyType(StrKey.encodePreAuthTx(raw))).toBe('preauth_tx')
        expect(getSignerKeyType(StrKey.encodeSha256Hash(raw))).toBe('sha256_hash')
        expect(getSignerKeyType(StrKey.encodeContract(raw))).toBe(null)
        expect(getSignerKeyType(undefined)).toBe(null)
    })
})
