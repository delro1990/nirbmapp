// Sample data only – replace with your agency's actual fund source / UACS codes.
export function seedSample() {
  const M = 1e6;
  const funds = [
    ['01101101', 'Regular Agency Fund – Current Year GAA (sample)'],
    ['01101102', 'Regular Agency Fund – Continuing Appropriations (sample)'],
    ['02101101', 'Foreign-Assisted Projects – Loan/Grant (sample)']
  ].map(([code, name]) => ({ code, name }));
  const recs = [
    ['01101101', '5010101001', 'Salaries and Wages – Regular', 'PS', 'General Administration and Support', 'Central Office', 480 * M, 455 * M, 450 * M, '2026-01-15'],
    ['01101101', '5020101000', 'Traveling Expenses – Local', 'MOOE', 'Public Health Programs', 'Central Office', 60 * M, 41 * M, 35 * M, '2026-02-20'],
    ['01101101', '5020201000', 'Training Expenses', 'MOOE', 'Public Health Programs', 'Regional Office 02', 25 * M, 14.5 * M, 9 * M, '2026-03-18'],
    ['01101101', '5020301001', 'Office Supplies Expenses', 'MOOE', 'General Administration and Support', 'Regional Office 02', 8 * M, 7.6 * M, 7 * M, '2026-04-10'],
    ['01101101', '1060400000', 'Machinery and Equipment', 'CO', 'Health Facilities Enhancement', 'Central Office', 320 * M, 150 * M, 62 * M, '2026-05-22'],
    ['01101102', '1060100000', 'Buildings and Other Structures', 'CO', 'Health Facilities Enhancement', 'Regional Office 02', 210 * M, 120 * M, 80 * M, '2026-07-08'],
    ['01101102', '5020399000', 'Other Supplies and Materials Expenses', 'MOOE', 'Public Health Programs', 'Central Office', 45 * M, 41 * M, 40 * M, '2026-08-14'],
    ['02101101', '5021199000', 'Other Professional Services', 'MOOE', 'Foreign-Assisted Project', 'Central Office', 90 * M, 30 * M, 12 * M, '2026-10-05']
  ].map((r, i) => ({ id: Date.now() + i, fund: r[0], uacs: r[1], desc: r[2], cls: r[3], pap: r[4], office: r[5], allot: r[6], oblig: r[7], disb: r[8], date: r[9] }));
  return { funds, recs };
}
