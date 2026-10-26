const path = require('path')

module.exports = {
    target: 'node',
    mode: 'production',
    context: __dirname,
    entry: './src/index.ts',
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'index.js',
        libraryTarget: 'umd',
        globalObject: 'this',
    },
    resolve: {
        extensions: ['.ts', '.js'],
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                loader: 'ts-loader',
                exclude: /node_modules/,
                options: { configFile: path.resolve(__dirname, 'tsconfig.json') },
            },
            {
                test: /\.html$/,
                use: [{ loader: 'html-loader', options: { esModule: false } }],
            },
            {
                test: /\.svg$/,
                type: 'asset/source',
            },
        ],
    },
    externals: [
        /^@angular/,
        /^@ng-bootstrap/,
        /^rxjs/,
        /^tabby-/,
        'ngx-toastr',
        'electron',
        /^@electron\//,
        'child_process',
        'fs',
        'os',
        'path',
    ],
}
