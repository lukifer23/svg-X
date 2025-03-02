# Building SVG Bolt for Windows

This guide will walk you through building the SVG Bolt installer for Windows.

## Prerequisites

1. **Node.js**: Make sure you have Node.js installed (v16 or newer)
2. **Git**: Make sure Git is installed 

## Getting Started

1. Clone the repository:
   ```
   git clone https://github.com/YOUR_USERNAME/svg-bolt.git
   cd svg-bolt
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Test the application:
   ```
   npm run electron:dev
   ```
   This should launch the application in development mode.

## Building the Windows Installer

To build the Windows installer:

```
npm run electron:build -- --win
```

This will create the following files in the `release` directory:
- `SVG Bolt-1.0.0-x64.exe` - NSIS Installer (64-bit)
- `SVG Bolt-1.0.0-x64-portable.exe` - Portable version (64-bit)

## Troubleshooting

### Common Issues

1. **electron-builder errors**:
   - Make sure you have the latest Node.js LTS version
   - Try clearing the cache: `node_modules/.cache`

2. **Icon related errors**:
   - The icon will be generated automatically during build
   - If you see icon errors, run `node create-electron-cjs.js` first

3. **Build process hangs**:
   - Ensure your system has enough memory and disk space
   - Close other applications to free up resources

## Distributing the Installer

After building, share the `.exe` file with users. The installer will:
1. Install SVG Bolt on the user's system
2. Create desktop and start menu shortcuts
3. Make the app available on the local network automatically when running 