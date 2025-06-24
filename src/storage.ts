import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { HiddenItem, HiddenItemsData } from './types';

export class HiddenItemsStorage {
    private static readonly VERSION = '1.0.0';
    private static readonly MAX_RECURSION_DEPTH = 10;
    
    private hiddenItemsCache: HiddenItem[] = [];
    
    constructor(private context: vscode.ExtensionContext) {}


    private getStorageFilePath(workspaceFolder: vscode.WorkspaceFolder): string {
        // Save directly in the workspace folder root as .hidden-items.json
        return path.join(workspaceFolder.uri.fsPath, '.hidden-items.json');
    }

    private updateCache(hiddenItems: HiddenItem[]): void {
        this.hiddenItemsCache = [...hiddenItems];
    }

    public getCachedItems(): HiddenItem[] {
        return this.hiddenItemsCache;
    }

    async loadHiddenItems(): Promise<HiddenItem[]> {
        const allItems: HiddenItem[] = [];
        
        if (!vscode.workspace.workspaceFolders) {
            return allItems;
        }

        for (const folder of vscode.workspace.workspaceFolders) {
            const filePath = this.getStorageFilePath(folder);
            try {
                if (fs.existsSync(filePath)) {
                    const content = await fs.promises.readFile(filePath, 'utf8');
                    const data = JSON.parse(content);
                    
                    if (data.hiddenItems && Array.isArray(data.hiddenItems)) {
                        allItems.push(...data.hiddenItems);
                    }
                }
            } catch (error) {
                console.error('Error loading hidden items:', error);
            }
        }

        this.updateCache(allItems);
        return allItems;
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
                console.error('Error saving hidden items:', error);
            }
        }
    }

    async addHiddenItem(uri: vscode.Uri): Promise<void> {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
        if (!workspaceFolder) {
            throw new Error('File must be within a workspace folder');
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
                    const children = await this.getChildPaths(uri.fsPath);
                    newItem.children = children;
                } catch (error) {
                    console.error('Failed to get children paths:', error);
                    newItem.children = [];
                }
            }

            const items = await this.loadHiddenItems();
            const filteredItems = items.filter(item => item.path !== uri.fsPath);
            filteredItems.push(newItem);
            await this.saveHiddenItems(filteredItems);
        } catch (error) {
            console.error('Error adding hidden item:', error);
            throw error;
        }
    }

    async removeHiddenItem(path: string): Promise<void> {
        const items = await this.loadHiddenItems();
        const filteredItems = items.filter(item => item.path !== path);
        
        if (items.length !== filteredItems.length) {
            await this.saveHiddenItems(filteredItems);
            this.updateCache(filteredItems);
        }
    }

    async removeAllHiddenItems(): Promise<void> {
        await this.saveHiddenItems([]);
        this.updateCache([]);
    }

    private async getChildPaths(rootPath: string): Promise<string[]> {
        const result: string[] = [];
        const stack: Array<{path: string, depth: number}> = [{path: rootPath, depth: 0}];
        
        while (stack.length > 0) {
            const {path: currentPath, depth} = stack.pop()!;
            
            if (depth >= HiddenItemsStorage.MAX_RECURSION_DEPTH) {
                continue;
            }
            
            try {
                const entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
                
                for (const entry of entries) {
                    const fullPath = path.join(currentPath, entry.name);
                    result.push(fullPath);
                    
                    if (entry.isDirectory() && depth < HiddenItemsStorage.MAX_RECURSION_DEPTH - 1) {
                        stack.push({path: fullPath, depth: depth + 1});
                    }
                }
            } catch (error) {
                console.error('Failed to read directory:', error);
            }
        }
        
        return result;
    }

}