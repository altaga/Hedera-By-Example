import React from 'react'

export interface VisualSpec { type: string; [key: string]: any }

/** Structured visuals emitted by labs through show.* (charts, Merkle trees, DAGs…). */
export function Visual ({ spec }: { spec: VisualSpec }) {
  return <pre className='visual-fallback'>{JSON.stringify(spec, null, 2)}</pre>
}
