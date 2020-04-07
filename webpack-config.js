const path = require('path'),
    webpack = require('webpack'),
    TerserPlugin = require('terser-webpack-plugin')

const settings = {
    mode: 'production',
    devtool: 'source-map',
    entry: {
        'stellar-tx-signers-inspector': [path.join(__dirname, './src/index.js')]
    },
    output: {
        path: path.join(__dirname, './lib'),
        filename: '[name].js',
        library: 'stellarTxSignersInspector',
        libraryTarget: 'umd',
        globalObject: 'this'
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
        'stellar-sdk': 'stellar-sdk'
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
        minimizer: [new TerserPlugin({
            parallel: true,
            sourceMap: true,
            extractComments: false,
            terserOptions: {
                warnings: true
                //toplevel: true
            }
        })]
    }
}

module.exports = settings