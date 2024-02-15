const path = require('path')
const webpack = require('webpack')
const TerserPlugin = require('terser-webpack-plugin')

const settings = {
    mode: 'production',
    devtool: 'source-map',
    entry: {
        'stellar-tx-signers-inspector': [path.join(__dirname, './src/index.js')]
    },
    output: {
        path: path.join(__dirname, './lib'),
        filename: '[name].js',
        library: {
            name: 'stellarTxSignersInspector',
            type: 'umd2',
            export: 'default'
        },
        globalObject: 'globalThis'
    },
    module: {
        rules: [
            {
                test: /\.js?$/,
                loader: 'babel-loader',
                exclude: /node_modules/
            }
        ]
    },
    externals: {
        '@stellar/stellar-sdk': '@stellar/stellar-sdk'
    },
    plugins: [
        new webpack.LoaderOptionsPlugin({
            minimize: true,
            debug: false,
            sourceMap: true
        }),
        new webpack.DefinePlugin({
            'process.env.NODE_ENV': JSON.stringify('production')
        })
    ],
    optimization: {
        minimize: true,
        minimizer: [new TerserPlugin({
            parallel: true,
            terserOptions: {
                toplevel: true
            }
        })]
    }
}

module.exports = settings