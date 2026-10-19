/** Reuse SVG text spans across camera frames and share multilingual typography. */
export function renderLabelText(text, rows, {x = 7} = {}) {
  // Several native names can share a language, so identity is the row position.
  const spans=text.selectAll('tspan').data(rows,(_row,index)=>index);
  spans.exit().remove();spans.enter().append('tspan');
  text.selectAll('tspan').attr('x',x)
    .attr('dy',(_row,index)=>index===0?String(0.35-(rows.length-1)*0.72)+'em':'1.32em')
    .attr('class',(_row,index)=>index===0?'user-label-primary':'user-label-secondary')
    .text(row=>row.text);
}
