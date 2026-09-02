import { TestContext } from '../harness/test-context.js';
import { assertEqual, assertNoKeyLeak, assertStatus, assertTrue } from '../harness/assertions.js';
import { AssetDto, ImageGenerationResponse, ProjectDetailDto } from '../types.js';

export async function runTier4CanvasWorkflowScenario(ctx: TestContext): Promise<void> {
  const { client: adminClient } = await ctx.ensureAdmin();
  const secretKey = 'sk-prod-flow-secret-key-55667788';

  // Ensure AI config is configured
  await adminClient.put('/api/admin/ai-config', {
    baseUrl: ctx.mockAi.getUrl(),
    apiKey: secretKey,
    imageModels: ['gpt-image-2', 'dall-e-3'],
    defaultModel: 'gpt-image-2',
    chatModels: ['gpt-4o'],
  });

  // Step 1: User logs in
  const artist = await ctx.createTestUser({ role: 'user', prefix: 'artist' });
  const artistClient = artist.client;

  // Step 2: Artist creates an initial canvas project
  const initialCanvasState = {
    nodes: [
      {
        id: 'prompt-node-1',
        type: 'text',
        x: 100,
        y: 100,
        data: { text: 'A hyper-detailed digital oil painting of an enchanted crystalline tree' },
      },
    ],
    connections: [],
    viewport: { x: 0, y: 0, zoom: 1.0 },
  };

  const createProjRes = await artistClient.post<{ project: ProjectDetailDto }>('/api/projects', {
    name: 'Enchanted Crystal Tree Concept',
    canvasData: initialCanvasState,
  });
  assertStatus(createProjRes, 201, 'Step 2: Artist creates initial project');
  const projectId = createProjRes.data.project.id;

  // Step 3: Artist dispatches AI generation through proxy
  const genRes = await artistClient.post<ImageGenerationResponse>('/api/ai/images/generations', {
    prompt: 'A hyper-detailed digital oil painting of an enchanted crystalline tree',
    model: 'gpt-image-2',
    size: '1024x1024',
    n: 1,
  });
  assertStatus(genRes, 200, 'Step 3: Artist generates AI image via proxy');
  assertNoKeyLeak(genRes.data, secretKey);

  const generatedImageUrl = genRes.data.data[0]?.url || 'http://127.0.0.1:3199/mock-images/sample-gen.png';

  // Step 4: Artist uploads a local texture asset
  const sampleTexture = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );
  let uploadRes = await artistClient.upload<AssetDto>('/api/upload', sampleTexture, 'brush-texture.png', 'image/png');
  if (!uploadRes.ok) {
    uploadRes = await artistClient.upload<AssetDto>('/api/assets/upload', sampleTexture, 'brush-texture.png', 'image/png');
  }
  assertStatus(uploadRes, [200, 201], 'Step 4: Artist uploads texture asset');
  const textureUrl = uploadRes.data.url;

  // Step 5: Artist links generated image and texture nodes into the canvas project graph
  const updatedCanvasState = {
    nodes: [
      ...initialCanvasState.nodes,
      {
        id: 'image-node-1',
        type: 'image',
        x: 500,
        y: 100,
        data: {
          imageUrl: generatedImageUrl,
          aspectRatio: '1:1',
          sourcePromptNodeId: 'prompt-node-1',
        },
      },
      {
        id: 'texture-node-1',
        type: 'image',
        x: 500,
        y: 500,
        data: {
          imageUrl: textureUrl,
          isAsset: true,
        },
      },
    ],
    connections: [
      { id: 'conn-1', from: 'prompt-node-1', to: 'image-node-1' },
      { id: 'conn-2', from: 'texture-node-1', to: 'image-node-1' },
    ],
    viewport: { x: -100, y: -50, zoom: 0.9 },
  };

  const updateProjRes = await artistClient.put<{ project: ProjectDetailDto }>(`/api/projects/${projectId}`, {
    name: 'Enchanted Crystal Tree (Finished)',
    canvasData: updatedCanvasState,
    thumbnail: generatedImageUrl,
  });
  assertStatus(updateProjRes, 200, 'Step 5: Artist updates cloud project state');

  // Step 6: Simulate opening canvas on a different browser session / device
  const session2Client = ctx.client.fork();
  session2Client.setToken(artist.token);

  const reloadRes = await session2Client.get<{ project: ProjectDetailDto }>(`/api/projects/${projectId}`);
  assertStatus(reloadRes, 200, 'Step 6: Reload project from secondary session');

  const loadedData = typeof reloadRes.data.project.canvasData === 'string'
    ? JSON.parse(reloadRes.data.project.canvasData)
    : (reloadRes.data.project.canvasData || reloadRes.data.project.canvas_data);

  assertEqual(loadedData.nodes?.length, 3, 'All 3 nodes preserved');
  assertEqual(loadedData.connections?.length, 2, 'All 2 node connections preserved');
  assertEqual(loadedData.viewport?.zoom, 0.9, 'Viewport zoom preserved');
}
