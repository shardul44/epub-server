import type { CoordsJson, SmilTiming } from '../types.js';
export interface SmilGenerationOptions {
    /** Seconds per word for placeholder timing when no audio is provided */
    secondsPerWord?: number;
    /** Pause between sentences in seconds */
    sentencePauseSec?: number;
    audioFileName?: string;
}
export declare class SmilGenerationService {
    /**
     * Generate SMIL media overlay files — one per page.
     * Each sentence maps to begin, end, and text fragment (#sentence_id).
     */
    static generate(smilDir: string, coords: CoordsJson, options?: SmilGenerationOptions): Promise<string[]>;
    static buildSmil(xhtmlFileName: string, audioFileName: string, timings: SmilTiming[]): string;
}
//# sourceMappingURL=SmilGenerationService.d.ts.map