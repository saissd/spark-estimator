/* ============================================================
 * data.js — the single source of truth for the catalog.
 *
 * CATALOG  : every line item from Pricing List.csv, keyed by id.
 * GROUPS   : the 19 required collapsible groups + room-only groups,
 *            each listing the item ids it contains.
 * ROOM_TYPES: which groups make up each room type. Rooms are added
 *            as instances at runtime (Bathroom 1, Bedroom 2, ...).
 * SECTIONS : the five fixed top-level sections for the brief's
 *            "75+ items in 5 sections / 19 groups" requirement.
 *
 * Prices here are DEFAULTS only. The live price list lives in
 * storage (see store.js) seeded from this file on first run, so
 * agents can edit standard pricing globally.
 * ============================================================ */

(function () {
// ---- Raw catalog: id -> { name, cost, unit }. Verbatim from the CSV. ----
const CATALOG_SEED = [
  // Interior / General  (ig-)
  { id: 'ig-01', name: 'Refinish Hardwood Floor', cost: 2.35, unit: 'sqft' },
  { id: 'ig-02', name: 'New Hardwoods 1.5"', cost: 10.0, unit: 'sqft' },
  { id: 'ig-03', name: 'New Hardwoods 2"', cost: 4.75, unit: 'sqft' },
  { id: 'ig-04', name: 'Hardwood Splicing', cost: 8.4, unit: 'sqft' },
  { id: 'ig-05', name: 'Vinyl Plank', cost: 2.5, unit: 'sqft' },
  { id: 'ig-06', name: 'Carpet', cost: 1.9, unit: 'sqft' },
  { id: 'ig-07', name: 'Interior Paint — 2 Tone', cost: 2.95, unit: 'sqft' },
  { id: 'ig-08', name: 'Drywall Repair', cost: 900.0, unit: '1,000 sqft' },
  { id: 'ig-09', name: 'Wallpaper Removal', cost: 250.0, unit: 'room' },
  { id: 'ig-10', name: 'Interior Door — Hollow Slab', cost: 125.0, unit: 'ea.' },
  { id: 'ig-11', name: 'Interior Door Hardware (Knob + Hinges + Labor)', cost: 25.0, unit: 'ea.' },
  { id: 'ig-12', name: 'Bifold Door with Framing', cost: 400.0, unit: 'ea.' },
  { id: 'ig-13', name: 'Interior Door — Pre-hung', cost: 200.0, unit: 'ea.' },
  { id: 'ig-14', name: 'Front Entry Door', cost: 475.0, unit: 'ea.' },
  { id: 'ig-15', name: 'Front Entry Door Hardware', cost: 80.0, unit: 'ea.' },
  { id: 'ig-16', name: 'Exterior Door Hardware', cost: 75.0, unit: 'handle' },
  { id: 'ig-17', name: 'Exterior Insulated Side Door (Installed)', cost: 500.0, unit: 'ea.' },
  { id: 'ig-18', name: 'Sliding Glass Door', cost: 1025.0, unit: 'ea.' },
  { id: 'ig-19', name: 'Trim Out (Casing, Crown, Baseboard)', cost: 3.75, unit: 'LF' },
  { id: 'ig-20', name: 'MISC / Punch List', cost: 2650.0, unit: 'flat' },
  { id: 'ig-21', name: 'Finish Out Labor', cost: 1350.0, unit: 'flat' },
  { id: 'ig-22', name: 'Light Fixtures', cost: 70.0, unit: '100 sqft' },
  { id: 'ig-23', name: 'Bedbug Spray / Heat Treat', cost: 475.0, unit: 'ea.' },
  { id: 'ig-24', name: 'Termite Treatment', cost: 650.0, unit: 'ea.' },
  { id: 'ig-25', name: 'Demo', cost: 1375.0, unit: 'variable' },
  { id: 'ig-26', name: 'Haul Off', cost: 725.0, unit: 'load' },
  { id: 'ig-27', name: 'Final Cleaning', cost: 325.0, unit: 'flat' },
  { id: 'ig-28', name: 'Staging', cost: 0.9, unit: 'sqft' },
  // Kitchen  (kt-)
  { id: 'kt-01', name: 'Hinges and Pulls', cost: 275.0, unit: 'kitchen' },
  { id: 'kt-02', name: 'Cabinets Uppers', cost: 125.0, unit: 'LF' },
  { id: 'kt-03', name: 'Cabinets Lowers', cost: 150.0, unit: 'LF' },
  { id: 'kt-04', name: 'Cabinet Door Faces Only', cost: 80.0, unit: 'door' },
  { id: 'kt-05', name: 'Cabinets (Labor & Paint)', cost: 1100.0, unit: 'kitchen' },
  { id: 'kt-06', name: 'Granite + 4" Splash Guard', cost: 40.0, unit: 'LF' },
  { id: 'kt-07', name: 'Backsplash', cost: 725.0, unit: 'house' },
  { id: 'kt-08', name: 'Misc Woodwork', cost: 500.0, unit: 'variable' },
  { id: 'kt-09', name: 'Tile — Large Areas', cost: 6.45, unit: 'sqft' },
  { id: 'kt-10', name: 'Tile — Small Areas', cost: 10.0, unit: 'sqft' },
  { id: 'kt-11', name: 'Undermount Kitchen Sink', cost: 325.0, unit: 'ea.' },
  { id: 'kt-12', name: 'Microwave / Hood', cost: 500.0, unit: 'ea.' },
  { id: 'kt-13', name: 'Range', cost: 725.0, unit: 'ea.' },
  { id: 'kt-14', name: 'Wall Oven', cost: 1075.0, unit: 'ea.' },
  { id: 'kt-15', name: 'Cooktop', cost: 550.0, unit: 'ea.' },
  { id: 'kt-16', name: 'Dishwasher', cost: 575.0, unit: 'ea.' },
  { id: 'kt-17', name: 'Fridge', cost: 1175.0, unit: 'ea.' },
  // Bathroom  (ba-)
  { id: 'ba-01', name: 'Granite ($/LF)', cost: 35.0, unit: 'LF' },
  { id: 'ba-02', name: 'New Bottom Vanity', cost: 125.0, unit: 'LF' },
  { id: 'ba-03', name: 'Home Depot Vanity w/ Sink (18")', cost: 225.0, unit: 'ea.' },
  { id: 'ba-04', name: 'Toilet', cost: 150.0, unit: 'ea.' },
  { id: 'ba-05', name: 'Tile — Large Areas', cost: 5.8, unit: 'sqft' },
  { id: 'ba-06', name: 'Tile — Small Areas', cost: 10.0, unit: 'sqft' },
  { id: 'ba-07', name: 'Reglaze Tub or Chemical Clean', cost: 350.0, unit: 'ea.' },
  { id: 'ba-08', name: 'Reglaze Tub + Surround', cost: 750.0, unit: 'ea.' },
  { id: 'ba-09', name: 'Reglaze Shower', cost: 1325.0, unit: 'ea.' },
  { id: 'ba-10', name: 'Tiled Shower Tear Out + Tile Install', cost: 3100.0, unit: 'ea.' },
  { id: 'ba-11', name: 'Tub Tile Surround Tear Out + Tile Install (incl. tub)', cost: 2250.0, unit: 'ea.' },
  { id: 'ba-12', name: 'Shower Plastic Insert Tear Out + New Insert', cost: 825.0, unit: 'ea.' },
  { id: 'ba-13', name: 'Tub Tear Out + New Insert & Tub', cost: 1575.0, unit: 'ea.' },
  { id: 'ba-14', name: 'Undermount Sink', cost: 150.0, unit: 'ea.' },
  { id: 'ba-15', name: 'Mirror', cost: 200.0, unit: 'ea.' },
  { id: 'ba-16', name: 'HVL (needed if no window)', cost: 275.0, unit: 'ea.' },
  // Appliances / Systems & Structure  (as-)
  { id: 'as-01', name: 'Furnace', cost: 3350.0, unit: 'ea.', serial: true },
  { id: 'as-02', name: 'Condensing Unit', cost: 3300.0, unit: 'ea.', serial: true },
  { id: 'as-03', name: 'Package Unit', cost: 4700.0, unit: 'ea.', serial: true },
  { id: 'as-04', name: 'A-Coil (if no condensing unit)', cost: 1625.0, unit: 'ea.' },
  { id: 'as-05', name: 'Ducting (if NO HVAC)', cost: 3200.0, unit: 'ea.' },
  { id: 'as-06', name: 'Duct Cleaning — Floor Vents', cost: 550.0, unit: 'ea.' },
  { id: 'as-07', name: 'Window Unit Replacement 220', cost: 575.0, unit: 'ea.' },
  { id: 'as-08', name: 'Hot Water Heater w/ Expansion Tank', cost: 1425.0, unit: 'ea.', serial: true },
  { id: 'as-09', name: 'Hot Water Heater Expansion Tank Only', cost: 200.0, unit: 'ea.' },
  { id: 'as-10', name: 'Switches / Outlets', cost: 1400.0, unit: 'house' },
  { id: 'as-11', name: 'Standard Electrical', cost: 1650.0, unit: 'house' },
  { id: 'as-12', name: 'Subfloor', cost: 8.2, unit: 'sqft' },
  { id: 'as-13', name: 'Framing', cost: 950.0, unit: 'variable' },
  { id: 'as-14', name: 'Structural (Pier)', cost: 375.0, unit: 'pier' },
  { id: 'as-15', name: 'Structural Foam Injection', cost: 5.85, unit: 'sqft of affected area' },
  { id: 'as-16', name: 'Roof', cost: 1100.0, unit: '225 sqft L&M' },
  { id: 'as-17', name: 'Plumbing', cost: 1000.0, unit: 'variable' },
  { id: 'as-18', name: 'Electrical Panel Swap to 200A', cost: 2350.0, unit: 'ea.' },
  { id: 'as-19', name: 'Full Electrical Rewire (to Studs)', cost: 5.65, unit: 'sqft' },
  { id: 'as-20', name: 'Full Electrical Rewire (leaving Drywall)', cost: 9.15, unit: 'sqft' },
  { id: 'as-21', name: 'Wall Insulation (to Studs)', cost: 1.2, unit: 'sqft' },
  { id: 'as-22', name: 'Attic Insulation', cost: 1225.0, unit: '1,600 sqft house' },
  { id: 'as-23', name: 'New Drywall to Studs (L&M)', cost: 5.2, unit: 'sqft' },
  { id: 'as-24', name: 'Aluminum Wiring', cost: 2450.0, unit: 'variable' },
  // Exterior  (ex-)
  { id: 'ex-01', name: 'Fence Repair — Chain Link / Wood Gate', cost: 225.0, unit: 'variable' },
  { id: 'ex-02', name: 'Fence Repair — Chain Link', cost: 275.0, unit: 'LF' },
  { id: 'ex-03', name: 'Fence Repair — Privacy 6ft', cost: 30.0, unit: 'LF' },
  { id: 'ex-04', name: 'Landscaping', cost: 450.0, unit: 'variable' },
  { id: 'ex-05', name: "Vinyl Siding (10'x10')", cost: 300.0, unit: 'square' },
  { id: 'ex-06', name: 'Tuck Pointing', cost: 225.0, unit: 'variable' },
  { id: 'ex-07', name: 'Exterior Paint', cost: 2.6, unit: 'sqft' },
  { id: 'ex-08', name: 'Exterior Wood Repair', cost: 525.0, unit: 'variable' },
  { id: 'ex-09', name: "Siding Repair (10'x10')", cost: 975.0, unit: 'section' },
  { id: 'ex-10', name: 'Tree Trimming', cost: 450.0, unit: 'variable' },
  { id: 'ex-11', name: 'Tree Removal (w/o stump)', cost: 1450.0, unit: 'tree' },
  { id: 'ex-12', name: 'Stump Grinding', cost: 250.0, unit: 'stump' },
  { id: 'ex-13', name: 'Aluminum Window Paint (Int/Ext)', cost: 700.0, unit: 'house' },
  { id: 'ex-14', name: 'Windows (3x5 sash)', cost: 425.0, unit: 'ea.' },
  { id: 'ex-15', name: 'Window Repair — Non-Insulated (6x6+)', cost: 35.0, unit: 'sf' },
  { id: 'ex-16', name: 'Window Repair — Insulated (6x6+)', cost: 40.0, unit: 'sf' },
  { id: 'ex-17', name: 'Aluminum Framed Window Pane', cost: 100.0, unit: 'pane' },
  { id: 'ex-18', name: 'Guttering', cost: 4.15, unit: 'LF' },
  { id: 'ex-19', name: 'Concrete w/ Demo', cost: 200.0, unit: 'sqft' },
  { id: 'ex-20', name: 'Mowing (summer, every 2 weeks)', cost: 45.0, unit: 'mowing' },
  { id: 'ex-21', name: 'Garage Door — 1 Car', cost: 975.0, unit: 'ea.' },
  { id: 'ex-22', name: 'Garage Door — 2 Car (Installed)', cost: 1225.0, unit: 'ea.' },
  { id: 'ex-23', name: 'Garage Conversion', cost: 8850.0, unit: 'ea.' },
];

/* ----------------------------------------------------------------
 * GROUPS — the 19 required collapsible groups from the brief, plus
 * the extra room-only groups (Closet, Lighting) needed to decouple
 * Bedroom and Living/Common areas from Interior/General per the
 * brief's explicit note. Each group lists the catalog ids it offers.
 *
 * Items can legitimately appear in more than one group (e.g. flooring
 * items are offered in Interior, Bedroom and Living). That is by
 * design: a group is a *menu* of relevant items, not an exclusive bin.
 * ---------------------------------------------------------------- */
const GROUPS = {
  // Interior / General
  'flooring':    { label: 'Flooring',            ids: ['ig-01','ig-02','ig-03','ig-04','ig-05','ig-06'] },
  'paint':       { label: 'Paint & Wall Repair', ids: ['ig-07','ig-08','ig-09','ig-19'] },
  'doors':       { label: 'Doors',               ids: ['ig-10','ig-11','ig-12','ig-13','ig-14','ig-15','ig-16','ig-17','ig-18'] },
  'pest':        { label: 'Pest Control',        ids: ['ig-23','ig-24'] },
  'general':     { label: 'General / Whole House', ids: ['ig-20','ig-21','ig-22','ig-25','ig-26','ig-27','ig-28'] },
  // Kitchen
  'cabinets':    { label: 'Cabinets',            ids: ['kt-01','kt-02','kt-03','kt-04','kt-05','kt-08'] },
  'counters':    { label: 'Countertops & Tile',  ids: ['kt-06','kt-07','kt-09','kt-10'] },
  'appliances':  { label: 'Appliances',          ids: ['kt-11','kt-12','kt-13','kt-14','kt-15','kt-16','kt-17'] },
  // Bathroom
  'vanity':      { label: 'Vanity & Countertop', ids: ['ba-01','ba-02','ba-03','ba-04','ba-14','ba-15'] },
  'tub':         { label: 'Tub & Shower',        ids: ['ba-07','ba-08','ba-09','ba-10','ba-11','ba-12','ba-13','ba-16'] },
  'bathtile':    { label: 'Tile',                ids: ['ba-05','ba-06'] },
  // Systems & Structure
  'hvac':        { label: 'HVAC',                ids: ['as-01','as-02','as-03','as-04','as-05','as-06','as-07'] },
  'electrical':  { label: 'Electrical',          ids: ['as-08','as-09','as-10','as-11','as-18','as-19','as-20','as-24'] },
  'structural':  { label: 'Structural',          ids: ['as-12','as-13','as-14','as-15','as-16','as-17'] },
  'insulation':  { label: 'Insulation & Drywall',ids: ['as-21','as-22','as-23'] },
  // Exterior
  'fence':       { label: 'Fence',               ids: ['ex-01','ex-02','ex-03','ex-04'] },
  'siding':      { label: 'Siding',              ids: ['ex-05','ex-06','ex-07','ex-08','ex-09','ex-13','ex-18','ex-19'] },
  'windows':     { label: 'Windows',             ids: ['ex-14','ex-15','ex-16','ex-17'] },
  'garage':      { label: 'Garage',              ids: ['ex-21','ex-22','ex-23'] },
  'trees':       { label: 'Trees & Yard',        ids: ['ex-10','ex-11','ex-12','ex-20'] },
  // Room-only groups (decoupled from Interior/General for Bedroom & Living)
  'closet':      { label: 'Closet',              ids: ['ig-10','ig-11','ig-12'], roomOnly: true },
  'lighting':    { label: 'Lighting',            ids: ['ig-22'], roomOnly: true },
};

/* The 19 brief-required groups, for the "19 groups" completeness claim. */
const REQUIRED_GROUP_KEYS = [
  'flooring','paint','doors','pest',           // Interior / General (4)
  'cabinets','counters','appliances',          // Kitchen (3)
  'vanity','tub','bathtile',                   // Bathroom (3)
  'hvac','electrical','structural','insulation', // Systems & Structure (4)
  'fence','siding','windows','garage','trees', // Exterior (5)
];

/* ----------------------------------------------------------------
 * ROOM_TYPES — each describes a kind of room the agent can add as
 * an instance. `multi:true` means it is normally added per-instance
 * (Bathroom 1, Bedroom 2). `fixed:true` rooms are seeded once for a
 * new project (whole-house scopes) but can still be removed/re-added.
 * `groups` lists which GROUPS that room exposes.
 * ---------------------------------------------------------------- */
const ROOM_TYPES = {
  interior:  { label: 'Interior / General', icon: '🏠', fixed: true,  groups: ['flooring','paint','doors','pest','general'] },
  systems:   { label: 'Systems & Structure', icon: '⚙️', fixed: true,  groups: ['hvac','electrical','structural','insulation'] },
  exterior:  { label: 'Exterior',           icon: '🌳', fixed: true,  groups: ['fence','siding','windows','garage','trees'] },
  kitchen:   { label: 'Kitchen',            icon: '🍳', multi: true,  groups: ['cabinets','counters','appliances'] },
  bathroom:  { label: 'Bathroom',           icon: '🛁', multi: true,  groups: ['vanity','tub','bathtile'] },
  bedroom:   { label: 'Bedroom',            icon: '🛏️', multi: true,  groups: ['flooring','paint','doors','closet'] },
  living:    { label: 'Living / Common',    icon: '🛋️', multi: true,  groups: ['flooring','paint','doors','lighting'] },
};

/* Default rooms seeded into a brand-new project. */
const DEFAULT_ROOMS = [
  { type: 'interior' },
  { type: 'kitchen' },
  { type: 'bathroom' },
  { type: 'systems' },
  { type: 'exterior' },
];

// Exposed for the rest of the app.
window.SPARK_DATA = {
  CATALOG_SEED, GROUPS, ROOM_TYPES, DEFAULT_ROOMS,
  REQUIRED_GROUP_KEYS,
};
})();
