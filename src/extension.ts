import * as vscode from 'vscode';
import * as path from 'path';
import { HiddenItemsProvider } from './hiddenItemsProvider';
import { HiddenItemsStorage } from './storage';
import { FileHider } from './fileHider';
import { HiddenItem } from './types';

let hiddenItemsProvider: HiddenItemsProvider;
let storage: HiddenItemsStorage;
let fileHider: FileHider;
let disposables: vscode.Disposable[] = [];

export function activate(context: vscode.ExtensionContext) {
    console.log('Hide Me extension is now active!');

    storage = new HiddenItemsStorage(context);
    fileHider = new FileHider();
    fileHider.setStorage(storage);
    hiddenItemsProvider = new HiddenItemsProvider(storage, fileHider);

    const treeView = vscode.window.createTreeView('hiddenItems', {
        treeDataProvider: hiddenItemsProvider,
        showCollapseAll: true,
        canSelectMany: true
    });

    // Commented out file decoration provider as it may interfere with file visibility
    // const fileDecorationDisposable = vscode.window.registerFileDecorationProvider(decorationProvider);

    context.subscriptions.push(treeView);

    // Load existing hidden items on startup
    (async () => {
        try {
            console.log('Loading hidden items on startup...');
            const hiddenItems = await storage.loadHiddenItems();
            if (hiddenItems.length > 0) {
                console.log(`Found ${hiddenItems.length} hidden items`);
                await fileHider.updateHiddenFiles(hiddenItems);
                hiddenItemsProvider.refresh();
            }
        } catch (error) {
            console.error('Error loading hidden items on startup:', error);
        }
    })();

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
            
            // Single file explorer refresh after all operations
            await vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
            
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


    const openFileCommand = vscode.commands.registerCommand('hideMe.openFile', async (item: HiddenItem) => {
        if (item && item.path) {
            try {
                if (item.type === 'folder') {
                    vscode.window.showInformationMessage('Cannot open folder. Use "Reveal in Finder" to access folder contents.');
                    return;
                }
                
                // Simply open the actual file - it exists, just visually hidden
                const uri = vscode.Uri.file(item.path);
                const document = await vscode.workspace.openTextDocument(uri);
                await vscode.window.showTextDocument(document, {
                    preview: false, // Don't use preview mode to avoid graying out
                    viewColumn: vscode.ViewColumn.Active,
                    preserveFocus: false // Ensure it gets full focus
                });
                
            } catch (error) {
                console.error('Error opening file:', error);
                vscode.window.showErrorMessage(`Failed to open file: ${error instanceof Error ? error.message : String(error)}`);
            }
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

    const unhideAllCommand = vscode.commands.registerCommand('hideMe.unhideAll', async () => {
        const items = await storage.loadHiddenItems();
        if (items.length === 0) {
            vscode.window.showInformationMessage('No hidden items to unhide.');
            return;
        }

        const answer = await vscode.window.showWarningMessage(
            `Unhide all ${items.length} hidden items?`,
            'Yes',
            'No'
        );

        if (answer === 'Yes') {
            // Clear storage
            await storage.removeAllHiddenItems();
            
            // Clear all workspace exclusions
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders) {
                for (const folder of workspaceFolders) {
                    const config = vscode.workspace.getConfiguration('files', folder.uri);
                    const currentExclude = config.get<Record<string, boolean>>('exclude') || {};
                    const newExclude: Record<string, boolean> = {};
                    
                    // Keep only non-Hide Me patterns
                    for (const [pattern, value] of Object.entries(currentExclude)) {
                        let isHideMePattern = false;
                        for (const item of items) {
                            const relativePath = path.relative(folder.uri.fsPath, item.path);
                            if (relativePath && !relativePath.startsWith('..')) {
                                if (pattern === relativePath || pattern === `${relativePath}/**`) {
                                    isHideMePattern = true;
                                    break;
                                }
                            }
                        }
                        if (!isHideMePattern) {
                            newExclude[pattern] = value;
                        }
                    }
                    
                    await config.update('exclude', newExclude, vscode.ConfigurationTarget.Workspace);
                }
            }
            
            hiddenItemsProvider.refresh();
            await vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
            vscode.window.showInformationMessage(`Unhid all ${items.length} hidden items.`);
        }
    });


    // Store all disposables for proper cleanup
    disposables.push(
        treeView,
        hideItemCommand,
        unhideItemCommand,
        openFileCommand,
        revealInOSCommand,
        copyPathCommand,
        copyRelativePathCommand,
        unhideAllCommand
    );

    context.subscriptions.push(...disposables);


    vscode.window.showInformationMessage('Hide Me extension activated successfully!');
}

export function deactivate() {
    console.log('Hide Me extension is deactivating...');
    
    // Dispose all resources
    disposables.forEach(disposable => {
        try {
            disposable.dispose();
        } catch (error) {
            console.error('Error disposing resource:', error);
        }
    });
    
    disposables = [];
    
    // Clear global references to prevent memory leaks
    hiddenItemsProvider = undefined as any;
    storage = undefined as any;
    fileHider = undefined as any;
    
    console.log('Hide Me extension deactivated successfully.');
}