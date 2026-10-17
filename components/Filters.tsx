'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
import { Button, inputClass, selectClass } from '@/components/ui'

export interface FilterField {
  name: string
  label: string
  type?: 'search' | 'select' | 'date'
  options?: { value: string; label: string }[]
  placeholder?: string
}

/**
 * Filters live in the URL, so every view is shareable/bookmarkable and the server
 * component can do the query (no client-side data fetching, no loading spinner).
 */
export function Filters({ fields, className }: { fields: FilterField[]; className?: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const [values, setValues] = useState<Record<string, string>>({})

  useEffect(() => {
    const next: Record<string, string> = {}
    for (const field of fields) next[field.name] = searchParams.get(field.name) ?? ''
    setValues(next)
  }, [searchParams, fields])

  function apply(next: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value)
      else params.delete(key)
    }
    params.delete('page')
    startTransition(() => router.push(`${pathname}?${params.toString()}`))
  }

  const hasFilters = Array.from(searchParams.keys()).some((key) => key !== 'page')

  return (
    <form
      className={className ?? 'card flex flex-wrap items-end gap-3 p-4'}
      onSubmit={(event) => {
        event.preventDefault()
        apply(values)
      }}
      role="search"
    >
      {fields.map((field) => (
        <label key={field.name} className="flex min-w-[10rem] flex-1 flex-col gap-1.5">
          <span className="text-xs font-medium text-ink-300">{field.label}</span>
          {field.type === 'select' ? (
            <select
              className={selectClass}
              value={values[field.name] ?? ''}
              onChange={(event) => {
                const next = { ...values, [field.name]: event.target.value }
                setValues(next)
                apply(next)
              }}
            >
              <option value="">All</option>
              {field.options?.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              className={inputClass}
              type={field.type === 'date' ? 'date' : 'search'}
              placeholder={field.placeholder}
              value={values[field.name] ?? ''}
              onChange={(event) => setValues({ ...values, [field.name]: event.target.value })}
            />
          )}
        </label>
      ))}

      <div className="flex items-center gap-2">
        <Button type="submit" variant="secondary" disabled={isPending}>
          {isPending ? 'Filtering…' : 'Apply'}
        </Button>
        {hasFilters ? (
          <Button variant="ghost" onClick={() => startTransition(() => router.push(pathname))}>
            Clear
          </Button>
        ) : null}
      </div>
    </form>
  )
}
