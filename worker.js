export default {
    async fetch(request, env) {
      const url = new URL(request.url)
  
      const allowedOrigin = env.ALLOWED_ORIGIN || '*'
  
      // Preflight CORS
      if (request.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders(allowedOrigin) })
      }
  
      try {
        if (url.pathname === '/api/scenario' && request.method === 'POST') {
          const scenario = await generateScenario(env)
          return json({ scenario }, 200, allowedOrigin)
        }
  
        if (url.pathname === '/api/evaluate' && request.method === 'POST') {
          const { scenario, userResponse } = await safeJson(request)
          if (!scenario || !userResponse) {
            return json({ error: 'Missing scenario or userResponse' }, 400, allowedOrigin)
          }
  
          const evaluation = await evaluateResponse(env, scenario, userResponse)
          return json(evaluation, 200, allowedOrigin)
        }
  
        return json({ error: 'Not found' }, 404, allowedOrigin)
      } catch (err) {
        return json(
          { error: 'Server error', detail: String(err?.message || err) },
          500,
          allowedOrigin
        )
      }
    },
  }
  
  function corsHeaders(origin) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }
  }
  
  function json(obj, status = 200, origin = '*') {
    return new Response(JSON.stringify(obj, null, 2), {
      status,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders(origin),
      },
    })
  }
  
  async function safeJson(request) {
    try {
      return await request.json()
    } catch {
      return {}
    }
  }
  
  /**
   * OpenAI Responses API helper.
   * Uses JSON Schema structured output when schema is provided.
   */
  async function openaiResponses(env, input, schema) {
    if (!env.OPENAI_API_KEY) throw new Error('Missing env.OPENAI_API_KEY')
  
    const body = {
      model: 'gpt-4.1-mini',
      input,
    }
  
    if (schema) {
      body.text = {
        format: {
          type: 'json_schema',
          name: 'evaluation',
          schema,
          strict: true,
        },
      }
    }
  
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      throw new Error(`OpenAI error ${res.status}: ${t}`)
    }
  
    const data = await res.json()
  
    // Responses API provides a convenience field:
    // - data.output_text (typical for plain text)
    return data.output_text || ''
  }
  
  async function generateScenario(env) {
    const input = [
      {
        role: 'system',
        content:
          'Eres un simulador clínico de conversaciones para entrenar comunicación interpersonal. Escribe en español, natural, realista.',
      },
      {
        role: 'user',
        content:
          'Genera: "Una situación dentro de un hospital sobre un chisme o una cosa parecida". ' +
          'Debe ser breve (80-140 palabras), realista, y terminar con una frase que invite a responder. ' +
          'No uses nombres reales. No incluyas contenido sexual explícito.',
      },
    ]
  
    return await openaiResponses(env, input)
  }
  
  async function evaluateResponse(env, scenario, userResponse) {
    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        score: { type: 'integer', minimum: 1, maximum: 100 },
        breakdown: {
          type: 'object',
          additionalProperties: false,
          properties: {
            tacto: { type: 'integer', minimum: 1, maximum: 100 },
            calidez: { type: 'integer', minimum: 1, maximum: 100 },
            elementos: { type: 'integer', minimum: 1, maximum: 100 },
          },
          required: ['tacto', 'calidez', 'elementos'],
        },
        feedback: { type: 'string' },
      },
      required: ['score', 'breakdown', 'feedback'],
    }
  
    const input = [
      {
        role: 'system',
        content:
          'Evalúas una respuesta del usuario ante un rumor/chisme en un hospital. ' +
          'Devuelve SOLO un JSON válido según el esquema. ' +
          'Criterios: tacto (respeto, no avivar rumor), calidez (empatía), elementos comunicativos (escucha, claridad, validación, límites, confidencialidad). ' +
          'Incluye 2-3 mejoras concretas y una versión alternativa breve de respuesta (1-2 frases) dentro de "feedback".',
      },
      {
        role: 'user',
        content: `Situación:\n${scenario}\n\nRespuesta del usuario:\n${userResponse}`,
      },
    ]
  
    const text = await openaiResponses(env, input, schema)
    return JSON.parse(text)
  }