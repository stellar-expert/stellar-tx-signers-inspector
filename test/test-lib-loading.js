/*eslint-disable no-undef */
describe('pre-built library', function () {
    it.skip('loads correctly in NodeJS environment', function(){
        const module = require('../lib/stellar-tx-signers-inspector')
        expect(typeof module.inspectTransactionSigners === 'function').to.be.true
    })
})