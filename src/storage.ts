import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import Ajv from 'ajv';
import { HiddenItem, HiddenItemsData } from './types';
import { SecureLogger } from './secureLogger';
import { PerformanceMonitor } from './performanceMonitor';

export class HiddenItemsStorage {
    private static readonly STORAGE_FILE = '.hidden-items.json';
    private static readonly VERSION = '1.0.0';
    private static readonly MAX_RECURSION_DEPTH = 20;
    private static readonly MAX_ITEMS = 10000;
    private static readonly MAX_MEMORY_MB = 100;
    private static readonly MAX_JSON_SIZE = 1024 * 1024; // 1MB limit
    private static readonly MAX_PATH_LENGTH = 1000;
    private static readonly ajv = new Ajv();
    
    // Performance caching
    private hiddenPathsCache: Set<string> = new Set();
    private hiddenItemsMap: Map<string, HiddenItem> = new Map();
    private workspaceFolderCache: Map<string, string> = new Map();
    private cacheVersion: number = 0;
    
    constructor(private context: vscode.ExtensionContext) {}

    private getWorkspaceHash(workspaceFolder: vscode.WorkspaceFolder): string {
        // Create unique, non-reversible workspace identifier
        const crypto = require('crypto');
        return crypto
            .createHash('sha256')
            .update(workspaceFolder.uri.fsPath)
            .digest('hex')
            .substring(0, 16);
    }

    private getSecureStorageDir(): string {
        // Use VS Code's secure storage location
        const globalStoragePath = this.context.globalStorageUri.fsPath;
        
        // Ensure directory exists and has proper permissions
        if (!fs.existsSync(globalStoragePath)) {
            fs.mkdirSync(globalStoragePath, { 
                recursive: true, 
                mode: 0o700 // Owner read/write/execute only
            });
        }
        
        return globalStoragePath;
    }

    private getStorageFilePath(workspaceFolder: vscode.WorkspaceFolder): string {
        const workspaceHash = this.getWorkspaceHash(workspaceFolder);
        const storageDir = this.getSecureStorageDir();
        return path.join(storageDir, `.hidden-items-${workspaceHash}.json`);
    }

    private validatePath(filePath: string, workspaceFolder: vscode.WorkspaceFolder): boolean {
        try {
            // Check path length
            if (filePath.length > HiddenItemsStorage.MAX_PATH_LENGTH) {
                SecureLogger.logWarning(`Path too long: ${filePath.length} characters`);
                return false;
            }

            // Resolve and normalize paths
            const resolvedPath = path.resolve(filePath);
            const workspacePath = path.resolve(workspaceFolder.uri.fsPath);
            
            // Ensure path is within workspace
            const relativePath = path.relative(workspacePath, resolvedPath);
            
            // Block paths that escape workspace
            if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
                SecureLogger.logWarning(`Blocked path traversal attempt: ${filePath}`);
                return false;
            }
            
            // Block dangerous path components
            const dangerousPatterns = [
                /\.\./,           // Parent directory references
                /^\//,            // Absolute paths
                /\0/,             // Null bytes
                /[<>:"|?*]/,      // Windows invalid chars
                /[\x00-\x1f]/,    // Control characters
            ];
            
            for (const pattern of dangerousPatterns) {
                if (pattern.test(filePath)) {
                    SecureLogger.logWarning(`Blocked dangerous path pattern: ${filePath}`);
                    return false;
                }
            }
            
            return true;
        } catch (error) {
            SecureLogger.logError(error, 'Path validation error');
            return false;
        }
    }

    private validateHiddenItemsData(data: any): data is HiddenItemsData {
        // Size check first
        const jsonString = JSON.stringify(data);
        if (jsonString.length > HiddenItemsStorage.MAX_JSON_SIZE) {
            throw new Error(`JSON data too large: ${jsonString.length} bytes`);
        }
        
        const schema = {
            type: 'object',
            properties: {
                version: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+$' },
                hiddenItems: {
                    type: 'array',
                    maxItems: HiddenItemsStorage.MAX_ITEMS,
                    items: {
                        type: 'object',
                        properties: {
                            path: { type: 'string', maxLength: HiddenItemsStorage.MAX_PATH_LENGTH },
                            name: { type: 'string', maxLength: 255 },
                            type: { enum: ['file', 'folder'] },
                            workspaceFolder: { type: 'string', maxLength: HiddenItemsStorage.MAX_PATH_LENGTH },
                            children: { 
                                type: 'array', 
                                maxItems: 1000,
                                items: { type: 'string', maxLength: HiddenItemsStorage.MAX_PATH_LENGTH }
                            }
                        },
                        required: ['path', 'name', 'type', 'workspaceFolder'],
                        additionalProperties: false
                    }
                }
            },
            required: ['version', 'hiddenItems'],
            additionalProperties: false
        };
        
        const validate = HiddenItemsStorage.ajv.compile(schema);
        const valid = validate(data);
        
        if (!valid) {
            SecureLogger.logError(`JSON validation failed: ${JSON.stringify(validate.errors)}`);
            throw new Error('Invalid hidden items data structure');
        }
        
        return true;
    }

    // Cache management for O(1) performance
    private async updateCache(hiddenItems: HiddenItem[]): Promise<void> {
        this.hiddenPathsCache.clear();
        this.hiddenItemsMap.clear();
        
        for (const item of hiddenItems) {
            const normalizedPath = path.normalize(item.path);
            this.hiddenPathsCache.add(normalizedPath);
            this.hiddenItemsMap.set(normalizedPath, item);
            
            // Cache children paths for folders
            if (item.children) {
                for (const childPath of item.children) {
                    const normalizedChild = path.normalize(childPath);
                    this.hiddenPathsCache.add(normalizedChild);
                }
            }
        }
        
        this.cacheVersion++;
    }

    public getCachedItems(): HiddenItem[] {
        return Array.from(this.hiddenItemsMap.values());
    }

    async loadHiddenItems(): Promise<HiddenItem[]> {
        return PerformanceMonitor.time('loadHiddenItems', async () => {
            const allItems: HiddenItem[] = [];
        
        if (!vscode.workspace.workspaceFolders) {
            return allItems;
        }

        for (const folder of vscode.workspace.workspaceFolders) {
            const filePath = this.getStorageFilePath(folder);
            try {
                if (fs.existsSync(filePath)) {
                    const content = await fs.promises.readFile(filePath, 'utf8');
                    
                    // Check file size before parsing
                    if (content.length > HiddenItemsStorage.MAX_JSON_SIZE) {
                        SecureLogger.logWarning(`Storage file too large: ${content.length} bytes`);
                        continue;
                    }
                    
                    const data = JSON.parse(content);
                    this.validateHiddenItemsData(data);
                    
                    if (data.hiddenItems && Array.isArray(data.hiddenItems)) {
                        allItems.push(...data.hiddenItems);
                    }
                }
            } catch (error) {
                if (error instanceof SyntaxError) {
                    SecureLogger.logError(error, 'Invalid JSON in storage file');
                    SecureLogger.showUserWarning(`Corrupted storage file detected: ${path.basename(filePath)}`);
                } else {
                    SecureLogger.logError(error, 'Error loading hidden items');
                }
            }
        }

            // Update cache after loading
            await this.updateCache(allItems);
            return allItems;
        });
    }

    async saveHiddenItems(items: HiddenItem[]): Promise<void> {
        if (!vscode.workspace.workspaceFolders) {
            return;
        }

        const itemsByWorkspace = new Map<string, HiddenItem[]>();
        
        for (const item of items) {
            const wsItems = itemsByWorkspace.get(item.workspaceFolder) || [];
            wsItems.push(item);
            itemsByWorkspace.set(item.workspaceFolder, wsItems);
        }

        for (const folder of vscode.workspace.workspaceFolders) {
            const filePath = this.getStorageFilePath(folder);
            const wsItems = itemsByWorkspace.get(folder.uri.fsPath) || [];
            
            const data: HiddenItemsData = {
                version: HiddenItemsStorage.VERSION,
                hiddenItems: wsItems
            };

            try {
                await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
            } catch (error) {
                SecureLogger.logError(error, 'Error saving hidden items');
                SecureLogger.showUserError('Failed to save hidden items');
            }
        }
    }

    async addHiddenItem(uri: vscode.Uri): Promise<void> {
        return PerformanceMonitor.time('addHiddenItem', async () => {
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
        if (!workspaceFolder) {
            throw new Error('File must be within a workspace folder');
        }

        if (!this.validatePath(uri.fsPath, workspaceFolder)) {
            throw new Error('Invalid or unsafe file path');
        }

        try {
            const stats = await fs.promises.stat(uri.fsPath);
            const isDirectory = stats.isDirectory();
            
            const newItem: HiddenItem = {
                path: uri.fsPath,
                name: path.basename(uri.fsPath),
                type: isDirectory ? 'folder' : 'file',
                workspaceFolder: workspaceFolder.uri.fsPath
            };

            if (isDirectory) {
                try {
                    const children = await this.getChildPathsIterative(uri.fsPath);
                    newItem.children = children;
                } catch (error) {
                    SecureLogger.logError(error, 'Failed to get children paths');
                    newItem.children = []; // Set empty array if traversal fails
                }
            }

            const items = await this.loadHiddenItems();
            
            // Check if we're exceeding limits
            if (items.length >= HiddenItemsStorage.MAX_ITEMS) {
                throw new Error(`Cannot add more items. Maximum of ${HiddenItemsStorage.MAX_ITEMS} items allowed.`);
            }
            
            // Remove any existing item with the same path to avoid duplicates
            const filteredItems = items.filter(item => item.path !== uri.fsPath);
            filteredItems.push(newItem);
            await this.saveHiddenItems(filteredItems);
        } catch (error) {
            SecureLogger.logError(error, 'Error adding hidden item');
            throw error;
        }
        });
    }

    async removeHiddenItem(path: string): Promise<void> {
        const items = await this.loadHiddenItems();
        const filteredItems = items.filter(item => item.path !== path);
        
        if (items.length !== filteredItems.length) {
            await this.saveHiddenItems(filteredItems);
            await this.updateCache(filteredItems);
        }
    }

    async removeAllHiddenItems(): Promise<void> {
        await this.saveHiddenItems([]);
        await this.updateCache([]);
    }

    private async getChildPathsIterative(rootPath: string): Promise<string[]> {
        const result: string[] = [];
        const stack: Array<{path: string, depth: number}> = [{path: rootPath, depth: 0}];
        const startMemory = process.memoryUsage().heapUsed;
        
        while (stack.length > 0 && result.length < HiddenItemsStorage.MAX_ITEMS) {
            const {path: currentPath, depth} = stack.pop()!;
            
            if (depth >= HiddenItemsStorage.MAX_RECURSION_DEPTH) {
                SecureLogger.logWarning(`Skipping deep directory at depth: ${depth}`);
                continue;
            }
            
            // Check memory usage periodically
            if (result.length % 1000 === 0 && result.length > 0) {
                const currentMemory = process.memoryUsage().heapUsed;
                const usedMB = (currentMemory - startMemory) / 1024 / 1024;
                
                if (usedMB > HiddenItemsStorage.MAX_MEMORY_MB) {
                    SecureLogger.logWarning(`Memory limit exceeded: ${usedMB}MB, stopping traversal`);
                    break;
                }
            }
            
            try {
                const entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
                
                for (const entry of entries) {
                    const fullPath = path.join(currentPath, entry.name);
                    result.push(fullPath);
                    
                    if (entry.isDirectory() && depth < HiddenItemsStorage.MAX_RECURSION_DEPTH - 1) {
                        stack.push({path: fullPath, depth: depth + 1});
                    }
                    
                    if (result.length >= HiddenItemsStorage.MAX_ITEMS) {
                        SecureLogger.logWarning(`Item limit exceeded: ${result.length} items, stopping traversal`);
                        break;
                    }
                }
            } catch (error) {
                SecureLogger.logError(error, 'Failed to read directory');
            }
        }
        
        return result;
    }

    // O(1) lookup instead of O(n) linear search
    isPathHidden(checkPath: string, hiddenItems?: HiddenItem[]): boolean {
        return PerformanceMonitor.time('isPathHidden', () => {
            const normalizedPath = path.normalize(checkPath);
        
        // Use cached Set for O(1) lookup
        if (this.hiddenPathsCache.has(normalizedPath)) {
            return true;
        }
        
        // Check if parent directory is hidden
        let currentPath = normalizedPath;
        while (currentPath !== path.dirname(currentPath)) {
            currentPath = path.dirname(currentPath);
            if (this.hiddenPathsCache.has(currentPath)) {
                return true;
            }
        }
        
        return false;
        });
    }

    // Batch operations for efficiency
    async addHiddenItems(uris: vscode.Uri[]): Promise<void> {
        const hiddenItems = await this.loadHiddenItems();
        const newItems: HiddenItem[] = [];
        
        for (const uri of uris) {
            if (!this.isPathHidden(uri.fsPath)) {
                try {
                    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
                    if (!workspaceFolder) {
                        continue;
                    }

                    if (!this.validatePath(uri.fsPath, workspaceFolder)) {
                        continue;
                    }

                    const stats = await fs.promises.stat(uri.fsPath);
                    const isDirectory = stats.isDirectory();
                    
                    const newItem: HiddenItem = {
                        path: uri.fsPath,
                        name: path.basename(uri.fsPath),
                        type: isDirectory ? 'folder' : 'file',
                        workspaceFolder: workspaceFolder.uri.fsPath
                    };

                    if (isDirectory) {
                        try {
                            const children = await this.getChildPathsIterative(uri.fsPath);
                            newItem.children = children;
                        } catch (error) {
                            SecureLogger.logError(error, 'Failed to get children paths');
                            newItem.children = [];
                        }
                    }

                    newItems.push(newItem);
                } catch (error) {
                    SecureLogger.logError(error, `Error processing ${uri.fsPath}`);
                }
            }
        }
        
        if (newItems.length > 0) {
            hiddenItems.push(...newItems);
            await this.saveHiddenItems(hiddenItems);
            await this.updateCache(hiddenItems);
        }
    }

    async removeHiddenItems(pathsToRemove: string[]): Promise<void> {
        const items = await this.loadHiddenItems();
        const pathSet = new Set(pathsToRemove);
        const filteredItems = items.filter(item => !pathSet.has(item.path));
        
        if (items.length !== filteredItems.length) {
            await this.saveHiddenItems(filteredItems);
            await this.updateCache(filteredItems);
        }
    }
}