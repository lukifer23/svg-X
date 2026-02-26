import React, { useState, useRef } from 'react';
import { Upload, UploadCloud, AlertCircle } from 'lucide-react';

interface FileUploadProps {
  onImageSelect: (image: string, file: File) => void;
  isMobile?: boolean;
}

const ACCEPTED_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/bmp',
  'image/webp'
]);
const ACCEPTED_EXTENSIONS = /\.(png|jpe?g|gif|bmp|webp)$/i;
const MAX_SIZE_MB = 50;

const FileUpload: React.FC<FileUploadProps> = ({ onImageSelect, isMobile = false }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sizeWarning, setSizeWarning] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  const processFile = (file: File) => {
    setError(null);
    setSizeWarning(null);

    if (!ACCEPTED_TYPES.has(file.type) && !ACCEPTED_EXTENSIONS.test(file.name)) {
      setError('Unsupported file type. Please select a PNG, JPG, GIF, BMP, or WEBP image.');
      return;
    }

    const sizeMB = file.size / (1024 * 1024);
    if (sizeMB > MAX_SIZE_MB) {
      setError(`File is too large (${sizeMB.toFixed(1)} MB). Maximum size is ${MAX_SIZE_MB} MB.`);
      return;
    }

    if (sizeMB > 10) {
      setSizeWarning(`Large file (${sizeMB.toFixed(1)} MB) — processing may take longer.`);
    }

    const reader = new FileReader();
    reader.onload = e => {
      if (e.target && typeof e.target.result === 'string') {
        onImageSelect(e.target.result, file);
      }
    };
    reader.onerror = () => {
      setError('Failed to read the file. It may be locked or inaccessible.');
    };
    reader.readAsDataURL(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) processFile(files[0]);
    e.target.value = '';
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (dropZoneRef.current && e.relatedTarget instanceof Node && dropZoneRef.current.contains(e.relatedTarget)) {
      return;
    }
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) processFile(files[0]);
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="flex flex-col gap-3">
      <div
        ref={dropZoneRef}
        role="button"
        aria-label="Drop zone: drag and drop an image file here, or click to browse"
        tabIndex={0}
        className={`border-2 border-dashed rounded-lg p-4 sm:p-8 text-center cursor-pointer transition-all duration-300 animate-bounce-in shadow-soft
          ${isDragging ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-blue-300 hover:bg-gray-50/80'}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleClick}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick(); } }}
      >
        <input
          type="file"
          className="hidden"
          accept="image/png,image/jpeg,image/gif,image/bmp,image/webp"
          onChange={handleFileChange}
          ref={fileInputRef}
          aria-hidden="true"
        />
        <div className="flex flex-col items-center justify-center">
          <div className="mb-3 sm:mb-4 p-3 sm:p-4 rounded-full bg-gradient-to-br from-blue-100 to-indigo-100 text-blue-500 animate-pulse-subtle">
            <UploadCloud className={`${isMobile ? 'w-8 h-8' : 'w-10 h-10'}`} />
          </div>
          <h3 className={`${isMobile ? 'text-lg' : 'text-xl'} font-medium text-gradient mb-1 sm:mb-2`}>
            Drag and drop your image
          </h3>
          <p className="text-sm sm:text-base text-gray-500 mb-4 sm:mb-6">Or click to browse files</p>
          <button
            type="button"
            onClick={e => { e.stopPropagation(); handleClick(); }}
            className="btn btn-primary text-xs sm:text-sm"
          >
            <Upload className="w-4 h-4 mr-2" />
            Upload Image
          </button>
          <p className="mt-3 sm:mt-4 text-xs text-gray-400">
            Supports PNG, JPG, GIF, BMP, and WEBP — up to {MAX_SIZE_MB} MB
          </p>
        </div>
      </div>

      {sizeWarning && (
        <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-xs">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {sizeWarning}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}
    </div>
  );
};

export default FileUpload;
