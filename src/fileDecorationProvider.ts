import * as vscode from 'vscode';
import { HiddenItem } from './types';
import { HiddenItemsStorage } from './storage';

export class FileDecorationProvider implements vscode.FileDecorationProvider {
    private readonly _onDidChangeFileDecorations: vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined> = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
    readonly onDidChangeFileDecorations: vscode.Event<vscode.Uri | vscode.Uri[] | undefined> = this._onDidChangeFileDecorations.event;

    constructor(private storage: HiddenItemsStorage) {}

    async provideFileDecoration(uri: vscode.Uri): Promise<vscode.FileDecoration | undefined> {
        const hiddenItems = await this.storage.loadHiddenItems();
        const isHidden = this.storage.isPathHidden(uri.fsPath, hiddenItems);
        
        if (isHidden) {
            return {
                tooltip: 'Hidden by Hide Me extension',
                color: new vscode.ThemeColor('disabledForeground'),
                propagate: false
            };
        }
        
        return undefined;
    }

    refresh(): void {
        this._onDidChangeFileDecorations.fire(undefined);
    }
}