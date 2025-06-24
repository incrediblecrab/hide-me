import * as vscode from 'vscode';
import * as path from 'path';
import { HiddenItem } from './types';
import { HiddenItemsStorage } from './storage';

export class FileHider {
    private storage: HiddenItemsStorage | null = null;

    setStorage(storage: HiddenItemsStorage): void {
        this.storage = storage;
    }

    async updateHiddenFiles(hiddenItems: HiddenItem[]): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return;
        }

        // Group items by workspace folder
        const itemsByWorkspace = new Map<string, HiddenItem[]>();
        
        for (const item of hiddenItems) {
            const items = itemsByWorkspace.get(item.workspaceFolder) || [];
            items.push(item);
            itemsByWorkspace.set(item.workspaceFolder, items);
        }
        
        // Update each workspace folder
        for (const folder of workspaceFolders) {
            const folderItems = itemsByWorkspace.get(folder.uri.fsPath) || [];
            await this.updateWorkspaceConfig(folder, folderItems);
        }
    }
    
    private async updateWorkspaceConfig(
        folder: vscode.WorkspaceFolder, 
        items: HiddenItem[]
    ): Promise<void> {
        const config = vscode.workspace.getConfiguration('files', folder.uri);
        const currentExclude = config.get<{[key: string]: boolean}>('exclude') || {};
        
        // Start with current exclusions
        const newExclude = {...currentExclude};
        
        // Add new exclusions for hidden items
        for (const item of items) {
            const relativePath = this.getRelativePath(item.path, folder);
            if (relativePath) {
                newExclude[relativePath] = true;
                if (item.type === 'folder') {
                    newExclude[`${relativePath}/**`] = true;
                }
            }
        }
        
        await config.update('exclude', newExclude, vscode.ConfigurationTarget.Workspace);
        
        // Note: File explorer refresh is handled by calling code to avoid multiple refreshes
    }
    
    private getRelativePath(itemPath: string, folder: vscode.WorkspaceFolder): string | null {
        const relativePath = path.relative(folder.uri.fsPath, itemPath);
        return (relativePath && !relativePath.startsWith('..')) ? relativePath : null;
    }
    

    async showHiddenFile(filePath: string): Promise<void> {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
        if (!workspaceFolder) {
            return;
        }

        const config = vscode.workspace.getConfiguration('files', workspaceFolder.uri);
        const currentExclude = config.get<Record<string, boolean>>('exclude') || {};
        const relativePath = path.relative(workspaceFolder.uri.fsPath, filePath);
        
        const newExclude = { ...currentExclude };
        let hasChanges = false;
        
        // Remove the main path
        if (relativePath in newExclude) {
            delete newExclude[relativePath];
            hasChanges = true;
        }
        
        // Remove the folder pattern if it exists
        const folderPattern = `${relativePath}/**`;
        if (folderPattern in newExclude) {
            delete newExclude[folderPattern];
            hasChanges = true;
        }
        
        if (hasChanges) {
            await config.update('exclude', newExclude, vscode.ConfigurationTarget.Workspace);
        }
    }

}