import SignatureRequirementsBase from '../src/signature-schemas/requirements/signature-requirements-base.js'
import SignatureRequirementsTypes from '../src/signature-schemas/requirements/signature-requirements-types.js'
import AccountSignatureRequirements from '../src/signature-schemas/requirements/account-signature-requirements.js'
import ExtraSignatureRequirements from '../src/signature-schemas/requirements/extra-signature-requirements.js'

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
})

describe('ExtraSignatureRequirements', () => {
    test('carries the extra signer key', () => {
        const req = new ExtraSignatureRequirements('GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ')
        expect(req.type).toBe(SignatureRequirementsTypes.EXTRA_SIGNATURE)
        expect(req.key).toBe('GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ')
    })
})
