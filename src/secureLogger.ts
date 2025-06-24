import * as vscode from 'vscode';

export class SecureLogger {
    private static sensitivePatterns = [
        /\/Users\/[^\/]+/g,           // User home directories (macOS/Linux)
        /C:\\Users\\[^\\]+/g,         // Windows user directories
        /\/home\/[^\/]+/g,            // Linux home directories
        /password|token|key|secret/gi, // Sensitive keywords
        /\/\.ssh\//g,                 // SSH directories
        /\/\.aws\//g,                 // AWS config directories
    ];
    
    public static sanitizeMessage(message: string): string {
        let sanitized = message;
        
        for (const pattern of SecureLogger.sensitivePatterns) {
            sanitized = sanitized.replace(pattern, '[REDACTED]');
        }
        
        return sanitized;
    }
    
    public static logError(error: any, context?: string): void {
        const sanitizedMessage = SecureLogger.sanitizeMessage(
            error?.message || String(error)
        );
        
        console.error(
            context ? `${context}: ${sanitizedMessage}` : sanitizedMessage
        );
    }
    
    public static logWarning(message: string, context?: string): void {
        const sanitized = SecureLogger.sanitizeMessage(message);
        console.warn(context ? `${context}: ${sanitized}` : sanitized);
    }
    
    public static showUserError(message: string): void {
        const sanitized = SecureLogger.sanitizeMessage(message);
        vscode.window.showErrorMessage(sanitized);
    }
    
    public static showUserWarning(message: string): void {
        const sanitized = SecureLogger.sanitizeMessage(message);
        vscode.window.showWarningMessage(sanitized);
    }
}