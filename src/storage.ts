import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { HiddenItem, HiddenItemsData } from './types';

export class HiddenItemsStorage {
    private static readonly STORAGE_FILE = '.hidden-items.json';
    private static readonly VERSION = '1.0.0';

    private getStorageFilePath(workspaceFolder: vscode.WorkspaceFolder): string {
        return path.join(workspaceFolder.uri.fsPath, HiddenItemsStorage.STORAGE_FILE);
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
                    const data: HiddenItemsData = JSON.parse(content);
                    
                    if (data.hiddenItems && Array.isArray(data.hiddenItems)) {
                        allItems.push(...data.hiddenItems);
                    }
                }
            } catch (error) {
                console.error(`Error loading hidden items from ${filePath}:`, error);
            }
        }

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
                console.error(`Error saving hidden items to ${filePath}:`, error);
                vscode.window.showErrorMessage(`Failed to save hidden items: ${error}`);
            }
        }
    }

    async addHiddenItem(uri: vscode.Uri): Promise<void> {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
        if (!workspaceFolder) {
            return;
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
            const children = await this.getChildPaths(uri.fsPath);
            newItem.children = children;
        }

        const items = await this.loadHiddenItems();
        
        const existingIndex = items.findIndex(item => item.path === uri.fsPath);
        if (existingIndex === -1) {
            items.push(newItem);
            await this.saveHiddenItems(items);
        }
    }

    async removeHiddenItem(path: string): Promise<void> {
        const items = await this.loadHiddenItems();
        const filteredItems = items.filter(item => item.path !== path);
        
        if (items.length !== filteredItems.length) {
            await this.saveHiddenItems(filteredItems);
        }
    }

    async removeAllHiddenItems(): Promise<void> {
        await this.saveHiddenItems([]);
    }

    private async getChildPaths(dirPath: string): Promise<string[]> {
        const children: string[] = [];
        
        try {
            const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
            
            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);
                children.push(fullPath);
                
                if (entry.isDirectory()) {
                    const subChildren = await this.getChildPaths(fullPath);
                    children.push(...subChildren);
                }
            }
        } catch (error) {
            console.error(`Error reading directory ${dirPath}:`, error);
        }
        
        return children;
    }

    isPathHidden(checkPath: string, hiddenItems: HiddenItem[]): boolean {
        for (const item of hiddenItems) {
            if (checkPath === item.path) {
                return true;
            }
            
            if (item.type === 'folder' && checkPath.startsWith(item.path + path.sep)) {
                return true;
            }
        }
        
        return false;
    }
}