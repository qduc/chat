// Reads one streamed turn with the official @google/genai SDK and prints the
// function calls it reconstructed as JSON. Run as a plain Node process: under
// Jest's VM sandbox the SDK's fetch fails ("Undici globalDispatcher is not
// available"), which is a test-runner limitation, not a fixture problem.
//
// Usage: node geminiSdkReader.mjs <baseUrl> <model>
import process from 'node:process';
import { GoogleGenAI } from '@google/genai';

const [baseUrl, model] = process.argv.slice(2);
const parameters = { type: 'object', properties: { a: { type: 'number' } }, required: ['a'] };
const ai = new GoogleGenAI({ apiKey: 'replay', httpOptions: { baseUrl } });
const stream = await ai.models.generateContentStream({
  model,
  contents: 'Use the fixture tool and then summarize its result.',
  config: { tools: [{ functionDeclarations: [{ name: 'fixture', description: 'fixture', parametersJsonSchema: parameters }] }] },
});
const calls = [];
for await (const chunk of stream) {
  for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
    if (!part.functionCall) continue;
    calls.push({
      id: part.functionCall.id ?? null,
      name: part.functionCall.name,
      args: part.functionCall.args,
      signed: Boolean(part.thoughtSignature),
    });
  }
}
process.stdout.write(JSON.stringify(calls));
