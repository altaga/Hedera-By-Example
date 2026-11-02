/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * Salida visual para el ejecutor web. En Node.js las funciones visuales no
 * imprimen nada extra (los labs ya imprimen sus resultados como texto); el
 * sitio del curso las dibuja como gráficas, árboles de Merkle, DAGs y
 * cuadrículas de progreso. show.table y show.json imprimen en ambos lados.
 *
 * show.chart({ type: 'bar' | 'stacked' | 'line', title, unit, … })
 * show.merkle({ title, leafCount, leafIndex, root, proof })
 * show.dag({ title, events: [{ id, creator, label, selfParent, otherParent }] })
 * show.shards({ id, title, total, done })
 * show.states({ title, items: [{ label, state: 'good' | 'warning' | 'critical', detail }] })
 */
const visual = () => {}

export const show = {
  table: (rows, columns) => console.table(rows, columns),
  json: (value) => console.log(JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2)),
  chart: visual,
  merkle: visual,
  dag: visual,
  shards: visual,
  states: visual
}
