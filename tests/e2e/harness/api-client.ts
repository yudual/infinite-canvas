import { ApiResponse } from '../types.js';

export class ApiClient {
  private baseUrl: string;
  private token: string | null = null;
  private customHeaders: Record<string, string> = {};

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  public setToken(token: string | null): void {
    this.token = token;
  }

  public getToken(): string | null {
    return this.token;
  }

  public setHeader(key: string, value: string): void {
    this.customHeaders[key] = value;
  }

  public clearHeader(key: string): void {
    delete this.customHeaders[key];
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  private async request<T = any>(
    path: string,
    options: {
      method: string;
      body?: any;
      headers?: Record<string, string>;
      isFormData?: boolean;
    }
  ): Promise<ApiResponse<T>> {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path.startsWith('/') ? path : '/' + path}`;
    const headers: Record<string, string> = {
      ...this.customHeaders,
      ...(options.headers || {}),
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    let requestBody: any = undefined;

    if (options.isFormData) {
      // Body is FormData, let fetch set boundary automatically
      requestBody = options.body;
      delete headers['Content-Type'];
    } else if (options.body !== undefined) {
      if (typeof options.body === 'string') {
        requestBody = options.body;
        if (!headers['Content-Type']) {
          headers['Content-Type'] = 'text/plain';
        }
      } else {
        requestBody = JSON.stringify(options.body);
        if (!headers['Content-Type']) {
          headers['Content-Type'] = 'application/json';
        }
      }
    }

    try {
      const response = await fetch(url, {
        method: options.method,
        headers,
        body: requestBody,
      });

      const rawText = await response.text();
      let data: any = rawText;
      try {
        data = JSON.parse(rawText);
      } catch {
        // Not JSON
      }

      return {
        status: response.status,
        ok: response.ok,
        headers: response.headers,
        data: data as T,
        rawText,
      };
    } catch (err: any) {
      return {
        status: 0,
        ok: false,
        headers: new Headers(),
        data: { error: { message: err.message, code: 'NETWORK_ERROR' } } as any,
        rawText: err.message,
      };
    }
  }

  public async get<T = any>(path: string, headers?: Record<string, string>): Promise<ApiResponse<T>> {
    return this.request<T>(path, { method: 'GET', headers });
  }

  public async post<T = any>(path: string, body?: any, headers?: Record<string, string>): Promise<ApiResponse<T>> {
    return this.request<T>(path, { method: 'POST', body, headers });
  }

  public async put<T = any>(path: string, body?: any, headers?: Record<string, string>): Promise<ApiResponse<T>> {
    return this.request<T>(path, { method: 'PUT', body, headers });
  }

  public async patch<T = any>(path: string, body?: any, headers?: Record<string, string>): Promise<ApiResponse<T>> {
    return this.request<T>(path, { method: 'PATCH', body, headers });
  }

  public async delete<T = any>(path: string, headers?: Record<string, string>): Promise<ApiResponse<T>> {
    return this.request<T>(path, { method: 'DELETE', headers });
  }

  public async upload<T = any>(
    path: string,
    fileBuffer: Buffer | Uint8Array,
    filename: string,
    mimeType: string,
    additionalFields?: Record<string, string>
  ): Promise<ApiResponse<T>> {
    const formData = new FormData();
    const blob = new Blob([fileBuffer], { type: mimeType });
    formData.append('file', blob, filename);

    if (additionalFields) {
      for (const [key, val] of Object.entries(additionalFields)) {
        formData.append(key, val);
      }
    }

    return this.request<T>(path, {
      method: 'POST',
      body: formData,
      isFormData: true,
    });
  }

  public fork(): ApiClient {
    const client = new ApiClient(this.baseUrl);
    client.setToken(this.token);
    client.customHeaders = { ...this.customHeaders };
    return client;
  }
}
