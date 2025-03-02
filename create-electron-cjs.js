import fs from 'fs';

// Read the electron.js file
const electronContent = fs.readFileSync('./electron.js', 'utf8');

// Write it as electron.cjs
fs.writeFileSync('./electron.cjs', electronContent);

console.log('Created electron.cjs file for Electron compatibility');

// Convert the SVG icon to PNG using sharp if needed
try {
  const sharp = await import('sharp');
  
  const svgBuffer = fs.readFileSync('./icon.svg');
  await sharp.default(svgBuffer)
    .resize(512, 512)
    .png()
    .toFile('./icon.png');
  
  console.log('Created icon.png from icon.svg');
} catch (error) {
  console.log('Could not convert SVG to PNG. Please install sharp or manually convert the icon.');
  console.log('Run: npm install --save-dev sharp');
  console.log('Error:', error.message);
} 