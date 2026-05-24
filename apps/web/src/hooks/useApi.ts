import { useState, useEffect, useCallback } from 'react'

export function useFetch<T>(url: string | null, interval?: number) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refetch = useCallback(async () => {
    if (!url) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setData(json as T)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fetch failed')
    } finally {
      setLoading(false)
    }
  }, [url])

  useEffect(() => {
    refetch()
  }, [refetch])

  useEffect(() => {
    if (!interval || !url) return
    const id = setInterval(refetch, interval)
    return () => clearInterval(id)
  }, [interval, refetch, url])

  return { data, loading, error, refetch }
}
