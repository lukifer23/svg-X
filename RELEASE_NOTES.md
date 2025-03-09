<!-- Last checked: 2025-03-02 -->

# SVG-X Release Notes

## Version 1.1.0 (Current)

### New Features
- **Complex Image Mode**: Added specialized optimization for processing complex geometric patterns and technical drawings
- **Enhanced Mobile Responsiveness**: Completely redesigned UI components to work on all screen sizes
- **Improved Error Handling**: Better feedback during image processing failures
- **Network URL Display**: Network addresses now prominently displayed in the UI for easier access from other devices
- **Optimized Processing Pipeline**: Better handling of complex images to prevent processing hang

### Improvements
- Redesigned network information panel that's expanded by default
- Added visual indicator for Complex Mode in settings
- Improved settings panel layout and organization
- Enhanced tooltips and helper text
- Better logging throughout the processing pipeline
- Streamlined UI controls for touch devices

### Fixes
- Fixed issues with converting complex images with dense line work
- Resolved UI scaling problems on mobile devices
- Improved error recovery for failed conversions
- Fixed network URL display issues
- Better memory management for large images

### Windows Build
- Available as a portable executable (SVG-X-1.1.0-x64.exe)
- Available as an unpacked application (SVG-X-win-unpacked.zip)
- Includes all dependencies and required files
- No installation needed - just run the executable

## Version 1.0.1

### Updates
- Fixed Windows build process to ensure reliable execution
- Improved build configuration to avoid code signing issues
- Updated dependencies to latest versions
- Enhanced build scripts for better development workflow
- Added GitHub release automation

### Features
- Upload and convert images to SVG with Potrace
- Customizable tracing parameters for different image types
- Automatic grayscale conversion and preprocessing
- Download SVG output
- Local network access for use on multiple devices

### Windows Build
- Successfully built and tested on Windows 10/11
- Available as a portable executable (SVG-X-1.0.1-x64.exe)
- Includes all dependencies and required files
- No installation needed - just run the executable

### Known Issues
- Network URL for accessing the app is only shown in the console, not in the UI
- On some systems, the portable executable may trigger security warnings
- Large or complex images may take longer to process

## Version 1.0.0

### Features
- Upload and convert images to SVG with Potrace
- Customizable tracing parameters for different image types
- Automatic grayscale conversion and preprocessing
- Download SVG output
- Local network access for use on multiple devices

### Windows Build
- Successfully built and tested on Windows 10/11
- Available as an unpacked application (SVG-X-win-unpacked.zip)
- Available as a portable executable (SVG-X-1.0.0-x64.exe)
- Includes all dependencies and required files
- No installation needed - extract and run

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
- `npm run build:win-no-sign` - Creates a Windows build without code signing
- `npm run electron:build:dir` - Creates an unpacked Windows application
- `npm run create-zip` - Creates a zip file of the unpacked application
- `npm run electron:build:portable` - Creates a portable executable (may require signing configuration)

### Installation
The application can be run directly from the unpacked directory. No installation is required.
For detailed installation instructions, see the README.md file. 