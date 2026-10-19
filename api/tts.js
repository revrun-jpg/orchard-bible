import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

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
const MAX_TEXT_LENGTH = 5000

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed.' })
  }

  const { text, voiceId, modelId = 'eleven_multilingual_v2' } = req.body ?? {}
  if (
    typeof text !== 'string'
    || !text.trim()
    || text.length > MAX_TEXT_LENGTH
    || !ALLOWED_VOICES.has(voiceId)
    || !ALLOWED_MODELS.has(modelId)
  ) {
    return res.status(400).json({ error: 'Invalid text, voice, or model.' })
  }

  const apiKey = globalThis.process.env.ELEVENLABS_API_KEY
  if (!apiKey) {
    console.error('ELEVENLABS_API_KEY is not configured.')
    return res.status(500).json({ error: 'Audio service is not configured.' })
  }

  let elevenLabsResponse
  try {
    elevenLabsResponse = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
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
      },
    )
  } catch (error) {
    console.error('Unable to reach ElevenLabs.', error)
    return res.status(502).json({ error: 'Unable to reach the audio service.' })
  }

  if (!elevenLabsResponse.ok) {
    console.error(`ElevenLabs returned status ${elevenLabsResponse.status}.`)
    return res.status(elevenLabsResponse.status).json({ error: 'Audio generation failed.' })
  }

  if (!elevenLabsResponse.body) {
    console.error('ElevenLabs returned an empty audio response.')
    return res.status(502).json({ error: 'Audio generation returned no audio.' })
  }

  res.setHeader('Content-Type', elevenLabsResponse.headers.get('content-type') || 'audio/mpeg')
  res.setHeader('Cache-Control', 'no-store')
  res.status(200)

  try {
    await pipeline(Readable.fromWeb(elevenLabsResponse.body), res)
  } catch (error) {
    console.error('Unable to stream audio to the client.', error)
    if (!res.headersSent) {
      res.status(502).json({ error: 'Unable to stream generated audio.' })
    } else {
      res.destroy(error)
    }
  }
}
