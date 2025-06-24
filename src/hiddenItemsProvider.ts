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

    constructor(private storage: HiddenItemsStorage, private fileHider?: FileHider) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: HiddenItem): vscode.TreeItem {
        let collapsibleState = vscode.TreeItemCollapsibleState.None;
        
        if (element.type === 'folder') {
            // Only make folders collapsible if they have children
            collapsibleState = (element.children && element.children.length > 0) 
                ? vscode.TreeItemCollapsibleState.Collapsed 
                : vscode.TreeItemCollapsibleState.None;
        }
        
        const item = new vscode.TreeItem(element.name, collapsibleState);

        item.contextValue = `hidden${element.type.charAt(0).toUpperCase() + element.type.slice(1)}`;
        
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(element.path));
        if (workspaceFolder) {
            const relativePath = path.relative(workspaceFolder.uri.fsPath, element.path);
            item.tooltip = relativePath;
            item.description = path.dirname(relativePath) === '.' ? '' : path.dirname(relativePath);
        }

        if (element.type === 'folder') {
            item.iconPath = new vscode.ThemeIcon('folder');
        } else {
            item.iconPath = new vscode.ThemeIcon('file');
        }

        // Removed auto-open command to prevent accidental unhiding when clicking
        // Users can right-click and select "Open File" instead

        item.resourceUri = vscode.Uri.file(element.path);
        
        // Enable dragging for this tree item and set context for menus
        item.contextValue = 'hiddenItem';

        return item;
    }

    async getChildren(element?: HiddenItem): Promise<HiddenItem[]> {
        if (!element) {
            return await this.storage.loadHiddenItems();
        }
        
        // If it's a folder, show its children
        if (element.type === 'folder' && element.children) {
            const childItems: HiddenItem[] = [];
            
            for (const childPath of element.children) {
                try {
                    const stats = await vscode.workspace.fs.stat(vscode.Uri.file(childPath));
                    const isDirectory = stats.type === vscode.FileType.Directory;
                    
                    const childItem: HiddenItem = {
                        path: childPath,
                        name: path.basename(childPath),
                        type: isDirectory ? 'folder' : 'file',
                        workspaceFolder: element.workspaceFolder
                    };
                    
                    childItems.push(childItem);
                } catch (error) {
                    // File might have been deleted, skip it
                    console.log(`Skipping missing child: ${childPath}`);
                }
            }
            
            return childItems.sort((a, b) => {
                // Folders first, then files, alphabetically
                if (a.type !== b.type) {
                    return a.type === 'folder' ? -1 : 1;
                }
                return a.name.localeCompare(b.name);
            });
        }
        
        return [];
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