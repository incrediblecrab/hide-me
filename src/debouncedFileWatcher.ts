import * as vscode from 'vscode';
import { HiddenItemsProvider } from './hiddenItemsProvider';
import { HiddenItemsStorage } from './storage';
import { SecureLogger } from './secureLogger';

export class DebouncedFileWatcher {
    private refreshTimer: NodeJS.Timeout | undefined;
    private pendingFiles: Set<string> = new Set();
    private static readonly DEBOUNCE_DELAY = 250; // 250ms
    
    constructor(
        private hiddenItemsProvider: HiddenItemsProvider,
        private storage: HiddenItemsStorage
    ) {}
    
    public handleFileCreated(files: readonly vscode.Uri[]): void {
        // Add files to pending set
        for (const file of files) {
            this.pendingFiles.add(file.fsPath);
        }
        
        // Debounce the refresh
        this.scheduleRefresh();
    }
    
    public handleFileDeleted(files: readonly vscode.Uri[]): void {
        // Add files to pending set
        for (const file of files) {
            this.pendingFiles.add(file.fsPath);
        }
        
        // Debounce the refresh
        this.scheduleRefresh();
    }
    
    public handleFileRenamed(files: readonly {oldUri: vscode.Uri, newUri: vscode.Uri}[]): void {
        // Add both old and new paths to pending set
        for (const file of files) {
            this.pendingFiles.add(file.oldUri.fsPath);
            this.pendingFiles.add(file.newUri.fsPath);
        }
        
        // Debounce the refresh
        this.scheduleRefresh();
    }
    
    private scheduleRefresh(): void {
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
        }
        
        this.refreshTimer = setTimeout(async () => {
            await this.processPendingFiles();
            this.pendingFiles.clear();
            this.refreshTimer = undefined;
        }, DebouncedFileWatcher.DEBOUNCE_DELAY);
    }
    
    private async processPendingFiles(): Promise<void> {
        if (this.pendingFiles.size === 0) {
            return;
        }
        
        try {
            const hiddenItems = await this.storage.loadHiddenItems();
            let needsRefresh = false;
            const itemsToRemove: string[] = [];
            
            // Batch process all pending files
            for (const filePath of this.pendingFiles) {
                if (this.storage.isPathHidden(filePath, hiddenItems)) {
                    const fileExists = await this.fileExists(filePath);
                    
                    if (fileExists) {
                        needsRefresh = true;
                    } else {
                        itemsToRemove.push(filePath);
                    }
                }
            }
            
            // Batch remove non-existent files
            if (itemsToRemove.length > 0) {
                await this.storage.removeHiddenItems(itemsToRemove);
                needsRefresh = true;
            }
            
            // Single refresh for all changes
            if (needsRefresh) {
                this.hiddenItemsProvider.refresh();
            }
        } catch (error) {
            SecureLogger.logError(error, 'Error processing file changes');
        }
    }
    
    private async fileExists(filePath: string): Promise<boolean> {
        try {
            await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
            return true;
        } catch {
            return false;
        }
    }
    
    public dispose(): void {
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
            this.refreshTimer = undefined;
        }
        this.pendingFiles.clear();
    }
}