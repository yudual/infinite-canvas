import { TestContext } from '../harness/test-context.js';
import { assertStatus } from '../harness/assertions.js';

export async function runTier2StorageBoundaryTests(ctx: TestContext): Promise<void> {
  const userSession = await ctx.createTestUser({ role: 'user', prefix: 'storage_bound_usr' });
  const client = userSession.client;

  // Test B4.1: Path traversal attacks on /uploads static serving
  {
    const traversalPaths = [
      '/uploads/../../package.json',
      '/uploads/..%2F..%2Fpackage.json',
      '/uploads/%2e%2e/%2e%2e/server/src/index.ts',
      '/uploads/....//....//etc/passwd',
    ];

    for (const p of traversalPaths) {
      const traversalRes = await client.get(p);
      assertStatus(traversalRes, [400, 403, 404], `Path traversal attempt on "${p}" must be blocked with 400/403/404`);
    }
  }

  // Test B4.2: Accessing non-existent project ID returns 404
  {
    const ghostProjRes = await client.get('/api/projects/non-existent-project-uuid-9999');
    assertStatus(ghostProjRes, 404, 'GET non-existent project must return 404 Not Found');
  }

  // Test B4.3: Updating non-existent project ID returns 404
  {
    const ghostUpdateRes = await client.put('/api/projects/non-existent-project-uuid-9999', {
      name: 'Ghost Update',
    });
    assertStatus(ghostUpdateRes, 404, 'PUT non-existent project must return 404 Not Found');
  }

  // Test B4.4: Project creation with empty payload
  {
    const emptyProjRes = await client.post('/api/projects', {});
    assertStatus(emptyProjRes, [400, 422], 'Creating project with empty body should return 400/422');
  }

  // Test B4.5: Uploading empty file
  {
    const emptyBuffer = Buffer.alloc(0);
    const emptyUploadRes = await client.upload('/api/upload', emptyBuffer, 'empty.png', 'image/png');
    assertStatus(emptyUploadRes, [400, 422], 'Uploading 0-byte empty file should return 400 Bad Request');
  }

  // Test B4.6: Static serving of non-existent file
  {
    const nonExistentStaticRes = await client.get('/uploads/this-image-definitely-does-not-exist.png');
    assertStatus(nonExistentStaticRes, 404, 'GET non-existent static file must return 404 Not Found');
  }
}
