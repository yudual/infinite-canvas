import { TestContext } from '../harness/test-context.js';
import { assertEqual, assertStatus, assertTrue } from '../harness/assertions.js';
import { AssetDto, ProjectDetailDto, ProjectSummaryDto } from '../types.js';

export async function runTier1ProjectStorageTests(ctx: TestContext): Promise<void> {
  const userSession = await ctx.createTestUser({ role: 'user', prefix: 'proj_usr' });
  const client = userSession.client;

  // Test 4.1: GET /api/projects returns initial list
  {
    const listRes = await client.get<{ projects: ProjectSummaryDto[] }>('/api/projects');
    assertStatus(listRes, 200, 'GET /api/projects should return 200 OK');
    assertTrue(Array.isArray(listRes.data.projects), 'Projects list should contain an array');
  }

  // Test 4.2: POST /api/projects creates a new canvas project
  let createdProjectId = '';
  const initialCanvasData = {
    nodes: [
      { id: 'node-1', type: 'image', x: 100, y: 150, data: { prompt: 'A mystical forest' } },
      { id: 'node-2', type: 'text', x: 400, y: 200, data: { text: 'Prompt commentary' } },
    ],
    connections: [{ from: 'node-1', to: 'node-2' }],
    viewport: { x: 0, y: 0, zoom: 1 },
  };

  {
    const createRes = await client.post<{ project: ProjectDetailDto }>('/api/projects', {
      name: 'My Masterpiece Canvas',
      canvasData: initialCanvasData,
      thumbnail: 'data:image/png;base64,samplethumbnail',
    });
    assertStatus(createRes, 201, 'POST /api/projects should return 201 Created');
    assertTrue(!!createRes.data.project.id, 'Created project must have an id');
    createdProjectId = createRes.data.project.id;
  }

  // Test 4.3: GET /api/projects/:id loads project detail
  {
    const detailRes = await client.get<{ project: ProjectDetailDto }>(`/api/projects/${createdProjectId}`);
    assertStatus(detailRes, 200, 'GET /api/projects/:id should return 200 OK');
    assertEqual(detailRes.data.project.id, createdProjectId, 'Loaded project id must match requested id');
    
    // Check canvas data
    const canvasData = typeof detailRes.data.project.canvasData === 'string'
      ? JSON.parse(detailRes.data.project.canvasData)
      : (detailRes.data.project.canvasData || detailRes.data.project.canvas_data);
    assertTrue(!!canvasData, 'Canvas data must be present in project detail');
  }

  // Test 4.4: PUT /api/projects/:id updates project state
  {
    const updatedCanvasData = {
      ...initialCanvasData,
      nodes: [
        ...initialCanvasData.nodes,
        { id: 'node-3', type: 'config', x: 700, y: 300, data: { model: 'gpt-image-2' } },
      ],
    };

    const updateRes = await client.put<{ project: ProjectDetailDto }>(`/api/projects/${createdProjectId}`, {
      name: 'My Updated Canvas Project',
      canvasData: updatedCanvasData,
    });
    assertStatus(updateRes, 200, 'PUT /api/projects/:id should return 200 OK');
  }

  // Test 4.5: POST /api/upload (or /api/assets/upload) uploads binary file
  let uploadedFileUrl = '';
  {
    const samplePngBuffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    );
    
    // Try /api/upload or /api/assets/upload
    let uploadRes = await client.upload<AssetDto>('/api/upload', samplePngBuffer, 'canvas-node.png', 'image/png');
    if (!uploadRes.ok) {
      uploadRes = await client.upload<AssetDto>('/api/assets/upload', samplePngBuffer, 'canvas-node.png', 'image/png');
    }

    assertStatus(uploadRes, [200, 201], 'POST upload endpoint should return 200/201 Created');
    assertTrue(!!uploadRes.data.url, 'Upload response must contain file url');
    uploadedFileUrl = uploadRes.data.url;
  }

  // Test 4.6: Static file serving via GET /uploads/:filename
  if (uploadedFileUrl) {
    const staticRes = await client.get(uploadedFileUrl);
    assertStatus(staticRes, 200, 'GET static upload url should return 200 OK');
    const contentType = staticRes.headers.get('content-type') || '';
    assertTrue(contentType.includes('image'), `Static asset Content-Type must be an image, got "${contentType}"`);
  }

  // Test 4.7: DELETE /api/projects/:id deletes project
  {
    const deleteRes = await client.delete<{ success: boolean }>(`/api/projects/${createdProjectId}`);
    assertStatus(deleteRes, 200, 'DELETE /api/projects/:id should return 200 OK');

    // Confirm project is gone
    const checkRes = await client.get(`/api/projects/${createdProjectId}`);
    assertStatus(checkRes, 404, 'GET deleted project should return 404 Not Found');
  }
}
