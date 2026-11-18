import { handleJudgeStreamingResponse } from '../lib/api/streaming-handler';

function streamResponse(events: unknown[]) {
  return new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n'
  );
}

test('rejects invalid judge output rather than fabricating a tie', async () => {
  const response = streamResponse([
    { choices: [{ delta: { content: 'No verdict' } }] },
    { type: 'error', message: 'Judge returned an invalid verdict. Please try again.' },
  ]);
  await expect(handleJudgeStreamingResponse(response)).rejects.toThrow('invalid verdict');
});

test('rejects a judge stream that ends without a persisted evaluation', async () => {
  const response = streamResponse([{ choices: [{ delta: { content: '{"winner":"tie"}' } }] }]);
  await expect(handleJudgeStreamingResponse(response)).rejects.toThrow(
    'did not return an evaluation'
  );
});
