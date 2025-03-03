/**
 * Script to create a ZIP file of the unpacked Windows build
 * This is used to distribute the application without requiring installation
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

// Configuration
const SOURCE_DIR = path.join(process.cwd(), 'release', 'win-unpacked');
const OUTPUT_FILE = path.join(process.cwd(), 'release', 'SVG-X-win-unpacked.zip');

// Check if the source directory exists
if (!fs.existsSync(SOURCE_DIR)) {
  console.error(`Error: Source directory not found: ${SOURCE_DIR}`);
  console.error('Please run the build command first: npm run electron:build:dir');
  process.exit(1);
}

console.log(`Creating ZIP file for SVG-X unpacked build...`);
console.log(`Source: ${SOURCE_DIR}`);
console.log(`Output: ${OUTPUT_FILE}`);

try {
  // Delete the output file if it already exists
  if (fs.existsSync(OUTPUT_FILE)) {
    fs.unlinkSync(OUTPUT_FILE);
    console.log(`Removed existing ZIP file: ${OUTPUT_FILE}`);
  }

  // Windows: Use PowerShell to create the ZIP file
  if (process.platform === 'win32') {
    const command = `powershell Compress-Archive -Path "${SOURCE_DIR}\\*" -DestinationPath "${OUTPUT_FILE}" -Force`;
    execSync(command, { stdio: 'inherit' });
  } 
  // Unix/Mac: Use zip command
  else {
    const command = `cd "${SOURCE_DIR}" && zip -r "${OUTPUT_FILE}" .`;
    execSync(command, { stdio: 'inherit' });
  }

  // Get the file size of the created ZIP file
  const stats = fs.statSync(OUTPUT_FILE);
  const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);

  console.log(`\nZIP file created successfully!`);
  console.log(`Location: ${OUTPUT_FILE}`);
  console.log(`Size: ${fileSizeMB} MB`);
  console.log(`\nThe ZIP file contains the unpacked SVG-X application.`);
  console.log(`It can be distributed as-is and run without installation.`);

} catch (error) {
  console.error(`\nError creating ZIP file: ${error.message}`);
  process.exit(1);
} 