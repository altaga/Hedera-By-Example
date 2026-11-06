/**
 * Visual output for the web runner. In Node.js the visual helpers print
 * nothing extra (the labs already print their results as text); the course
 * website draws them as charts, Merkle trees, DAGs and progress grids.
 * show.table and show.json print to the console in both places.
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
