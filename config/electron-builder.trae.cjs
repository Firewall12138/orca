const base = require('./electron-builder.config.cjs')
module.exports = {
  ...base,
  appId: 'com.stablyai.orca.traechat',
  productName: 'Orca TRAE Chat',
  extraMetadata: {
    name: 'orca-trae-chat',
    productName: 'Orca TRAE Chat',
    version: '1.4.266-trae.20261123.1'
  },
  directories: { ...base.directories, output: '../artifacts' },
  files: [
    'out/**/*',
    'resources/**/*',
    'package.json',
    'LICENSE',
    ...base.files,
    '!out/bin{,/**/*}',
    '!out/dev-instance.json'
  ],
  publish: null,
  mac: {
    ...base.mac,
    identity: null,
    hardenedRuntime: false,
    notarize: false,
    target: [{ target: 'dir', arch: ['arm64'] }]
  }
}
