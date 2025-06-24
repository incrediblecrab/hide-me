import * as vscode from 'vscode';
import * as path from 'path';
import { HiddenItem } from './types';
import { HiddenItemsStorage } from './storage';
import { FileHider } from './fileHider';

export class HiddenItemsProvider implements vscode.TreeDataProvider<HiddenItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<HiddenItem | undefined | null | void> = new vscode.EventEmitter<HiddenItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<HiddenItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(private storage: HiddenItemsStorage, private fileHider?: FileHider) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: HiddenItem): vscode.TreeItem {
        return this.createTreeItem(element);
    }

    private createTreeItem(element: HiddenItem): vscode.TreeItem {
        let collapsibleState = vscode.TreeItemCollapsibleState.None;
        
        if (element.type === 'folder') {
            collapsibleState = (element.children && element.children.length > 0) 
                ? vscode.TreeItemCollapsibleState.Collapsed 
                : vscode.TreeItemCollapsibleState.None;
        }
        
        const item = new vscode.TreeItem(element.name, collapsibleState);
        
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(element.path));
        if (workspaceFolder) {
            const relativePath = path.relative(workspaceFolder.uri.fsPath, element.path);
            item.tooltip = relativePath;
            item.description = path.dirname(relativePath) === '.' ? '' : path.dirname(relativePath);
        }

        // Use VS Code's default file type icons
        if (element.type === 'folder') {
            item.iconPath = new vscode.ThemeIcon('folder');
        } else {
            // Let VS Code automatically determine the file icon based on file extension
            item.resourceUri = vscode.Uri.file(element.path);
        }
        
        const canUnhide = this.canUnhideItem(element);
        item.contextValue = canUnhide ? 'hiddenItem' : 'nestedHiddenItem';

        return item;
    }


    async getChildren(element?: HiddenItem): Promise<HiddenItem[]> {
        if (!element) {
            return this.storage.getCachedItems();
        }
        
        if (element.type === 'folder' && element.children) {
            return this.loadChildren(element);
        }
        
        return [];
    }

    private async loadChildren(element: HiddenItem): Promise<HiddenItem[]> {
        const childItems: HiddenItem[] = [];
        
        if (!element.children) {
            return childItems;
        }
        
        for (const childPath of element.children) {
            try {
                const stats = await vscode.workspace.fs.stat(vscode.Uri.file(childPath));
                const isDirectory = stats.type === vscode.FileType.Directory;
                
                childItems.push({
                    path: childPath,
                    name: path.basename(childPath),
                    type: isDirectory ? 'folder' : 'file',
                    workspaceFolder: element.workspaceFolder
                } as HiddenItem);
            } catch (error) {
                // File might have been deleted, skip it
            }
        }
        
        return childItems.sort((a, b) => {
            if (a.type !== b.type) {
                return a.type === 'folder' ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
        });
    }

    async unhideItem(item: HiddenItem): Promise<void> {
        // Check if this item can be unhidden (must be a top-level hidden item)
        if (!this.canUnhideItem(item)) {
            vscode.window.showWarningMessage(`Cannot unhide '${item.name}'. Only parent folders can be unhidden.`);
            return;
        }

        // Remove from storage (this will also remove all children if it's a folder)
        await this.storage.removeHiddenItem(item.path);
        
        // Remove all child items from storage as well
        await this.removeChildItems(item.path);
        
        // Use the fileHider's showHiddenFile method for proper exclusion removal
        if (this.fileHider) {
            await this.fileHider.showHiddenFile(item.path);
        }
        
        // Refresh the hidden items tree
        this.refresh();
        
        // Force refresh the file explorer
        await vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
        
        vscode.window.showInformationMessage(`Unhidden: ${item.name}`);
    }

    private canUnhideItem(item: HiddenItem): boolean {
        // Load all hidden items to check hierarchy
        const allHiddenItems = this.storage.getCachedItems();
        
        // Check if any parent directory is also hidden
        for (const hiddenItem of allHiddenItems) {
            if (hiddenItem.path !== item.path && 
                hiddenItem.type === 'folder' && 
                item.path.startsWith(hiddenItem.path + path.sep)) {
                // This item is nested under another hidden folder
                return false;
            }
        }
        
        return true;
    }

    private async removeChildItems(parentPath: string): Promise<void> {
        const allHiddenItems = await this.storage.loadHiddenItems();
        const itemsToRemove = allHiddenItems.filter(item => 
            item.path !== parentPath && item.path.startsWith(parentPath + path.sep)
        );
        
        for (const childItem of itemsToRemove) {
            await this.storage.removeHiddenItem(childItem.path);
        }
    }


}