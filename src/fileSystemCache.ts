import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

interface CacheEntry {
    entries: string[];
    lastModified: number;
    size: number;
}

export class FileSystemCache {
    private static instance: FileSystemCache;
    private directoryCache: Map<string, CacheEntry> = new Map();
    
    private static readonly CACHE_TTL = 5000; // 5 seconds
    private static readonly MAX_CACHE_SIZE = 1000; // directories
    
    public static getInstance(): FileSystemCache {
        if (!FileSystemCache.instance) {
            FileSystemCache.instance = new FileSystemCache();
        }
        return FileSystemCache.instance;
    }
    
    public async getDirectoryContents(dirPath: string, maxDepth: number = 3): Promise<string[]> {
        const cacheKey = `${dirPath}:${maxDepth}`;
        const cached = this.directoryCache.get(cacheKey);
        
        // Check cache validity
        if (cached && (Date.now() - cached.lastModified) < FileSystemCache.CACHE_TTL) {
            return cached.entries;
        }
        
        // Scan directory with depth limit
        const entries = await this.scanDirectoryIterative(dirPath, maxDepth);
        
        // Update cache with size limit
        if (this.directoryCache.size >= FileSystemCache.MAX_CACHE_SIZE) {
            // Remove oldest entries (LRU eviction)
            const oldestKey = this.directoryCache.keys().next().value;
            if (oldestKey) {
                this.directoryCache.delete(oldestKey);
            }
        }
        
        this.directoryCache.set(cacheKey, {
            entries,
            lastModified: Date.now(),
            size: entries.length
        });
        
        return entries;
    }
    
    private async scanDirectoryIterative(rootPath: string, maxDepth: number): Promise<string[]> {
        const result: string[] = [];
        const queue: Array<{path: string, depth: number}> = [{path: rootPath, depth: 0}];
        
        while (queue.length > 0 && result.length < 10000) {
            const {path: currentPath, depth} = queue.shift()!;
            
            if (depth >= maxDepth) {
                continue;
            }
            
            try {
                const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(currentPath));
                
                for (const [name, type] of entries) {
                    const fullPath = path.join(currentPath, name);
                    result.push(fullPath);
                    
                    if (type === vscode.FileType.Directory && depth < maxDepth - 1) {
                        queue.push({path: fullPath, depth: depth + 1});
                    }
                }
            } catch (error) {
                // Skip inaccessible directories
                continue;
            }
        }
        
        return result;
    }
    
    public clearCache(): void {
        this.directoryCache.clear();
    }
    
    public getCacheStats(): {size: number, entries: number} {
        const totalEntries = Array.from(this.directoryCache.values())
            .reduce((sum, entry) => sum + entry.size, 0);
        
        return {
            size: this.directoryCache.size,
            entries: totalEntries
        };
    }
}