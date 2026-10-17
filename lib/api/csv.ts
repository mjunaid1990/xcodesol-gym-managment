/** Minimal, RFC 4180 compliant CSV writer (quotes, commas, newlines, BOM for Excel). */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return ''
  const headers = Object.keys(rows[0]!)

  const escape = (value: unknown): string => {
    if (value === null || value === undefined) return ''
    const text = String(value)
    if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`
    return text
  }

  const lines = [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => escape(row[header])).join(',')),
  ]

  return `\uFEFF${lines.join('\r\n')}\r\n`
}

export function csvResponse(filename: string, csv: string): Response {
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
