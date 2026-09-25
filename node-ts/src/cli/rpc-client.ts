export class RpcClient {
  constructor(
    private readonly base: string,
    private id = 0,
  ) {}

  async call<T = unknown>(method: string, params?: unknown): Promise<T> {
    const res = await fetch(this.base, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: this.id++, method, params: params ?? {} }),
    })
    const body = (await res.json()) as { result?: T; error?: { message: string } }
    if (body.error) throw new Error(body.error.message)
    return body.result as T
  }

  async post<T = unknown>(path: string, body: Record<string, unknown>, params?: string): Promise<T> {
    const url = `${this.base}${path.startsWith('/') ? path : '/' + path}${params ? '?' + params : ''}`
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = (await r.json()) as (T & { error?: string }) | { error?: string }
    if ('error' in (json as object) && json?.error) throw new Error(json.error)
    return json as T
  }
}