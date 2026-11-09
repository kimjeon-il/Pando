/** Local calendar month for UI follow-now policy only.
 * Actual historical dates, comparisons and month-end semantics stay in C++. */
export const deviceCurrentMonth=(now=new Date())=>
  `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
