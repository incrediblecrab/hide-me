import * as vscode from 'vscode';
import * as path from 'path';
import { HiddenItemsProvider } from './hiddenItemsProvider';
import { HiddenItemsStorage } from './storage';
import { FileHider } from './fileHider';
import { FileDecorationProvider } from './fileDecorationProvider';
import { DebouncedFileWatcher } from './debouncedFileWatcher';
import { PerformanceMonitor } from './performanceMonitor';
import { HiddenItem } from './types';

let hiddenItemsProvider: HiddenItemsProvider;
let storage: HiddenItemsStorage;
let fileHider: FileHider;
let decorationProvider: FileDecorationProvider;
let debouncedWatcher: DebouncedFileWatcher;
let performanceTimer: NodeJS.Timeout | undefined;
let disposables: vscode.Disposable[] = [];

export function activate(context: vscode.ExtensionContext) {
    console.log('Hide Me extension is now active!');

    storage = new HiddenItemsStorage(context);
    fileHider = new FileHider();
    hiddenItemsProvider = new HiddenItemsProvider(storage, fileHider);
    decorationProvider = new FileDecorationProvider(storage);
    debouncedWatcher = new DebouncedFileWatcher(hiddenItemsProvider, storage);

    const treeView = vscode.window.createTreeView('hiddenItems', {
        treeDataProvider: hiddenItemsProvider,
        showCollapseAll: true,
        canSelectMany: true,
        dragAndDropController: hiddenItemsProvider
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
            try {
                console.log(`Attempting to open hidden file: ${item.path}`);
                
                // First, check if it's a file or folder
                if (item.type === 'folder') {
                    // For folders, show contents in hidden items tree
                    vscode.window.showInformationMessage('Folder contents are shown in the Hidden Items panel');
                    return;
                }
                
                // For files, read the content directly without changing exclusions
                const uri = vscode.Uri.file(item.path);
                
                try {
                    // Read file content directly using fs
                    const fs = require('fs').promises;
                    const content = await fs.readFile(item.path, 'utf8');
                    
                    // Create a virtual document with the content
                    const doc = await vscode.workspace.openTextDocument({
                        content: content,
                        language: getLanguageId(item.path)
                    });
                    
                    // Show the document in a new editor
                    const editor = await vscode.window.showTextDocument(doc, {
                        preview: false,
                        viewColumn: vscode.ViewColumn.Active
                    });
                    
                    // Set a custom title for the editor
                    vscode.languages.setTextDocumentLanguage(doc, getLanguageId(item.path));
                    
                    // Show info that this is a read-only view of a hidden file
                    vscode.window.showInformationMessage(`Viewing hidden file: ${item.name} (read-only)`);
                    
                    console.log('Hidden file opened successfully');
                    
                } catch (error) {
                    console.error('Error reading file:', error);
                    vscode.window.showErrorMessage(`Failed to open file: ${error}`);
                }
                
            } catch (error) {
                console.error('Error in openFile command:', error);
                vscode.window.showErrorMessage(`Failed to open file: ${error}`);
            }
        }
    });
    
    // Helper function to determine language ID from file extension
    function getLanguageId(filePath: string): string {
        const ext = path.extname(filePath).toLowerCase();
        const languageMap: { [key: string]: string } = {
            '.js': 'javascript',
            '.ts': 'typescript',
            '.jsx': 'javascriptreact',
            '.tsx': 'typescriptreact',
            '.py': 'python',
            '.java': 'java',
            '.c': 'c',
            '.cpp': 'cpp',
            '.cs': 'csharp',
            '.go': 'go',
            '.rs': 'rust',
            '.php': 'php',
            '.rb': 'ruby',
            '.swift': 'swift',
            '.kt': 'kotlin',
            '.scala': 'scala',
            '.r': 'r',
            '.m': 'objective-c',
            '.mm': 'objective-cpp',
            '.html': 'html',
            '.htm': 'html',
            '.xml': 'xml',
            '.css': 'css',
            '.scss': 'scss',
            '.sass': 'sass',
            '.less': 'less',
            '.json': 'json',
            '.yaml': 'yaml',
            '.yml': 'yaml',
            '.toml': 'toml',
            '.ini': 'ini',
            '.cfg': 'ini',
            '.conf': 'ini',
            '.sh': 'shellscript',
            '.bash': 'shellscript',
            '.zsh': 'shellscript',
            '.fish': 'shellscript',
            '.ps1': 'powershell',
            '.bat': 'bat',
            '.cmd': 'bat',
            '.md': 'markdown',
            '.markdown': 'markdown',
            '.tex': 'latex',
            '.bib': 'bibtex',
            '.sql': 'sql',
            '.pl': 'perl',
            '.lua': 'lua',
            '.vim': 'viml',
            '.dart': 'dart',
            '.elm': 'elm',
            '.clj': 'clojure',
            '.coffee': 'coffeescript',
            '.fs': 'fsharp',
            '.fsx': 'fsharp',
            '.fsi': 'fsharp',
            '.ml': 'ocaml',
            '.mli': 'ocaml',
            '.pas': 'pascal',
            '.pp': 'pascal',
            '.hs': 'haskell',
            '.lhs': 'haskell',
            '.jl': 'julia',
            '.nim': 'nim',
            '.nims': 'nim',
            '.vue': 'vue',
            '.svelte': 'svelte'
        };
        
        return languageMap[ext] || 'plaintext';
    }

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


    // Store all disposables for proper cleanup
    disposables.push(
        treeView,
        hideItemCommand,
        unhideItemCommand,
        resetAllCommand,
        openFileCommand,
        revealInExplorerCommand,
        revealInOSCommand,
        copyPathCommand,
        copyRelativePathCommand
    );

    context.subscriptions.push(...disposables);

    // Use debounced file watchers for better performance
    const hiddenItemsCreateWatcher = vscode.workspace.onDidCreateFiles((event) => {
        debouncedWatcher.handleFileCreated(event.files);
    });

    const hiddenItemsDeleteWatcher = vscode.workspace.onDidDeleteFiles((event) => {
        debouncedWatcher.handleFileDeleted(event.files);
    });

    const hiddenItemsRenameWatcher = vscode.workspace.onDidRenameFiles((event) => {
        debouncedWatcher.handleFileRenamed(event.files);
    });

    // Add watchers to disposables array for proper cleanup
    disposables.push(hiddenItemsCreateWatcher, hiddenItemsDeleteWatcher, hiddenItemsRenameWatcher);
    context.subscriptions.push(hiddenItemsCreateWatcher, hiddenItemsDeleteWatcher, hiddenItemsRenameWatcher);

    // Start performance monitoring (only in development)
    if (process.env.NODE_ENV === 'development') {
        performanceTimer = PerformanceMonitor.startPeriodicLogging(300000); // Every 5 minutes
        console.log('Performance monitoring enabled');
    }

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
    
    // Stop performance monitoring
    if (performanceTimer) {
        clearInterval(performanceTimer);
        performanceTimer = undefined;
    }
    
    // Dispose debounced watcher
    if (debouncedWatcher) {
        debouncedWatcher.dispose();
    }
    
    // Clear global references to prevent memory leaks
    hiddenItemsProvider = undefined as any;
    storage = undefined as any;
    fileHider = undefined as any;
    decorationProvider = undefined as any;
    debouncedWatcher = undefined as any;
    performanceTimer = undefined;
    
    console.log('Hide Me extension deactivated successfully.');
}