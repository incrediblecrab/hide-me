import * as vscode from 'vscode';
import * as path from 'path';
import { HiddenItem } from './types';
import { HiddenItemsStorage } from './storage';
import { FileHider } from './fileHider';

export class HiddenItemsProvider implements vscode.TreeDataProvider<HiddenItem>, vscode.TreeDragAndDropController<HiddenItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<HiddenItem | undefined | null | void> = new vscode.EventEmitter<HiddenItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<HiddenItem | undefined | null | void> = this._onDidChangeTreeData.event;

    dropMimeTypes = ['application/vnd.code.tree.hiddenItems'];
    dragMimeTypes = ['text/uri-list'];

    // Performance caching
    private treeCache: Map<string, vscode.TreeItem> = new Map();
    private lastDataHash: string = '';
    private childrenCache: Map<string, HiddenItem[]> = new Map();

    constructor(private storage: HiddenItemsStorage, private fileHider?: FileHider) {}

    refresh(): void {
        // Only fire change event if data actually changed
        const currentHash = this.calculateDataHash();
        if (currentHash !== this.lastDataHash) {
            this.lastDataHash = currentHash;
            this.clearCaches();
            this._onDidChangeTreeData.fire();
        }
    }

    private clearCaches(): void {
        this.treeCache.clear();
        this.childrenCache.clear();
    }

    private calculateDataHash(): string {
        // Simple hash of current hidden items for change detection
        const crypto = require('crypto');
        const cachedItems = this.storage.getCachedItems();
        return crypto.createHash('md5')
            .update(JSON.stringify(cachedItems.map(item => item.path)))
            .digest('hex');
    }

    getTreeItem(element: HiddenItem): vscode.TreeItem {
        const cacheKey = `${element.path}:${element.type}`;
        
        // Return cached item if available
        if (this.treeCache.has(cacheKey)) {
            return this.treeCache.get(cacheKey)!;
        }
        
        // Create new tree item
        const treeItem = this.createTreeItem(element);
        
        // Cache with size limit
        if (this.treeCache.size > 1000) {
            // Clear cache when it gets too large
            this.treeCache.clear();
        }
        
        this.treeCache.set(cacheKey, treeItem);
        return treeItem;
    }

    private createTreeItem(element: HiddenItem): vscode.TreeItem {
        let collapsibleState = vscode.TreeItemCollapsibleState.None;
        
        if (element.type === 'folder') {
            // Only make folders collapsible if they have children
            collapsibleState = (element.children && element.children.length > 0) 
                ? vscode.TreeItemCollapsibleState.Collapsed 
                : vscode.TreeItemCollapsibleState.None;
        }
        
        const item = new vscode.TreeItem(element.name, collapsibleState);

        item.contextValue = `hidden${element.type.charAt(0).toUpperCase() + element.type.slice(1)}`;
        
        // Lazy load tooltip and description
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(element.path));
        if (workspaceFolder) {
            const relativePath = path.relative(workspaceFolder.uri.fsPath, element.path);
            item.tooltip = relativePath;
            item.description = path.dirname(relativePath) === '.' ? '' : path.dirname(relativePath);
        }

        // Lazy load icons
        item.iconPath = this.getIconPath(element.type);

        item.resourceUri = vscode.Uri.file(element.path);
        
        // Enable dragging for this tree item and set context for menus
        item.contextValue = 'hiddenItem';
        
        // Add command to open file when clicked (only for files, not folders)
        if (element.type === 'file') {
            item.command = {
                command: 'hideMe.openFile',
                title: 'Open File',
                arguments: [element]
            };
        }

        return item;
    }

    private getIconPath(type: string): vscode.ThemeIcon {
        return type === 'folder' ? new vscode.ThemeIcon('folder') : new vscode.ThemeIcon('file');
    }

    async getChildren(element?: HiddenItem): Promise<HiddenItem[]> {
        if (!element) {
            // Root level - return cached items
            return this.storage.getCachedItems();
        }
        
        // Check cache first
        const cacheKey = element.path;
        if (this.childrenCache.has(cacheKey)) {
            return this.childrenCache.get(cacheKey)!;
        }
        
        // If it's a folder, show its children
        if (element.type === 'folder' && element.children) {
            const childItems = await this.loadChildrenBatch(element);
            
            // Cache the result
            this.childrenCache.set(cacheKey, childItems);
            
            return childItems;
        }
        
        return [];
    }

    private async loadChildrenBatch(element: HiddenItem): Promise<HiddenItem[]> {
        const childItems: HiddenItem[] = [];
        const batchSize = 50; // Process children in batches
        
        if (!element.children) {
            return childItems;
        }
        
        for (let i = 0; i < element.children.length; i += batchSize) {
            const batch = element.children.slice(i, i + batchSize);
            const batchPromises = batch.map(async (childPath) => {
                try {
                    const stats = await vscode.workspace.fs.stat(vscode.Uri.file(childPath));
                    const isDirectory = stats.type === vscode.FileType.Directory;
                    
                    return {
                        path: childPath,
                        name: path.basename(childPath),
                        type: isDirectory ? 'folder' : 'file',
                        workspaceFolder: element.workspaceFolder
                    } as HiddenItem;
                } catch (error) {
                    // File might have been deleted, return null to filter out
                    return null;
                }
            });
            
            const batchResults = await Promise.all(batchPromises);
            const validItems = batchResults.filter(item => item !== null) as HiddenItem[];
            childItems.push(...validItems);
        }
        
        return childItems.sort((a, b) => {
            // Folders first, then files, alphabetically
            if (a.type !== b.type) {
                return a.type === 'folder' ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
        });
    }

    async unhideItem(item: HiddenItem): Promise<void> {
        await this.storage.removeHiddenItem(item.path);
        
        if (this.fileHider) {
            await this.fileHider.showHiddenFile(item.path);
            const hiddenItems = await this.storage.loadHiddenItems();
            await this.fileHider.updateHiddenFiles(hiddenItems);
        }
        
        this.refresh();
        
        // Force refresh the file explorer
        await vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
        
        vscode.window.showInformationMessage(`Unhidden: ${item.name}`);
    }


    async handleDrag(source: HiddenItem[], treeDataTransfer: vscode.DataTransfer): Promise<void> {
        const uris = source.map(item => vscode.Uri.file(item.path));
        treeDataTransfer.set('text/uri-list', new vscode.DataTransferItem(uris.map(uri => uri.toString()).join('\r\n')));
    }

    async handleDrop(target: HiddenItem | undefined, sources: vscode.DataTransfer): Promise<void> {
        const transferItem = sources.get('text/uri-list');
        if (!transferItem) {
            return;
        }

        const uriListStr = transferItem.value;
        if (typeof uriListStr !== 'string') {
            return;
        }

        const uris = uriListStr.split('\r\n').filter(line => line.trim().length > 0);
        
        for (const uriStr of uris) {
            try {
                const uri = vscode.Uri.parse(uriStr);
                const hiddenItems = await this.storage.loadHiddenItems();
                const isAlreadyHidden = this.storage.isPathHidden(uri.fsPath, hiddenItems);
                
                if (!isAlreadyHidden) {
                    await this.storage.addHiddenItem(uri);
                    
                    if (this.fileHider) {
                        const updatedHiddenItems = await this.storage.loadHiddenItems();
                        await this.fileHider.updateHiddenFiles(updatedHiddenItems);
                    }
                }
            } catch (error) {
                console.error('Error handling dropped item:', error);
            }
        }
        
        this.refresh();
        vscode.window.showInformationMessage(`Added ${uris.length} items to hidden list.`);
    }
}