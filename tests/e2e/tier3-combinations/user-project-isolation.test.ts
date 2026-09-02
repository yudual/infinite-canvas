import { TestContext } from '../harness/test-context.js';
import { assertEqual, assertFalse, assertStatus, assertTrue } from '../harness/assertions.js';
import { ProjectDetailDto, ProjectSummaryDto } from '../types.js';

export async function runTier3UserProjectIsolationTests(ctx: TestContext): Promise<void> {
  const alice = await ctx.createTestUser({ role: 'user', prefix: 'alice' });
  const bob = await ctx.createTestUser({ role: 'user', prefix: 'bob' });

  // Alice creates project
  const aliceProjRes = await alice.client.post<{ project: ProjectDetailDto }>('/api/projects', {
    name: "Alice's Secret Canvas",
    canvasData: { secret: 'AlicePrivateSecretData', nodes: [] },
  });
  assertStatus(aliceProjRes, 201, 'Alice creates project');
  const aliceProjId = aliceProjRes.data.project.id;

  // Bob creates project
  const bobProjRes = await bob.client.post<{ project: ProjectDetailDto }>('/api/projects', {
    name: "Bob's Public Canvas",
    canvasData: { secret: 'BobPrivateData', nodes: [] },
  });
  assertStatus(bobProjRes, 201, 'Bob creates project');
  const bobProjId = bobProjRes.data.project.id;

  // Verify project list tenant isolation
  const aliceList = await alice.client.get<{ projects: ProjectSummaryDto[] }>('/api/projects');
  assertStatus(aliceList, 200, 'Alice lists projects');
  assertTrue(aliceList.data.projects.some((p) => p.id === aliceProjId), "Alice should see Alice's project");
  assertFalse(aliceList.data.projects.some((p) => p.id === bobProjId), "Alice must NOT see Bob's project");

  const bobList = await bob.client.get<{ projects: ProjectSummaryDto[] }>('/api/projects');
  assertStatus(bobList, 200, 'Bob lists projects');
  assertTrue(bobList.data.projects.some((p) => p.id === bobProjId), "Bob should see Bob's project");
  assertFalse(bobList.data.projects.some((p) => p.id === aliceProjId), "Bob must NOT see Alice's project");

  // Bob attempts cross-tenant read of Alice's project
  const bobReadAlice = await bob.client.get(`/api/projects/${aliceProjId}`);
  assertStatus(bobReadAlice, [403, 404], "Bob reading Alice's project must return 403 Forbidden or 404 Not Found");

  // Bob attempts cross-tenant update of Alice's project
  const bobUpdateAlice = await bob.client.put(`/api/projects/${aliceProjId}`, {
    name: 'Hijacked by Bob',
  });
  assertStatus(bobUpdateAlice, [403, 404], "Bob updating Alice's project must return 403 Forbidden or 404 Not Found");

  // Bob attempts cross-tenant delete of Alice's project
  const bobDeleteAlice = await bob.client.delete(`/api/projects/${aliceProjId}`);
  assertStatus(bobDeleteAlice, [403, 404], "Bob deleting Alice's project must return 403 Forbidden or 404 Not Found");

  // Verify Alice's project is still intact
  const aliceVerify = await alice.client.get<{ project: ProjectDetailDto }>(`/api/projects/${aliceProjId}`);
  assertStatus(aliceVerify, 200, "Alice's project remains untouched");
  assertEqual(aliceVerify.data.project.name || aliceVerify.data.project.title, "Alice's Secret Canvas");
}
