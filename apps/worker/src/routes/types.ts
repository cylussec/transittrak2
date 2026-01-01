import type { Context, Hono } from 'hono'

type ApiBindings = { Bindings: Env }

export type Api = Hono<ApiBindings>

export type ApiContext = Context<ApiBindings>
