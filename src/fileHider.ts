import * as vscode from 'vscode';
import * as path from 'path';
import { HiddenItem } from './types';

export class FileHider {
    private hiddenPathsSet: Set<string> = new Set();

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

        for (const workspaceFolder of workspaceFolders) {
            const config = vscode.workspace.getConfiguration('files', workspaceFolder.uri);
            const currentExclude = config.get<Record<string, boolean>>('exclude') || {};
            
            const newExclude: Record<string, boolean> = {};
            
            // Keep all existing exclusions that aren't from Hide Me
            for (const [pattern, value] of Object.entries(currentExclude)) {
                const fullPath = path.resolve(workspaceFolder.uri.fsPath, pattern);
                if (!this.hiddenPathsSet.has(fullPath)) {
                    newExclude[pattern] = value;
                }
            }

            // Add all currently hidden items
            for (const item of hiddenItems) {
                if (item.workspaceFolder === workspaceFolder.uri.fsPath) {
                    const relativePath = path.relative(workspaceFolder.uri.fsPath, item.path);
                    if (relativePath && !relativePath.startsWith('..')) {
                        newExclude[relativePath] = true;
                        
                        // For folders, also add a pattern to exclude all contents
                        if (item.type === 'folder') {
                            newExclude[`${relativePath}/**`] = true;
                        }
                    }
                }
            }

            await config.update('exclude', newExclude, vscode.ConfigurationTarget.Workspace);
        }
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