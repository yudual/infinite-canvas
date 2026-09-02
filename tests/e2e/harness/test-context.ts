import { ApiClient } from './api-client.js';
import { MockAiServer } from './mock-ai-server.js';
import { AuthResponse, SetupStatusResponse, UserListItem } from '../types.js';

export interface TestUserSession {
  client: ApiClient;
  token: string;
  user: UserListItem;
  password: string;
}

export class TestContext {
  private static instance: TestContext | null = null;
  public baseUrl: string;
  public client: ApiClient;
  public mockAi: MockAiServer;
  private adminSession: { token: string; username: string } | null = null;

  constructor() {
    this.baseUrl = (process.env.BASE_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
    this.client = new ApiClient(this.baseUrl);
    const mockPort = parseInt(process.env.MOCK_AI_PORT || '3199', 10);
    this.mockAi = new MockAiServer(mockPort);
  }

  public static get(): TestContext {
    if (!TestContext.instance) {
      TestContext.instance = new TestContext();
    }
    return TestContext.instance;
  }

  public async init(): Promise<void> {
    await this.mockAi.start();
  }

  public async teardown(): Promise<void> {
    await this.mockAi.stop();
  }

  public uniqueUsername(prefix = 'testuser'): string {
    const rand = Math.random().toString(36).substring(2, 8);
    return `${prefix}_${Date.now().toString().slice(-4)}_${rand}`;
  }

  public async isServerReachable(): Promise<boolean> {
    try {
      const res = await this.client.get('/api/setup/status');
      return res.status > 0;
    } catch {
      return false;
    }
  }

  public async getSetupStatus(): Promise<SetupStatusResponse> {
    const res = await this.client.get<SetupStatusResponse>('/api/setup/status');
    return res.data;
  }

  public async ensureAdmin(): Promise<{ client: ApiClient; token: string }> {
    if (this.adminSession) {
      const adminClient = this.client.fork();
      adminClient.setToken(this.adminSession.token);
      return { client: adminClient, token: this.adminSession.token };
    }

    if (this.client.getToken()) {
      this.adminSession = { token: this.client.getToken()!, username: 'admin' };
      const adminClient = this.client.fork();
      return { client: adminClient, token: this.client.getToken()! };
    }

    const status = await this.getSetupStatus();
    const adminUsername = 'admin';
    const adminPassword = 'AdminPassword123!';

    if (!status.initialized) {
      // Initialize first admin
      const setupRes = await this.client.post<AuthResponse>('/api/setup', {
        username: adminUsername,
        password: adminPassword,
        displayName: 'Initial Super Admin',
      });

      if (setupRes.ok && setupRes.data?.token) {
        this.adminSession = { token: setupRes.data.token, username: adminUsername };
        const adminClient = this.client.fork();
        adminClient.setToken(setupRes.data.token);
        return { client: adminClient, token: setupRes.data.token };
      }
    }

    // Try known default logins if already initialized
    const defaultCredentials = [
      { username: 'admin', password: 'AdminPassword123!' },
      { username: 'admin', password: 'password123' },
      { username: 'admin', password: 'admin' },
      { username: 'superadmin', password: 'SuperAdmin123!' },
    ];

    for (const cred of defaultCredentials) {
      const loginRes = await this.client.post<AuthResponse>('/api/auth/login', cred);
      if (loginRes.ok && loginRes.data?.token && loginRes.data?.user?.role === 'admin') {
        this.adminSession = { token: loginRes.data.token, username: cred.username };
        const adminClient = this.client.fork();
        adminClient.setToken(loginRes.data.token);
        return { client: adminClient, token: loginRes.data.token };
      }
    }

    // If no default login worked, fallback to current token or unauthenticated admin client
    const fallbackClient = this.client.fork();
    return { client: fallbackClient, token: '' };
  }

  public async createTestUser(
    options: { role?: 'admin' | 'user'; status?: 'active' | 'disabled'; prefix?: string } = {}
  ): Promise<TestUserSession> {
    const { client: adminClient } = await this.ensureAdmin();
    const username = this.uniqueUsername(options.prefix || 'usr');
    const password = 'UserPassword123!';
    const role = options.role || 'user';

    const createRes = await adminClient.post<{ user: UserListItem }>('/api/admin/users', {
      username,
      password,
      role,
      displayName: `Test User ${username}`,
    });

    const user: UserListItem = createRes.data?.user || {
      id: 'mock-id',
      username,
      role,
      status: options.status || 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (options.status === 'disabled' && user.id && user.id !== 'mock-id') {
      await adminClient.patch(`/api/admin/users/${user.id}/status`, { status: 'disabled' });
      user.status = 'disabled';
    }

    // Attempt login to obtain user token
    const userClient = this.client.fork();
    let token = '';
    const loginRes = await userClient.post<AuthResponse>('/api/auth/login', { username, password });
    if (loginRes.ok && loginRes.data?.token) {
      token = loginRes.data.token;
      userClient.setToken(token);
    }

    return {
      client: userClient,
      token,
      user,
      password,
    };
  }
}
