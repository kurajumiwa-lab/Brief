import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'

/**
 * Stock room state: my shelves, the network's shelves, and movements.
 * Every mutating call refreshes the slices it touches.
 */
export function useStock({ auto = true } = {}) {
  const [myStock, setMyStock] = useState([])
  const [networkStock, setNetworkStock] = useState([])
  const [movements, setMovements] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const loadMine = useCallback(async (params = {}) => {
    const { data } = await api.get('/stock/my-stock', { params })
    setMyStock(data)
    return data
  }, [])

  const loadNetwork = useCallback(async (params = {}) => {
    const { data } = await api.get('/stock/network-stock', { params })
    setNetworkStock(data)
    return data
  }, [])

  const loadMovements = useCallback(async (params = {}) => {
    const { data } = await api.get('/stock/movements', { params })
    setMovements(data)
    return data
  }, [])

  const loadCategories = useCallback(async () => {
    const { data } = await api.get('/stock/categories')
    setCategories(data.categories || [])
    return data
  }, [])

  const refreshAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      await Promise.all([loadMine(), loadNetwork(), loadMovements(), loadCategories()])
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }, [loadMine, loadNetwork, loadMovements, loadCategories])

  useEffect(() => { if (auto) refreshAll() }, [auto, refreshAll])

  const addStock = useCallback(async (payload) => {
    const { data } = await api.post('/stock/add', payload)
    await Promise.all([loadMine(), loadCategories()])
    return data
  }, [loadMine, loadCategories])

  const updateStock = useCallback(async (id, payload) => {
    const { data } = await api.put(`/stock/${id}`, payload)
    await loadMine()
    return data
  }, [loadMine])

  const removeStock = useCallback(async (id) => {
    const { data } = await api.delete(`/stock/${id}`)
    await loadMine()
    return data
  }, [loadMine])

  const bulkImport = useCallback(async (file) => {
    const form = new FormData()
    form.append('file', file)
    const { data } = await api.post('/stock/bulk-import', form, { headers: { 'Content-Type': 'multipart/form-data' } })
    await Promise.all([loadMine(), loadCategories()])
    return data
  }, [loadMine, loadCategories])

  const source = useCallback(async (stockId, payload) => {
    const { data } = await api.post(`/stock/${stockId}/source`, payload)
    await Promise.all([loadNetwork(), loadMovements()])
    return data
  }, [loadNetwork, loadMovements])

  const advance = useCallback(async (movementId, action) => {
    const { data } = await api.post(`/stock/movements/${movementId}/${action}`)
    await Promise.all([loadMine(), loadNetwork(), loadMovements()])
    return data
  }, [loadMine, loadNetwork, loadMovements])

  return {
    myStock, networkStock, movements, categories, loading, error,
    loadMine, loadNetwork, loadMovements, loadCategories, refreshAll,
    addStock, updateStock, removeStock, bulkImport, source, advance,
  }
}
