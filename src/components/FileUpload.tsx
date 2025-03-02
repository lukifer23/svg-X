import React, { useState, useRef } from 'react';
import { Upload, UploadCloud } from 'lucide-react';

interface FileUploadProps {
  onImageSelect: (image: string, file: File) => void;
  isMobile?: boolean;
}

const FileUpload: React.FC<FileUploadProps> = ({ onImageSelect, isMobile = false }) => {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const file = files[0];
      processFile(file);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const file = files[0];
      processFile(file);
    }
  };

  const handleClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const processFile = (file: File) => {
    if (!file.type.match('image.*')) {
      alert('Please select an image file.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target && typeof e.target.result === 'string') {
        onImageSelect(e.target.result, file);
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div
      className={`border-2 border-dashed rounded-lg p-4 sm:p-8 text-center cursor-pointer transition-all duration-300 animate-bounce-in shadow-soft
        ${isDragging ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-blue-300 hover:bg-gray-50/80'}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
    >
      <input
        type="file"
        className="hidden"
        accept="image/*"
        onChange={handleFileChange}
        ref={fileInputRef}
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
          className="btn btn-primary text-xs sm:text-sm"
        >
          <Upload className="w-4 h-4 mr-2" />
          Upload Image
        </button>
        <p className="mt-3 sm:mt-4 text-xs text-gray-400">
          Supports PNG, JPG, GIF, and BMP images
        </p>
      </div>
    </div>
  );
};

export default FileUpload; 