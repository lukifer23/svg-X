/**
 * Last checked: 2025-03-08
 */

import React, { useState, useEffect } from 'react';
import { FolderInput, FolderOutput, Play, X, Loader2, CheckCircle2, AlertCircle, ImageIcon, Settings } from 'lucide-react';
import { TracingParams } from '../utils/imageProcessor';

// Add TypeScript interface for electronAPI
declare global {
  interface Window {
    electronAPI?: {
      selectInputDirectory: () => Promise<string | null>;
      selectOutputDirectory: () => Promise<string | null>;
      readDirectory: (dirPath: string) => Promise<string[] | { error: string }>;
      saveSvg: (data: { svgData: string, outputPath: string }) => Promise<{ success: boolean, path: string } | { error: string }>;
      readImageFile: (filePath: string) => Promise<string | { error: string }>;
      resizeImage?: (data: { imageData: string, width: number, height: number }) => Promise<string | { error: string }>;
      toggleConsole?: () => Promise<{ visible: boolean }>;
    }
  }
}

interface BatchConversionProps {
  potraceParams: TracingParams;
  onClose: () => void;
  processImage: (imageData: string, params: TracingParams) => Promise<string>;
}

interface BatchProcessingStats {
  total: number;
  completed: number;
  failed: number;
  inProgress: number;
}

interface ProcessingItem {
  filePath: string;
  fileName: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
}

// Add resize options interface
interface ResizeOptions {
  enabled: boolean;
  width: number;
  height: number;
  maintainAspectRatio: boolean;
}

const BatchConversion: React.FC<BatchConversionProps> = ({ potraceParams, onClose, processImage }) => {
  const [inputDirectory, setInputDirectory] = useState<string | null>(null);
  const [outputDirectory, setOutputDirectory] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingItems, setProcessingItems] = useState<ProcessingItem[]>([]);
  const [stats, setStats] = useState<BatchProcessingStats>({ total: 0, completed: 0, failed: 0, inProgress: 0 });
  const [currentFileIndex, setCurrentFileIndex] = useState<number>(-1);
  const [isElectronEnvironment, setIsElectronEnvironment] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  // Add state for resize options
  const [resizeOptions, setResizeOptions] = useState<ResizeOptions>({
    enabled: false,
    width: 512,
    height: 512,
    maintainAspectRatio: true
  });
  
  // Add state for showing resize settings
  const [showResizeSettings, setShowResizeSettings] = useState<boolean>(false);
  
  // Check if we're in an Electron environment on component mount
  useEffect(() => {
    const checkElectronEnvironment = () => {
      const isElectron = !!window.electronAPI;
      console.log('Electron environment detected:', isElectron);
      setIsElectronEnvironment(isElectron);
      
      if (!isElectron) {
        setErrorMessage('Batch conversion requires the Electron app. Please run SVG-X as a desktop application to use this feature.');
      }
    };
    
    checkElectronEnvironment();
  }, []);
  
  // Function to select input directory
  const handleSelectInputDirectory = async () => {
    if (!isElectronEnvironment || !window.electronAPI) {
      setErrorMessage("Cannot access file system in browser mode. Please run with 'npm run electron:dev'.");
      return;
    }
    
    try {
      const selectedDir = await window.electronAPI.selectInputDirectory();
      if (selectedDir) {
        setInputDirectory(selectedDir);
        
        // Reset any previous errors
        setErrorMessage(null);
        
        // List image files in the directory
        const files = await window.electronAPI.readDirectory(selectedDir);
        
        if (Array.isArray(files)) {
          // Create a Map to avoid duplicate files by filename
          const uniqueFiles = new Map();
          
          files.forEach(filePath => {
            const fileName = filePath.split(/[/\\]/).pop() || '';
            // Only add if it's an image file
            if (/\.(jpe?g|png|gif|bmp)$/i.test(fileName)) {
              uniqueFiles.set(fileName, {
                filePath,
                fileName,
                status: 'pending'
              });
            }
          });
          
          const items: ProcessingItem[] = Array.from(uniqueFiles.values());
          
          if (items.length === 0) {
            setErrorMessage("No image files found in the selected directory. Please select a directory containing image files.");
            return;
          }
          
          console.log(`Found ${items.length} unique image files to process`);
          
          setProcessingItems(items);
          setStats({
            total: items.length,
            completed: 0,
            failed: 0,
            inProgress: 0
          });
        } else {
          console.error('Error reading directory:', files.error);
          setErrorMessage(`Error reading directory: ${files.error}`);
        }
      }
    } catch (error) {
      console.error('Error selecting input directory:', error);
      setErrorMessage(`Error selecting directory: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  
  // Function to select output directory
  const handleSelectOutputDirectory = async () => {
    if (!isElectronEnvironment || !window.electronAPI) {
      setErrorMessage("Cannot access file system in browser mode. Please run with 'npm run electron:dev'.");
      return;
    }
    
    try {
      const selectedDir = await window.electronAPI.selectOutputDirectory();
      if (selectedDir) {
        setOutputDirectory(selectedDir);
      }
    } catch (error) {
      console.error('Error selecting output directory:', error);
      setErrorMessage(`Error selecting directory: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  
  // Function to start batch processing
  const startBatchProcessing = async () => {
    if (!inputDirectory || !outputDirectory || processingItems.length === 0) {
      return;
    }
    
    // Show confirmation dialog
    const confirmed = window.confirm(
      `You are about to process ${processingItems.length} image files from:\n${inputDirectory}\n\nSVG files will be saved to:\n${outputDirectory}\n\nDo you want to continue?`
    );
    
    if (!confirmed) {
      return;
    }
    
    // Reset any previous state
    setStats({
      total: processingItems.length,
      completed: 0,
      failed: 0,
      inProgress: 0
    });
    
    // Reset all items to pending state
    setProcessingItems(items => 
      items.map(item => ({
        ...item,
        status: 'pending',
        error: undefined
      }))
    );
    
    // Start processing
    setIsProcessing(true);
    setCurrentFileIndex(0);
  };
  
  // Effect to handle the processing queue
  useEffect(() => {
    if (!isProcessing || currentFileIndex < 0 || currentFileIndex >= processingItems.length || !window.electronAPI) {
      return;
    }
    
    const processCurrentFile = async () => {
      const currentItem = processingItems[currentFileIndex];
      
      // Skip if this file is already processed or processing
      if (currentItem.status !== 'pending') {
        // Already processed or processing, move to next file
        if (currentFileIndex < processingItems.length - 1) {
          setCurrentFileIndex(prevIndex => prevIndex + 1);
        } else {
          // All files processed
          setIsProcessing(false);
          setCurrentFileIndex(-1);
        }
        return;
      }
      
      console.log(`Processing file ${currentFileIndex + 1}/${processingItems.length}: ${currentItem.fileName}`);
      
      // Update status to processing
      setProcessingItems(items => 
        items.map((item, idx) => 
          idx === currentFileIndex ? { ...item, status: 'processing' } : item
        )
      );
      
      setStats(prev => ({ ...prev, inProgress: 1 }));
      
      try {
        // Read the file
        const fileData = await readFileAsDataURL(currentItem.filePath);
        
        // Process the image
        const svgData = await processImage(fileData, potraceParams);
        
        // Get base filename without extension
        const baseFileName = currentItem.fileName.split('.').slice(0, -1).join('.') || currentItem.fileName;
        
        // Save the SVG
        if (!window.electronAPI) {
          throw new Error('Electron API is not available');
        }
        
        const outputPath = joinPaths(outputDirectory!, `${baseFileName}.svg`);
        const saveResult = await window.electronAPI.saveSvg({ svgData, outputPath });
        
        if ('success' in saveResult && saveResult.success) {
          // Update status to completed
          setProcessingItems(items => 
            items.map((item, idx) => 
              idx === currentFileIndex ? { ...item, status: 'completed' } : item
            )
          );
          
          setStats(prev => ({ 
            ...prev, 
            completed: prev.completed + 1,
            inProgress: 0
          }));
        } else {
          throw new Error('error' in saveResult ? saveResult.error : 'Failed to save SVG');
        }
      } catch (error) {
        console.error(`Error processing ${currentItem.fileName}:`, error);
        
        // Update status to failed
        setProcessingItems(items => 
          items.map((item, idx) => 
            idx === currentFileIndex ? { 
              ...item, 
              status: 'failed',
              error: error instanceof Error ? error.message : 'Unknown error'
            } : item
          )
        );
        
        setStats(prev => ({ 
          ...prev, 
          failed: prev.failed + 1,
          inProgress: 0
        }));
      }
      
      // Move to next file
      if (currentFileIndex < processingItems.length - 1) {
        setCurrentFileIndex(prevIndex => prevIndex + 1);
      } else {
        // All files processed
        setIsProcessing(false);
        setCurrentFileIndex(-1);
      }
    };
    
    // Use a timeout to avoid potential infinite loops 
    // and give UI time to update between files
    const timeoutId = setTimeout(() => {
      processCurrentFile();
    }, 100);
    
    return () => clearTimeout(timeoutId);
  // Remove processingItems from dependency array to prevent reprocessing
  // when items are updated
  }, [isProcessing, currentFileIndex, outputDirectory, potraceParams, processImage]);
  
  // Update readFileAsDataURL to handle resizing
  const readFileAsDataURL = async (filePath: string): Promise<string> => {
    if (!window.electronAPI) {
      throw new Error('Electron API is not available');
    }

    try {
      let result = await window.electronAPI.readImageFile(filePath);
      
      if (typeof result !== 'string') {
        throw new Error(result.error || 'Failed to read image file');
      }
      
      // If resize is enabled, resize the image
      if (resizeOptions.enabled && window.electronAPI && window.electronAPI.resizeImage) {
        console.log(`Resizing image to ${resizeOptions.width}x${resizeOptions.height}`);
        
        try {
          const resizedImage = await window.electronAPI.resizeImage({
            imageData: result,
            width: resizeOptions.width,
            height: resizeOptions.height
          });
          
          if (typeof resizedImage !== 'string') {
            throw new Error(resizedImage.error || 'Failed to resize image');
          }
          
          result = resizedImage;
        } catch (error) {
          console.error('Error resizing image:', error);
          // Continue with original image if resize fails
        }
      }
      
      return result;
    } catch (error) {
      console.error(`Error reading file ${filePath}:`, error);
      throw error;
    }
  };
  
  // Add helper function for path joining to handle different OS path separators
  const joinPaths = (path1: string, path2: string): string => {
    // Remove trailing slashes from first path
    const cleanPath1 = path1.replace(/[/\\]$/, '');
    // Remove leading slashes from second path
    const cleanPath2 = path2.replace(/^[/\\]/, '');
    
    // Use forward slash as universal separator
    return `${cleanPath1}/${cleanPath2}`;
  };
  
  // Render progress bar
  const renderProgressBar = () => {
    const percentage = stats.total > 0 
      ? Math.round(((stats.completed + stats.failed) / stats.total) * 100) 
      : 0;
    
    return (
      <div className="w-full bg-gray-200 rounded-full h-2.5 mb-4">
        <div 
          className="bg-blue-600 h-2.5 rounded-full" 
          style={{ width: `${percentage}%` }}></div>
      </div>
    );
  };
  
  // Create a component for resize settings
  const ResizeSettings = () => (
    <div className="border rounded-lg p-4 mb-4 bg-gray-50">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-medium text-gray-800">Image Resize Options</h3>
        <button
          onClick={() => setShowResizeSettings(false)}
          className="p-1 rounded-full hover:bg-gray-200 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      
      <div className="space-y-3">
        <div className="flex items-center">
          <input
            type="checkbox"
            id="resize-enabled"
            checked={resizeOptions.enabled}
            onChange={(e) => setResizeOptions(prev => ({
              ...prev,
              enabled: e.target.checked
            }))}
            className="mr-2"
          />
          <label htmlFor="resize-enabled" className="text-sm">Enable image resizing</label>
        </div>
        
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="resize-width" className="block text-sm mb-1">Width (px)</label>
            <input
              type="number"
              id="resize-width"
              value={resizeOptions.width}
              onChange={(e) => setResizeOptions(prev => ({
                ...prev,
                width: Math.max(1, parseInt(e.target.value) || 1)
              }))}
              disabled={!resizeOptions.enabled}
              className="w-full px-3 py-2 border rounded text-sm"
            />
          </div>
          
          <div>
            <label htmlFor="resize-height" className="block text-sm mb-1">Height (px)</label>
            <input
              type="number"
              id="resize-height"
              value={resizeOptions.height}
              onChange={(e) => setResizeOptions(prev => ({
                ...prev,
                height: Math.max(1, parseInt(e.target.value) || 1)
              }))}
              disabled={!resizeOptions.enabled}
              className="w-full px-3 py-2 border rounded text-sm"
            />
          </div>
        </div>
        
        <div className="flex items-center">
          <input
            type="checkbox"
            id="maintain-aspect"
            checked={resizeOptions.maintainAspectRatio}
            onChange={(e) => setResizeOptions(prev => ({
              ...prev,
              maintainAspectRatio: e.target.checked
            }))}
            disabled={!resizeOptions.enabled}
            className="mr-2"
          />
          <label htmlFor="maintain-aspect" className="text-sm">Maintain aspect ratio</label>
        </div>
      </div>
    </div>
  );
  
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-3xl max-h-[80vh] overflow-y-auto p-4 sm:p-6 shadow-xl">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold">Batch Conversion</h2>
          <button
            onClick={onClose}
            disabled={isProcessing}
            className="p-1 rounded-full hover:bg-gray-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        
        {/* Error message display */}
        {errorMessage && (
          <div className="mb-4 p-4 bg-red-100 border border-red-300 text-red-700 rounded-md">
            <div className="flex items-start">
              <AlertCircle className="w-5 h-5 mr-2 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium mb-1">Electron Environment Required</p>
                <p className="mb-2">{errorMessage}</p>
                {!isElectronEnvironment && (
                  <div className="mt-2 p-2 bg-gray-100 rounded text-gray-800 font-mono text-sm">
                    npm run electron:dev
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        
        <div className="space-y-6">
          {/* Resize Settings Toggle */}
          <div className="flex justify-end">
            <button
              onClick={() => setShowResizeSettings(!showResizeSettings)}
              className="btn btn-secondary flex items-center gap-2"
              disabled={isProcessing}
            >
              <ImageIcon className="w-4 h-4" />
              <span>Image Resize Options</span>
            </button>
          </div>
          
          {/* Resize Settings Panel */}
          {showResizeSettings && <ResizeSettings />}
          
          {/* Directory Selection */}
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <button
                onClick={handleSelectInputDirectory}
                disabled={isProcessing}
                className="btn btn-primary flex items-center gap-2"
              >
                <FolderInput className="w-4 h-4" />
                <span>Select Input Directory</span>
              </button>
              
              {inputDirectory && (
                <div className="text-sm truncate max-w-xs">
                  <span className="font-medium">Selected:</span> {inputDirectory}
                </div>
              )}
            </div>
            
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <button
                onClick={handleSelectOutputDirectory}
                disabled={isProcessing}
                className="btn btn-primary flex items-center gap-2"
              >
                <FolderOutput className="w-4 h-4" />
                <span>Select Output Directory</span>
              </button>
              
              {outputDirectory && (
                <div className="text-sm truncate max-w-xs">
                  <span className="font-medium">Selected:</span> {outputDirectory}
                </div>
              )}
            </div>
          </div>
          
          {/* File List */}
          {processingItems.length > 0 && (
            <div className="border rounded-lg overflow-hidden">
              <div className="p-3 bg-gray-50 border-b">
                <div className="font-medium">Files to process: {stats.total}</div>
                {renderProgressBar()}
                <div className="flex justify-between text-sm">
                  <div>Completed: <span className="text-green-600">{stats.completed}</span></div>
                  <div>Failed: <span className="text-red-600">{stats.failed}</span></div>
                  <div>Remaining: <span className="text-blue-600">{Math.max(0, stats.total - stats.completed - stats.failed)}</span></div>
                </div>
              </div>
              
              <div className="max-h-60 overflow-y-auto">
                {processingItems.map((item, index) => (
                  <div 
                    key={`${item.filePath}-${index}`} 
                    className={`flex justify-between items-center p-2 text-sm ${
                      index % 2 === 0 ? 'bg-white' : 'bg-gray-50'
                    } ${
                      index === currentFileIndex ? 'bg-blue-50' : ''
                    }`}
                  >
                    <div className="truncate max-w-xs">{item.fileName}</div>
                    <div className="flex items-center">
                      {item.status === 'pending' && <span className="text-gray-500">Pending</span>}
                      {item.status === 'processing' && (
                        <span className="flex items-center text-blue-600">
                          <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                          Processing
                        </span>
                      )}
                      {item.status === 'completed' && (
                        <span className="flex items-center text-green-600">
                          <CheckCircle2 className="w-4 h-4 mr-1" />
                          Completed
                        </span>
                      )}
                      {item.status === 'failed' && (
                        <span className="flex items-center text-red-600">
                          <AlertCircle className="w-4 h-4 mr-1" />
                          Failed
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {/* Start Button */}
          <div className="flex justify-end">
            <button
              onClick={startBatchProcessing}
              disabled={!inputDirectory || !outputDirectory || processingItems.length === 0 || isProcessing}
              className={`btn ${isProcessing ? 'btn-disabled' : 'btn-primary'} flex items-center gap-2`}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Processing...</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  <span>Start Batch Processing</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BatchConversion; 