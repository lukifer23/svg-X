# SVG Bolt - Image to SVG Converter

A React application that converts images to SVG using Potrace.

## Features

- Upload any image file
- Automatically converts to grayscale
- Processes and traces the image to create an SVG
- Download the resulting SVG
- Customizable tracing parameters
- Available on local network for access from other devices

## How It Works

The application follows these steps to convert raster images to SVG:

1. **Image Loading**: Uploads and loads the source image into memory
2. **Preprocessing**: 
   - Scales large images down to max 1000px dimension while preserving aspect ratio
   - Draws the image to a canvas with a white background

3. **Grayscale Conversion**:
   - Processes each pixel using the luminance formula: `0.299*R + 0.587*G + 0.114*B`
   - Creates a new grayscale image on a canvas

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

### Local Network Access

The application can be accessed from other devices on the same network. When running the development server or the desktop application, it listens on all network interfaces (0.0.0.0), allowing access via:

```
http://[your-computer-ip]:3000
```

Currently, the local network URL is displayed in the application console when it starts. You can see these URLs by:
- In development mode: Check the terminal where you started the app
- In the desktop app: The URLs are logged in the background (not visible to end users)

We're working on adding this information directly to the user interface in a future update.

## Installation

### As a Desktop Application

SVG Bolt is available as a standalone desktop application for Windows, macOS, and Linux. The desktop version offers the same functionality as the web version, but runs locally without requiring a browser.

#### Windows Installation

Two options are available for Windows:

1. **Unpacked Application (Recommended)**:
   - Download `SVG-Bolt-win-unpacked.zip` from the latest release
   - Extract the zip file to a location of your choice
   - Run `SVG Bolt.exe` from the extracted directory

2. **Portable Executable**:
   - Download `SVG Bolt-1.0.0-x64.exe` from the latest release
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

Build an unpacked directory (recommended):
```
npm run electron:build:dir
```

Create a zip file of the unpacked directory:
```
npm run create-zip
```

The built application will be available in the `release` directory:
- Unpacked application: `release\win-unpacked\`
- Zip file: `release\SVG-Bolt-win-unpacked.zip`

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
// Critical configuration for Potrace tracing quality
const potraceParams = {
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

### Recent Fixes

- Fixed Potrace implementation to properly use the library's `trace` function
- Corrected image data formatting for Potrace compatibility
- Improved conversion parameters for better SVG quality
- Fixed validation and error handling for image processing

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

- Large images are automatically scaled down to 1000px maximum dimension
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