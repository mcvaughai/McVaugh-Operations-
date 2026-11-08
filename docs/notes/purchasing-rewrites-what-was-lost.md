# What the two purchasing rewrites dropped

Line-by-line comparison of the 3 November and 4 November hubs. Only genuine losses are listed: anything
merely reworded, or moved into another step, is not counted.

## Work Order Entry in BuildConnect (SOP-PUR-01) — 15 steps to 11

### Dropped

| What | Was |
|---|---|
| The navigation | `Open Jobs → correctly routed job → New Work Order in the BuildConnect frame` |
| Why order matters | "Set payment-period count **FIRST — changing it reloads the form**". The new version keeps "first" but drops the reason, so it reads as preference rather than a trap |
| How you submit | "Submit using the **passcode-box Enter step** within current authorization; **keep passcode private**" |
| A flag default | "Leave **completion/payment flags unset** for new work" |
| A stop rule | "If verification inconclusive, stop and report uncertainty — **never create a duplicate**" |
| A known bug and its workaround | "**Calendar selections have sometimes failed to persist** — if the date does not apply, report requested vs saved date and preserve the existing record." The new version says only that date persistence "remains open" |
| Three vendor rules | Synergy roofing 30/50/20 draws · Electrical Works change orders at code 620 · Reece plumbing fixtures at 601, split valves and trims. These still exist in the vendor-rules panel, but are no longer in the procedure you follow |

### Gained

"A source document alone is not spending approval." · "Do not substitute the bill-to address." · "Do not
sign for vendors or infer field acceptance." · The ten-minute turnaround is "discussed, not a universal
SLA." · WO 40186 flagged as an open correction.

## Material Purchase Order Entry (SOP-PUR-02) — 15 steps to 8

### Dropped

| What | Was |
|---|---|
| The navigation | `Select Jobs → correct job → New Purchase Order` |
| A cost code | **996 for Lowe's / Home Depot**. 601 for plumbing fixtures survives; 996 does not |
| A draw rule | "Use a **single draw for standalone quotes**" |
| Two data-entry steps | "**Separate merchandise from tax** where applicable" and "**verify form recalculation after blur**" |
| The date rule | "Use the **proposal date** for proposal-based orders, the **invoice date** for invoices." Survives in the work-order SOP, not here |
| A verification field | Confirm the **cost code** on the saved PO. The new version checks ID, job, vendor, total and dates, but not the code |
| A status distinction | "**Complete is separate from Received / Pay / Paid In Full**." The new version only warns not to apply Lowe's rule everywhere, so the general distinction is gone |
| An open governance question | "Material PO procedure **owner and backup to be confirmed**; **approval boundary for spending authority to be established**." Dropped entirely rather than answered |

### Gained

"Verify current recipients rather than automatically copying Maria after transition." · "Reported WO
portal notifications do not establish PO delivery." · "Extra lumber before 9 AM may catch a same-day
truck; do not promise a truck without confirmation." · The water-heater single draw is "a historical
example, not every quote default."

## Reading this fairly

The rewrites are not careless. Almost everything added is a correction to an over-generalisation, and
several are things only someone reviewing the evidence would catch — not copying Maria after she leaves,
not treating a portal notification as proof of delivery.

What they consistently removed is the mechanics: which menu, which button, which field, what happens if
you do it in the wrong order. That is exactly the knowledge a new person needs and an experienced one
does not notice using.

**So merge.** Keep the dropped rows above as the body of each procedure and fold the new caveats around
them. The one that matters most is the last row of the material PO table: who owns that procedure and
what someone is allowed to spend without asking was an open question, and dropping the question does not
answer it.
