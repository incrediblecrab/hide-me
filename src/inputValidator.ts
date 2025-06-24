export class InputValidator {
    private static readonly SAFE_FILENAME_PATTERN = /^[a-zA-Z0-9._-]+$/;
    private static readonly MAX_FILENAME_LENGTH = 255;
    private static readonly BLOCKED_FILENAMES = new Set([
        'CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM2', 'COM3', 'COM4', 'COM5',
        'COM6', 'COM7', 'COM8', 'COM9', 'LPT1', 'LPT2', 'LPT3', 'LPT4',
        'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
    ]);
    
    public static validateFileName(filename: string): boolean {
        if (!filename || filename.length > InputValidator.MAX_FILENAME_LENGTH) {
            return false;
        }
        
        // Check for blocked Windows device names
        const baseName = filename.split('.')[0].toUpperCase();
        if (InputValidator.BLOCKED_FILENAMES.has(baseName)) {
            return false;
        }
        
        // Allow more characters for flexibility but still secure
        return !/[<>:"|?*\x00-\x1f]/.test(filename);
    }
    
    public static sanitizeString(input: string, maxLength: number = 1000): string {
        if (!input) {
            return '';
        }
        
        return input
            .slice(0, maxLength)
            .replace(/[<>:"|?*\x00-\x1f]/g, '')  // Remove dangerous chars
            .replace(/\.\./g, '')                 // Remove parent directory references
            .trim();
    }
    
    public static validateWorkspacePath(workspacePath: string): boolean {
        if (!workspacePath || workspacePath.length === 0) {
            return false;
        }
        
        try {
            const fs = require('fs');
            const resolved = require('path').resolve(workspacePath);
            const stat = fs.statSync(resolved);
            return stat.isDirectory();
        } catch {
            return false;
        }
    }
    
    public static validateJsonString(jsonString: string, maxSize: number = 1024 * 1024): boolean {
        if (!jsonString || jsonString.length > maxSize) {
            return false;
        }
        
        try {
            JSON.parse(jsonString);
            return true;
        } catch {
            return false;
        }
    }
    
    public static sanitizePathForDisplay(filePath: string): string {
        // Remove sensitive information for display purposes
        return filePath
            .replace(/\/Users\/[^\/]+/g, '/Users/[USER]')
            .replace(/C:\\Users\\[^\\]+/g, 'C:\\Users\\[USER]')
            .replace(/\/home\/[^\/]+/g, '/home/[USER]');
    }
    
    public static validateExtensionName(name: string): boolean {
        if (!name || name.length < 1 || name.length > 100) {
            return false;
        }
        
        // Only allow alphanumeric, hyphens, and underscores
        return /^[a-zA-Z0-9_-]+$/.test(name);
    }
}