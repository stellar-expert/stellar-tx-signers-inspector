import terser from '@rollup/plugin-terser'

export default {
    input: 'src/bundle.js',
    output: {
        file: 'lib/stellar-tx-signers-inspector.js',
        format: 'umd',
        name: 'stellarTxSignersInspector',
        exports: 'default',
        sourcemap: true,
        globals: {
            '@stellar/stellar-sdk': 'StellarSdk'
        }
    },
    external: ['@stellar/stellar-sdk'],
    plugins: [terser()]
}
