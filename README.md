# Hide Me

A Visual Studio Code extension that allows you to hide files and folders to reduce visual clutter in the Explorer view.

## Features

- **Right-click to Hide**: Right-click on any file or folder in the Explorer and select "Hide Me" to hide it
- **Hidden Items View**: View all hidden items in a dedicated section in the Explorer sidebar
- **Easy Unhide**: Unhide individual items or all items at once from the Hidden Items view
- **Nested Hiding**: When you hide a folder, all its contents are automatically hidden as well
- **Visual Only**: Hidden items are only visually hidden in VS Code - the actual file system remains unchanged

## Usage

1. Right-click on any file or folder in the Explorer
2. Select "Hide Me" from the context menu
3. The item will be hidden from the Explorer view and appear in the "Hidden Items" section
4. To unhide items, use the "Hidden Items" view in the Explorer sidebar

## Commands

- `Hide Me`: Hide the selected file or folder
- `Unhide`: Unhide a specific item from the Hidden Items view
- `Unhide All`: Unhide all currently hidden items
- `Refresh Hidden Items`: Refresh the Hidden Items view

## Requirements

- Visual Studio Code ^1.74.0

## Installation

Install from the VS Code Marketplace or build from source.

## License

MIT