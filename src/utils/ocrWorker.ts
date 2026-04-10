import Tesseract from "tesseract.js";

class OCRWorkerManager {
    private static instance: OCRWorkerManager;
    private worker: any | null = null;
    private isInitializing = false;
    private pendingRequests: Array<{ resolve: Function; reject: Function }> = [];

    static getInstance(): OCRWorkerManager {
        if (!OCRWorkerManager.instance) {
            OCRWorkerManager.instance = new OCRWorkerManager();
        }
        return OCRWorkerManager.instance;
    }

    async getWorker(): Promise<any> {
        if (this.worker) return this.worker;

        if (this.isInitializing) {
            return new Promise((resolve, reject) => {
                this.pendingRequests.push({ resolve, reject });
            });
        }

        this.isInitializing = true;
        try {
            const worker = await Tesseract.createWorker("eng");
            await worker.setParameters({
                tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
                tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz '-,",
            });

            this.worker = worker;
            this.pendingRequests.forEach(req => req.resolve(worker));
            this.pendingRequests = [];
            return worker;
        } catch (error) {
            this.pendingRequests.forEach(req => req.reject(error));
            this.pendingRequests = [];
            throw error;
        } finally {
            this.isInitializing = false;
        }
    }

    async recognize(imageData: string): Promise<any> {
        const worker = await this.getWorker();
        return worker.recognize(imageData);
    }

    async terminate(): Promise<void> {
        if (this.worker) {
            await this.worker.terminate();
            this.worker = null;
        }
    }
}

export const ocrWorkerManager = OCRWorkerManager.getInstance();
export const initializeOCRWorker = () => ocrWorkerManager.getWorker();
export const terminateOCRWorker = () => ocrWorkerManager.terminate();