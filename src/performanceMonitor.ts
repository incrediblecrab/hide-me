interface PerformanceConfig {
    enableCaching: boolean;           // Default: true
    cacheMaxSize: number;             // Default: 1000
    cacheTTL: number;                 // Default: 5000ms
    debounceDelay: number;            // Default: 250ms
    maxItemsPerOperation: number;     // Default: 1000
    enableIncrementalUpdates: boolean; // Default: true
}

export class PerformanceMonitor {
    private static metrics: Map<string, number[]> = new Map();
    private static config: PerformanceConfig = {
        enableCaching: true,
        cacheMaxSize: 1000,
        cacheTTL: 5000,
        debounceDelay: 250,
        maxItemsPerOperation: 1000,
        enableIncrementalUpdates: true
    };
    
    public static time<T>(operation: string, fn: () => T): T;
    public static time<T>(operation: string, fn: () => Promise<T>): Promise<T>;
    public static time<T>(operation: string, fn: () => T | Promise<T>): T | Promise<T> {
        const start = performance.now();
        
        const result = fn();
        
        if (result instanceof Promise) {
            return result.then(value => {
                const duration = performance.now() - start;
                PerformanceMonitor.recordMetric(operation, duration);
                return value;
            }).catch(error => {
                const duration = performance.now() - start;
                PerformanceMonitor.recordMetric(`${operation}:error`, duration);
                throw error;
            });
        } else {
            const duration = performance.now() - start;
            PerformanceMonitor.recordMetric(operation, duration);
            return result;
        }
    }
    
    private static recordMetric(operation: string, duration: number): void {
        const times = PerformanceMonitor.metrics.get(operation) || [];
        times.push(duration);
        
        // Keep only recent measurements
        if (times.length > 100) {
            times.shift();
        }
        
        PerformanceMonitor.metrics.set(operation, times);
        
        if (duration > 1000) { // Log slow operations
            console.warn(`Slow operation: ${operation} took ${duration.toFixed(2)}ms`);
        }
    }
    
    public static getAverageTime(operation: string): number {
        const times = PerformanceMonitor.metrics.get(operation) || [];
        return times.length > 0 ? times.reduce((a, b) => a + b) / times.length : 0;
    }
    
    public static getMetrics(): {[operation: string]: {avg: number, count: number, max: number, min: number}} {
        const result: {[operation: string]: {avg: number, count: number, max: number, min: number}} = {};
        
        for (const [operation, times] of PerformanceMonitor.metrics.entries()) {
            if (times.length > 0) {
                const avg = times.reduce((a, b) => a + b) / times.length;
                const max = Math.max(...times);
                const min = Math.min(...times);
                
                result[operation] = {
                    avg: Math.round(avg * 100) / 100,
                    count: times.length,
                    max: Math.round(max * 100) / 100,
                    min: Math.round(min * 100) / 100
                };
            }
        }
        
        return result;
    }
    
    public static getMemoryUsage(): {heapUsed: number, heapTotal: number, external: number} {
        const usage = process.memoryUsage();
        return {
            heapUsed: Math.round(usage.heapUsed / 1024 / 1024 * 100) / 100, // MB
            heapTotal: Math.round(usage.heapTotal / 1024 / 1024 * 100) / 100, // MB
            external: Math.round(usage.external / 1024 / 1024 * 100) / 100 // MB
        };
    }
    
    public static clearMetrics(): void {
        PerformanceMonitor.metrics.clear();
    }
    
    public static getConfig(): PerformanceConfig {
        return {...PerformanceMonitor.config};
    }
    
    public static updateConfig(newConfig: Partial<PerformanceConfig>): void {
        PerformanceMonitor.config = {...PerformanceMonitor.config, ...newConfig};
    }
    
    public static logPerformanceReport(): void {
        const metrics = PerformanceMonitor.getMetrics();
        const memory = PerformanceMonitor.getMemoryUsage();
        
        console.log('=== Hide Me Performance Report ===');
        console.log(`Memory Usage: ${memory.heapUsed}MB (heap), ${memory.external}MB (external)`);
        console.log('Operation Metrics:');
        
        for (const [operation, stats] of Object.entries(metrics)) {
            console.log(`  ${operation}: avg=${stats.avg}ms, count=${stats.count}, min=${stats.min}ms, max=${stats.max}ms`);
        }
        
        console.log('==================================');
    }
    
    public static startPeriodicLogging(intervalMs: number = 60000): NodeJS.Timeout {
        return setInterval(() => {
            if (PerformanceMonitor.metrics.size > 0) {
                PerformanceMonitor.logPerformanceReport();
            }
        }, intervalMs);
    }
}