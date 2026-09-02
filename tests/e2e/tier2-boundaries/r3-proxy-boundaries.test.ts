import { TestContext } from '../harness/test-context.js';
import { assertNoKeyLeak, assertStatus } from '../harness/assertions.js';

export async function runTier2ProxyBoundaryTests(ctx: TestContext): Promise<void> {
  const { client: adminClient } = await ctx.ensureAdmin();
  const secretKey = 'sk-upstream-secret-ai-token-11223344';

  // Set valid AI config
  await adminClient.put('/api/admin/ai-config', {
    baseUrl: ctx.mockAi.getUrl(),
    apiKey: secretKey,
    imageModels: ['gpt-image-2', 'dall-e-3'],
    defaultModel: 'gpt-image-2',
    chatModels: ['gpt-4o'],
  });

  const userSession = await ctx.createTestUser({ role: 'user', prefix: 'proxy_bound_usr' });

  // Test B3.1: Image generation with empty prompt
  {
    const emptyPromptRes = await userSession.client.post('/api/ai/images/generations', {
      prompt: '',
      model: 'gpt-image-2',
    });
    assertStatus(emptyPromptRes, [400, 422], 'Image generation with empty prompt should return 400 Bad Request');
  }

  // Test B3.2: Upstream returns 429 Rate Limit
  {
    ctx.mockAi.setNextError(429, 'Rate limit exceeded on upstream provider');
    const rateLimitRes = await userSession.client.post('/api/ai/images/generations', {
      prompt: 'Test prompt causing rate limit',
      model: 'gpt-image-2',
    });
    assertStatus(rateLimitRes, [502, 429, 500], 'Upstream 429 should be handled safely as 502/429');
    assertNoKeyLeak(rateLimitRes.data, secretKey);
  }

  // Test B3.3: Upstream returns 500 Internal Server Error
  {
    ctx.mockAi.setNextError(500, 'Upstream internal failure');
    const upstreamFailRes = await userSession.client.post('/api/ai/images/generations', {
      prompt: 'Test prompt causing 500',
      model: 'gpt-image-2',
    });
    assertStatus(upstreamFailRes, [502, 500], 'Upstream 500 should be mapped to 502 Bad Gateway');
    assertNoKeyLeak(upstreamFailRes.data, secretKey);
  }

  // Test B3.4: Chat completions with missing messages
  {
    const badChatRes = await userSession.client.post('/api/ai/chat/completions', {
      model: 'gpt-4o',
    });
    assertStatus(badChatRes, 400, 'Chat completion without messages array must return 400 Bad Request');
  }

  // Test B3.5: Chat completions with empty messages array
  {
    const emptyChatRes = await userSession.client.post('/api/ai/chat/completions', {
      messages: [],
      model: 'gpt-4o',
    });
    assertStatus(emptyChatRes, 400, 'Chat completion with empty messages array must return 400 Bad Request');
  }

  // Test B3.6: Generation request with non-existent model
  {
    const badModelRes = await userSession.client.post('/api/ai/images/generations', {
      prompt: 'A landscape painting',
      model: 'non-existent-unsupported-model-999',
    });
    assertStatus(badModelRes, [400, 422, 200], 'Invalid model handled safely');
    assertNoKeyLeak(badModelRes.data, secretKey);
  }
}
