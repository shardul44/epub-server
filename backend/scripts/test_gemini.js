import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import fs from 'fs';
dotenv.config();

async function testModels() {
    const apiKey = process.env.GEMINI_API_KEY;
    const logFile = 'gemini_test_log.txt';
    fs.writeFileSync(logFile, 'Starting Test...\n');

    if (!apiKey) {
        fs.appendFileSync(logFile, 'GEMINI_API_KEY not found\n');
        return;
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const models = [
        'gemini-pro',
        'gemini-2.5-flash',
        'gemini-2.0-flash',
        'gemini-1.5-flash',
        'gemini-1.5-pro'
    ];

    for (const modelName of models) {
        try {
            fs.appendFileSync(logFile, `Testing model: ${modelName}...\n`);
            const model = genAI.getGenerativeModel({ model: modelName });
            const result = await model.generateContent('Hi');
            const text = result.response.text();
            fs.appendFileSync(logFile, `SUCCESS [${modelName}]: ${text.substring(0, 50)}...\n`);
        } catch (err) {
            fs.appendFileSync(logFile, `FAILED [${modelName}]: ${err.message}\n`);
        }
    }
    fs.appendFileSync(logFile, 'Tests completed.\n');
}

testModels();
