// Delivery targets by name, those normalize() aims at and check() holds a take to: each one's integrated loudness (LUFS,
// ITU-R BS.1770), and the names they also go by. Their rules and sources, and the specs that have no single target (acx,
// netflix), are fn/check.js's. Imports nothing, registers nothing: importing it loads no op.
export const LOUDNESS = { podcast: -16, spotify: -14, broadcast: -23 }
export const ALIAS = { apple: 'podcast', ebu: 'broadcast', streaming: 'spotify' }
export const specOf = name => ALIAS[name] ?? name
