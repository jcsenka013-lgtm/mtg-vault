class ApiQueue {
    private queue: Array<{
        task: () => Promise<any>;
        resolve: Function;
        reject: Function;
    }> = [];
    private isProcessing = false;
    private lastRequestTime = 0;
    private readonly MIN_GAP_MS = 150;

    async enqueue<T>(task: () => Promise<T>): Promise<T> {
        return new Promise((resolve, reject) => {
            this.queue.push({ task, resolve, reject });
            this.processQueue();
        });
    }

    private async processQueue(): Promise<void> {
        if (this.isProcessing) return;
        this.isProcessing = true;

        while (this.queue.length > 0) {
            const { task, resolve, reject } = this.queue.shift()!;

            try {
                const now = Date.now();
                const gap = now - this.lastRequestTime;
                if (gap < this.MIN_GAP_MS) {
                    await new Promise(r => setTimeout(r, this.MIN_GAP_MS - gap));
                }

                this.lastRequestTime = Date.now();
                const result = await task();
                resolve(result);
            } catch (error) {
                reject(error);
            }
        }

        this.isProcessing = false;
    }
}

export const scryfallQueue = new ApiQueue();