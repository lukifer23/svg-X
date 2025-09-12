<!-- Last checked: 2025-03-02 -->

# SVG-X - Image to SVG Converter

A desktop application that converts raster images to SVG using Potrace.

## Features

- Upload any image file
- Automatically converts to grayscale
- Processes and traces the image to create an SVG
- Download the resulting SVG
- Customizable tracing parameters
- **Complex Image Mode** for optimizing complex geometric patterns and dense line work
- Fully responsive UI that works on both desktop and mobile devices
- **Network Mode** - Access from other devices on the local network with optimized processing
- **Memory Optimization** - Improved handling of large images with reduced memory footprint

## How It Works

The application follows these steps to convert raster images to SVG:

1. **Image Loading**: Uploads and loads the source image into memory
2. **Preprocessing**:
   - Scales large images down to a maximum of 1000px on the longest side while preserving aspect ratio (`resizeImage`)
   - Draws the image to a canvas with an optional background color

3. **Grayscale Conversion**:
   - Processes each pixel using the luminance formula: `0.299*R + 0.587*G + 0.114*B`
   - Creates a new grayscale image on a canvas
   - This step runs automatically for every upload to ensure consistent tracing results

4. **Image Tracing**:
   - Converts the canvas to a data URL (PNG format)
   - Passes the data URL to Potrace's trace function with optimized parameters
   - Potrace traces the image boundaries and generates vector paths

5. **SVG Generation**: 
   - The traced image is converted to SVG format
   - The SVG is displayed and made available for download

### Customizable Parameters

Users can adjust the following parameters to optimize the SVG output:

- **Detail Level (turdSize)**: Controls the minimum size of shapes to be included (1-10)
- **Threshold**: Sets the cutoff between black and white pixels (0-255)
- **Corner Threshold (alphaMax)**: Affects how corners are detected and processed (0.1-1.5)
- **Curve Optimization**: Enables smoother curves in the output SVG

#### Foreground & Background Colors

The `color` option sets the fill color for traced paths, while `background` controls the canvas behind them. Adjusting these values can dramatically change the SVG appearance (for example, white paths on a black background for a negative effect).

Enable **Color Preservation** in the Settings panel to sample and apply the original image colors instead of a single foreground/background combination.

### Complex Image Mode

The application includes a **Complex Image Mode** specifically designed for handling:
- Images with intricate geometric patterns
- Dense line work or diagrams
- Technical drawings and precise shapes

To use this feature:
1. Upload your image
2. Open the Settings panel by clicking the gear icon
3. Click the "Complex Image" button
4. The image will be reprocessed with optimized settings for complex patterns

This mode automatically adjusts multiple parameters to achieve better results with complex graphics:
- Increases the detail level to reduce noise
- Optimizes curve tolerance for cleaner lines
- Adjusts threshold for better line detection
- Sets turn policy for improved shape handling

### Mobile Responsiveness

SVG-X is now fully responsive and works on all device sizes:
- Adapts layout for mobile screens
- Touch-friendly controls
- Optimized network panel for smaller screens
- Accessible on phones and tablets via local network URLs

### Local Network Access

The application can be reached from other devices on the same network. After network hardening, SVG-X now retrieves active URLs from `/api/network-info` and refreshes the list every 30 seconds.

The network panel (Globe icon in the corner) shows these addresses and lets you copy them. Example usage from another device:

```
http://192.168.1.50:3000
```

The panel also lists `http://localhost:3000` for local access.

For developers and advanced users, the resolved URLs are logged to the console when the application starts:
- In development mode: Check the terminal where you started the app
- In the desktop app: The URLs are logged in the background console window

## Installation

### As a Desktop Application

SVG-X is available as a standalone desktop application for Windows, macOS, and Linux. The desktop version offers the same functionality as the web version, but runs locally without requiring a browser.

#### Windows Installation

Two options are available for Windows:

1. **Unpacked Application (Recommended)**:
   - Download `SVG-X-win-unpacked.zip` from the latest release
   - Extract the zip file to a location of your choice
   - Run `SVG-X.exe` from the extracted directory

2. **Portable Executable**:
   - Download `SVG-X-1.1.0-x64.exe` from the latest release
   - Run the executable directly - no installation required

Both versions automatically provide access on your local network when running.

#### macOS and Linux

Coming soon! We're working on builds for these platforms.

### Development Setup

1. Install dependencies:
```
npm install
```

2. Run the development server:
```
npm run dev
```

3. Or run with Electron:
```
npm run electron:dev
```

## Building for Distribution

### Web Application

```
npm run build
```

### Desktop Application

#### Windows Builds

Build a portable executable:
```
npm run build:portable-exe
```

Build an unpacked directory:
```
npm run electron:build:dir
```

Create a zip file of the unpacked directory:
```
npm run create-zip
```

The built application will be available in the `release` directory:
- Portable executable: `release\SVG-X-1.1.0-x64.exe`
- Unpacked application: `release\win-unpacked\`
- Zip file: `release\SVG-X-win-unpacked.zip`

#### All Platforms (may require additional configuration)

```
npm run electron:build
```

This will generate installers for your current platform in the `release` directory.

### Platform-Specific Builds

To build for a specific platform, add the platform flag:

```
# Windows
npm run electron:build -- --win

# macOS
npm run electron:build -- --mac

# Linux
npm run electron:build -- --linux
```

## Key Implementation Details

```typescript
import type { PotraceOptions } from './utils/imageProcessor';

// Critical configuration for Potrace tracing quality
const potraceParams: PotraceOptions = {
  turdSize: 2,        // Suppress speckles (smaller = more details)
  alphaMax: 1,        // Corner threshold
  optCurve: true,     // Optimize curves
  optTolerance: 0.2,  // Curve optimization tolerance
  threshold: 128,     // Black/white threshold
  blackOnWhite: true, // Fill black areas
  background: '#fff', // Background color
  color: '#000'       // Foreground color
};

// Critical for proper Potrace processing - convert canvas to data URL
const dataUrl = canvas.toDataURL('image/png');

// Use Potrace.trace with data URL instead of raw pixel data
(Potrace as any).trace(dataUrl, potraceParams, (err: Error | null, svg?: string) => {
  // Handle result
});
```

## Technical Details

### Libraries Used

- React with TypeScript
- Potrace for image tracing
- Tailwind CSS for styling
- Vite for build and development
- Electron for desktop application

### Recent Fixes

- Fixed SVG conversion functionality to properly implement the `processImage` function
- Added batch processing capability for converting multiple images at once
- Added color preservation mode for retaining original image colors
- Fixed Electron application mode detection for proper file loading
- Fixed Potrace implementation to properly use the library's `trace` function with enhanced error handling
- Corrected image data formatting for Potrace compatibility
- Improved conversion parameters for better SVG quality
- Optimized memory usage during image processing for better performance with large images
- Enhanced network client handling for improved remote access performance
- Streamlined Windows build process with portable executable option

## Development

1. Install dependencies:
```
npm install
```

2. Run the development server:
```
npm run dev
```

## Building for Production

```
npm run build
```

## Known Limitations

- Large images are automatically scaled down to 1000px maximum dimension (`resizeImage`)
- Works best with high-contrast images
- Processing may take some time depending on image complexity

## Future Improvements

Potential enhancements to build upon this foundation:

1. **Advanced Image Processing**:
   - Pre-processing options (contrast, brightness adjustments)
   - Edge detection filters to improve tracing quality
   - Noise reduction algorithms

2. **Tracing Options UI**:
   - Adjustable parameters for Potrace (turdSize, threshold, etc.)
   - Preview mode showing effect of different settings

3. **Multi-format Support**:
   - Output to additional vector formats (PDF, EPS)
   - Batch processing multiple images

4. **Optimization Options**:
   - SVG path simplification controls
   - File size optimization
   - SVG viewBox and dimensions configuration

5. **User Experience**:
   - Savable presets for different types of images
   - Progress indicators with more detailed status information
   - Image history for recently converted images

## Troubleshooting

### Common Issues

1. **No SVG Output / Conversion Hangs**
   - Ensure you're using the canvas data URL method shown in the implementation
   - Check that Potrace is receiving the image in the correct format (PNG data URL)
   - Verify the image has sufficient contrast between light and dark areas

2. **Jimp Constructor Errors**
   - These typically occur when raw pixel data is passed incorrectly to Potrace
   - Always use the data URL approach as shown in the implementation
   - Avoid using the direct Potrace constructor unless you're familiar with its internals

3. **Poor Quality SVG Output**
   - Try adjusting the `potraceParams` values for better results:
     - Lower `turdSize` (1-3) for more details
     - Adjust `threshold` for better black/white separation
     - Set `optCurve: true` and lower `optTolerance` for smoother curves

4. **Performance Issues**
   - Large or complex images will take longer to process
   - Consider implementing a worker thread for processing to avoid UI freezing
   - Implement progress callbacks from Potrace for better user feedback

### Windows Build Issues

#### Code Signing Errors

When building the Windows application, you may encounter code signing errors, especially if you don't have a code signing certificate. These errors can include:

```
Cannot use 'in' operator to search for 'file' in undefined failedTask=build
```

To build without code signing:

1. Use the portable executable build script:
   ```
   npm run build:portable-exe
   ```

2. This script explicitly disables all code signing by setting the necessary environment variables.

3. The built application will be available as a standalone executable in `release\` and the unpacked version in `release\win-unpacked\`.

4. To create a zip file of the unpacked application:
   ```
   npm run create-zip
   ```

#### Running the Application After Building

The application can be run directly from:
- The portable executable `SVG-X-1.1.0-x64.exe`
- The unpacked directory by executing `SVG-X.exe` from `release\win-unpacked\`

For network access, the application will automatically start an Express server on port 3000 and will be available at:
- `http://localhost:3000` (local access)
- `http://[your-ip-address]:3000` (network access) 