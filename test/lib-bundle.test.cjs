//the UMD bundle is CommonJS, so this suite has to stay .cjs inside a "type": "module" package
const bundle = require('../lib/stellar-tx-signers-inspector')

describe('pre-built library', () => {
    test('loads correctly in a NodeJS CommonJS environment', () => {
        expect(typeof bundle.inspectTransactionSigners).toBe('function')
        expect(typeof bundle.inspectAccountSigners).toBe('function')
    })
})
