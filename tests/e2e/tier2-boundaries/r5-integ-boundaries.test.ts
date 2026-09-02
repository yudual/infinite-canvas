import { TestContext } from '../harness/test-context.js';
import { assertEqual, assertStatus, assertTrue } from '../harness/assertions.js';
import { ProjectDetailDto } from '../types.js';

export async function runTier2IntegBoundaryTests(ctx: TestContext): Promise<void> {
  const userSession = await ctx.createTestUser({ role: 'user', prefix: 'fe_bound_usr' });
  const client = userSession.client;

  // Test B5.1: Special Unicode and emoji preservation in project metadata
  {
    const unicodeTitle = '🎨 无限画布测试 Project 日本語 & Emoji 🚀 💥 <script>alert(1)</script>';
    const unicodeData = {
      notes: '包含特殊符号 & < > " \' / \n\t 和多语言字符',
      nodes: [{ id: 'u1', type: 'text', data: { content: '你好 世界 Hello World 🌍' } }],
    };

    const createRes = await client.post<{ project: ProjectDetailDto }>('/api/projects', {
      name: unicodeTitle,
      canvasData: unicodeData,
    });
    assertStatus(createRes, 201, 'Unicode project creation should succeed');

    const projectId = createRes.data.project.id;
    const fetchRes = await client.get<{ project: ProjectDetailDto }>(`/api/projects/${projectId}`);
    assertStatus(fetchRes, 200, 'Fetching unicode project should succeed');
    assertEqual(fetchRes.data.project.name || fetchRes.data.project.title, unicodeTitle, 'Project title unicode must be preserved exactly');
  }

  // Test B5.2: Large canvas graph with hundreds of nodes
  {
    const largeNodes = Array.from({ length: 150 }, (_, i) => ({
      id: `node-${i}`,
      type: i % 2 === 0 ? 'image' : 'text',
      x: (i * 50) % 2000,
      y: (i * 30) % 2000,
      data: {
        label: `Generated Node #${i}`,
        description: `High density node payload with structured parameters ${i}`,
      },
    }));

    const largeConnections = Array.from({ length: 149 }, (_, i) => ({
      from: `node-${i}`,
      to: `node-${i + 1}`,
    }));

    const largeProjectRes = await client.post<{ project: ProjectDetailDto }>('/api/projects', {
      name: 'High Density 150 Node Project',
      canvasData: { nodes: largeNodes, connections: largeConnections },
    });
    assertStatus(largeProjectRes, 201, 'High density project creation should succeed');

    const projectId = largeProjectRes.data.project.id;
    const fetchRes = await client.get<{ project: ProjectDetailDto }>(`/api/projects/${projectId}`);
    assertStatus(fetchRes, 200, 'Fetching large project must succeed');
    
    const loadedData = typeof fetchRes.data.project.canvasData === 'string'
      ? JSON.parse(fetchRes.data.project.canvasData)
      : (fetchRes.data.project.canvasData || fetchRes.data.project.canvas_data);
    assertEqual(loadedData.nodes?.length, 150, '150 nodes must be preserved in database');
  }

  // Test B5.3: Rapid concurrent project creates
  {
    const createPromises = Array.from({ length: 5 }, (_, i) =>
      client.post<{ project: ProjectDetailDto }>('/api/projects', {
        name: `Concurrent Project ${i}`,
        canvasData: { index: i },
      })
    );

    const results = await Promise.all(createPromises);
    for (const res of results) {
      assertStatus(res, 201, 'Concurrent project creation should all succeed without locking errors');
    }
  }

  // Test B5.4: User accessing projects with invalid Authorization format
  {
    const badAuthClient = ctx.client.fork();
    badAuthClient.setHeader('Authorization', 'InvalidFormatHeader');
    const res = await badAuthClient.get('/api/projects');
    assertStatus(res, [401, 403], 'Invalid Authorization header format must be rejected');
  }
}
