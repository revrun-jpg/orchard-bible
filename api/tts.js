import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import process from 'node:process'

const ALLOWED_VOICES = new Set([
  'auq43ws1oslv0tO4BDa7',
  'GoGUcAZovo4MFeLxJdZd',
  'TYKLc7ViOIGE13dSZYlK',
  'G4Wh6MqJNTzYtuAeMqv5',
])
const ALLOWED_MODELS = new Set([
  'eleven_multilingual_v2',
  'eleven_flash_v2_5',
])
const MAX_CHUNK_LENGTH = 5000
const MAX_TEXT_LENGTH = 20000

function splitTextIntoChunks(text) {
  const chunks = []
  let remaining = text.trim()

  while (remaining.length > MAX_CHUNK_LENGTH) {
    const lastAllowedIndex = MAX_CHUNK_LENGTH - 1
    const searchFrom = remaining.lastIndexOf(' ', lastAllowedIndex)
    const sentenceBreaks = [
      remaining.lastIndexOf('. ', lastAllowedIndex),
      remaining.lastIndexOf('? ', lastAllowedIndex),
      remaining.lastIndexOf('! ', lastAllowedIndex),
      remaining.lastIndexOf('\n', lastAllowedIndex),
    ]
    const sentenceBreak = Math.max(...sentenceBreaks)
    const splitAt = sentenceBreak >= MAX_CHUNK_LENGTH * 0.75
      ? sentenceBreak + 1
      : searchFrom > 0
        ? searchFrom
        : MAX_CHUNK_LENGTH

    chunks.push(remaining.slice(0, splitAt).trim())
    remaining = remaining.slice(splitAt).trim()
  }

  if (remaining) chunks.push(remaining)
  return chunks
}

function requestAudioChunk(text, voiceId, modelId, apiKey) {
  return fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  })
}

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

function getSafeErrorMessage(error, apiKey) {
  const message = error instanceof Error ? error.message : String(error)
  return message
    .replaceAll(apiKey, '[redacted]')
    .slice(0, 500)
}

async function getProviderErrorMessage(response, apiKey) {
  const responseText = await response.text()
  let message = responseText

  try {
    const body = JSON.parse(responseText)
    const detail = body?.detail
    message = typeof detail === 'string'
      ? detail
      : detail?.message || body?.message || body?.error || responseText
  } catch {
    // Preserve a non-JSON provider response as the diagnostic message.
  }

  return getSafeErrorMessage(message, apiKey)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return sendJson(res, 405, { error: 'Method not allowed.' })
  }

  const { text, voiceId, modelId = 'eleven_multilingual_v2' } = req.body ?? {}
  if (
    typeof text !== 'string'
    || !text.trim()
    || text.length > MAX_TEXT_LENGTH
    || !ALLOWED_VOICES.has(voiceId)
    || !ALLOWED_MODELS.has(modelId)
  ) {
    return sendJson(res, 400, { error: 'Invalid text, voice, or model.' })
  }

  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) {
    console.error('ELEVENLABS_API_KEY is not configured.')
    return sendJson(res, 500, { error: 'Audio service is not configured.' })
  }

  const textChunks = splitTextIntoChunks(text)
  let firstResponse
  try {
    firstResponse = await requestAudioChunk(textChunks[0], voiceId, modelId, apiKey)
  } catch (error) {
    const message = getSafeErrorMessage(error, apiKey)
    console.error('Unable to reach ElevenLabs.', message)
    return sendJson(res, 502, { error: `Unable to reach ElevenLabs: ${message}` })
  }

  if (!firstResponse.ok) {
    const message = await getProviderErrorMessage(firstResponse, apiKey)
    console.error(`ElevenLabs returned status ${firstResponse.status}: ${message}`)
    return sendJson(res, firstResponse.status, {
      error: `ElevenLabs returned ${firstResponse.status}: ${message}`,
    })
  }

  if (!firstResponse.body) {
    console.error('ElevenLabs returned an empty audio response.')
    return sendJson(res, 502, { error: 'Audio generation returned no audio.' })
  }

  res.setHeader('Content-Type', firstResponse.headers.get('content-type') || 'audio/mpeg')
  res.setHeader('Cache-Control', 'no-store')
  res.statusCode = 200

  try {
    async function* streamAudio() {
      yield* Readable.fromWeb(firstResponse.body)
      for (const textChunk of textChunks.slice(1)) {
        const response = await requestAudioChunk(textChunk, voiceId, modelId, apiKey)
        if (!response.ok || !response.body) {
          const message = response.body
            ? await getProviderErrorMessage(response, apiKey)
            : 'The provider returned an empty audio response.'
          console.error(`ElevenLabs returned status ${response.status} for a subsequent audio chunk: ${message}`)
          throw new Error(`ElevenLabs returned ${response.status} for a subsequent audio chunk: ${message}`)
        }
        yield* Readable.fromWeb(response.body)
      }
    }

    await pipeline(Readable.from(streamAudio()), res)
  } catch (error) {
    const message = getSafeErrorMessage(error, apiKey)
    console.error('Unable to stream audio to the client.', message)
    if (!res.headersSent) {
      sendJson(res, 502, { error: `Unable to stream generated audio: ${message}` })
    } else {
      res.destroy(error)
    }
  }
}
