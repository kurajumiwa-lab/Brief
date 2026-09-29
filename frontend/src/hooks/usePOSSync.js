import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'

/** POS Bridge connections, sync logs and the push/pull actions. */
export function usePOSSync() {
  const [connections, setConnections] = useState([])
  const [logs, setLogs] = useState({})
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/pos/connections')
      setConnections(data)
      return data
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const loadLogs = useCallback(async (connectionId) => {
    const { data } = await api.get(`/pos/sync-logs/${connectionId}`)
    setLogs((prev) => ({ ...prev, [connectionId]: data }))
    return data
  }, [])

  const connect = useCallback(async (payload) => {
    const { data } = await api.post('/pos/connect', payload)
    await load()
    return data
  }, [load])

  const disconnect = useCallback(async (connectionId) => {
    const { data } = await api.delete(`/pos/${connectionId}`)
    await load()
    return data
  }, [load])

  const sync = useCallback(async (connectionId) => {
    const { data } = await api.post(`/pos/${connectionId}/sync`)
    await Promise.all([load(), loadLogs(connectionId)])
    return data
  }, [load, loadLogs])

  const pushCsv = useCallback(async (connectionId, file) => {
    const form = new FormData()
    form.append('file', file)
    const { data } = await api.post(`/pos/${connectionId}/push-csv`, form, { headers: { 'Content-Type': 'multipart/form-data' } })
    await Promise.all([load(), loadLogs(connectionId)])
    return data
  }, [load, loadLogs])

  const pushItems = useCallback(async (connectionId, items) => {
    const { data } = await api.post(`/pos/${connectionId}/push`, { items })
    await Promise.all([load(), loadLogs(connectionId)])
    return data
  }, [load, loadLogs])

  return { connections, logs, loading, load, loadLogs, connect, disconnect, sync, pushCsv, pushItems }
}
