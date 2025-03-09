<!-- Last checked: 2025-03-02 -->

# Building SVG-X for Windows

This guide will walk you through building the SVG-X application for Windows.

## Prerequisites

1. **Node.js**: Make sure you have Node.js installed (v16 or newer)
2. **Git**: Make sure Git is installed 

## Getting Started

1. Clone the repository:
   ```
   git clone https://github.com/YOUR_USERNAME/svg-x.git
   cd svg-x
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

## Building the Windows Executable

There are several build options available:

### Option 1: Portable Executable (Recommended)
```
npm run build:portable-exe
```
This will create a portable .exe file in the `release` directory that can be run without installation.

### Option 2: Directory Output (For testing)
```
npm run electron:build:dir
```
This creates the application files in `release/win-unpacked` which can be useful for testing.

### Option 3: Create a ZIP archive of the unpacked build
```
npm run create-zip
```
This creates a ZIP file of the unpacked build at `release/SVG-X-win-unpacked.zip`.

## Important Build Notes

1. **Electron Entry Point**: If you get an error about `electron.cjs`, run:
   ```
   node create-electron-cjs.js
   ```
   This generates the necessary entry point file.

2. **Code Signing**: The default builds disable code signing. Users may get security warnings when running the app for the first time.

3. **Network Client Performance**: The application includes optimizations for network clients accessing the app from other devices:
   - Automatic downscaling of images
   - Adjusted processing parameters
   - Enhanced UI responsiveness

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

4. **"Cannot use 'in' operator to search for 'file'" error**:
   - This is related to code signing and can be ignored when using the non-signed build options

## Distributing the Application

- Share the portable executable `SVG-X-1.1.0-x64.exe` for the simplest distribution
- Alternatively, share the ZIP file containing the unpacked application
- The app works as a standalone application without installation 