export interface HiddenItem {
    path: string;
    name: string;
    type: 'file' | 'folder';
    workspaceFolder: string;
    children?: string[];
}

export interface HiddenItemsData {
    version: string;
    hiddenItems: HiddenItem[];
}