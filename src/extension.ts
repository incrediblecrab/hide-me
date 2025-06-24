import * as vscode from 'vscode';
import { HiddenItemsProvider } from './hiddenItemsProvider';
import { HiddenItemsStorage } from './storage';
import { HiddenItem } from './types';

let hiddenItemsProvider: HiddenItemsProvider;
let storage: HiddenItemsStorage;

export function activate(context: vscode.ExtensionContext) {
    console.log('Hide Me extension is now active!');

    storage = new HiddenItemsStorage();
    hiddenItemsProvider = new HiddenItemsProvider(storage);

    const treeView = vscode.window.createTreeView('hiddenItems', {
        treeDataProvider: hiddenItemsProvider,
        showCollapseAll: true
    });

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
            const hiddenItems = await storage.loadHiddenItems();
            const isAlreadyHidden = storage.isPathHidden(uri.fsPath, hiddenItems);
            
            if (isAlreadyHidden) {
                vscode.window.showInformationMessage(`${uri.fsPath} is already hidden.`);
                return;
            }

            await storage.addHiddenItem(uri);
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

    const unhideAllCommand = vscode.commands.registerCommand('hideMe.unhideAll', async () => {
        await hiddenItemsProvider.unhideAll();
    });

    const refreshCommand = vscode.commands.registerCommand('hideMe.refresh', () => {
        hiddenItemsProvider.refresh();
    });

    context.subscriptions.push(
        hideItemCommand,
        unhideItemCommand,
        unhideAllCommand,
        refreshCommand
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