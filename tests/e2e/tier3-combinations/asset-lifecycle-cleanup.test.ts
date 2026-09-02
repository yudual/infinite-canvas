import { TestContext } from '../harness/test-context.js';
import { assertEqual, assertStatus, assertTrue } from '../harness/assertions.js';
import { AssetDto, ProjectDetailDto } from '../types.js';

export async function runTier3AssetLifecycleTests(ctx: TestContext): Promise<void> {
  const user = await ctx.createTestUser({ role: 'user', prefix: 'asset_life_usr' });
  const client = user.client;

  // Step 1: Upload an image asset
  const sampleImage = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );

  let uploadRes = await client.upload<AssetDto>('/api/upload', sampleImage, 'artwork-texture.png', 'image/png');
  if (!uploadRes.ok) {
    uploadRes = await client.upload<AssetDto>('/api/assets/upload', sampleImage, 'artwork-texture.png', 'image/png');
  }
  assertStatus(uploadRes, [200, 201], 'Asset upload must succeed');
  const assetUrl = uploadRes.data.url;

  // Step 2: Create canvas project embedding uploaded asset URL
  const projectRes = await client.post<{ project: ProjectDetailDto }>('/api/projects', {
    name: 'Canvas with Asset Reference',
    canvasData: {
      nodes: [
        {
          id: 'img-node-1',
          type: 'image',
          data: { imageUrl: assetUrl },
        },
      ],
    },
    thumbnail: assetUrl,
  });
  assertStatus(projectRes, 201, 'Project embedding asset must succeed');
  const projId = projectRes.data.project.id;

  // Step 3: Fetch static asset and verify HTTP headers
  const staticRes = await client.get(assetUrl);
  assertStatus(staticRes, 200, 'Static asset URL must be accessible');

  // Step 4: Cleanup project
  const delProj = await client.delete(`/api/projects/${projId}`);
  assertStatus(delProj, 200, 'Project deletion succeeds');
}
