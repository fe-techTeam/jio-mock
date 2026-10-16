import { getDb } from '@/lib/db'
import { apiError, withApi } from '@/lib/queries/http'
import { actorOf, readJson, validationFailed } from '../_lib/request'
import { HttpError, listConfigTopics, patchSeedTopic } from '../_lib/topics'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withApi(async () => listConfigTopics(getDb().sql), { cacheControl: 'no-store' })

const isStr = (v: unknown): v is string => typeof v === 'string'

export const PATCH = withApi(
  async (req: Request) => {
    const body = await readJson(req)
    if (body instanceof Response) return body
    if (!isStr(body.slug) || !body.slug) {
      return validationFailed([{ path: 'slug', message: 'slug is required' }])
    }
    if (body.name !== undefined && !isStr(body.name)) {
      return validationFailed([{ path: 'name', message: 'name must be a string' }])
    }
    if (body.description !== undefined && !isStr(body.description)) {
      return validationFailed([{ path: 'description', message: 'description must be a string' }])
    }
    if (
      body.examplePhrases !== undefined &&
      !(Array.isArray(body.examplePhrases) && body.examplePhrases.every(isStr))
    ) {
      return validationFailed([{ path: 'examplePhrases', message: 'must be an array of strings' }])
    }
    try {
      await patchSeedTopic(
        getDb().sql,
        {
          slug: body.slug,
          name: body.name as string | undefined,
          description: body.description as string | undefined,
          examplePhrases: body.examplePhrases as string[] | undefined,
        },
        await actorOf(req),
      )
    } catch (err) {
      if (err instanceof HttpError) return apiError(err.status, err.message)
      throw err
    }
    return { ok: true }
  },
  { cacheControl: 'no-store' },
)
