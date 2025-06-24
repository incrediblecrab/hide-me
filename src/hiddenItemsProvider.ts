import * as vscode from 'vscode';
import * as path from 'path';
import { HiddenItem } from './types';
import { HiddenItemsStorage } from './storage';

export class HiddenItemsProvider implements vscode.TreeDataProvider<HiddenItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<HiddenItem | undefined | null | void> = new vscode.EventEmitter<HiddenItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<HiddenItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(private storage: HiddenItemsStorage) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: HiddenItem): vscode.TreeItem {
        const item = new vscode.TreeItem(
            element.name,
            element.type === 'folder' ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
        );

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

        item.command = {
            command: 'vscode.open',
            title: 'Open',
            arguments: [vscode.Uri.file(element.path)]
        };

        return item;
    }

    async getChildren(element?: HiddenItem): Promise<HiddenItem[]> {
        if (!element) {
            return await this.storage.loadHiddenItems();
        }
        
        return [];
    }

    async unhideItem(item: HiddenItem): Promise<void> {
        await this.storage.removeHiddenItem(item.path);
        this.refresh();
        vscode.window.showInformationMessage(`Unhidden: ${item.name}`);
    }

    async unhideAll(): Promise<void> {
        const items = await this.storage.loadHiddenItems();
        if (items.length === 0) {
            vscode.window.showInformationMessage('No hidden items to unhide.');
            return;
        }

        const answer = await vscode.window.showWarningMessage(
            `Are you sure you want to unhide all ${items.length} hidden items?`,
            'Yes',
            'No'
        );

        if (answer === 'Yes') {
            await this.storage.removeAllHiddenItems();
            this.refresh();
            vscode.window.showInformationMessage(`Unhidden all ${items.length} items.`);
        }
    }
}