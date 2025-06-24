# Change Log

All notable changes to the "Hide Me" extension will be documented in this file.

## [1.0.0] - 2024-06-24

### Added
- Initial release of Hide Me extension
- Hide files and folders from VS Code Explorer
- Hidden Items panel to manage hidden files
- Context menu integration for easy hiding
- Drag and drop support to hide files
- Commands to reveal files in Explorer/Finder
- Copy path and relative path functionality

### Features
- **Visual Hiding Only**: Files remain intact on disk, only hidden from view
- **Performance Optimized**: Efficient caching and batch operations
- **Security**: Path validation and traversal protection
- **Persistent Storage**: Hidden items persist across VS Code sessions
- **Multi-workspace Support**: Works with multiple workspace folders

### Fixed
- Path validation now correctly handles workspace-relative paths
- Hidden items load automatically on extension startup
- Files can be opened from Hidden Items panel without unhiding
- Unhidden files return to normal appearance in Explorer

### Technical Details
- Uses VS Code's built-in `files.exclude` setting for hiding
- Stores hidden item metadata in VS Code's global storage
- No file system modifications - completely non-destructive
- Supports all file types and folder structures