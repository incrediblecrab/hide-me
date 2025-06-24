import * as vscode from 'vscode';
import * as path from 'path';
import { HiddenItem } from './types';

export class FileHider {
    private hiddenPathsSet: Set<string> = new Set();
    private configCache: Map<string, any> = new Map();
    private lastConfigHash: Map<string, string> = new Map();

    async updateHiddenFiles(hiddenItems: HiddenItem[]): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return;
        }

        // Update our internal set of hidden paths
        this.hiddenPathsSet.clear();
        for (const item of hiddenItems) {
            this.hiddenPathsSet.add(item.path);
        }

        // Group items by workspace folder for batch processing
        const itemsByWorkspace = new Map<string, HiddenItem[]>();
        
        for (const item of hiddenItems) {
            const items = itemsByWorkspace.get(item.workspaceFolder) || [];
            items.push(item);
            itemsByWorkspace.set(item.workspaceFolder, items);
        }
        
        // Process each workspace folder with incremental updates
        const updatePromises = workspaceFolders.map(async (folder) => {
            const folderItems = itemsByWorkspace.get(folder.uri.fsPath) || [];
            await this.updateWorkspaceConfig(folder, folderItems);
        });
        
        await Promise.all(updatePromises);
    }
    
    private async updateWorkspaceConfig(
        folder: vscode.WorkspaceFolder, 
        items: HiddenItem[]
    ): Promise<void> {
        const config = vscode.workspace.getConfiguration('files', folder.uri);
        const currentExclude = config.get<{[key: string]: boolean}>('exclude') || {};
        
        // Calculate new exclude patterns
        const newExclude = {...currentExclude};
        const hidePatterns = new Set<string>();
        
        for (const item of items) {
            const relativePath = this.getRelativePath(item.path, folder);
            if (relativePath) {
                hidePatterns.add(relativePath);
                if (item.type === 'folder') {
                    hidePatterns.add(`${relativePath}/**`);
                }
            }
        }
        
        // Only update if configuration changed
        const newConfigHash = this.calculateConfigHash(hidePatterns);
        const lastHash = this.lastConfigHash.get(folder.uri.fsPath);
        
        if (newConfigHash !== lastHash) {
            // Add new patterns directly without prefix
            for (const pattern of hidePatterns) {
                newExclude[pattern] = true;
            }
            
            await config.update('exclude', newExclude, vscode.ConfigurationTarget.Workspace);
            this.lastConfigHash.set(folder.uri.fsPath, newConfigHash);
        }
    }
    
    private getRelativePath(itemPath: string, folder: vscode.WorkspaceFolder): string | null {
        const relativePath = path.relative(folder.uri.fsPath, itemPath);
        return (relativePath && !relativePath.startsWith('..')) ? relativePath : null;
    }
    
    private calculateConfigHash(patterns: Set<string>): string {
        const crypto = require('crypto');
        const sortedPatterns = Array.from(patterns).sort();
        return crypto.createHash('md5').update(JSON.stringify(sortedPatterns)).digest('hex');
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

    async clearAllHiddenFiles(hiddenItems: HiddenItem[]): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return;
        }

        // Create set of paths to remove
        const pathsToRemove = new Set<string>();
        for (const item of hiddenItems) {
            pathsToRemove.add(item.path);
        }

        for (const workspaceFolder of workspaceFolders) {
            const config = vscode.workspace.getConfiguration('files', workspaceFolder.uri);
            const currentExclude = config.get<Record<string, boolean>>('exclude') || {};
            
            const newExclude: Record<string, boolean> = {};
            
            // Keep only exclusions that aren't managed by Hide Me
            for (const [pattern, value] of Object.entries(currentExclude)) {
                const fullPath = path.resolve(workspaceFolder.uri.fsPath, pattern.replace('/**', ''));
                const isHideMePattern = pathsToRemove.has(fullPath) || pattern.endsWith('/**') && pathsToRemove.has(fullPath);
                
                if (!isHideMePattern) {
                    newExclude[pattern] = value;
                }
            }

            await config.update('exclude', newExclude, vscode.ConfigurationTarget.Workspace);
        }

        // Clear our internal set after successful update
        this.hiddenPathsSet.clear();
    }
}