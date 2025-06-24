import * as vscode from 'vscode';
import * as path from 'path';
import { HiddenItemsProvider } from './hiddenItemsProvider';
import { HiddenItemsStorage } from './storage';
import { FileHider } from './fileHider';
import { FileDecorationProvider } from './fileDecorationProvider';
import { HiddenItem } from './types';

let hiddenItemsProvider: HiddenItemsProvider;
let storage: HiddenItemsStorage;
let fileHider: FileHider;
let decorationProvider: FileDecorationProvider;

export function activate(context: vscode.ExtensionContext) {
    console.log('Hide Me extension is now active!');

    storage = new HiddenItemsStorage();
    fileHider = new FileHider();
    hiddenItemsProvider = new HiddenItemsProvider(storage, fileHider);
    decorationProvider = new FileDecorationProvider(storage);

    const treeView = vscode.window.createTreeView('hiddenItems', {
        treeDataProvider: hiddenItemsProvider,
        showCollapseAll: true,
        canSelectMany: true,
        dragAndDropController: hiddenItemsProvider
    });

    // Commented out file decoration provider as it may interfere with file visibility
    // const fileDecorationDisposable = vscode.window.registerFileDecorationProvider(decorationProvider);

    context.subscriptions.push(treeView);

    const hideItemCommand = vscode.commands.registerCommand('hideMe.hideItem', async (uri: vscode.Uri) => {
        if (!uri) {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                uri = editor.document.uri;
            } else {
                vscode.window.showErrorMessage('No file or folder selected to hide.');
                return;
            }
        }

        try {
            // Skip the already hidden check to fix double-click issue
            console.log(`Hiding: ${uri.fsPath}`);

            await storage.addHiddenItem(uri);
            
            const updatedHiddenItems = await storage.loadHiddenItems();
            await fileHider.updateHiddenFiles(updatedHiddenItems);
            
            hiddenItemsProvider.refresh();
            
            const fileName = uri.fsPath.split('/').pop();
            vscode.window.showInformationMessage(`Hidden: ${fileName}`);
        } catch (error) {
            console.error('Error hiding item:', error);
            vscode.window.showErrorMessage(`Failed to hide item: ${error}`);
        }
    });

    const unhideItemCommand = vscode.commands.registerCommand('hideMe.unhideItem', async (item: HiddenItem) => {
        if (item) {
            await hiddenItemsProvider.unhideItem(item);
        }
    });

    const resetAllCommand = vscode.commands.registerCommand('hideMe.resetAll', async () => {
        const items = await storage.loadHiddenItems();
        if (items.length === 0) {
            vscode.window.showInformationMessage('No hidden items to show.');
            return;
        }

        const answer = await vscode.window.showWarningMessage(
            `Show all ${items.length} hidden items?`,
            'Yes',
            'No'
        );

        if (answer === 'Yes') {
            // Clear storage
            await storage.removeAllHiddenItems();
            
            // Clear all workspace exclusions (complete reset)
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders) {
                for (const folder of workspaceFolders) {
                    const config = vscode.workspace.getConfiguration('files', folder.uri);
                    await config.update('exclude', {}, vscode.ConfigurationTarget.Workspace);
                }
            }
            
            hiddenItemsProvider.refresh();
            await vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
            vscode.window.showInformationMessage(`Showed all ${items.length} hidden items.`);
        }
    });


    const openFileCommand = vscode.commands.registerCommand('hideMe.openFile', async (item: HiddenItem) => {
        if (item && item.path) {
            const uri = vscode.Uri.file(item.path);
            await vscode.window.showTextDocument(uri);
        }
    });

    const revealInExplorerCommand = vscode.commands.registerCommand('hideMe.revealInExplorer', async (item: HiddenItem) => {
        if (item && item.path) {
            const uri = vscode.Uri.file(item.path);
            await vscode.commands.executeCommand('revealInExplorer', uri);
        }
    });

    const revealInOSCommand = vscode.commands.registerCommand('hideMe.revealInOS', async (item: HiddenItem) => {
        if (item && item.path) {
            const uri = vscode.Uri.file(item.path);
            await vscode.commands.executeCommand('revealFileInOS', uri);
        }
    });

    const copyPathCommand = vscode.commands.registerCommand('hideMe.copyPath', async (item: HiddenItem) => {
        if (item && item.path) {
            await vscode.env.clipboard.writeText(item.path);
            vscode.window.showInformationMessage(`Copied path: ${item.path}`);
        }
    });

    const copyRelativePathCommand = vscode.commands.registerCommand('hideMe.copyRelativePath', async (item: HiddenItem) => {
        if (item && item.path) {
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(item.path));
            if (workspaceFolder) {
                const relativePath = path.relative(workspaceFolder.uri.fsPath, item.path);
                await vscode.env.clipboard.writeText(relativePath);
                vscode.window.showInformationMessage(`Copied relative path: ${relativePath}`);
            } else {
                await vscode.env.clipboard.writeText(item.path);
                vscode.window.showInformationMessage(`Copied path: ${item.path}`);
            }
        }
    });


    context.subscriptions.push(
        hideItemCommand,
        unhideItemCommand,
        resetAllCommand,
        openFileCommand,
        revealInExplorerCommand,
        revealInOSCommand,
        copyPathCommand,
        copyRelativePathCommand
    );

    const hiddenItemsWatcher = vscode.workspace.onDidCreateFiles(async (event) => {
        const hiddenItems = await storage.loadHiddenItems();
        let needsRefresh = false;

        for (const file of event.files) {
            if (storage.isPathHidden(file.fsPath, hiddenItems)) {
                needsRefresh = true;
                break;
            }
        }

        if (needsRefresh) {
            hiddenItemsProvider.refresh();
        }
    });

    const hiddenItemsDeleteWatcher = vscode.workspace.onDidDeleteFiles(async (event) => {
        const hiddenItems = await storage.loadHiddenItems();
        let itemsToRemove: string[] = [];

        for (const file of event.files) {
            const item = hiddenItems.find(item => item.path === file.fsPath);
            if (item) {
                itemsToRemove.push(item.path);
            }
        }

        if (itemsToRemove.length > 0) {
            for (const path of itemsToRemove) {
                await storage.removeHiddenItem(path);
            }
            hiddenItemsProvider.refresh();
        }
    });

    context.subscriptions.push(hiddenItemsWatcher, hiddenItemsDeleteWatcher);

    vscode.window.showInformationMessage('Hide Me extension activated successfully!');
}

export function deactivate() {
    console.log('Hide Me extension is now deactivated.');
}