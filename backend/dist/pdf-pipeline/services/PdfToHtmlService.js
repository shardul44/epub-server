import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { createLogger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';
const log = createLogger('PdfToHtml');
export class PdfToHtmlService {
    static DOCKER_IMAGE = process.env.PDF2HTMLEX_IMAGE || 'guoxuequan/pdf2htmlex';
    /**
     * Convert PDF to HTML using pdf2htmlEX inside Docker.
     * Assets are organized into job subdirectories after conversion.
     */
    static async convert(layout, options = {}) {
        await fs.mkdir(layout.html, { recursive: true });
        await fs.mkdir(layout.css, { recursive: true });
        await fs.mkdir(layout.images, { recursive: true });
        await fs.mkdir(layout.fonts, { recursive: true });
        const workDir = layout.root;
        const inputName = 'input.pdf';
        const outputName = 'output.html';
        // pdf2htmlEX expects input.pdf in working directory
        const inputPath = path.join(workDir, inputName);
        const inputStat = await fs.stat(inputPath).catch(() => null);
        if (!inputStat) {
            await fs.copyFile(layout.sourcePdf, inputPath);
        }
        const splitPages = options.splitPages ?? true;
        const dockerArgs = [
            'run',
            '--rm',
            '-v',
            `${workDir}:/pdf`,
            '-w',
            '/pdf',
            PdfToHtmlService.DOCKER_IMAGE,
            'pdf2htmlEX',
            '--correct-text-visibility',
            '1',
            '--embed-css',
            '0',
            '--embed-font',
            '0',
            '--embed-image',
            '0',
            '--split-pages',
            splitPages ? '1' : '0',
            '--dest-dir',
            '/pdf',
            inputName,
            outputName,
        ];
        log.info('Starting pdf2htmlEX conversion', { workDir, splitPages });
        await withRetry(() => PdfToHtmlService.runDocker(dockerArgs), { label: 'pdf2htmlEX', maxAttempts: 2, baseDelayMs: 2000 });
        const organized = await PdfToHtmlService.organizeOutput(workDir, layout);
        log.info('pdf2htmlEX conversion complete', {
            html: organized.htmlFiles.length,
            css: organized.cssFiles.length,
            images: organized.imageFiles.length,
        });
        return organized;
    }
    static runDocker(args) {
        return new Promise((resolve, reject) => {
            const proc = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
            let stderr = '';
            let stdout = '';
            proc.stdout.on('data', (chunk) => {
                stdout += chunk.toString();
            });
            proc.stderr.on('data', (chunk) => {
                stderr += chunk.toString();
            });
            proc.on('error', (err) => {
                reject(new Error(`Docker not available: ${err.message}`));
            });
            proc.on('close', (code) => {
                if (code === 0) {
                    resolve();
                    return;
                }
                reject(new Error(`pdf2htmlEX exited with code ${code}\nstdout: ${stdout.slice(-2000)}\nstderr: ${stderr.slice(-2000)}`));
            });
        });
    }
    static async organizeOutput(workDir, layout) {
        const entries = await fs.readdir(workDir);
        const htmlFiles = [];
        const cssFiles = [];
        const imageFiles = [];
        const fontFiles = [];
        for (const name of entries) {
            const src = path.join(workDir, name);
            const stat = await fs.stat(src);
            if (!stat.isFile())
                continue;
            const lower = name.toLowerCase();
            if (lower.endsWith('.html') || lower.endsWith('.xhtml') || lower.endsWith('.page')) {
                const dest = path.join(layout.html, name);
                await fs.rename(src, dest).catch(async () => {
                    await fs.copyFile(src, dest);
                    await fs.unlink(src).catch(() => { });
                });
                // .page files = per-page HTML fragments from pdf2htmlEX split-pages mode
                // output.html = the skeleton file with empty page stubs (skip it; .page files have the real content)
                if (lower.endsWith('.page')) {
                    htmlFiles.push(dest);
                }
                else if (lower !== 'output.html') {
                    // Include any other .html/.xhtml files (e.g. split-page .html files from older pdf2htmlEX)
                    htmlFiles.push(dest);
                }
                // output.html is moved to html/ for reference but not parsed — it's an empty skeleton when .page files exist
            }
            else if (lower.endsWith('.css')) {
                const dest = path.join(layout.css, name);
                await fs.rename(src, dest).catch(async () => {
                    await fs.copyFile(src, dest);
                    await fs.unlink(src).catch(() => { });
                });
                cssFiles.push(dest);
            }
            else if (/\.(png|jpe?g|gif|webp|svg)$/i.test(lower)) {
                const dest = path.join(layout.images, name);
                await fs.rename(src, dest).catch(async () => {
                    await fs.copyFile(src, dest);
                    await fs.unlink(src).catch(() => { });
                });
                imageFiles.push(dest);
            }
            else if (/\.(woff2?|ttf|otf|eot)$/i.test(lower)) {
                const dest = path.join(layout.fonts, name);
                await fs.rename(src, dest).catch(async () => {
                    await fs.copyFile(src, dest);
                    await fs.unlink(src).catch(() => { });
                });
                fontFiles.push(dest);
            }
        }
        // Sort all html files numerically by the leading number in the filename
        htmlFiles.sort((a, b) => {
            const numA = parseInt(/(\d+)/.exec(path.basename(a))?.[1] || '0', 10);
            const numB = parseInt(/(\d+)/.exec(path.basename(b))?.[1] || '0', 10);
            if (numA !== numB)
                return numA - numB;
            return a.localeCompare(b, undefined, { numeric: true });
        });
        // If no per-page files found (non-split-pages mode), fall back to using the main output.html
        if (htmlFiles.length === 0) {
            const mainHtml = path.join(layout.html, 'output.html');
            const mainStat = await fs.stat(mainHtml).catch(() => null);
            if (mainStat)
                htmlFiles.push(mainHtml);
        }
        const mainHtmlPath = htmlFiles[0] || path.join(layout.html, 'output.html');
        return { mainHtmlPath, htmlFiles, cssFiles, imageFiles, fontFiles };
    }
}
//# sourceMappingURL=PdfToHtmlService.js.map