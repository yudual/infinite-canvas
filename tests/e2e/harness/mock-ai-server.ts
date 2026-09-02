import * as http from 'node:http';

export interface RecordedRequest {
  path: string;
  method: string;
  headers: http.IncomingHttpHeaders;
  body: any;
  timestamp: number;
}

export class MockAiServer {
  private server: http.Server | null = null;
  private port: number;
  private requests: RecordedRequest[] = [];
  private shouldFailNextStatus: number | null = null;
  private failNextMessage: string | null = null;

  constructor(port = 3199) {
    this.port = port;
  }

  public getUrl(): string {
    return `http://127.0.0.1:${this.port}/v1`;
  }

  public getPort(): number {
    return this.port;
  }

  public getRequests(): RecordedRequest[] {
    return [...this.requests];
  }

  public getLastRequest(): RecordedRequest | undefined {
    return this.requests[this.requests.length - 1];
  }

  public getLastAuthHeader(): string | undefined {
    const last = this.getLastRequest();
    return last ? (last.headers['authorization'] as string) : undefined;
  }

  public clearRequests(): void {
    this.requests = [];
  }

  public setNextError(status: number, message = 'Upstream mock error'): void {
    this.shouldFailNextStatus = status;
    this.failNextMessage = message;
  }

  public async start(): Promise<void> {
    if (this.server) return;

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
          const rawBody = Buffer.concat(chunks).toString('utf-8');
          let parsedBody: any = rawBody;
          try {
            parsedBody = JSON.parse(rawBody);
          } catch {
            // Keep as string (e.g. multipart formData or plain text)
          }

          const record: RecordedRequest = {
            path: req.url || '/',
            method: req.method || 'GET',
            headers: req.headers,
            body: parsedBody,
            timestamp: Date.now(),
          };
          this.requests.push(record);

          // Check if an error should be triggered
          if (this.shouldFailNextStatus) {
            const status = this.shouldFailNextStatus;
            const msg = this.failNextMessage || 'Simulated upstream error';
            this.shouldFailNextStatus = null;
            this.failNextMessage = null;

            res.writeHead(status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: msg, type: 'mock_error', code: status } }));
            return;
          }

          const url = req.url || '/';

          // 1. GET /v1/models or GET /models
          if (url.includes('/models') && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                object: 'list',
                data: [
                  { id: 'gpt-image-2', object: 'model', created: 1700000000, owned_by: 'system' },
                  { id: 'dall-e-3', object: 'model', created: 1700000000, owned_by: 'system' },
                  { id: 'gpt-4o', object: 'model', created: 1700000000, owned_by: 'system' },
                  { id: 'gpt-4o-mini', object: 'model', created: 1700000000, owned_by: 'system' },
                ],
              })
            );
            return;
          }

          // 2. POST /v1/images/generations
          if (url.includes('/images/generations') && req.method === 'POST') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                created: Math.floor(Date.now() / 1000),
                data: [
                  {
                    url: `http://127.0.0.1:${this.port}/mock-images/sample-gen-${Date.now()}.png`,
                    b64_json: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
                    revised_prompt: parsedBody?.prompt || 'Generated sample prompt',
                  },
                ],
              })
            );
            return;
          }

          // 3. POST /v1/images/edits
          if (url.includes('/images/edits') && req.method === 'POST') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                created: Math.floor(Date.now() / 1000),
                data: [
                  {
                    url: `http://127.0.0.1:${this.port}/mock-images/edited-${Date.now()}.png`,
                  },
                ],
              })
            );
            return;
          }

          // 4. POST /v1/chat/completions
          if (url.includes('/chat/completions') && req.method === 'POST') {
            const isStream = parsedBody && typeof parsedBody === 'object' && parsedBody.stream === true;

            if (isStream) {
              res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive',
              });

              res.write(
                `data: ${JSON.stringify({
                  id: 'chatcmpl-mock-1',
                  object: 'chat.completion.chunk',
                  created: Math.floor(Date.now() / 1000),
                  model: parsedBody.model || 'gpt-4o',
                  choices: [{ index: 0, delta: { role: 'assistant', content: 'Hello' }, finish_reason: null }],
                })}\n\n`
              );

              res.write(
                `data: ${JSON.stringify({
                  id: 'chatcmpl-mock-1',
                  object: 'chat.completion.chunk',
                  created: Math.floor(Date.now() / 1000),
                  model: parsedBody.model || 'gpt-4o',
                  choices: [{ index: 0, delta: { content: ' from mock AI!' }, finish_reason: 'stop' }],
                })}\n\n`
              );

              res.write('data: [DONE]\n\n');
              res.end();
              return;
            } else {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(
                JSON.stringify({
                  id: 'chatcmpl-mock-static-1',
                  object: 'chat.completion',
                  created: Math.floor(Date.now() / 1000),
                  model: parsedBody?.model || 'gpt-4o',
                  choices: [
                    {
                      index: 0,
                      message: {
                        role: 'assistant',
                        content: 'Mock AI response: Canvas project updated successfully.',
                      },
                      finish_reason: 'stop',
                    },
                  ],
                })
              );
              return;
            }
          }

          // Fallback response for any other route
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', mock: true }));
        });
      });

      this.server.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
          // Port in use, try next port
          this.port += 1;
          this.server?.close();
          this.server = null;
          this.start().then(resolve).catch(reject);
        } else {
          reject(err);
        }
      });

      this.server.listen(this.port, '127.0.0.1', () => {
        resolve();
      });
    });
  }

  public async stop(): Promise<void> {
    if (!this.server) return;
    return new Promise((resolve) => {
      this.server!.close(() => {
        this.server = null;
        resolve();
      });
    });
  }
}
