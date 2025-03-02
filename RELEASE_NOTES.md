# SVG Bolt Release Notes

## Version 1.0.0 (Current)

### Features
- Upload and convert images to SVG with Potrace
- Customizable tracing parameters for different image types
- Automatic grayscale conversion and preprocessing
- Download SVG output
- Local network access for use on multiple devices

### Windows Build
- Successfully built and tested on Windows 10/11
- Available as an unpacked application (SVG-Bolt-win-unpacked.zip)
- Available as a portable executable (SVG Bolt-1.0.0-x64.exe)
- Includes all dependencies and required files
- No installation needed - extract and run

### Known Issues
- Network URL for accessing the app is only shown in the console, not in the UI
- On some systems, the portable executable may trigger security warnings
- Large or complex images may take longer to process

### Coming Soon
- macOS and Linux builds
- Improved user interface with network URL display
- Better error handling and progress indicators
- Batch processing for multiple images
- Additional vector format outputs

## Development Notes

### Building the Application
The application is built using Electron and React. For detailed build instructions, see the README.md file.

Key build scripts:
- `npm run electron:build:dir` - Creates an unpacked Windows application
- `npm run create-zip` - Creates a zip file of the unpacked application
- `npm run electron:build:portable` - Creates a portable executable (may require signing configuration)

### Installation
The application can be run directly from the unpacked directory. No installation is required.
For detailed installation instructions, see the README.md file. 