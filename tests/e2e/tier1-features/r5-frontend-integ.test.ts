import { TestContext } from '../harness/test-context.js';
import { assertEqual, assertStatus, assertTrue } from '../harness/assertions.js';
import { ProjectDetailDto, ProjectSummaryDto, SetupStatusResponse } from '../types.js';

export async function runTier1FrontendIntegTests(ctx: TestContext): Promise<void> {
  const userSession = await ctx.createTestUser({ role: 'user', prefix: 'fe_integ_usr' });

  // Test 5.1: Setup status contract for root router guard
  {
    const statusRes = await ctx.client.get<SetupStatusResponse>('/api/setup/status');
    assertStatus(statusRes, 200, 'GET /api/setup/status must return 200 OK');
    assertTrue(typeof statusRes.data.initialized === 'boolean', 'initialized property must be boolean');
  }

  // Test 5.2: AI Models discovery contract for Canvas Top Bar & Generation Settings
  {
    const modelsRes = await userSession.client.get<{ imageModels: string[]; defaultModel?: string; defaultImageModel?: string }>(
      '/api/ai/models'
    );
    assertStatus(modelsRes, 200, 'GET /api/ai/models must return 200 OK');
    assertTrue(Array.isArray(modelsRes.data.imageModels), 'imageModels must be an array of model identifiers');
  }

  // Test 5.3: Canvas graph serialization round-trip (nested node state, tools, chat sessions)
  {
    const complexCanvasData = {
      nodes: [
        {
          id: 'node-img-1',
          type: 'image',
          position: { x: 120, y: 340 },
          width: 512,
          height: 512,
          data: {
            prompt: 'A cyberpunk cityscape at twilight with flying vehicles',
            model: 'gpt-image-2',
            aspectRatio: '1:1',
            generationHistory: ['http://127.0.0.1:3199/mock-images/sample-1.png'],
          },
        },
        {
          id: 'node-cfg-1',
          type: 'config',
          position: { x: 700, y: 340 },
          data: {
            lora: 'cyberpunk-style',
            steps: 30,
            cfgScale: 7.5,
          },
        },
      ],
      connections: [{ id: 'conn-1', from: 'node-cfg-1', to: 'node-img-1', type: 'parameter' }],
      chatSessions: [
        {
          id: 'chat-1',
          title: 'Canvas Assistant Discussion',
          messages: [
            { id: 'm1', role: 'user', content: 'Suggest a color palette for cyber canvas' },
            { id: 'm2', role: 'assistant', content: 'Try neon magenta and electric teal.' },
          ],
        },
      ],
      viewport: { x: 50, y: 100, zoom: 0.85 },
    };

    const createRes = await userSession.client.post<{ project: ProjectDetailDto }>('/api/projects', {
      name: 'Full Interactive Canvas State',
      canvasData: complexCanvasData,
    });
    assertStatus(createRes, 201, 'POST /api/projects should accept complex frontend canvas structure');

    const projectId = createRes.data.project.id;
    const fetchRes = await userSession.client.get<{ project: ProjectDetailDto }>(`/api/projects/${projectId}`);
    assertStatus(fetchRes, 200, 'GET /api/projects/:id should return intact canvas state');

    const loadedData = typeof fetchRes.data.project.canvasData === 'string'
      ? JSON.parse(fetchRes.data.project.canvasData)
      : (fetchRes.data.project.canvasData || fetchRes.data.project.canvas_data);

    assertEqual(loadedData.nodes?.length, 2, 'Loaded canvas nodes length must match saved state');
    assertEqual(loadedData.chatSessions?.length, 1, 'Loaded chat sessions length must match saved state');
    assertEqual(loadedData.viewport?.zoom, 0.85, 'Loaded viewport zoom must match saved state');
  }

  // Test 5.4: Cloud project list format for Project Switcher Dropdown
  {
    const listRes = await userSession.client.get<{ projects: ProjectSummaryDto[] }>('/api/projects');
    assertStatus(listRes, 200, 'GET /api/projects must return 200 OK');
    assertTrue(Array.isArray(listRes.data.projects), 'Projects list must be an array');
    if (listRes.data.projects.length > 0) {
      const p = listRes.data.projects[0];
      assertTrue(!!p.id, 'Project item must have id');
      assertTrue(!!(p.name || p.title), 'Project item must have name or title');
    }
  }

  // Test 5.5: User profile dropdown contract
  {
    const meRes = await userSession.client.get('/api/auth/me');
    assertStatus(meRes, 200, 'GET /api/auth/me must return 200 OK');
    assertTrue(!!meRes.data.user, 'Session response must include user object');
    assertTrue(!!meRes.data.user.id, 'User object must include id');
    assertTrue(!!meRes.data.user.username, 'User object must include username');
    assertTrue(!!meRes.data.user.role, 'User object must include role');
  }
}
