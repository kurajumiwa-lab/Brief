import { useEffect, useRef, useState } from 'react'
import { roomSocketUrl } from '../lib/api'

/**
 * Receive-only socket for a chat room. Messages are sent over HTTP; the
 * socket delivers everyone's broadcasts. Reconnects with backoff unless the
 * server closed us on purpose (4401 bad token, 4403 not a participant, 4404
 * no such room).
 */
export function useWebSocket(roomId, token, onMessage) {
  const [status, setStatus] = useState('idle') // idle | connecting | open | closed | refused
  const [closeReason, setCloseReason] = useState(null)
  const handlerRef = useRef(onMessage)
  handlerRef.current = onMessage

  useEffect(() => {
    if (!roomId || !token) { setStatus('idle'); return undefined }
    let ws
    let attempts = 0
    let timer
    let stopped = false

    const connect = () => {
      setStatus('connecting')
      ws = new WebSocket(roomSocketUrl(roomId, token))
      ws.onopen = () => { attempts = 0; setStatus('open'); setCloseReason(null) }
      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data)
          if (data.type === 'message' && handlerRef.current) handlerRef.current(data.message)
        } catch { /* ignore non-JSON frames */ }
      }
      ws.onclose = (ev) => {
        if (stopped) return
        if ([4401, 4403, 4404].includes(ev.code)) {
          setStatus('refused')
          setCloseReason(ev.reason || `closed (${ev.code})`)
          return
        }
        setStatus('closed')
        attempts += 1
        timer = setTimeout(connect, Math.min(15000, 1000 * 2 ** Math.min(attempts, 4)))
      }
      ws.onerror = () => { /* onclose follows */ }
    }
    connect()

    const ping = setInterval(() => { if (ws?.readyState === WebSocket.OPEN) ws.send('ping') }, 25000)
    return () => {
      stopped = true
      clearInterval(ping)
      clearTimeout(timer)
      if (ws) ws.close()
    }
  }, [roomId, token])

  return { status, closeReason }
}
