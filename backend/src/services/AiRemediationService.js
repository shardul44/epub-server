import { GoogleGenerativeAI } from '@google/generative-ai';
import { AiConfigService } from './aiConfigService.js';

export class AiRemediationService {
  static async _getModel() {
    const config = await AiConfigService.getActiveConfiguration();
    if (!config?.apiKey) {
      throw new Error('AI service is not configured. Please configure AI settings first.');
    }

    const genAI = new GoogleGenerativeAI(config.apiKey);
    const modelName = config.modelName || 'gemini-2.0-flash';
    const model = genAI.getGenerativeModel({ model: modelName });
    return { model, modelName };
  }

  /**
   * Generate alt text suggestion from image bytes.
   * Human-in-the-loop: caller must ask user to approve/edit before apply.
   */
  static async suggestAltText({ imageBuffer, mimeType = 'image/png', imageSrc = '' }) {
    const { model, modelName } = await this._getModel();
    const prompt = `You are an EPUB accessibility specialist.
Generate one concise WCAG-friendly alt text for this image.

Rules:
- Output only one line of plain text, no bullets, no quotes.
- Keep it concise (about 8-25 words).
- Describe meaningful visual information for non-sighted users.
- Do not include "image of" unless required by context.
- If the image appears decorative, output exactly: decorative

Image source path (context): ${imageSrc || 'unknown'}
`;

    const result = await model.generateContent([
      { text: prompt },
      {
        inlineData: {
          data: imageBuffer.toString('base64'),
          mimeType
        }
      }
    ]);

    const response = await result.response;
    const suggestion = (await response.text()).trim().replace(/\s+/g, ' ');
    return { suggestion, modelName };
  }

  /**
   * Generate code repair suggestion for an Ace serious violation.
   * Returns structured JSON (file path optional).
   */
  static async suggestCodeRepair({
    title,
    description,
    helpDescription,
    filePath,
    offendingSnippet
  }) {
    const { model, modelName } = await this._getModel();
    const prompt = `You are an EPUB + WCAG remediation assistant.
Given a serious accessibility violation, return a minimal, safe fix.

Violation title: ${title || 'unknown'}
Violation description: ${description || 'unknown'}
Guidance: ${helpDescription || 'none'}
File path: ${filePath || 'unknown'}

Offending snippet:
${offendingSnippet || ''}

Important:
Do NOT try to echo/alter the offending snippet in your response. The caller will use the Ace-provided offending snippet for matching.

Return STRICT JSON ONLY with this shape:
{
  "fixedSnippet": "<wcag-compliant snippet>",
  "reason": "<short reason>"
}

Rules:
- Keep the fix minimal and preserve fixed-layout structure.
- Do not invent unrelated markup.
- If snippet is insufficient to fix safely, still return best effort but keep original structure.
`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const raw = (await response.text()).trim();
    const parsed = this._parseJsonResponse(raw);

    return {
      modelName,
      // Critical: always use the Ace-provided offendingSnippet for matching.
      // If Gemini returns a slightly different "offendingSnippet", RemedyEngine's
      // snippet replacement will fail and the issue count will not drop.
      offendingSnippet: offendingSnippet || parsed?.offendingSnippet || '',
      fixedSnippet: parsed?.fixedSnippet || '',
      reason: parsed?.reason || ''
    };
  }

  static _parseJsonResponse(raw) {
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (_e) {
      const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
      if (fenced?.[1]) {
        try {
          return JSON.parse(fenced[1].trim());
        } catch (_e2) {
          return null;
        }
      }
      return null;
    }
  }
}

