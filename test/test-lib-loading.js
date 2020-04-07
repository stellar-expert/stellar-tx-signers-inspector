describe('pre-built library', function () {
    it('loads correctly in NodeJS environment', function(){
        const module = require('../lib/stellar-tx-signers-inspector')
        expect(typeof module.inspectTransactionSigners === 'function').to.be.true
    })
})