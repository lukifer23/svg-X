/**
 * Electron Builder configuration
 */
export default {
  win: {
    sign: false,
    signDlls: false,
    publisherName: "SVG Bolt Team",
    verifyUpdateCodeSignature: false,
    signAndEditExecutable: false,
    target: [
      "portable"
    ]
  },
  mac: {
    identity: null
  },
  afterSign: undefined,
  appId: "com.svgbolt.app",
  productName: "SVG Bolt",
  files: [
    "dist/**/*",
    "electron.cjs",
    "electron.js",
    "icon.png",
    "src/**/*",
    "package.json"
  ],
  extraResources: [
    {
      from: "dist",
      to: "dist"
    }
  ],
  directories: {
    buildResources: "assets",
    output: "release"
  }
}; 